import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/api/guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit/log-audit";
import {
  canModify,
  MAX_PINNED,
  normalizeAudience,
  AUDIENCE_ROLES,
  TITLE_MAX,
  BODY_MAX,
  type AnnouncementRow,
} from "@/lib/announcements/audience";
import type { Role } from "@/lib/auth/roles";

const patchSchema = z.object({
  title: z.string().trim().min(1).max(TITLE_MAX).optional(),
  body: z.string().trim().min(1).max(BODY_MAX).optional(),
  delete_at: z.string().datetime().nullable().optional(),
  pinned: z.boolean().optional(),
  audience: z
    .object({
      roles: z.array(z.enum(AUDIENCE_ROLES as unknown as [Role, ...Role[]])).max(AUDIENCE_ROLES.length),
      batches: z.array(z.string().min(1).max(20)).max(40),
    })
    .optional(),
});

type Ctx = { params: Promise<{ id: string }> };

/**
 * COM-1: the creator's role or an admin may change it. System rows never, because the birthday
 * post's text is generated and its style is fixed.
 */
async function loadEditable(id: string, viewerRole: Role) {
  const sb = getSupabaseAdmin();
  const { data: row, error } = await sb
    .from("announcements")
    .select("id, created_by, pinned, audience_roles, audience_batches")
    .eq("id", id)
    .maybeSingle();
  if (error || !row) return { allowed: false as const, reason: "not_found" as const };
  if (!canModify(row as AnnouncementRow, viewerRole)) {
    return { allowed: false as const, reason: "forbidden" as const };
  }
  return { allowed: true as const, row, sb };
}

/**
 * COM-1: editing a post, and pinning it.
 *
 * `updated_at` is what the feed reads to decide whether to print "Edited", so it is set here rather
 * than in the database: the column is nullable on purpose, and NULL is a meaningful value here, not
 * an oversight.
 */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const g = await requireRole(req.headers.get("cookie"), ["admin", "secretary", "officer"]);
  if (!g.ok) return g.response;
  const { id } = await ctx.params;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const loaded = await loadEditable(id, g.session.role);
  if (!loaded.allowed) {
    return NextResponse.json(
      { error: loaded.reason === "not_found" ? "Not found" : "You cannot edit this announcement" },
      { status: loaded.reason === "not_found" ? 404 : 403 },
    );
  }

  const { row, sb } = loaded;

  if (parsed.data.pinned === true && !row.pinned) {
    const { count } = await sb
      .from("announcements")
      .select("id", { count: "exact", head: true })
      .eq("pinned", true);
    if ((count ?? 0) >= MAX_PINNED) {
      return NextResponse.json(
        {
          error: `At most ${MAX_PINNED} announcements can be pinned. Unpin one first.`,
        },
        { status: 409 },
      );
    }
  }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (parsed.data.title !== undefined) update.title = parsed.data.title;
  if (parsed.data.body !== undefined) update.body = parsed.data.body;
  if (parsed.data.delete_at !== undefined) update.delete_at = parsed.data.delete_at;
  if (parsed.data.pinned !== undefined) update.pinned = parsed.data.pinned;
  if (parsed.data.audience !== undefined) {
    // Same rule as creation: empty means "everyone", and anything else is stored as the union the
    // author actually chose. Storing the raw body would let a typo silently become a broadcast.
    const audience = normalizeAudience(parsed.data.audience);
    update.audience_roles = audience.roles;
    update.audience_batches = audience.batches;
  }

  const { error } = await sb.from("announcements").update(update).eq("id", id);
  if (error) {
    if (error.code === "check_violation") {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await logAudit({
    actor: { role: g.session.role, memberId: g.session.actor?.id ?? null, name: g.session.actor?.name ?? null },
    action: "announcement_updated",
    entityType: "announcement",
    entityId: id,
    meta: { fields: Object.keys(update).filter((k) => k !== "updated_at") },
  });

  return NextResponse.json({ ok: true, updated_at: update.updated_at });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const g = await requireRole(req.headers.get("cookie"), ["admin", "secretary", "officer"]);
  if (!g.ok) return g.response;
  const { id } = await ctx.params;

  const loaded = await loadEditable(id, g.session.role);
  if (!loaded.allowed) {
    return NextResponse.json(
      { error: loaded.reason === "not_found" ? "Not found" : "You cannot delete this announcement" },
      { status: loaded.reason === "not_found" ? 404 : 403 },
    );
  }

  const { error } = await loaded.sb.from("announcements").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logAudit({
    actor: { role: g.session.role, memberId: g.session.actor?.id ?? null, name: g.session.actor?.name ?? null },
    action: "announcement_deleted",
    entityType: "announcement",
    entityId: id,
  });

  return NextResponse.json({ ok: true });
}
