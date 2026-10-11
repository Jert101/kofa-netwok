import { NextRequest } from "next/server";
import { requireRole } from "@/lib/api/guard";
import { internalError, jsonOk } from "@/lib/api/response";
import { getSetting } from "@/lib/settings/store";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { churchToday } from "@/lib/time/church-time";
import { loadDashboardHistory } from "@/lib/insights/server/history";
import {
  attendanceRate,
  birthdaysWithin,
  isSunday,
  monthlySundayBuckets,
  recentSundayRows,
  sessionsHeld,
  weekendStreak,
} from "@/lib/insights/metrics";

/** "2026-10" in words, without depending on the server's locale. */
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) return month;
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

/**
 * DSH-4: the member's own home data.
 *
 * One member, and only their own rows. The query behind it is filtered by the session's declared
 * identity, not by anything in a query string, so there is no parameter here that could widen it.
 */
export async function GET(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["member"]);
  if (!g.ok) return g.response;

  const memberId = g.session.actor?.id ?? null;

  try {
    const asOf = churchToday(await getSetting("report_timezone"));

    // Two weeks is enough for the birthdays card; four months for a rate that means something.
    const history = await loadDashboardHistory({ weeks: 12, months: 4 });
    const me = history.members.find((m) => m.id === memberId) ?? null;

    if (!memberId) {
      // A member with no declared identity is still a member of the app. They get the parish-wide parts
      // and a sentence explaining why the personal ones are empty, rather than a broken card.
      return jsonOk({
        as_of: asOf,
        identity_declared: false,
        birthdays: birthdaysWithin(history.members, asOf, 7),
        empty_personal: true,
      });
    }

    const mySessionIds = new Set(
      history.marks.filter((m) => m.memberId === memberId).map((m) => m.sessionId),
    );

    // The same Sunday-only window as the headline rate, so every number on the
    // page agrees with it.
    const sundayHeld = sessionsHeld(history.sessions).filter((s) => isSunday(s.date));
    const sundaysAttended = sundayHeld.filter((s) => mySessionIds.has(s.id)).length;

    // Lifetime and last-served are windowed nowhere: the history above only
    // reaches back a few months, and "all time" must mean it. Four small
    // indexed reads, Mass sessions only -- a meeting is not serving.
    const lifetime = await lifetimeServing(memberId);

    return jsonOk({
      as_of: asOf,
      identity_declared: true,
      full_name: me?.fullName ?? null,
      // Sundays only, because that is what the secretary's report counts and two different rates for
      // one member is worse than one honest one.
      attendance_rate: attendanceRate(history.sessions, mySessionIds, { sundaysOnly: true }),
      sundays_attended: sundaysAttended,
      sundays_held: sundayHeld.length,
      lifetime_served: lifetime.count,
      last_served_date: lifetime.lastDate,
      monthly: monthlySundayBuckets(history.sessions, mySessionIds).map((b) => ({
        ...b,
        label: monthLabel(b.month),
      })),
      recent: recentSundayRows(history.sessions, mySessionIds),
      weekend_streak: weekendStreak(history.sessions, mySessionIds),
      birthdays: birthdaysWithin(
        me ? [me] : [],
        asOf,
        7,
      ),
      sunday_attendance: history.marks.some((m) => m.memberId === memberId && isSunday(m.date)),
      empty_personal: mySessionIds.size === 0,
    });
  } catch (e) {
    console.error("[dashboard/member] failed:", e instanceof Error ? e.message : e);
    return internalError("Could not build your dashboard.");
  }
}

/**
 * How many Masses this member has ever served, and the most recent date.
 *
 * Separate from the windowed history because "all time" is not a window.
 * Mass sessions only: the 041 rule that a meeting is recorded but is not
 * serving applies to a member's own lifetime count first of all.
 */
async function lifetimeServing(memberId: string): Promise<{ count: number; lastDate: string | null }> {
  const sb = getSupabaseAdmin();
  const [liveRecords, archivedRecords] = await Promise.all([
    sb.from("attendance_records").select("session_id").eq("member_id", memberId),
    sb.from("attendance_records_archive").select("session_id").eq("member_id", memberId),
  ]);
  if (liveRecords.error) throw new Error(liveRecords.error.message);
  // A missing archive table must not empty the count: the archive only exists
  // once a month has been closed.
  if (archivedRecords.error && archivedRecords.error.code !== "42P01") {
    throw new Error(archivedRecords.error.message);
  }

  const ids = [
    ...new Set([
      ...((liveRecords.data ?? []).map((r) => String(r.session_id))),
      ...((archivedRecords.data ?? []).map((r) => String(r.session_id))),
    ]),
  ];
  if (ids.length === 0) return { count: 0, lastDate: null };

  const [liveSessions, archivedSessions] = await Promise.all([
    sb.from("attendance_sessions").select("id, session_date").in("id", ids).not("mass_id", "is", null),
    sb
      .from("attendance_sessions_archive")
      .select("id, session_date")
      .in("id", ids)
      .not("mass_id", "is", null),
  ]);
  if (liveSessions.error) throw new Error(liveSessions.error.message);
  if (archivedSessions.error && archivedSessions.error.code !== "42P01") {
    throw new Error(archivedSessions.error.message);
  }

  const dates = [
    ...((liveSessions.data ?? []).map((s) => String(s.session_date))),
    ...((archivedSessions.data ?? []).map((s) => String(s.session_date))),
  ];
  // One session id can appear in both tables around archive time; the count is
  // distinct sessions, not rows.
  const distinct = new Set([
    ...((liveSessions.data ?? []).map((s) => String(s.id))),
    ...((archivedSessions.data ?? []).map((s) => String(s.id))),
  ]);
  dates.sort();
  return { count: distinct.size, lastDate: dates.length > 0 ? dates[dates.length - 1] : null };
}