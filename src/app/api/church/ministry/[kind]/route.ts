import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api/guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { badRequest, jsonOk } from "@/lib/api/response";
import { logAudit } from "@/lib/audit/log-audit";
import { isUndeployedSchemaError, migrationMessage } from "@/lib/supabase/migration-error";
import {
  MINISTRY_COLUMNS,
  MINISTRY_TABLE,
  createSchema,
  isMinistryKind,
  nextSortOrder,
  type MinistryKind,
} from "@/lib/church/ministry";
import type { AuditAction } from "@/lib/audit/actions";

/**
 * Adding one row to one of the three editable landing-page lists.
 *
 * Super admin, for the same reason the rest of the church module is: this is published to signed-out
 * strangers, and it names the parish's ministry.
 *
 * The `[kind]` segment is checked against a closed list before it is ever concatenated into a table
 * name. It arrives in the path, so `MINISTRY_TABLE[kind]` is the only thing standing between a request
 * and an arbitrary table -- and a lookup that returns `undefined` for an unknown kind fails there,
 * rather than building a query against the string "undefined".
 */

type Ctx = { params: Promise<{ kind: string }> };

/**
 * The audit action per kind, so the log reads as what happened rather than as a URL.
 *
 * Typed as the audit catalogue's own union rather than `string`, so adding a kind without adding its
 * three actions is a compile error here instead of a runtime rejection at the point somebody has already
 * made the change.
 */
const ACTION: Record<MinistryKind, AuditAction> = {
  role: "ministry_role_added",
  milestone: "history_milestone_added",
  patron: "patron_added",
};

export async function POST(req: NextRequest, ctx: Ctx) {
  const g = await requireRole(req.headers.get("cookie"), ["super_admin"]);
  if (!g.ok) return g.response;

  const { kind } = await ctx.params;
  if (!isMinistryKind(kind)) return badRequest("That is not a list on this page.");

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return badRequest("Invalid JSON.");
  }

  const parsed = createSchema(kind).safeParse(json);
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? "That could not be read.");

  const sb = getSupabaseAdmin();
  const table = MINISTRY_TABLE[kind];
  const columns = MINISTRY_COLUMNS[kind];

  // Read the current order first so the new row lands last. Not atomic, and does not need to be: two
  // super admins adding a row at the same instant is not a race worth a transaction, and the worst case
  // is two rows sharing a position, which the editor's reorder handles.
  const { data: existing, error: readErr } = await sb.from(table).select("sort_order");
  if (readErr) {
    return NextResponse.json(
      { error: isUndeployedSchemaError(readErr) ? migrationMessage("040_parish_content.sql") : readErr.message },
      { status: 500 },
    );
  }

  const row: Record<string, unknown> = { ...parsed.data };
  row.sort_order = parsed.data.sort_order ?? nextSortOrder(existing ?? []);

  const { data, error } = await sb
    .from(table)
    .insert(row)
    .select(columns)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: isUndeployedSchemaError(error) ? migrationMessage("040_parish_content.sql") : error.message },
      { status: 500 },
    );
  }

  await logAudit({
    actor: { role: g.session.role, memberId: g.session.actor?.id ?? null, name: g.session.actor?.name ?? null },
    action: ACTION[kind],
    entityType: table,
    entityId: (data as { id?: string } | null)?.id ?? null,
    meta: { kind },
    ip: req.headers.get("x-forwarded-for"),
  });

  return jsonOk({ row: data });
}