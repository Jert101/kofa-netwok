import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/api/guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getSetting } from "@/lib/settings/store";
import { jsonOk, internalError } from "@/lib/api/response";
import { logAudit } from "@/lib/audit/log-audit";

/**
 * The seeded `church_profile` row. A fixed id so the write path can address the one row without first
 * having to read it, and so a second insert -- from a reseeded database, say -- collides with the
 * singleton index rather than quietly adding a profile nobody is looking at.
 */
const PROFILE_ID = "00000000-0000-0000-0000-000000000001";

/**
 * The parish's public face: who leads it, what the ministry is, and the council.
 *
 * **Unauthenticated on purpose**, because the landing page is what a signed-out visitor sees and it has
 * to say something. That makes this the only route in the app that hands parish content to a stranger,
 * so it returns exactly the fields the page renders and nothing else: no addresses, no contact details,
 * no internal ids the page does not use, and no inactive council members.
 *
 * The parish name comes from `church_name` in settings rather than from `church_profile`, so the name on
 * this page is the same name that prints on every report. It is read here rather than in the page
 * because a route that answers "who is this parish" answering completely is easier to keep complete.
 */
export async function GET() {
  const sb = getSupabaseAdmin();

  const [{ data: profile, error: pErr }, { data: members, error: mErr }, churchName] = await Promise.all([
    sb.from("church_profile").select("priest_name, headline, about, updated_at").limit(1).maybeSingle(),
    sb
      .from("council_members")
      .select("id, name, office, bio, sort_order")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    // A bad or missing setting must not take the front door down with it; the registry default is a
    // perfectly good parish name and this is the page a stranger lands on.
    getSetting("church_name").catch(() => "Knights of the Altar"),
  ]);

  if (pErr) return internalError(pErr.message);
  if (mErr) return internalError(mErr.message);

  return jsonOk({
    parish_name: churchName,
    priest_name: profile?.priest_name ?? null,
    headline: profile?.headline ?? null,
    about: profile?.about ?? null,
    updated_at: profile?.updated_at ?? null,
    council: members ?? [],
  });
}

const profileSchema = z.object({
  priest_name: z.string().trim().max(160).nullable(),
  headline: z.string().trim().max(200).nullable(),
  about: z.string().trim().max(4000).nullable(),
});

/**
 * Editing the profile the landing page renders.
 *
 * Super admin only. This is content published to signed-out strangers and it names the parish's
 * leadership, so it is not something an admin overseeing the sacristy should be able to rewrite.
 *
 * Every field is nullable and blank is a real value: clearing the priest line is how the parish says the
 * post is vacant, and storing an empty string instead would render a heading with nothing under it.
 */
export async function PUT(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["super_admin"]);
  if (!g.ok) return g.response;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const parsed = profileSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "That could not be read." },
      { status: 400 },
    );
  }

  const sb = getSupabaseAdmin();
  const blank = (v: string | null | undefined) => (v ?? "").trim() || null;
  const values = {
    priest_name: blank(parsed.data.priest_name),
    headline: blank(parsed.data.headline),
    about: blank(parsed.data.about),
  };

  // The seeded row id, so this updates the one row rather than fighting the singleton index. A database
  // created before this migration's seed ran has no row, and the insert below covers that.
  const { data: updated, error } = await sb
    .from("church_profile")
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq("id", PROFILE_ID)
    .select("priest_name, headline, about, updated_at")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let profile = updated;
  if (!profile) {
    const { data: inserted, error: insErr } = await sb
      .from("church_profile")
      .insert({ id: PROFILE_ID, ...values })
      .select("priest_name, headline, about, updated_at")
      .maybeSingle();
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
    profile = inserted;
  }

  await logAudit({
    actor: { role: g.session.role, memberId: g.session.actor?.id ?? null, name: g.session.actor?.name ?? null },
    action: "church_profile_updated",
    entityType: "church_profile",
    entityId: PROFILE_ID,
    meta: {
      // Which fields were written, not what they now say: the audit log is not the place to keep a copy
      // of the parish's published biography.
      changed: Object.keys(values),
    },
    ip: req.headers.get("x-forwarded-for"),
  });

  return jsonOk({ profile });
}