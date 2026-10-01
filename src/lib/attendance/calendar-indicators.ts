/**
 * The calendar's "needs encoding" rule, extracted so it can be tested without a
 * database. Mirrors the query in `/api/attendance/month-indicators`.
 */

export type DayCounts = {
  /** Sessions on the day. */
  sessions: number;
  /** Sessions with at least one attendance record, live or archived. */
  held: number;
};

/**
 * A day needs encoding when it is in the past, has sessions, and nobody recorded
 * anybody.
 *
 * Future days are never flagged. Pre-created Sunday sessions sit on the calendar days
 * before they happen, and marking those "needs encoding" would leave the parish staring
 * at amber dots on a week it has not lived through yet.
 *
 * Comparison is on the calendar date string, not a timestamp. "2026-03-01" < "2026-02-28"
 * as strings is false, and as dates is true, so the string form is the only one of the
 * two that avoids a timezone shifting the answer.
 */
export function needsEncoding(date: string, counts: DayCounts, today: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return false;
  if (counts.sessions === 0) return false;
  if (counts.held > 0) return false;
  return date < today;
}

/**
 * Dot colour for a day, highest priority first.
 *
 * Appeals outrank encoding because an appeal is a person waiting for an answer. A
 * locked month still shows the encoding dot: the month being closed does not mean the
 * data in it is complete, and hiding that would make a locked month look finished.
 */
export type DayDot = "appeal" | "needs_encoding" | "recorded" | null;

export function dayDot(
  counts: DayCounts,
  options: { today: string; date: string; pendingAppeals: number },
): DayDot {
  if (options.pendingAppeals > 0) return "appeal";
  if (needsEncoding(options.date, counts, options.today)) return "needs_encoding";
  if (counts.held > 0) return "recorded";
  return null;
}
