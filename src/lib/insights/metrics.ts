/**
 * DSH-6: every number the app shows about attendance, defined once.
 *
 * Spec acceptance criterion: "Old metric code is removed; nothing computes a rate outside
 * `metrics.ts`." That is the whole reason this file exists, because before it there were five
 * definitions of attendance rate in four places and an "inactive" rule written twice with different
 * windows.
 *
 * Every function here is pure and takes its data as arguments. Nothing in this file reads the database,
 * knows what a Supabase client is, or imports React -- which is what makes the at-risk rule and the
 * birthday window testable on hand-built fixtures, and testable is the only reason anybody would trust
 * them.
 *
 * ## The rule this replaces
 *
 * `src/lib/attendance/metrics.ts` computed a rate over a three-month window and a weekend streak. Both
 * are here now. That file is left re-exporting from this one so the member profile keeps working, but
 * nothing new should be added there.
 */

import { addMonthsClamped, monthStart, shiftDays } from "@/lib/time/church-time";

// Re-exported so a caller that already imports metrics does not need a second import path for a date
// helper, and so there is exactly one implementation of "shift by N days" in the app.
export { daysBetween, shiftDays } from "@/lib/time/church-time";

// ======================================================================================
// Types
// ======================================================================================

/** A session, live or archived. `id` may repeat across archive snapshots; see `dedupeSessions`. */
export type Session = {
  id: string;
  /** `YYYY-MM-DD` */
  date: string;
  massId: string | null;
  massName: string | null;
  /** Records for this session. */
  attendanceCount: number;
};

/** The minimal member shape every metric needs. */
export type MemberRow = {
  id: string;
  fullName: string;
  batch: string | null;
  isActive: boolean;
  /** `YYYY-MM-DD` or null. Never attended anybody. */
  dateOfBirth: string | null;
};

/** A single attendance event. */
export type AttendanceMark = {
  memberId: string;
  sessionId: string;
  /** `YYYY-MM-DD`, denormalised so the metrics do not have to join to find the weekend. */
  date: string;
};

// ======================================================================================
// Small calendar helpers, duplicated from the attendance module's private ones
// ======================================================================================

export function isSunday(date: string): boolean {
  return new Date(`${date}T00:00:00Z`).getUTCDay() === 0;
}

/** Saturday evening counts as a weekend: the vigil Mass belongs to the same weekend as Sunday. */
export function isWeekend(date: string): boolean {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

/**
 * The Monday of the week containing `date`, as `YYYY-MM-DD`.
 *
 * Monday-anchored because ISO weeks are, and because a weekend is the unit this app cares about: a
 * Saturday and the Sunday after it belong to one weekend, and keying on the Saturday keeps them
 * together.
 */
export function weekStart(date: string): string {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  const back = day === 0 ? 6 : day - 1;
  return shiftDays(date, -back);
}


/** The last `count` weekend keys, newest first, ending at the weekend containing `latest`. */
export function recentWeekendKeys(latest: string, count: number): string[] {
  const keys: string[] = [];
  let cursor = weekStart(latest);
  for (let i = 0; i < count; i++) {
    keys.push(cursor);
    cursor = shiftDays(cursor, -7);
  }
  return keys;
}

// ======================================================================================
// Session held
// ======================================================================================

/**
 * DSH-6: "A session with at least one attendance record."
 *
 * A session nobody attended is not a session the parish held. This distinction is the denominator of
 * every rate below, so getting it wrong quietly inflates everybody's percentage.
 */
export function isSessionHeld(session: Pick<Session, "attendanceCount">): boolean {
  return session.attendanceCount > 0;
}

export function sessionsHeld(sessions: readonly Session[]): Session[] {
  return sessions.filter(isSessionHeld);
}

/**
 * Collapse duplicate session rows.
 *
 * `attendance_sessions_archive` has a composite primary key of `(id, archived_at)`, so the same session
 * can appear in the live table and in two archive snapshots. Counting it twice would make a month look
 * busier than it was. The archived row wins where both exist, because it carries `mass_name` and the live
 * row's `masses` join is a second round trip.
 */
export function dedupeSessions(rows: readonly Session[]): Session[] {
  const byId = new Map<string, Session>();
  for (const row of rows) {
    const existing = byId.get(row.id);
    if (!existing) {
      byId.set(row.id, row);
      continue;
    }
    // Prefer the richer row: attendance wins, then a mass name.
    const better =
      row.attendanceCount > existing.attendanceCount ||
      (!existing.massName && Boolean(row.massName));
    if (better) byId.set(row.id, { ...existing, ...row });
    else byId.set(row.id, { ...row, ...existing });
  }
  return [...byId.values()];
}

// ======================================================================================
// Attendance rate and average
// ======================================================================================

export type RateOptions = {
  /** Include Saturdays. Off by default: most parishes measure Sunday attendance. */
  sundaysOnly?: boolean;
};

/**
 * DSH-6: "Distinct sessions attended ÷ sessions held in the period."
 *
 * Returns null when nothing was held, never 0. A new installation with no sessions is not a parish with
 * a zero percent attendance rate, and showing "0%" to somebody on their first Sunday reads as an
 * accusation. Spec §DSH-8 asks for meaningful empty states and this is where that starts.
 */
export function attendanceRate(
  sessions: readonly Session[],
  attendedSessionIds: ReadonlySet<string>,
  options: RateOptions = {},
): number | null {
  const held = sessionsHeld(sessions).filter((s) => (options.sundaysOnly ? isSunday(s.date) : true));
  if (held.length === 0) return null;
  const attended = held.filter((s) => attendedSessionIds.has(s.id)).length;
  return round1((attended / held.length) * 100);
}

/**
 * DSH-6: "Total records ÷ sessions held."
 *
 * The parish-wide figure, so a Mass of forty and a Mass of four both count once. Averages of members
 * would weight the big Mass the same as the small one.
 */
export function averageAttendance(sessions: readonly Session[]): number | null {
  const held = sessionsHeld(sessions);
  if (held.length === 0) return null;
  const total = held.reduce((n, s) => n + s.attendanceCount, 0);
  return round1(total / held.length);
}

/** Total attendance across the sessions that were held. */
export function totalAttendance(sessions: readonly Session[]): number {
  return sessionsHeld(sessions).reduce((n, s) => n + s.attendanceCount, 0);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

// ======================================================================================
// Weekend streak
// ======================================================================================

/**
 * DSH-6: consecutive weekends, counting back from the latest weekend that had any session, in which
 * this member attended at least one.
 *
 * Counting back from the *latest weekend with a session*, not from today, is what stops a member being
 * punished for a weekend the parish has not reached yet. A Saturday-evening Mass is on the weekend of
 * the Sunday after it, because `weekStart` is Monday-anchored and Saturday sits in the same week block.
 */
export function weekendStreak(
  sessions: readonly Session[],
  attendedSessionIds: ReadonlySet<string>,
): number {
  const weekendsWithASession = new Set<string>();
  const attendedWeekends = new Set<string>();

  for (const session of sessions) {
    if (!isWeekend(session.date)) continue;
    const key = weekStart(session.date);
    weekendsWithASession.add(key);
    if (attendedSessionIds.has(session.id)) attendedWeekends.add(key);
  }

  if (weekendsWithASession.size === 0) return 0;

  let cursor = [...weekendsWithASession].sort().reverse()[0];
  let streak = 0;
  while (weekendsWithASession.has(cursor)) {
    if (!attendedWeekends.has(cursor)) break;
    streak += 1;
    cursor = shiftDays(cursor, -7);
  }
  return streak;
}

// ======================================================================================
// Inactive
// ======================================================================================

export const INACTIVE_MONTHS = 2;

/**
 * DSH-6: "Active member with zero attendance in the last 2 complete months."
 *
 * The window runs from the start of the month two months back through today. The spec's wording is "the
 * last 2 complete months", and the old implementation used precisely August and September when today is
 * 4 October -- which means a member who served *yesterday* appeared on the inactive list, because
 * yesterday is in October. That is not what anybody means by "has drifted away", so the window ends at
 * today rather than at the end of last month.
 *
 * Members who never had any attendance are excluded, as today. Somebody who joined last week has no
 * two-month silence to report, and listing them beside a member who served for twenty years and stopped
 * is unfair.
 */
export function inactiveMembers(
  members: readonly MemberRow[],
  marks: readonly AttendanceMark[],
  asOf: string,
  months = INACTIVE_MONTHS,
): MemberRow[] {
  const windowStart = monthStart(addMonthsClamped(asOf, -months));

  const servedInWindow = new Set(
    marks.filter((m) => m.date >= windowStart && m.date <= asOf).map((m) => m.memberId),
  );
  const everServed = new Set(marks.map((m) => m.memberId));

  return members.filter((m) => {
    if (!m.isActive) return false;
    if (!everServed.has(m.id)) return false;
    return !servedInWindow.has(m.id);
  });
}

// ======================================================================================
// At risk
// ======================================================================================

/**
 * DSH-6: "attended 3 or more of the previous 8 weekends but none of the last 3; or a rate over the last
 * 4 weekends at least 50 points below the rate over the 8 weekends before that."
 *
 * A proposal, and the spec says so. The thresholds are named constants rather than literals buried in
 * the comparison so they can be tuned against real data without hunting.
 */
export const AT_RISK = {
  /** Attended at least this many of the earlier window, before either verdict is allowed. */
  baselineFloor: 3,
  /** Rule 1's earlier window: "the previous 8 weekends". */
  stoppedBaselineWeekends: 8,
  /** Rule 1's recent window: "none of the last 3". */
  stoppedRecentWeekends: 3,
  /** Rule 2's recent window: "the last 4 weekends". */
  dropRecentWeekends: 4,
  /**
   * Rule 2's baseline: "the 8 weekends before that", i.e. the eight sitting *behind* the recent four.
   *
   * Disjoint, not overlapping. An overlapping eight would share its last three weekends with the recent
   * window, which caps the baseline at 5/8 and makes a 50-point drop impossible to reach without the
   * recent window already being empty -- at which point rule 1 has fired and rule 2 says nothing extra.
   */
  dropBaselineWeekends: 8,
  /** Percentage points. */
  dropThreshold: 50,
} as const;

export type AtRiskReason = "stopped" | "dropped";

export type AtRiskMember = {
  memberId: string;
  fullName: string;
  reasons: AtRiskReason[];
  /** Their rate over the recent window, for the card's detail line. */
  recentRate: number;
  baselineRate: number;
};
/**
 * DSH-6: "attended 3 or more of the previous 8 weekends but none of the last 3; or a rate over the last
 * 4 weekends at least 50 points below the rate over the 8 weekends before that."
 *
 * Two independent signals, reported as two reasons rather than one verdict, because they call for
 * different conversations. Somebody who attended five of eight weekends and none of the last three has
 * stopped. Somebody whose rate over four weekends has halved against the eight before those has slowed
 * down, which is earlier and easier to act on.
 *
 * Both rules need enough history to mean anything, so a member below the floor of three attended
 * weekends is not reported at all. Flagging somebody on two weekends of data is how a useful warning
 * turns into something people learn to ignore.
 */
export function atRiskMembers(
  members: readonly MemberRow[],
  sessions: readonly Session[],
  marks: readonly AttendanceMark[],
  asOf: string,
): AtRiskMember[] {
  // Sessions dated after `asOf` are ignored. The secretary pre-creates next Sunday's sessions, and a
  // window anchored on a weekend that has not happened yet would measure the parish against a Mass
  // nobody has attended -- reporting a collapse in attendance the week before it happens.
  const past = sessions.filter((s) => s.date <= asOf);

  // Which weekends this member actually attended, keyed off the session the mark belongs to.
  const weekendBySessionId = new Map(past.map((s) => [s.id, weekStart(s.date)] as const));
  const attendedWeekendsByMember = new Map<string, Set<string>>();
  for (const mark of marks) {
    const weekend = weekendBySessionId.get(mark.sessionId);
    if (!weekend) continue;
    const set = attendedWeekendsByMember.get(mark.memberId);
    if (set) set.add(weekend);
    else attendedWeekendsByMember.set(mark.memberId, new Set([weekend]));
  }

  // The newest weekend the parish reached, so "the last 3 weekends" means the last 3 that happened.
  const latestWeekend = sessionsHeld(past).reduce<string | null>((newest, s) => {
    const key = weekStart(s.date);
    if (!newest || key > newest) return key;
    return newest;
  }, null);
  if (!latestWeekend) return [];

  // Rule 1's windows: "the previous 8 weekends" and "none of the last 3".
  const stoppedRecent = new Set(recentWeekendKeys(latestWeekend, AT_RISK.stoppedRecentWeekends));
  const stoppedBaselineOnly = new Set(
    recentWeekendKeys(latestWeekend, AT_RISK.stoppedBaselineWeekends).filter(
      (k) => !stoppedRecent.has(k),
    ),
  );

  // Rule 2's windows, disjoint: the recent four, then the eight sitting behind them.
  const dropRecent = new Set(recentWeekendKeys(latestWeekend, AT_RISK.dropRecentWeekends));
  const dropBaselineOnly = new Set(
    recentWeekendKeys(latestWeekend, AT_RISK.dropRecentWeekends + AT_RISK.dropBaselineWeekends).filter(
      (k) => !dropRecent.has(k),
    ),
  );

  const out: AtRiskMember[] = [];

  for (const member of members) {
    if (!member.isActive) continue;
    const attended = attendedWeekendsByMember.get(member.id);
    if (!attended || attended.size === 0) continue; // Never came; that is not "drifting".

    const stoppedBaselineCount = countIn(attended, stoppedBaselineOnly);
    const stoppedRecentCount = countIn(attended, stoppedRecent);

    const dropBaselineCount = countIn(attended, dropBaselineOnly);
    const dropRecentCount = countIn(attended, dropRecent);

    const reasons: AtRiskReason[] = [];

    if (stoppedBaselineCount >= AT_RISK.baselineFloor && stoppedRecentCount === 0) {
      reasons.push("stopped");
    }

    const baselineRate = (dropBaselineCount / AT_RISK.dropBaselineWeekends) * 100;
    const recentRate = (dropRecentCount / AT_RISK.dropRecentWeekends) * 100;
    if (
      dropBaselineCount >= AT_RISK.baselineFloor &&
      baselineRate - recentRate >= AT_RISK.dropThreshold
    ) {
      if (!reasons.includes("stopped")) reasons.push("dropped");
    }

    if (reasons.length > 0) {
      out.push({
        memberId: member.id,
        fullName: member.fullName,
        reasons,
        recentRate: round1(recentRate),
        baselineRate: round1(baselineRate),
      });
    }
  }

  return out.sort((a, b) => a.fullName.localeCompare(b.fullName));
}

function countIn(attended: ReadonlySet<string>, keys: ReadonlySet<string>): number {
  let n = 0;
  for (const key of keys) {
    if (attended.has(key)) n += 1;
  }
  return n;
}

// ======================================================================================
// Birthdays
// ======================================================================================

/**
 * DSH-6: birthdays in the next N days, compared as `MM-DD` in church time.
 *
 * 29 February is shown on 28 February in a non-leap year, because somebody born on the 29th of February
 * of a leap year still has a birthday, and the parish still wants to say so. Silently skipping them is
 * the kind of bug that makes a member stop feeling like part of the community.
 */
export function birthdaysWithin(
  members: readonly MemberRow[],
  asOf: string,
  days = 7,
): Array<{ memberId: string; fullName: string; date: string; isToday: boolean; leapDay: boolean }> {
  const window: string[] = [];
  for (let i = 0; i <= days; i++) window.push(shiftDays(asOf, i));

  const out: Array<{ memberId: string; fullName: string; date: string; isToday: boolean; leapDay: boolean }> = [];

  for (const member of members) {
    if (!member.isActive || !member.dateOfBirth) continue;
    const dob = member.dateOfBirth.slice(0, 10);
    const leapDay = dob.slice(5, 7) === "02" && dob.slice(8, 10) === "29";

    const match = window.find((candidate) => {
      if (candidate.slice(5) === dob.slice(5)) return true;
      // A 29 February birthday falls on 28 February in a year that has no 29 February. Only when it
      // does, otherwise the real 29th is shadowed by the fallback a day early.
      if (leapDay && candidate.slice(5, 10) === "02-28" && !hasFeb29(candidate.slice(0, 4))) {
        return true;
      }
      return false;
    });

    if (!match) continue;
    out.push({
      memberId: member.id,
      fullName: member.fullName,
      date: match,
      isToday: match === asOf,
      leapDay,
    });
  }

  return out.sort((a, b) => a.date.localeCompare(b.date) || a.fullName.localeCompare(b.fullName));
}

function hasFeb29(year: string): boolean {
  return new Date(Date.UTC(Number(year), 1, 29)).getUTCDate() === 29;
}

// ======================================================================================
// Trend
// ======================================================================================

export type TrendPoint = { weekStart: string; attendance: number; sessionsHeld: number };

/**
 * DSH-1: weekend attendance for the last N weeks.
 *
 * Weekends with no session are emitted as zero-attendance points rather than skipped, because a gap in
 * the line is a gap in the data and hiding it makes a decline look flat.
 */
export function attendanceTrend(
  sessions: readonly Session[],
  asOf: string,
  weeks = 12,
): TrendPoint[] {
  const keys = recentWeekendKeys(asOf, weeks).reverse();
  const byKey = new Map<string, Session[]>();
  for (const key of keys) byKey.set(key, []);

  for (const session of sessionsHeld(sessions)) {
    if (!isWeekend(session.date)) continue;
    const key = weekStart(session.date);
    const bucket = byKey.get(key);
    if (bucket) bucket.push(session);
  }

  return keys.map((key) => {
    const bucket = byKey.get(key) ?? [];
    return {
      weekStart: key,
      attendance: bucket.reduce((n, s) => n + s.attendanceCount, 0),
      sessionsHeld: bucket.length,
    };
  });
}

/** DSH-1: average attendance per Mass type over the last N weeks. */
export function turnoutByMass(
  sessions: readonly Session[],
  asOf: string,
  weeks = 8,
): Array<{ massName: string; average: number; sessionsHeld: number }> {
  const cutoff = shiftDays(asOf, -(weeks * 7));

  const groups = new Map<string, Session[]>();
  for (const session of sessionsHeld(sessions)) {
    if (session.date < cutoff || session.date > asOf) continue;
    const name = session.massName ?? "Unnamed Mass";
    const list = groups.get(name);
    if (list) list.push(session);
    else groups.set(name, [session]);
  }

  return [...groups.entries()]
    .map(([massName, list]) => ({
      massName,
      average: round1(list.reduce((n, s) => n + s.attendanceCount, 0) / list.length),
      sessionsHeld: list.length,
    }))
    .sort((a, b) => b.average - a.average);
}

// ======================================================================================
// Plain-language summaries, for the charts' text alternatives
// ======================================================================================

/**
 * DSH-1 requires every chart to carry a text summary, because a line chart is a picture of numbers and
 * a screen reader cannot read a picture of numbers.
 */
export function describeTrend(points: readonly TrendPoint[]): string {
  if (points.length === 0) return "No weekend attendance recorded yet.";
  const first = points[0];
  const last = points[points.length - 1];
  if (first.attendance === 0 && last.attendance === 0) {
    return "No attendance recorded in any of the last " + points.length + " weekends.";
  }
  const direction = last.attendance > first.attendance ? "up" : last.attendance < first.attendance ? "down" : "unchanged";
  return (
    `Weekend attendance over the last ${points.length} weeks is ${direction}, from ` +
    `${first.attendance} to ${last.attendance}. Most recent weekend: ${last.attendance} across ` +
    `${last.sessionsHeld} ${last.sessionsHeld === 1 ? "session" : "sessions"}.`
  );
}

export function describeTurnout(rows: ReadonlyArray<{ massName: string; average: number; sessionsHeld: number }>): string {
  if (rows.length === 0) return "No Masses recorded yet.";
  const busiest = rows[0];
  return (
    `Averaging across the last 8 weeks, ${busiest.massName} has the highest average attendance at ` +
    `${busiest.average} across ${busiest.sessionsHeld} ${busiest.sessionsHeld === 1 ? "session" : "sessions"}. ` +
    `Across ${rows.length} ${rows.length === 1 ? "Mass" : "Masses"}.`
  );
}
