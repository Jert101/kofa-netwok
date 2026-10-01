/** Module 02 AUTH-8 retention rules for the daily sweep. */

/** `login_attempts` is a short-lived brute-force signal, not a record to keep. */
export const LOGIN_ATTEMPTS_RETENTION_DAYS = 7;

export const DEFAULT_AUDIT_RETENTION_MONTHS = 12;

/** Bounds so a typo in the setting cannot wipe or pin the whole audit log. */
export const MIN_AUDIT_RETENTION_MONTHS = 1;
export const MAX_AUDIT_RETENTION_MONTHS = 120;

/**
 * Reads `audit_retention_months` from settings. Anything missing, non-numeric or
 * out of range falls back to the default rather than failing the sweep.
 */
export function parseAuditRetentionMonths(raw: string | null | undefined): number {
  if (raw === null || raw === undefined) return DEFAULT_AUDIT_RETENTION_MONTHS;
  const trimmed = String(raw).trim();
  if (trimmed === "") return DEFAULT_AUDIT_RETENTION_MONTHS;
  const n = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(n)) return DEFAULT_AUDIT_RETENTION_MONTHS;
  if (n < MIN_AUDIT_RETENTION_MONTHS || n > MAX_AUDIT_RETENTION_MONTHS) {
    return DEFAULT_AUDIT_RETENTION_MONTHS;
  }
  return n;
}

/**
 * Cutoff for `months` whole months back from `now`.
 *
 * Calendar months are the point of the setting: "keep 12 months" should not drift
 * by a day each month, so this walks the month field instead of adding 30-day blocks.
 */
export function retentionCutoff(now: Date, months: number): Date {
  if (months <= 0) return new Date(now.getTime());
  const cutoff = new Date(now.getTime());
  const day = cutoff.getDate();
  cutoff.setDate(1);
  cutoff.setMonth(cutoff.getMonth() - months);
  // Clamp to the last valid day: Jan 31 minus 1 month is Dec 31, but Mar 31 minus
  // 1 month must be Feb 28/29 rather than rolling into March.
  const lastDay = new Date(cutoff.getFullYear(), cutoff.getMonth() + 1, 0).getDate();
  cutoff.setDate(Math.min(day, lastDay));
  return cutoff;
}
