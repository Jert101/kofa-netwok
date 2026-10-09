import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/api/guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { jsonOk, internalError } from "@/lib/api/response";
import { logAudit } from "@/lib/audit/log-audit";
import { discardPhotoObject } from "@/lib/church/photos";
import { readPublicChurchProfile } from "@/lib/church/profile-server";

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
  // The read lives in `profile-server` so the landing page and this route cannot drift apart. It used to
  // be here alone, and the page called this route over HTTP to get it -- see that file for why that
  // quietly showed the front door without any parish content on every single request.
  const result = await readPublicChurchProfile();
  if (!result.ok) return internalError(result.reason);

  return jsonOk(result.profile);
}

const profileSchema = z.object({
  priest_name: z.string().trim().max(160).nullable(),
  priest_role: z.string().trim().max(120).nullable(),
  headline: z.string().trim().max(200).nullable(),
  about: z.string().trim().max(4000).nullable(),
  /**
   * Set by the photo route, and clearable here.
   *
   * A blank string means "remove the photograph", which is why this exists alongside the upload route
   * rather than being done there: clearing is not an upload, and a DELETE that sometimes works and
   * sometimes leaves a row pointing at a deleted object is worse than a field that says null.
   */
  photo_url: z.string().trim().max(600).nullable().optional(),
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
  const values: Record<string, string | null> = {
    priest_name: blank(parsed.data.priest_name),
    priest_role: blank(parsed.data.priest_role),
    headline: blank(parsed.data.headline),
    about: blank(parsed.data.about),
  };
  // Only written when it was sent. A client that has never heard of photographs sends nothing here, and
  // must not be read as asking to remove the one that is there.
  const clearingPhoto = parsed.data.photo_url !== undefined && blank(parsed.data.photo_url) === null;
  if (parsed.data.photo_url !== undefined) {
    values.photo_url = blank(parsed.data.photo_url);
  }

  // Read before the write below, because after it the column is empty and there is nothing left to say
  // which file to delete.
  let previousPhoto: string | null = null;
  if (clearingPhoto) {
    const { data: prior } = await sb
      .from("church_profile")
      .select("photo_url")
      .eq("id", PROFILE_ID)
      .maybeSingle();
    previousPhoto = (prior?.photo_url as string | null) ?? null;
  }

  // The seeded row id, so this updates the one row rather than fighting the singleton index. A database
  // created before this migration's seed ran has no row, and the insert below covers that.
  const { data: updated, error } = await sb
    .from("church_profile")
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq("id", PROFILE_ID)
    .select("priest_name, priest_role, headline, about, photo_url, updated_at")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let profile = updated;
  if (!profile) {
    const { data: inserted, error: insErr } = await sb
      .from("church_profile")
      .insert({ id: PROFILE_ID, ...values })
      .select("priest_name, priest_role, headline, about, photo_url, updated_at")
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

  // Clearing the photograph deletes the file as well as the reference. Replacing one did this already --
  // which is what made the gap easy to miss: Replace cleaned up after itself and Remove did not, so a
  // photograph of the priest that the parish took down kept being served from the public bucket to
  // anyone already holding its URL.
  if (clearingPhoto) {
    const discarded = await discardPhotoObject(sb, previousPhoto, process.env.NEXT_PUBLIC_SUPABASE_URL);
    if (!discarded.ok) {
      await logAudit({
        actor: { role: g.session.role, memberId: g.session.actor?.id ?? null, name: g.session.actor?.name ?? null },
        action: "church_profile_updated",
        entityType: "church_profile",
        entityId: PROFILE_ID,
        meta: { changed: ["photo_url"], storage_cleanup_failed: discarded.message },
        ip: req.headers.get("x-forwarded-for"),
      });
      return NextResponse.json(
        {
          error: `The photograph is off the page but the file could not be deleted from storage: ${discarded.message}`,
        },
        { status: 500 },
      );
    }
  }

  return jsonOk({ profile });
}