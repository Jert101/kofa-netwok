/**
 * APL-6: when an appeal can still be submitted.
 *
 * Two conditions, and they are separate on purpose. The window is about the parish's
 * own patience; the lock is about the report already being closed. A member whose
 * window closed should hear that, not "this month is locked", because those lead to
 * different actions — one is nothing to be done, the other is to ask a secretary.
 *
 * Kept free of the database so the dates can be tested directly. Dates are plain
 * `YYYY-MM-DD` strings and compared as strings, which is safe here because that format
 * sorts chronologically. Building Date objects instead would put the boundary at UTC
 * midnight and shift a day for any parish not on UTC.
 */

export const DEFAULT_WINDOW_DAYS = 14;

/**
 * Bounds for the settings screen. The ceiling is a year: past that the window is not a
 * correction mechanism any more, and a long window on an unreviewed month quietly makes
 * the report permanently unauditable.
 */
export const MIN_APPEAL_WINDOW_DAYS = 0;
export const MAX_APPEAL_WINDOW_DAYS = 365;

/** `0` disables the limit entirely, for a parish that wants to stay open. */
export function parseWindowDays(raw: string | null | undefined): number {
  if (raw === null || raw === undefined || raw.trim() === "") return DEFAULT_WINDOW_DAYS;
  const n = Number(raw);
  // A setting that is unreadable falls back to the default rather than to "no limit".
  // Blocking every appeal because someone typed "two weeks" into the box would be a
  // silent outage in the one feature that lets a member correct the record.
  if (!Number.isFinite(n) || n < 0) return DEFAULT_WINDOW_DAYS;
  return Math.floor(n);
}

/** Last date an appeal for `sessionDate` can be submitted, or null when unlimited. */
export function windowClosesOn(sessionDate: string, windowDays: number): string | null {
  if (windowDays === 0) return null;

  const [year, month, day] = sessionDate.split("-").map(Number);
  if (!year || !month || !day) return null;

  // Built with Date.UTC rather than new Date(y, m, d), which would read the parts as
  // local time and can land on the previous day west of Greenwich.
  const closes = new Date(Date.UTC(year, month - 1, day + windowDays));
  return closes.toISOString().slice(0, 10);
}

export type AppealWindowVerdict =
  | { open: true; closes_on: string | null }
  | { open: false; reason: "window_closed"; closes_on: string; days_over: number };

/**
 * `today` is the parish's current date, not the server's. A parish east of UTC would
 * otherwise lose the last day of every window.
 *
 * The closing date is inclusive: an appeal on the closing day still counts. "Appeals
 * close on the 3rd" has to mean the 3rd is the last day, otherwise the message and the
 * behaviour disagree and the parish finds out the hard way.
 */
export function checkAppealWindow(
  sessionDate: string,
  today: string,
  windowDays: number,
): AppealWindowVerdict {
  const closesOn = windowClosesOn(sessionDate, windowDays);
  if (closesOn === null) return { open: true, closes_on: null };

  if (today <= closesOn) return { open: true, closes_on: closesOn };

  return {
    open: false,
    reason: "window_closed",
    closes_on: closesOn,
    days_over: daysBetween(closesOn, today),
  };
}

function daysBetween(fromIso: string, toIso: string): number {
  const ms = Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}
