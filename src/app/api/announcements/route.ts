import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/api/guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { notify } from "@/lib/notify/notify";
import { logAudit } from "@/lib/audit/log-audit";
import type { Role } from "@/lib/auth/roles";
import {
  audienceOf,
  canModify,
  describeAudience,
  isExpired,
  isForViewer,
  normalizeAudience,
  sortAnnouncements,
  AUDIENCE_ROLES,
  TITLE_MAX,
  BODY_MAX,
  type AnnouncementRow,
} from "@/lib/announcements/audience";

const roleEnum = z.enum(AUDIENCE_ROLES as unknown as [Role, ...Role[]]);

const postSchema = z.object({
  title: z.string().trim().min(1).max(TITLE_MAX),
  body: z.string().trim().min(1).max(BODY_MAX),
  delete_at: z.string().datetime().nullable().optional(),
  /** COM-1: an author may decide the post is quiet. Default is to send. */
  send_push: z.boolean().optional(),
  audience_roles: z.array(roleEnum).max(AUDIENCE_ROLES.length).optional(),
  audience_batches: z.array(z.string().min(1).max(20)).max(40).optional(),
  pinned: z.boolean().optional(),
  /** Set by the generators (birthday cron, report runs) so a rerun updates instead of duplicating. */
  dedupe_key: z.string().min(3).max(120).optional(),
});

/** The viewer's batch year, so batch-targeted posts can be matched. Null when unknown. */
async function viewerBatch(memberId: string | null | undefined): Promise<string | null> {
  if (!memberId) return null;
  const sb = getSupabaseAdmin();
  const { data } = await sb.from("members").select("batch").eq("id", memberId).maybeSingle();
  const batch = data?.batch;
  return typeof batch === "string" && batch.trim() ? batch.trim() : null;
}

/** Member ids for a batch audience, so a batch post can be pushed to exactly those people. */
async function memberIdsForBatches(batches: string[]): Promise<string[]> {
  if (batches.length === 0) return [];
  const sb = getSupabaseAdmin();
  const { data } = await sb.from("members").select("id").in("batch", batches);
  return (data ?? []).map((r) => String(r.id));
}

export async function GET(req: NextRequest) {
  // Everyone reads announcements, treasurer included: the composer lets an author aim a post at the
  // treasurer, and a role that can be targeted but not reached is a bug waiting to be noticed by the
  // one person it affects.
  const g = await requireRole(req.headers.get("cookie"), [
    "admin",
    "secretary",
    "member",
    "officer",
    "treasurer",
  ]);
  if (!g.ok) return g.response;

  const sb = getSupabaseAdmin();
  const url = new URL(req.url);
  const mine = url.searchParams.get("mine") === "1";
  const now = new Date();

  let q = sb
    .from("announcements")
    .select(
      "id, title, body, created_by, created_at, delete_at, audience_roles, audience_batches, pinned, updated_at",
    )
    .is("liturgy_session_date", null)
    .order("pinned", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(60);

  if (mine && (g.session.role === "admin" || g.session.role === "secretary" || g.session.role === "officer")) {
    // Everything the author ever wrote, expired included, so a post that has quietly run out is
    // still something they can find and delete.
    q = q.eq("created_by", g.session.role);
  } else {
    q = q.or(`delete_at.is.null,delete_at.gt.${now.toISOString()}`);
  }

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as Array<AnnouncementRow & { title: string; body: string; created_at: string }>;
  const batch = await viewerBatch(g.session.actor?.id);

  // Audience is filtered in the application rather than in SQL because the rule is a union of a role
  // array and a batch list, and the batch list lives in `members`, not in the post row.
  const visible = mine
    ? sortAnnouncements(rows, now, true)
    : sortAnnouncements(
        rows.filter((r) => isForViewer(audienceOf(r), { role: g.session.role, batch })),
        now,
      );

  return NextResponse.json({
    announcements: visible.map((r) => ({
      ...r,
      audience: describeAudience(audienceOf(r)),
      // The same rule the write route enforces, so the composer does not offer an Edit button that
      // comes back 403 and a secretary wonders which of the two is wrong.
      can_edit: canModify(r, g.session.role),
      expired: isExpired(r, now),
    })),
  });
}

export async function POST(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["admin", "secretary", "officer"]);
  if (!g.ok) return g.response;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = postSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const audience = normalizeAudience({
    roles: parsed.data.audience_roles,
    batches: parsed.data.audience_batches,
  });
  const wantPinned = parsed.data.pinned === true;

  const sb = getSupabaseAdmin();

  // The database trigger refuses a fourth pin, but a trigger error is a 500 and a question the
  // officer can answer is not. Check first so the composer gets the choice.
  if (wantPinned) {
    const { count } = await sb
      .from("announcements")
      .select("id", { count: "exact", head: true })
      .eq("pinned", true);
    if ((count ?? 0) >= 3) {
      return NextResponse.json(
        { error: "Three announcements are already pinned. Unpin one before pinning another." },
        { status: 409 },
      );
    }
  }

  const row = {
    title: parsed.data.title,
    body: parsed.data.body,
    created_by: g.session.role,
    delete_at: parsed.data.delete_at ?? null,
    audience_roles: audience.roles,
    audience_batches: audience.batches,
    pinned: wantPinned,
    dedupe_key: parsed.data.dedupe_key ?? null,
  };

  // A plain insert rather than an upsert on the dedupe key: the unique index behind that key is
  // partial, and asking PostgREST to infer it as the arbiter is a thing that works until it does
  // not. The generators use `insertOnceByDedupeKey`, which handles the collision explicitly, and
  // this route is for humans who do not supply a key.
  const { data, error } = await sb
    .from("announcements")
    .insert(row)
    .select("id, created_at")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // The catalog owns the wording and the recipient rule. What this route supplies is the author's
  // choice, resolved: roles stay roles, a batch becomes the people in it.
  const title = g.session.role === "officer" ? `[Officer] ${parsed.data.title}` : parsed.data.title;

  // The audience is a union, so the push has to resolve both halves. Asking for members only when no
  // roles were chosen meant that "the servers and batch 2" reached the servers' devices and nobody
  // else's, which is a quiet version of the leak this module exists to close.
  const targeted = audience.roles.length > 0 || audience.batches.length > 0;
  const memberIds = targeted ? await memberIdsForBatches(audience.batches) : [];

  // COM-1: `send_push: false` means a quiet post. It still exists and is still in the feed; it just
  // does not interrupt anybody. The default is to send, because silence-by-default is how an
  // announcement becomes a note nobody reads.
  if (parsed.data.send_push !== false) {
    await notify(
      "announcement_posted",
      {
        announcement_id: String(data?.id ?? ""),
        title,
        audience_roles: audience.roles,
        member_ids: memberIds,
        // Records that the author narrowed the audience, even when that audience resolved to nobody.
        // A batch with no members in it must reach zero devices, not every device.
        audience_specified: targeted,
      },
      { fromRole: g.session.role },
    );
  }

  await logAudit({
    actor: { role: g.session.role, memberId: g.session.actor?.id ?? null, name: g.session.actor?.name ?? null },
    action: "announcement_created",
    entityType: "announcement",
    entityId: data?.id ?? null,
    meta: {
      audience: describeAudience(audience),
      pinned: wantPinned,
      expires: parsed.data.delete_at ?? null,
      push: parsed.data.send_push !== false,
    },
  });

  return NextResponse.json({
    ok: true,
    id: data?.id ?? null,
    audience: describeAudience(audience),
    pushed: parsed.data.send_push !== false,
  });
}
