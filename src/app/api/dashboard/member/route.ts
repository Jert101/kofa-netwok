import { NextRequest } from "next/server";
import { requireRole } from "@/lib/api/guard";
import { internalError, jsonOk } from "@/lib/api/response";
import { getSetting } from "@/lib/settings/store";
import { churchToday } from "@/lib/time/church-time";
import { loadDashboardHistory } from "@/lib/insights/server/history";
import {
  attendanceRate,
  birthdaysWithin,
  isSunday,
  weekendStreak,
} from "@/lib/insights/metrics";

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

    return jsonOk({
      as_of: asOf,
      identity_declared: true,
      full_name: me?.fullName ?? null,
      // Sundays only, because that is what the secretary's report counts and two different rates for
      // one member is worse than one honest one.
      attendance_rate: attendanceRate(history.sessions, mySessionIds, { sundaysOnly: true }),
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