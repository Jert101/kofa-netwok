import { addDays, addMonths, endOfMonth, format, startOfMonth } from "date-fns";
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
    // Same reason as in evaluateReportWindow: an unknown zone yields an Invalid Date, whose
    // getDay() is NaN. Without this, isLastSundayOfLocalMonth returns false and the caller
    // reports a closed window for what is actually a misconfigured setting.
    if (Number.isNaN(z.getTime())) return false;
    if (!isLastSundayOfLocalMonth(z)) return false;
    return z.getHours() >= 20;
  } catch {
    return false;
  }
}

/** Local hour the window opens on. 20:00 church time. */
const WINDOW_OPEN_HOUR = 20;

export type ReportWindowStatus = "pending" | "approved" | "rejected" | null;

export type ReportWindowDecision =
  | { allowed: true; opensAt: null; blockedBy: null }
  | { allowed: false; opensAt: string | null; blockedBy: "exists" | "window" | "timezone" };

export type ReportWindowInput = {
  now: Date;
  /** First day of the target month, YYYY-MM-DD. */
  monthStart: string;
  timeZone: string;
  /** Status of the month's active (non-rejected) report, if any. 029 makes this partial. */
  existingStatus?: ReportWindowStatus;
  /** Admin-only. Skips the schedule entirely. */
  bypass?: boolean;
};

/**
 * RPT-7 / spec §7: the window rule for a *specific* target month, as a pure function.
 *
 * The old `canGenerateMonthlyReport(now, tz)` could only answer about the current month
 * and could only say yes or no. RPT-1 needs the exact opening moment so the status strip
 * can say "Opens Sun 26 Oct, 8:00 PM", which a boolean cannot express.
 *
 * The window belongs to the target month's own final Sunday, not the following month's.
 * That is what makes the 31st case work: a 31-day month ending on a Sunday opens that same
 * evening rather than never, and there is no special case to remember at the call site.
 */
export function evaluateReportWindow(input: ReportWindowInput): ReportWindowDecision {
  const { now, monthStart, timeZone, existingStatus = null, bypass = false } = input;

  // A rejected row does not hold the month (029's partial index), so it is not "exists".
  // It is passed as null by the callers that already filter, and treated as absent here so
  // a stray rejected row cannot block a regenerate.
  if (existingStatus && existingStatus !== "rejected") {
    return { allowed: false, opensAt: null, blockedBy: "exists" };
  }

  if (bypass) return { allowed: true, opensAt: null, blockedBy: null };
  if (!timeZone) return { allowed: false, opensAt: null, blockedBy: "timezone" };

  let zoned: Date;
  try {
    zoned = toZonedTime(now, timeZone);
  } catch {
    return { allowed: false, opensAt: null, blockedBy: "timezone" };
  }

  // `toZonedTime` does not throw for an unrecognised zone; it returns an Invalid Date. The
  // try/catch above therefore never fires, and the `format()` below would throw a RangeError
  // out of a routine status check. Guarding the value is what makes `blockedBy: "timezone"`
  // reachable at all, which is what lets the UI say "timezone misconfigured" instead of
  // blaming the schedule for a settings problem.
  if (Number.isNaN(zoned.getTime())) {
    return { allowed: false, opensAt: null, blockedBy: "timezone" };
  }

  const lastSunday = lastSundayOfMonth(monthStart);
  if (!lastSunday) return { allowed: false, opensAt: null, blockedBy: "window" };

  const opensAt = `${lastSunday}T${String(WINDOW_OPEN_HOUR).padStart(2, "0")}:00:00`;
  const zonedNow = format(zoned, "yyyy-MM-dd'T'HH:mm:ss");
  if (Number.isNaN(Date.parse(`${zonedNow}Z`))) {
    return { allowed: false, opensAt: null, blockedBy: "timezone" };
  }
  const opened = zonedNow >= opensAt;

  // Behaviour note: this admits any moment from the opening instant onwards, whereas the
  // old `canGenerateMonthlyReport` only admitted `now` being the last Sunday itself at or
  // after 20:00. For a target month the two differ only when the last Sunday falls on the
  // 30th and the secretary tries on the 31st, which the old rule refused. That refusal was
  // an artifact of comparing against "today" rather than against the window, and it would
  // have blocked the secretary on the final day of the month. Flagged for review in
  // new md/06-reports.md.
  if (!opened) return { allowed: false, opensAt, blockedBy: "window" };
  return { allowed: true, opensAt: null, blockedBy: null };
}

/**
 * YYYY-MM-DD of the final Sunday of the month starting at `monthStartYmd`.
 * Returns null for a malformed month.
 */
export function lastSundayOfMonth(monthStartYmd: string): string | null {
  const parsed = parseMonthStart(monthStartYmd);
  if (!parsed) return null;
  const last = new Date(parsed.getFullYear(), parsed.getMonth() + 1, 0);
  // Walk back to the nearest Sunday. getDay() is 0 for Sunday.
  last.setDate(last.getDate() - last.getDay());
  return format(last, "yyyy-MM-dd");
}

/**
 * Parse a "YYYY-MM-01" month start into a local Date.
 *
 * The day must be 01, because that is what a month start *is*. Validating the day by
 * round-tripping is not enough on its own: `new Date(2026, 1, 31)` rolls into March, so
 * "2026-02-31" would otherwise be silently accepted and reported as February.
 */
function parseMonthStart(monthStartYmd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-01$/.exec(monthStartYmd);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  const d = new Date(y, mo - 1, 1);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

/**
 * Human-facing opening time for the status strip, e.g. "Sun 26 Oct, 8:00 PM".
 *
 * `opensAt` is already a wall-clock string in church time, so it is formatted directly
 * rather than round-tripped through a timezone. Constructing `new Date(opensAt + "Z")` and
 * then formatting with `timeZone` would apply the offset twice and shift 20:00 Manila to
 * 04:00 the next day.
 */
export function describeWindowOpening(opensAt: string | null): string {
  if (!opensAt) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(opensAt);
  if (!m) return "";

  const [, y, mo, d, hh, mm] = m;
  const dateLabel = new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d))));

  const hour12 = Number(hh) % 12 === 0 ? 12 : Number(hh) % 12;
  const suffix = Number(hh) < 12 ? "AM" : "PM";
  const timeLabel = `${hour12}:${mm} ${suffix}`;
  return `${dateLabel}, ${timeLabel}`;
}


/** First day (YYYY-MM-DD) of the calendar month in TZ for `now`. */
export function reportMonthStartForNow(now: Date, timeZone: string): string {
  const z = toZonedTime(now, timeZone);
  return format(startOfMonth(z), "yyyy-MM-dd");
}

/** First day (YYYY-MM-DD) of the previous calendar month in TZ for `now`. */
export function previousReportMonthStartForNow(now: Date, timeZone: string): string {
  const z = toZonedTime(now, timeZone);
  return format(startOfMonth(addMonths(z, -1)), "yyyy-MM-dd");
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
