import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/api/guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { badRequest, jsonOk, notFound } from "@/lib/api/response";
import { logAudit } from "@/lib/audit/log-audit";
import {
  PHOTO_BUCKET,
  buildPhotoKey,
  keyFromPhotoUrl,
  publicPhotoUrl,
  validatePhoto,
  type PhotoScope,
} from "@/lib/church/photos";

/**
 * Upload a photograph for the priest or a council member.
 *
 * One endpoint for both, and it writes the row as well as storing the object. Two requests -- upload,
 * then PATCH the URL -- would leave an orphan in a public bucket every time the second one failed, which
 * is every time somebody closed the tab between them. Here the URL lands in the table or nothing is
 * claimed to have worked.
 *
 * Super admin, for the same reason the rest of the church module is: these images are published to
 * signed-out strangers and they are photographs of identifiable people.
 */

const fields = z.object({
  scope: z.enum(["priest", "council"]),
  member_id: z.string().uuid().optional(),
});

/** The seeded profile row. Same fixed id as the profile write path. */
const PROFILE_ID = "00000000-0000-0000-0000-000000000001";

export async function POST(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["super_admin"]);
  if (!g.ok) return g.response;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return badRequest("That upload could not be read.");
  }

  const file = form.get("file");
  const parsedFields = fields.safeParse({
    scope: form.get("scope"),
    member_id: form.get("member_id") ?? undefined,
  });

  if (!parsedFields.success) {
    return badRequest("That upload is missing who the photograph is for.");
  }
  if (!(file instanceof File)) {
    return badRequest("Choose a photograph to upload.");
  }

  const { scope, member_id } = parsedFields.data;
  if (scope === "council" && !member_id) {
    return badRequest("Which council member is this photograph for?");
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  // The declared `file.type` is never consulted. A browser can be told anything, this route is exactly
  // where a renamed script arrives, and the bytes are published to the public immediately afterwards.
  const check = validatePhoto(bytes);
  if (!check.ok) return badRequest(check.message);

  const sb = getSupabaseAdmin();
  const key = buildPhotoKey(scope as PhotoScope, check.type);
  const url = publicPhotoUrl(key, process.env.NEXT_PUBLIC_SUPABASE_URL);
  if (!url) {
    // Without a project URL there is nothing to store the photograph *at*. Saying so is better than
    // uploading it somewhere nobody will look for it.
    return NextResponse.json(
      { error: "Photographs are not available on this deployment: the storage URL is not set." },
      { status: 500 },
    );
  }

  // The previous photograph, so it can go once the new one is in place. Read before the write, because
  // after the write the row no longer holds it.
  const previous = await currentPhotoUrl(sb, scope, member_id);
  if (previous === "missing") return notFound("That council member no longer exists.");

  const { error: upErr } = await sb.storage.from(PHOTO_BUCKET).upload(key, bytes, {
    contentType: check.type,
    // False, not true: a collision would mean two rows pointing at one object, and the next person's
    // replace would delete the photograph out from under them.
    upsert: false,
  });
  if (upErr) {
    return NextResponse.json(
      { error: `The photograph could not be stored: ${upErr.message}` },
      { status: 500 },
    );
  }

  const written = await writePhotoUrl(sb, scope, member_id, url);
  if (!written.ok) {
    // The object is stored but nothing points at it. Removing it now keeps the bucket from filling with
    // photographs no page will ever show.
    await sb.storage.from(PHOTO_BUCKET).remove([key]);
    return NextResponse.json({ error: written.message }, { status: 500 });
  }

  // Best-effort, after the row is correct. A leftover object costs storage; a missing photograph costs
  // the parish its priest's picture, so the order is not negotiable.
  const stale = keyFromPhotoUrl(previous, process.env.NEXT_PUBLIC_SUPABASE_URL);
  if (stale && stale !== key) {
    void sb.storage.from(PHOTO_BUCKET).remove([stale]).catch(() => {});
  }

  await logAudit({
    actor: { role: g.session.role, memberId: g.session.actor?.id ?? null, name: g.session.actor?.name ?? null },
    action: "church_photo_uploaded",
    entityType: scope === "priest" ? "church_profile" : "council_members",
    entityId: scope === "priest" ? PROFILE_ID : (member_id as string),
    // The key, not the person's name: the audit log records what changed, and the row already holds the
    // name of whoever this is.
    meta: { scope, key },
    ip: req.headers.get("x-forwarded-for"),
  });

  return jsonOk({ photo_url: url });
}

/** The photograph currently on this row, or null, or "missing" when the row is gone. */
async function currentPhotoUrl(
  sb: ReturnType<typeof getSupabaseAdmin>,
  scope: string,
  memberId: string | undefined,
): Promise<string | null | "missing"> {
  if (scope === "priest") {
    const { data } = await sb
      .from("church_profile")
      .select("photo_url")
      .eq("id", PROFILE_ID)
      .maybeSingle();
    // No profile row is not a failure here: the write path below creates one, same as the PUT handler.
    return data ? (data.photo_url as string | null) : null;
  }
  const { data } = await sb
    .from("council_members")
    .select("photo_url")
    .eq("id", memberId as string)
    .maybeSingle();
  if (!data) return "missing";
  return data.photo_url as string | null;
}

async function writePhotoUrl(
  sb: ReturnType<typeof getSupabaseAdmin>,
  scope: string,
  memberId: string | undefined,
  url: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (scope === "priest") {
    const { error } = await sb
      .from("church_profile")
      .update({ photo_url: url, updated_at: new Date().toISOString() })
      .eq("id", PROFILE_ID);
    if (error) return { ok: false, message: error.message };

    // The seeded row may not exist on a database created before the seed ran. Insert it rather than
    // reporting success for a write that matched nothing.
    const { data: check } = await sb.from("church_profile").select("id").eq("id", PROFILE_ID).maybeSingle();
    if (!check) {
      const { error: insErr } = await sb.from("church_profile").insert({ id: PROFILE_ID, photo_url: url });
      if (insErr) return { ok: false, message: insErr.message };
    }
    return { ok: true };
  }

  const { data, error } = await sb
    .from("council_members")
    .update({ photo_url: url, updated_at: new Date().toISOString() })
    .eq("id", memberId as string)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, message: error.message };
  if (!data) return { ok: false, message: "That council member no longer exists." };
  return { ok: true };
}