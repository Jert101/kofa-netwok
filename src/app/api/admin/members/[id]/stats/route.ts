import { NextRequest } from "next/server";
import { requireRole } from "@/lib/api/guard";
import { internalError, jsonOk, notFound } from "@/lib/api/response";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getSetting } from "@/lib/settings/store";
import {
  computeMemberMetrics,
  monthsBefore,
  recentSessions,
  RECENT_SESSION_LIMIT,
  RATE_WINDOW_MONTHS,
  todayInTimeZone,
  type AttendanceSession,
} from "@/lib/attendance/metrics";

type Ctx = { params: Promise<{ id: string }> };

export type PaymentSummary = {
  structureId: string;
  structureName: string;
  amount: string;
  paid: string;
  remaining: string;
  isActive: boolean;
  lastPaidAt: string | null;
};

export type MemberStats = {
  metrics: {
    lifetimeServed: number;
    sessionsHeld: number;
    attendanceRate: number | null;
    weekendStreak: number;
    lastServedDate: string | null;
  };
  recent: {
    id: string;
    sessionDate: string;
    massName: string | null;
    present: boolean;
    archived: boolean;
    sunday: boolean;
  }[];
  payments: PaymentSummary[];
  today: string;
  windowStart: string;
};

/**
 * MEM-4: attendance metrics and recent sessions for one member.
 *
 * The rate needs two different sets of records: this member's own for the
 * numerator, and every session that anybody attended for the denominator. Both
 * the live and the archived tables are read, because a member who served before
 * archiving keeps their history.
 *
 * Admin only, matching the rest of the members pages.
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  const g = await requireRole(req.headers.get("cookie"), ["admin"]);
  if (!g.ok) return g.response;

  const { id } = await ctx.params;
  const url = new URL(req.url);
  const sundaysOnly = url.searchParams.get("sundays") === "1";
  const parsedLimit = Number.parseInt(url.searchParams.get("limit") ?? "", 10);
  const limit = Number.isNaN(parsedLimit)
    ? RECENT_SESSION_LIMIT
    : Math.min(Math.max(parsedLimit, 1), 50);

  const sb = getSupabaseAdmin();

  const { data: member, error: memberError } = await sb
    .from("members")
    .select("id, full_name, is_active, batch")
    .eq("id", id)
    .maybeSingle();

  if (memberError) return internalError("Could not load that member.");
  if (!member) return notFound("That member no longer exists.");

  const [liveSessions, archivedSessions, liveRecords, archivedRecords, masses] =
    await Promise.all([
      sb.from("attendance_sessions").select("id, session_date, mass_id"),
      sb.from("attendance_sessions_archive").select("id, session_date, mass_id, mass_name"),
      sb.from("attendance_records").select("session_id").eq("member_id", id),
      sb.from("attendance_records_archive").select("session_id").eq("member_id", id),
      sb.from("masses").select("id, name"),
    ]);

  if (liveSessions.error || archivedSessions.error) {
    console.error(
      "[admin/members/stats] sessions failed:",
      liveSessions.error?.message ?? archivedSessions.error?.message,
    );
    return internalError("Could not load the attendance history.");
  }
  if (liveRecords.error || archivedRecords.error) {
    console.error(
      "[admin/members/stats] records failed:",
      liveRecords.error?.message ?? archivedRecords.error?.message,
    );
    return internalError("Could not load the attendance history.");
  }

  const massNameById = new Map(
    (masses.data ?? []).map((m) => [m.id as string, m.name as string]),
  );

  // A meeting is recorded but it is not serving, so it stays out of the member's record too:
  // serving total, attendance rate, streak, recent sessions. The day view and the session screen still
  // show it; the record that follows a member does not.
  const liveRows = (liveSessions.data ?? [])
    .filter((s) => s.mass_id != null)
    .map((s) => ({
      id: s.id as string,
      sessionDate: s.session_date as string,
      massName: massNameById.get(s.mass_id as string) ?? null,
    }));
  const archivedRows = (archivedSessions.data ?? [])
    .filter((s) => s.mass_id != null)
    .map((s) => ({
      id: s.id as string,
      sessionDate: s.session_date as string,
      // The archive keeps the mass name as text, so it survives a deleted mass.
      massName: (s.mass_name as string | null) ?? massNameById.get(s.mass_id as string) ?? null,
      archived: true as const,
    }));
  const sessions: AttendanceSession[] = [...liveRows, ...archivedRows];

  const memberSessionIds = [
    ...(liveRecords.data ?? []).map((r) => r.session_id as string),
    ...(archivedRecords.data ?? []).map((r) => r.session_id as string),
  ];

  // Read on the server so the client's clock cannot widen or narrow the window, and
  // in the parish's own timezone so that "today" is today where the parish is.
  const timeZone = await getSetting("report_timezone");
  const today = todayInTimeZone(new Date(), timeZone);
  const windowStart = monthsBefore(today, RATE_WINDOW_MONTHS);

  // The denominator only needs sessions inside the window, so the "who else was
  // there" queries are bounded by three months rather than by all history.
  const windowLiveIds = liveRows
    .filter((s) => s.sessionDate >= windowStart && s.sessionDate <= today)
    .map((s) => s.id);
  const windowArchivedIds = archivedRows
    .filter((s) => s.sessionDate >= windowStart && s.sessionDate <= today)
    .map((s) => s.id);

  const [heldLive, heldArchived] = await Promise.all([
    windowLiveIds.length > 0
      ? sb.from("attendance_records").select("session_id").in("session_id", windowLiveIds)
      : Promise.resolve({ data: [] as { session_id: string }[], error: null }),
    windowArchivedIds.length > 0
      ? sb
          .from("attendance_records_archive")
          .select("session_id")
          .in("session_id", windowArchivedIds)
      : Promise.resolve({ data: [] as { session_id: string }[], error: null }),
  ]);

  const anyRecordSessionIds = [
    ...memberSessionIds,
    ...(heldLive.data ?? []).map((r) => r.session_id as string),
    ...(heldArchived.data ?? []).map((r) => r.session_id as string),
  ];

  const metrics = computeMemberMetrics({
    sessions,
    memberSessionIds,
    anyRecordSessionIds,
    today,
    sundaysOnly,
  });

  const recent = recentSessions(sessions, memberSessionIds, limit);
  const payments = await paymentSummary(id, (member.batch as string | null) ?? null);

  return jsonOk({ metrics, recent, payments, today, windowStart });
}

function toMoney(value: number): string {
  return value.toFixed(2);
}

/**
 * Read-only payment position per structure (module 03, MEM-4 section 4).
 *
 * Only the structures that actually apply to this member are shown: one scoped to
 * everybody, plus one scoped to their own batch. A structure belonging to another
 * batch says nothing about this person's balance, and listing it beside real ones
 * would make the summary read as though they owe it.
 *
 * Voided payments are left out of both sides, so voiding a receipt raises the
 * balance again instead of leaving a phantom credit behind.
 */
async function paymentSummary(
  memberId: string,
  memberBatch: string | null,
): Promise<PaymentSummary[]> {
  const sb = getSupabaseAdmin();

  const [structures, payments] = await Promise.all([
    sb.from("payment_structures").select("id, name, amount, is_active, for_all, batch"),
    sb
      .from("payments")
      .select("payment_structure_id, amount_paid, paid_at")
      .eq("member_id", memberId)
      .eq("voided", false),
  ]);

  if (structures.error || payments.error) {
    // Payments are supplementary on this page; it is still useful without them.
    console.error(
      "[admin/members/stats] payments failed:",
      structures.error?.message ?? payments.error?.message,
    );
    return [];
  }

  const applies = (s: { for_all: boolean | null; batch: string | null }) =>
    s.for_all === true || (s.batch !== null && s.batch === memberBatch);

  const paidByStructure = new Map<string, { total: number; lastPaidAt: string | null }>();
  for (const row of payments.data ?? []) {
    const key = row.payment_structure_id as string;
    const amount = Number(row.amount_paid ?? 0);
    const paidAt = (row.paid_at as string | null) ?? null;
    const current = paidByStructure.get(key);
    if (current) {
      current.total += amount;
      if (paidAt && (!current.lastPaidAt || paidAt > current.lastPaidAt)) {
        current.lastPaidAt = paidAt;
      }
    } else {
      paidByStructure.set(key, { total: amount, lastPaidAt: paidAt });
    }
  }

  return (structures.data ?? [])
    .filter(applies)
    .map((s) => {
      const id = s.id as string;
      const required = Number(s.amount ?? 0);
      const entry = paidByStructure.get(id);
      const paid = entry?.total ?? 0;
      return {
        structureId: id,
        structureName: s.name as string,
        amount: toMoney(required),
        paid: toMoney(paid),
        remaining: toMoney(Math.max(0, required - paid)),
        isActive: s.is_active !== false,
        lastPaidAt: entry?.lastPaidAt ?? null,
      };
    });
}
