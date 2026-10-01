import { todayInTimeZone } from "@/lib/attendance/metrics";

/**
 * ATT-8: attendance cannot be encoded for a Mass that has not happened yet.
 *
 * Two traps here, both of which show up in the Philippines:
 *
 * "Today" has to be the parish's date, not the server's. A parish at UTC+8 runs
 * past midnight at 16:00 UTC, so a server using UTC still thinks it is yesterday
 * and would refuse to let the secretary mark the evening's Mass.
 *
 * And the comparison has to be on calendar dates, not timestamps. Session dates are
 * plain `YYYY-MM-DD` with no time on them, so comparing instants invites an off-by-one
 * from an assumed midnight.
 */

export type FutureSessionCheck =
  | { allowed: true }
  | { allowed: false; message: string };

export function canEncodeSession(
  sessionDate: string,
  now: Date,
  timeZone: string | null | undefined,
): FutureSessionCheck {
  const today = todayInTimeZone(now, timeZone);

  if (sessionDate > today) {
    return { allowed: false, message: "This Mass hasn't happened yet." };
  }
  return { allowed: true };
}

export function isFutureSession(
  sessionDate: string,
  now: Date,
  timeZone: string | null | undefined,
): boolean {
  return !canEncodeSession(sessionDate, now, timeZone).allowed;
}
