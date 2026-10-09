import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api/guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { badRequest, jsonOk, notFound } from "@/lib/api/response";
import { logAudit } from "@/lib/audit/log-audit";
import { isUndeployedSchemaError, migrationMessage } from "@/lib/supabase/migration-error";
import {
  MINISTRY_COLUMNS,
  MINISTRY_TABLE,
  isMinistryKind,
  patchSchema,
  type MinistryKind,
} from "@/lib/church/ministry";
import type { AuditAction } from "@/lib/audit/actions";

/**
 * Changing or removing one row of one of the three editable landing-page lists.
 *
 * Super admin only. The council has its own equivalent route; this one covers roles, milestones and
 * patrons, which differ only in their columns and so are the same request three times over.
 */

type Ctx = { params: Promise<{ kind: string; id: string }> };

const ACTION: Record<MinistryKind, { updated: AuditAction; removed: AuditAction }> = {
  role: { updated: "ministry_role_updated", removed: "ministry_role_removed" },
  milestone: { updated: "history_milestone_updated", removed: "history_milestone_removed" },
  patron: { updated: "patron_updated", removed: "patron_removed" },
};

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const g = await requireRole(req.headers.get("cookie"), ["super_admin"]);
  if (!g.ok) return g.response;

  const { kind, id } = await ctx.params;
  if (!isMinistryKind(kind)) return badRequest("That is not a list on this page.");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return badRequest("Which entry?");

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return badRequest("Invalid JSON.");
  }

  const parsed = patchSchema(kind).safeParse(json);
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? "That could not be read.");

  // An empty object is a silent no-op, which reads as a save that did nothing. Said out loud instead.
  const changes = Object.entries(parsed.data).filter(([, v]) => v !== undefined);
  if (changes.length === 0) return badRequest("Nothing to change.");

  const sb = getSupabaseAdmin();
  const table = MINISTRY_TABLE[kind];
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const [key, value] of changes) {
    // An empty string means "no note", "no description". Stored as-is it reads back as a blank line
    // rather than as absent, which is why it becomes null.
    patch[key] = value === "" ? null : value;
  }

  const { data, error } = await sb
    .from(table)
    .update(patch)
    .eq("id", id)
    .select(MINISTRY_COLUMNS[kind])
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: isUndeployedSchemaError(error) ? migrationMessage("040_parish_content.sql") : error.message },
      { status: 500 },
    );
  }
  if (!data) return notFound("That entry no longer exists.");

  await logAudit({
    actor: { role: g.session.role, memberId: g.session.actor?.id ?? null, name: g.session.actor?.name ?? null },
    action: ACTION[kind].updated,
    entityType: table,
    entityId: id,
    meta: { changed: changes.map(([k]) => k) },
    ip: req.headers.get("x-forwarded-for"),
  });

  return jsonOk({ row: data });
}

/**
 * Removing an entry outright, as opposed to vacating it with `is_active: false`.
 *
 * Both exist, for the same reason they do on the council: a list that quietly loses a row when somebody
 * corrects a typo reads as a mistake, so a deliberate removal is a separate, obvious act.
 */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const g = await requireRole(req.headers.get("cookie"), ["super_admin"]);
  if (!g.ok) return g.response;

  const { kind, id } = await ctx.params;
  if (!isMinistryKind(kind)) return badRequest("That is not a list on this page.");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return badRequest("Which entry?");

  const sb = getSupabaseAdmin();
  const table = MINISTRY_TABLE[kind];

  const { data: existing, error: readErr } = await sb
    .from(table)
    .select(MINISTRY_COLUMNS[kind])
    .eq("id", id)
    .maybeSingle();
  if (readErr) {
    return NextResponse.json(
      { error: isUndeployedSchemaError(readErr) ? migrationMessage("040_parish_content.sql") : readErr.message },
      { status: 500 },
    );
  }
  if (!existing) return notFound("That entry no longer exists.");

  const { error } = await sb.from(table).delete().eq("id", id);
  if (error) {
    return NextResponse.json(
      { error: isUndeployedSchemaError(error) ? migrationMessage("040_parish_content.sql") : error.message },
      { status: 500 },
    );
  }

  await logAudit({
    actor: { role: g.session.role, memberId: g.session.actor?.id ?? null, name: g.session.actor?.name ?? null },
    action: ACTION[kind].removed,
    entityType: table,
    entityId: id,
    // The row, because "a row was deleted" tells nobody what disappeared from the public page.
    meta: { row: existing },
    ip: req.headers.get("x-forwarded-for"),
  });

  return jsonOk({ ok: true });
}