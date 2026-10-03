/**
 * APL-8: which pending appeals can no longer be resolved.
 *
 * A pending appeal in a month whose report exists and was not rejected can never be
 * approved — approval goes through the lock guard, and the guard blocks it. Left alone,
 * such an appeal is a question nobody can ever answer, and it sits in every queue as
 * unfinished work. The two-pass expiry during report generation only covers months being
 * generated now; months that were locked before this code existed need the same outcome.
 *
 * The rule is kept pure so it can be tested: given the pending items and the locked
 * months, decide which ones are stranded. Nothing else in this file talks to a database.
 */

export type PendingAppealWithDate = {
  id: string;
  session_date: string;
};

/** First day of the month an ISO date falls in, e.g. "2026-09-14" -> "2026-09-01". */
export function monthStartOf(sessionDate: string): string {
  return `${sessionDate.slice(0, 7)}-01`;
}

/**
 * `lockedMonths` are the report_months with a report that was not rejected, matching the
 * report-lock rule used everywhere else. A rejected report means "send it back", so that
 * month is editable and its appeals are still answerable.
 */
export function selectStrandedAppealIds(
  pending: readonly PendingAppealWithDate[],
  lockedMonths: readonly string[],
): string[] {
  const locked = new Set(lockedMonths);
  const ids: string[] = [];

  for (const item of pending) {
    if (locked.has(monthStartOf(item.session_date))) ids.push(item.id);
  }

  return ids;
}
