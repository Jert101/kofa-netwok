/**
 * Church time: what day it is where the parish is, not where the server is.
 *
 * Three modules need this and none of them should invent it: payments (a payment dated "today" in
 * Manila), dashboards (every month boundary), and settings (an invalid timezone would move all of
 * them at once).
 *
 * ## Why this exists
 *
 * The app ran on a server whose timezone is UTC and read dates with `new Date()`, so "today" was
 * whatever UTC thought. A parish in Manila opens the app at 07:00 local and the app is already on
 * tomorrow's date; at 08:00 it has silently rolled the week over. The birthday cron had the same
 * problem in the other direction and could wish somebody happy a day early.
 *
 * Every function here takes the IANA zone from settings and derives the answer from it, so moving the
 * parish's timezone setting moves all of this together.
 */

export const DEFAULT_TIMEZONE = "Asia/Manila";

/**
 * Non-region zone names we accept deliberately.
 *
 * "UTC" and "GMT" are not regions but are perfectly reasonable things for an operator to configure, and
 * neither has daylight saving to get wrong.
 */
const ZONE_ALIASES_OK = new Set(["UTC", "GMT", "Z"]);

/**
 * Whether a string is a timezone this deployment should accept.
 *
 * ## Why this is more than a try/catch
 *
 * `new Intl.DateTimeFormat(..., { timeZone })` alone is too lenient. It accepts the legacy
 * single-letter abbreviations "PST" and "EST", which are *fixed offsets with no daylight saving*. A
 * parish that set "PST" would get a timezone that silently disagrees with civil time for half the year,
 * and nothing anywhere would ever say so -- and the report window is exactly the kind of thing that has
 * to be right.
 *
 * ## Why this is not a list membership test either
 *
 * `Intl.supportedValuesOf('timeZone')` is the canonical list, but it is only as complete as the ICU data
 * in the runtime. This build returns "Asia/Calcutta" and does **not** include "Asia/Kolkata", so a plain
 * allowlist rejects a perfectly valid modern name for the most populous time zone on earth.
 *
 * ## The rule actually used
 *
 * A name is accepted when the runtime understands it **and** it is region-qualified (contains a "/") or
 * is one of the three deliberate aliases above. Every real IANA zone is either region-qualified
 * ("Asia/Kolkata", "Etc/GMT+8", "US/Pacific") or one of the aliases; the dangerous abbreviations are not.
 */
export function isValidTimeZone(timezone: string | null | undefined): boolean {
  if (!timezone || typeof timezone !== "string") return false;

  if (!timezone.includes("/") && !ZONE_ALIASES_OK.has(timezone)) return false;

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Every zone the settings page should offer, for the searchable picker.
 *
 * The runtime's list when it has one, plus the aliases. Some entries may be no longer canonical on a
 * given runtime ("Asia/Calcutta"), which is harmless in a picker and better than an empty one.
 */
export function availableTimeZones(): string[] {
  const zones = new Set<string>(ZONE_ALIASES_OK);
  if (typeof Intl.supportedValuesOf === "function") {
    try {
      for (const zone of Intl.supportedValuesOf("timeZone")) zones.add(zone);
    } catch {
      // Fall through with just the aliases and the default.
    }
  }
  zones.add(DEFAULT_TIMEZONE);
  return [...zones].sort();
}

/**
 * The timezone to actually use.
 *
 * An invalid stored value falls back to Manila rather than throwing, per spec §SYS-8: the health page
 * shows the problem in red, and the app keeps working. A page that 500s because somebody typed
 * `Asia/Manila ` with a trailing space is worse than a page that quietly uses the default.
 */
export function resolveTimeZone(timezone: string | null | undefined): string {
  return isValidTimeZone(timezone) ? (timezone as string) : DEFAULT_TIMEZONE;
}

/** Today's date in the church's timezone, as `YYYY-MM-DD`. */
export function churchToday(timezone: string | null | undefined, now: Date = new Date()): string {
  return datePartsInZone(resolveTimeZone(timezone), now).date;
}

/** The current time in the church's timezone, as `h:mm AM/PM`. For the settings page's live clock. */
export function churchClock(timezone: string | null | undefined, now: Date = new Date()): string {
  const parts = datePartsInZone(resolveTimeZone(timezone), now);
  const suffix = parts.hour >= 12 ? "PM" : "AM";
  const hour = parts.hour % 12 === 0 ? 12 : parts.hour % 12;
  return `${hour}:${String(parts.minute).padStart(2, "0")} ${suffix}`;
}

/**
 * The zone's offset from UTC in minutes at a given instant.
 *
 * Needed for the duplicate-payment warning, which has to print a time the treasurer recognises. A
 * fixed offset is wrong for any zone with daylight saving, hence "at this instant".
 *
 * Positive east of Greenwich, so `new Date(ms + offset)` lands on the local wall clock. That is the
 * sign convention `Date.getTimezoneOffset()` deliberately inverts, which is why this is written out
 * rather than delegating.
 */
export function zoneOffsetMinutes(timezone: string | null | undefined, now: Date = new Date()): number {
  const zone = resolveTimeZone(timezone);
  const parts = datePartsInZone(zone, now);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  // Seconds are dropped on both sides so the difference is a whole number of minutes even when the
  // instant has milliseconds.
  return Math.round((asUtc - now.getTime()) / 60_000);
}

/** Calendar fields for an instant in a zone. */
export function datePartsInZone(
  timezone: string | null | undefined,
  now: Date = new Date(),
): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  date: string;
} {
  const zone = resolveTimeZone(timezone);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const out: Record<string, string> = {};
  for (const part of formatter.formatToParts(now)) {
    if (part.type !== "literal") out[part.type] = part.value;
  }

  // `hour12: false` yields 24 for midnight in some ICU builds, which is not an hour anybody uses.
  const hour = Number(out.hour) % 24;

  const year = Number(out.year);
  const month = Number(out.month);
  const day = Number(out.day);

  return {
    year,
    month,
    day,
    hour,
    minute: Number(out.minute),
    second: Number(out.second),
    date: `${out.year}-${out.month}-${out.day}`,
  };
}

/** Whole days between two `YYYY-MM-DD` dates. Negative when `to` precedes `from`. */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${to.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/**
 * A date some number of days from `date`.
 *
 * Exported rather than kept private in each metrics module because four places need it -- dashboard
 * windows, trend buckets, streaks -- and three copies drift apart. UTC throughout, for the same reason
 * everything else here is.
 */
export function shiftDays(date: string, days: number): string {
  const d = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The first day of the month containing `date`, as `YYYY-MM-DD`. */
export function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

/** The last day of the month containing `date`, as `YYYY-MM-DD`. */
export function monthEnd(date: string): string {
  const d = new Date(`${date.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

/** The same day-of-month `count` months later, clamped so 31 January plus one month is 28 February. */
export function addMonthsClamped(date: string, count: number): string {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(0, 7).slice(5));
  const d = Number(date.slice(8, 10));

  const targetMonthIndex = m - 1 + count;
  const targetYear = y + Math.floor(targetMonthIndex / 12);
  const normalized = ((targetMonthIndex % 12) + 12) % 12;

  const lastDay = new Date(Date.UTC(targetYear, normalized + 1, 0)).getUTCDate();
  const clamped = Math.min(d, lastDay);

  return `${String(targetYear).padStart(4, "0")}-${String(normalized + 1).padStart(2, "0")}-${String(clamped).padStart(2, "0")}`;
}

/**
 * The N whole calendar months before `date`.
 *
 * Clamped, never overflowing: adding a month to 31 January must land on 28 or 29 February rather than
 * rolling into March, because "the two complete months before now" is what the inactive-members rule
 * means and 2 March is neither of those months.
 */
export function monthsBeforeClamped(date: string, count: number): string {
  return addMonthsClamped(date, -count);
}

/** Whether a date string is `YYYY-MM-DD` and a real day. */
export function isIsoDate(value: string | null | undefined): boolean {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed)) return false;
  return new Date(parsed).toISOString().slice(0, 10) === value;
}