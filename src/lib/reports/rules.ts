import { addDays, endOfMonth, format, startOfMonth } from "date-fns";
import { toZonedTime } from "date-fns-tz";

/** True if this local calendar date is the final Sunday of its month. */
export function isLastSundayOfLocalMonth(localDate: Date): boolean {
  if (localDate.getDay() !== 0) return false;
  const nextWeek = addDays(localDate, 7);
  return nextWeek.getMonth() !== localDate.getMonth();
}

/** Report window: last Sunday of month in church TZ, local hour >= 20. */
export function canGenerateMonthlyReport(now: Date, timeZone: string): boolean {
  if (!timeZone) return false;
  try {
    const z = toZonedTime(now, timeZone);
    if (!isLastSundayOfLocalMonth(z)) return false;
    return z.getHours() >= 20;
  } catch {
    return false;
  }
}

/** First day (YYYY-MM-DD) of the calendar month in TZ for `now`. */
export function reportMonthStartForNow(now: Date, timeZone: string): string {
  const z = toZonedTime(now, timeZone);
  return format(startOfMonth(z), "yyyy-MM-dd");
}

/** Inclusive month bounds for SQL filtering on `session_date`. */
export function monthBoundsFromStart(monthStartYmd: string): { start: string; end: string } {
  const [y, m] = monthStartYmd.split("-").map(Number);
  const start = new Date(y, m - 1, 1);
  const end = endOfMonth(start);
  return {
    start: format(start, "yyyy-MM-dd"),
    end: format(end, "yyyy-MM-dd"),
  };
}

export { toZonedTime, format, startOfMonth, endOfMonth };
