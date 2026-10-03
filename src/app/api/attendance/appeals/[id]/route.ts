import { NextRequest } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/api/guard";
import {
  alreadyResolved,
  badRequest,
  internalError,
  jsonOk,
  notFound,
  reportLocked,
  validationFailed,
  zodFields,
} from "@/lib/api/response";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getClientIp } from "@/lib/auth/ip-hash";
import { logAudit } from "@/lib/audit/log-audit";
import { notifyAttendanceSessionUpdated } from "@/lib/push/attendance-notify";
import { formatAppealRejectReason } from "@/lib/appeals/reject-reasons";
import { approveAppealItems, rejectAppealItem } from "@/features/appeals/server/appeals";

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve") }),
  z.object({
    action: z.literal("reject"),
    reason: z.string().max(120).trim().optional(),
    note: z.string().max(400).optional(),
  }),
]);

/**
 * APL-3 + APL-5 + APL-7: decide one appeal item.
 *
 * The item row is kept after this call. That is the reversal this module makes: approval
 * used to DELETE the item and then delete the parent appeal once empty, which meant the
 * record of a decision disappeared at the moment it was made. Now the row records who
 * decided, when, and why, which is what lets the member see their own outcome.
 *
 * A second click returns ALREADY_RESOLVED rather than 404. Two reviewers, or one
 * reviewer on a slow connection, is the ordinary case for a double tap, and the row is
 * still right there for them to look at.
 */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const g = await requireRole(req.headers.get("cookie"), ["admin", "secretary"]);
  if (!g.ok) return g.response;

  const { id: itemId } = await ctx.params;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return badRequest("Invalid JSON.");
  }

  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) return validationFailed("Invalid body.", zodFields(parsed.error));

  const sb = getSupabaseAdmin();
  const reviewerRole = g.session.role === "admin" ? "admin" : "secretary";

  const { data: item, error: itemError } = await sb
    .from("attendance_appeal_items")
    .select("id, member_id, status, appeal_id, attendance_appeals!inner(session_id)")
    .eq("id", itemId)
    .maybeSingle();

  if (itemError) return internalError();
  if (!item) return notFound("Appeal item not found.");

  const parent = (Array.isArray(item.attendance_appeals) ? item.attendance_appeals[0] : item.attendance_appeals) as
    | { session_id?: string }
    | null;
  const sessionId = parent?.session_id;
  if (!sessionId) return internalError("Missing appeal context.");

  if (item.status !== "pending") {
    return alreadyResolved(`This appeal was already ${item.status}.`);
  }

  if (parsed.data.action === "approve") {
    const result = await approveAppealItems(sb, { sessionId, itemIds: [itemId], reviewerRole });

    if (!result.ok) {
      if (result.reason === "report_locked") return reportLocked(result.message);
      if (result.reason === "session_missing") return notFound(result.message);
      return internalError();
    }

    // Nothing to announce when the item turned out to be resolved by someone else.
    if (result.approved > 0) {
      void notifyAttendanceSessionUpdated(sessionId);
      await logAudit({
        action: "appeal_approved",
        actor: { role: g.session.role, memberId: g.session.actor?.id ?? null, name: g.session.actor?.name ?? null },
        entityType: "attendance_appeal_item",
        entityId: itemId,
        meta: { sessionId, memberId: item.member_id, merged: result.merged, added: result.added },
        ip: getClientIp(req.headers),
      });
    }

    return jsonOk({
      approved: result.approved,
      merged_duplicates: result.merged,
      attendance_added: result.added,
      already_resolved: result.already,
    });
  }

  // APL-5: a reason is required. A rejection the member cannot understand is the failure
  // this whole item exists to prevent.
  const reason = formatAppealRejectReason({
    reason: parsed.data.reason ?? "",
    note: parsed.data.note ?? null,
  });
  if (!reason) {
    return validationFailed("Say why this appeal was turned down.", {
      reason: "Choose a reason or write a note.",
    });
  }

  const rejected = await rejectAppealItem(sb, { itemId, reason, reviewerRole });
  if (!rejected.ok) {
    if (rejected.reason === "already_resolved") return alreadyResolved(rejected.message);
    return internalError();
  }

  await logAudit({
    action: "appeal_rejected_with_reason",
    actor: { role: g.session.role, memberId: g.session.actor?.id ?? null, name: g.session.actor?.name ?? null },
    entityType: "attendance_appeal_item",
    entityId: itemId,
    meta: { sessionId, memberId: item.member_id, reason },
    ip: getClientIp(req.headers),
  });

  return jsonOk({ rejected: 1, reason });
}
