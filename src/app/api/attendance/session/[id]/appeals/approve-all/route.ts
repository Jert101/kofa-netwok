import { NextRequest } from "next/server";
import { requireRole } from "@/lib/api/guard";
import { internalError, jsonOk, notFound, reportLocked, badRequest } from "@/lib/api/response";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getClientIp } from "@/lib/auth/ip-hash";
import { logAudit } from "@/lib/audit/log-audit";
import { notifyAttendanceSessionUpdated } from "@/lib/push/attendance-notify";
import { approveAppealItems, pendingItemsForSession } from "@/features/appeals/server/appeals";

type Ctx = { params: Promise<{ id: string }> };

/**
 * APL-7: approve everything pending on this session, in one transaction.
 *
 * This used to be four separate calls ending in a DELETE of the item rows, so a failure
 * midway left attendance written and the appeals still pending — a state a retry cannot
 * distinguish from a fresh appeal. It now runs entirely inside
 * `approve_appeal_items`, so it is all of it or none of it.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const g = await requireRole(req.headers.get("cookie"), ["admin", "secretary"]);
  if (!g.ok) return g.response;

  const { id: sessionId } = await ctx.params;
  const sb = getSupabaseAdmin();
  const reviewerRole = g.session.role === "admin" ? "admin" : "secretary";

  const { data: session, error: sessionError } = await sb
    .from("attendance_sessions")
    .select("id")
    .eq("id", sessionId)
    .maybeSingle();
  if (sessionError) return internalError();
  if (!session) return notFound("Session not found.");

  const pending = await pendingItemsForSession(sb, sessionId);
  if (pending.length === 0) {
    return badRequest("No pending appeal items for this Mass.");
  }

  const result = await approveAppealItems(sb, {
    sessionId,
    itemIds: pending.map((p) => p.id),
    reviewerRole,
  });

  if (!result.ok) {
    if (result.reason === "report_locked") return reportLocked(result.message);
    if (result.reason === "session_missing") return notFound(result.message);
    return internalError();
  }

  if (result.approved > 0) {
    void notifyAttendanceSessionUpdated(sessionId);
    await logAudit({
      action: "appeals_approved_all",
      actor: { role: g.session.role, memberId: g.session.actor?.id ?? null, name: g.session.actor?.name ?? null },
      entityType: "attendance_session",
      entityId: sessionId,
      meta: {
        approved: result.approved,
        merged: result.merged,
        attendanceAdded: result.added,
      },
      ip: getClientIp(req.headers),
    });
  }

  return jsonOk({
    approved_count: result.approved,
    merged_duplicates: result.merged,
    attendance_added: result.added,
    already_resolved: result.already,
  });
}
