import { NextRequest } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/api/guard";
import {
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
import { approveAppealItems } from "@/features/appeals/server/appeals";

/**
 * APL-2: the central queue. One endpoint, two identical UIs.
 *
 * Pending first because that is what the page is for; resolved after, so the same
 * request answers "what have we already decided". Grouping and month filtering happen
 * here rather than in the browser so the secretary sees the same queue on their phone.
 */
const selectedSchema = z.object({
  session_id: z.string().uuid(),
  item_ids: z.array(z.string().uuid()).min(1).max(200),
});

/**
 * APL-2/APL-7: approve a selection the secretary ticked, across one session.
 *
 * Per-session on purpose. Approving across two sessions would have to span two months
 * and could be blocked by one of them, which is exactly the half-done state this module
 * is trying to remove.
 */
export async function PATCH(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["admin", "secretary"]);
  if (!g.ok) return g.response;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return badRequest("Invalid JSON.");
  }
  const parsed = selectedSchema.safeParse(json);
  if (!parsed.success) return validationFailed("Select at least one appeal.", zodFields(parsed.error));

  const sb = getSupabaseAdmin();
  const reviewerRole = g.session.role === "admin" ? "admin" : "secretary";

  // The items must actually belong to the session the client claimed. Without this, a
  // secretary could pass a valid session id of their own and approve an item from
  // someone else's Mass by id.
  const { data: rows, error: rowsError } = await sb
    .from("attendance_appeal_items")
    .select("id, status, attendance_appeals!inner(session_id)")
    .eq("attendance_appeals.session_id", parsed.data.session_id)
    .in("id", parsed.data.item_ids);
  if (rowsError) return internalError();

  const allowed = new Set((rows ?? []).map((r) => String(r.id)));
  const outOfSession = parsed.data.item_ids.filter((id) => !allowed.has(id));
  if (outOfSession.length > 0) {
    return validationFailed("Some appeals are not from that Mass.", {
      item_ids: "Reload the queue and try again.",
    });
  }

  const result = await approveAppealItems(sb, {
    sessionId: parsed.data.session_id,
    itemIds: parsed.data.item_ids,
    reviewerRole,
  });

  if (!result.ok) {
    if (result.reason === "report_locked") return reportLocked(result.message);
    if (result.reason === "session_missing") return notFound(result.message);
    return internalError();
  }

  if (result.approved > 0) {
    void notifyAttendanceSessionUpdated(parsed.data.session_id);
    await logAudit({
      action: "appeals_approved_selected",
      actor: { role: g.session.role, memberId: g.session.actor?.id ?? null, name: g.session.actor?.name ?? null },
      entityType: "attendance_session",
      entityId: parsed.data.session_id,
      meta: {
        requested: parsed.data.item_ids.length,
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

export async function GET(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["admin", "secretary"]);
  if (!g.ok) return g.response;

  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? "pending";
  const month = url.searchParams.get("month");
  const limit = clampLimit(url.searchParams.get("limit"));

  if (status !== "pending" && status !== "resolved") {
    return validationFailed("Unknown status.", { status: "Use pending or resolved." });
  }

  if (month !== null && !/^\d{4}-\d{2}$/.test(month)) {
    return validationFailed("Invalid month.", { month: "Use YYYY-MM." });
  }

  const sb = getSupabaseAdmin();

  const { data, error } = await sb
    .from("attendance_appeal_items")
    .select(
      "id, member_id, status, resolution, reject_reason, reviewed_at, reviewed_by_role, created_at, " +
        "attendance_appeals!inner(session_id, submitted_at, note, attendance_sessions!inner(session_date, masses!inner(name))), " +
        "members!inner(full_name)",
    )
    // One `in` rather than two round trips, so the two tabs cannot disagree about what
    // counts as resolved.
    .in("status", status === "pending" ? ["pending"] : ["rejected", "expired"])
    .order("created_at", { ascending: false })
    .limit(limit * 4);

  if (error) return internalError();

  // The select is assembled as a string, so the client cannot infer the shape. Cast
  // once here rather than pretending it is typed.
  const rows = (data as unknown as Record<string, unknown>[] | null) ?? [];

  const grouped = new Map<
    string,
    { session_id: string; session_date: string; mass_name: string; appeals: unknown[] }
  >();

  for (const row of rows) {
    const parent = first(row.attendance_appeals) as {
      session_id?: string;
      submitted_at?: string;
      note?: string | null;
      attendance_sessions?: unknown;
    } | null;
    const session = first(parent?.attendance_sessions) as { session_date?: string; masses?: unknown } | null;
    const mass = first(session?.masses) as { name?: string } | null;
    const member = first(row.members) as { full_name?: string } | null;

    const sessionId = String(parent?.session_id ?? "");
    const sessionDate = String(session?.session_date ?? "");
    if (!sessionId || !sessionDate) continue;
    if (month !== null && sessionDate.slice(0, 7) !== month) continue;

    if (!grouped.has(sessionId)) {
      grouped.set(sessionId, {
        session_id: sessionId,
        session_date: sessionDate,
        mass_name: mass?.name?.trim() || "Mass",
        appeals: [],
      });
    }

    grouped.get(sessionId)!.appeals.push({
      id: String(row.id),
      member_id: String(row.member_id),
      member_name: member?.full_name?.trim() || "Member",
      status: String(row.status),
      resolution: (row.resolution as string | null) ?? null,
      reject_reason: (row.reject_reason as string | null) ?? null,
      reviewed_at: (row.reviewed_at as string | null) ?? null,
      reviewed_by_role: (row.reviewed_by_role as string | null) ?? null,
      created_at: String(row.created_at),
      submitted_at: parent?.submitted_at ?? String(row.created_at),
      note: parent?.note ?? null,
    });
  }

  const sessions = [...grouped.values()]
    .map((s) => ({
      ...s,
      appeals: (s.appeals as Record<string, unknown>[]).sort(
        (a, b) => new Date(String(b.created_at)).getTime() - new Date(String(a.created_at)).getTime(),
      ),
    }))
    // Newest date first, which is what "pending, newest first" means at the page level.
    .sort((a, b) => b.session_date.localeCompare(a.session_date));

  const pendingCount = sessions.reduce((n, s) => n + s.appeals.length, 0);

  return jsonOk({ sessions, pending_count: pendingCount, month });
}

function clampLimit(raw: string | null): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 200;
  return Math.min(500, Math.floor(n));
}

function first(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}
