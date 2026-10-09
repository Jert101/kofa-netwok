import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/api/guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { badRequest, jsonOk, notFound } from "@/lib/api/response";
import { logAudit } from "@/lib/audit/log-audit";

/**
 * Changing or removing one council member.
 *
 * Super admin only, for the same reason adding is: these names are published to signed-out strangers.
 */

type Ctx = { params: Promise<{ id: string }> };

const field = (max: number) => z.string().trim().max(max);

const patchSchema = z.object({
  name: field(120).nullish(),
  office: field(120).nullish(),
  bio: field(600).nullish(),
  sort_order: z.number().int().min(0).max(999).nullish(),
  /** Vacated rather than deleted, which is what a seat changing hands actually is. */
  is_active: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const g = await requireRole(req.headers.get("cookie"), ["super_admin"]);
  if (!g.ok) return g.response;

  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return badRequest("Which council member?");

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return badRequest("Invalid JSON.");
  }
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? "That could not be read.");

  // An empty object is a silent no-op, which reads as a save that did nothing. Said out loud instead.
  const changes = Object.entries(parsed.data).filter(([, v]) => v !== undefined);
  if (changes.length === 0) return badRequest("Nothing to change.");

  // A blank name would publish an empty card. Blank is fine for the optional fields and refused for the
  // name, because there is no sensible version of a nameless council member.
  if (changes.some(([k, v]) => k === "name" && !v)) {
    return badRequest("A council member needs a name.");
  }

  const sb = getSupabaseAdmin();
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const [key, value] of changes) {
    // An empty string means "no office" or "no bio". Stored as-is it reads back as a blank line rather
    // than as absent, which is why it becomes null here instead.
    patch[key] = value === "" ? null : value;
  }

  const { data, error } = await sb
    .from("council_members")
    .update(patch)
    .eq("id", id)
    .select("id, name, office, bio, sort_order, is_active")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return notFound("That council member no longer exists.");

  await logAudit({
    actor: { role: g.session.role, memberId: g.session.actor?.id ?? null, name: g.session.actor?.name ?? null },
    action: "council_member_updated",
    entityType: "council_members",
    entityId: id,
    meta: { changed: changes.map(([k]) => k) },
    ip: req.headers.get("x-forwarded-for"),
  });

  return jsonOk({ member: data });
}

/**
 * Removing somebody entirely, as opposed to vacating their seat.
 *
 * Both exist and they are not the same. Vacating (`is_active: false`) keeps the row and its place in the
 * order for when the seat is filled again; this is for a name that should not be in the table at all,
 * a typo that was added by accident, or somebody who asked to be taken down.
 */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const g = await requireRole(req.headers.get("cookie"), ["super_admin"]);
  if (!g.ok) return g.response;

  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return badRequest("Which council member?");

  const sb = getSupabaseAdmin();
  const { data: existing } = await sb
    .from("council_members")
    .select("name")
    .eq("id", id)
    .maybeSingle();
  if (!existing) return notFound("That council member no longer exists.");

  const { error } = await sb.from("council_members").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logAudit({
    actor: { role: g.session.role, memberId: g.session.actor?.id ?? null, name: g.session.actor?.name ?? null },
    action: "council_member_removed",
    entityType: "council_members",
    entityId: id,
    // The name, because "a row was deleted" tells nobody who left the council.
    meta: { name: existing.name },
    ip: req.headers.get("x-forwarded-for"),
  });

  return jsonOk({ ok: true });
}