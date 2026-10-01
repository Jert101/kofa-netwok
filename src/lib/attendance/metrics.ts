/**
 * Attendance metrics for the member profile (module 03, MEM-4).
 *
 * These definitions are the ones module 10 reuses, so they live apart from any
 * component and apart from Supabase: a rate is arithmetic over two sets, and the
 * arithmetic is what needs testing, not the query.
 *
 * Two facts about the schema shape everything here:
 * - A member is present in a session by the *existence* of a row in
 *   attendance_records. There is no status column, so "absent" is the absence of
 *   a row and "late" or "excused" are not attendance states at all.
 * - A session counts as held when at least one member has a record for it, which
 *   is how a session nobody attended is still counted in the denominator.
 *
 * Live and archived rows are passed in as one merged list, so a member who served
 * before archiving keeps their history.
 */

export type AttendanceSession = {
  id: string;
  /** ISO calendar date, `YYYY-MM-DD`. */
  sessionDate: string;
  massName: string | null;
  /** True when this row came from the archive rather than the live table. */
  archived?: boolean;
};

export type MemberMetrics = {
  /** Distinct sessions this member has a record in, live plus archived. */
  lifetimeServed: number;
  /** Sessions held in the measured period. */
  sessionsHeld: number;
  /** attended / held, as a percentage rounded to one decimal, or null when nothing was held. */
  attendanceRate: number | null;
  /** Consecutive weekends attended, counted back from the latest one that ran. */
  weekendStreak: number;
  /** Most recent session date attended, or null if never. */
  lastServedDate: string | null;
};

export const RECENT_SESSION_LIMIT = 20;

/** The measured window for the rate: the last three months. */
export const RATE_WINDOW_MONTHS = 3;

function isValidIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function toUtcDate(iso: string): Date | null {
  if (!isValidIsoDate(iso)) return null;
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== m - 1 ||
    date.getUTCDate() !== d
  ) {
    return null;
  }
  return date;
}

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday, on a UTC date so the day never shifts. */
function dayOfWeek(iso: string): number {
  return toUtcDate(iso)?.getUTCDay() ?? -1;
}

export function isSunday(iso: string): boolean {
  return dayOfWeek(iso) === 0;
}

/** Saturday and Sunday. */
export function isWeekend(iso: string): boolean {
  const day = dayOfWeek(iso);
  return day === 0 || day === 6;
}

/**
 * Today's date, in the parish's own timezone, as `YYYY-MM-DD`.
 *
 * This is why the profile's "today" is not `toISOString().slice(0, 10)`. That is
 * UTC, and a parish that is a day ahead would see the wrong date for eight hours
 * every evening: sessions from the evening they just ran would be excluded from
 * "last served" and from today's own list.
 *
 * Falls back to UTC when no timezone is configured, rather than throwing, because
 * a missing setting should not take the profile down. An unrecognised timezone
 * name falls back too; guessing a nearby one would be worse than using UTC.
 */
export function todayInTimeZone(now: Date, timeZone: string | null | undefined): string {
  if (!timeZone) return now.toISOString().slice(0, 10);
  try {
    // The parts of the instant as they read on the wall clock in that zone.
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
    // en-CA already writes YYYY-MM-DD, but going through the parts guards against
    // a locale that does not.
    const [y, m, d] = parts.split("-").map(Number);
    if (!y || !m || !d) return now.toISOString().slice(0, 10);
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/** The most recent day that is `months` before `today`, as an ISO date. */
export function monthsBefore(today: string, months: number): string {
  const date = toUtcDate(today) ?? new Date();
  const day = date.getUTCDate();
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - months, 1));
  // Clamp: three months before the 31st is a shorter month, so day 31 would roll
  // into the following month and quietly shorten the window.
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return toIso(target);
}

/**
 * The set of sessions that were actually held, from the ids of sessions that have
 * at least one attendance record from anybody. A session nobody attended is still
 * held, which is why this is the denominator and not the member's own records.
 */
export function heldSessionIds(recordSessionIds: Iterable<string>): Set<string> {
  return new Set(recordSessionIds);
}

function dedupeSessions(sessions: readonly AttendanceSession[]): AttendanceSession[] {
  const byId = new Map<string, AttendanceSession>();
  for (const session of sessions) {
    if (!isValidIsoDate(session.sessionDate)) continue;
    const existing = byId.get(session.id);
    // A session is archived wholesale, so the same id can appear live and archived.
    // The archived row carries the mass name, so prefer it when both are present.
    if (!existing || (!existing.massName && session.massName)) byId.set(session.id, session);
  }
  return [...byId.values()].sort((a, b) => (a.sessionDate < b.sessionDate ? 1 : a.sessionDate > b.sessionDate ? -1 : 0));
}

/**
 * The metrics the profile shows.
 *
 * The two record sets are deliberately separate arguments: the numerator comes
 * from the member's own records, the denominator from everybody's. Passing one
 * list for both would make "somebody else turned up" indistinguishable from "this
 * member turned up", and the rate would always be 100.
 *
 * `sundaysOnly` narrows the measured window to Sunday sessions, which is the
 * toggle on the profile: a parish that also holds weekday masses otherwise gets
 * a rate diluted by days its members were never expected to attend.
 */
export function computeMemberMetrics({
  sessions,
  memberSessionIds,
  anyRecordSessionIds,
  today,
  sundaysOnly = false,
  windowMonths = RATE_WINDOW_MONTHS,
}: {
  sessions: readonly AttendanceSession[];
  /** Sessions this member has an attendance record in. */
  memberSessionIds: Iterable<string>;
  /** Sessions with at least one record from anybody. */
  anyRecordSessionIds: Iterable<string>;
  today: string;
  sundaysOnly?: boolean;
  windowMonths?: number;
}): MemberMetrics {
  const allSessions = dedupeSessions(sessions);
  const sessionById = new Map(allSessions.map((s) => [s.id, s]));

  const attendedSessionIds = new Set<string>();
  for (const id of memberSessionIds) {
    // A record whose session is unknown is not counted: the member cannot have
    // attended a session with no date, and guessing a date would corrupt the rate.
    if (sessionById.has(id)) attendedSessionIds.add(id);
  }

  const lifetimeServed = attendedSessionIds.size;

  const lastServedDate = allSessions
    .filter((s) => attendedSessionIds.has(s.id))
    .reduce<string | null>(
      (latest, s) => (latest === null || s.sessionDate > latest ? s.sessionDate : latest),
      null,
    );

  const from = monthsBefore(today, windowMonths);
  const held = heldSessionIds(anyRecordSessionIds);

  const inWindow = allSessions.filter(
    (s) =>
      s.sessionDate >= from &&
      s.sessionDate <= today &&
      held.has(s.id) &&
      (!sundaysOnly || isSunday(s.sessionDate)),
  );

  const sessionsHeld = inWindow.length;
  const attendedInWindow = inWindow.filter((s) => attendedSessionIds.has(s.id)).length;

  return {
    lifetimeServed,
    sessionsHeld,
    attendanceRate:
      sessionsHeld === 0 ? null : Math.round((attendedInWindow / sessionsHeld) * 1000) / 10,
    weekendStreak: weekendStreak(allSessions, attendedSessionIds),
    lastServedDate,
  };
}

/**
 * Consecutive weekends attended, counting back from the latest weekend that ran.
 *
 * Weeks are keyed by ISO week so a Saturday and the Sunday after it are one
 * weekend. A weekend with no session at all ends the streak: the member was not
 * absent, the parish did not meet, and counting it as a break would understate
 * someone who joined recently.
 */
export function weekendStreak(
  sessions: readonly AttendanceSession[],
  attendedSessionIds: ReadonlySet<string>,
): number {
  const attendedWeeks = new Set<string>();
  const weekendsWithASession = new Set<string>();

  for (const session of sessions) {
    if (!isWeekend(session.sessionDate)) continue;
    const key = isoWeekKey(session.sessionDate);
    weekendsWithASession.add(key);
    if (attendedSessionIds.has(session.id)) attendedWeeks.add(key);
  }

  if (weekendsWithASession.size === 0) return 0;

  // Step back one week at a time from the newest weekend, so the count is
  // consecutive by calendar rather than by "how many are in the set".
  let cursor = newestKey([...weekendsWithASession]);
  let streak = 0;
  while (weekendsWithASession.has(cursor)) {
    if (!attendedWeeks.has(cursor)) break;
    streak += 1;
    cursor = previousKey(cursor);
  }
  return streak;
}

function isoWeekKey(iso: string): string {
  const date = toUtcDate(iso);
  if (!date) return iso;
  const day = (date.getUTCDay() + 6) % 7; // Monday = 0
  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() - day);
  return toIso(monday);
}

function previousKey(key: string): string {
  const date = toUtcDate(key);
  const out = new Date(date ?? new Date());
  out.setUTCDate(out.getUTCDate() - 7);
  return toIso(out);
}

function newestKey(keys: readonly string[]): string {
  return keys.reduce((a, b) => (a > b ? a : b));
}

export type RecentSession = {
  id: string;
  sessionDate: string;
  massName: string | null;
  present: boolean;
  archived: boolean;
  sunday: boolean;
};

/** The most recent sessions, newest first, with whether this member was present. */
export function recentSessions(
  sessions: readonly AttendanceSession[],
  memberSessionIds: Iterable<string>,
  limit = RECENT_SESSION_LIMIT,
): RecentSession[] {
  const attended = new Set(memberSessionIds);
  return dedupeSessions(sessions)
    .slice(0, limit)
    .map((s) => ({
      id: s.id,
      sessionDate: s.sessionDate,
      massName: s.massName,
      present: attended.has(s.id),
      archived: s.archived === true,
      sunday: isSunday(s.sessionDate),
    }));
}
