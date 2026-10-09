import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/api/guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { badRequest, jsonOk } from "@/lib/api/response";
import { logAudit } from "@/lib/audit/log-audit";
import { isUndeployedSchemaError, migrationMessage } from "@/lib/supabase/migration-error";

/**
 * Adding somebody to the council.
 *
 * Super admin only, and that is not a formality. This is the one table in the app whose contents are
 * published to signed-out strangers, and it names real people. An admin overseeing the sacristy has no
 * business rewriting who the parish says its council is.
 */

const field = (max: number) => z.string().trim().max(max);

const addSchema = z.object({
  name: field(120).pipe(z.string().min(1, "A council member needs a name.")),
  office: field(120).nullish(),
  bio: field(600).nullish(),
  sort_order: z.number().int().min(0).max(999).optional(),
});

export async function POST(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["super_admin"]);
  if (!g.ok) return g.response;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return badRequest("Invalid JSON.");
  }
  const parsed = addSchema.safeParse(json);
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? "That could not be read.");

  const sb = getSupabaseAdmin();

  // Land the new member after the last one rather than at the top, so adding somebody does not silently
  // reorder everybody else's seat. The officer edits the order afterwards.
  const { data: last, error: lastErr } = await sb
    .from("council_members")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Checked, because this used to be ignored. On a database where migration 038 has not been applied the
  // read fails, the error is dropped, and the insert then fails with a *different* message about the same
  // missing table -- which is how a deployment step turns into a puzzle nobody can solve from the screen.
  if (lastErr) {
    return NextResponse.json(
      {
        error: isUndeployedSchemaError(lastErr)
          ? migrationMessage("038_church_ministry.sql")
          : `The council table could not be read: ${lastErr.message}`,
      },
      { status: 500 },
    );
  }

  const { data, error } = await sb
    .from("council_members")
    .insert({
      name: parsed.data.name,
      office: parsed.data.office || null,
      bio: parsed.data.bio || null,
      sort_order: parsed.data.sort_order ?? ((last?.sort_order as number | undefined) ?? -1) + 1,
    })
    .select("id, name, office, bio, sort_order, is_active")
    .single();

  if (error) {
    return NextResponse.json(
      {
        error: isUndeployedSchemaError(error)
          ? migrationMessage("038_church_ministry.sql")
          : error.message,
      },
      { status: 500 },
    );
  }

  await logAudit({
    actor: { role: g.session.role, memberId: g.session.actor?.id ?? null, name: g.session.actor?.name ?? null },
    action: "council_member_added",
    entityType: "council_members",
    entityId: data.id as string,
    meta: { name: data.name, office: data.office },
    ip: req.headers.get("x-forwarded-for"),
  });

  return jsonOk({ member: data });
}