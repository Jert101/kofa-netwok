/**
 * Birthdays: who gets one announced, where a birthday comes from, and why the
 * whole ministry needs one.
 *
 * Module 03 lets an admin add a member by hand with nothing but a name -- which
 * is right, because a roster entry four years old should not be blocking
 * anything -- and module 13's public registration form makes the date of birth
 * mandatory, because a child applying to serve has to be old enough to be
 * accepted. Put together, those two rules are how the roster ended up with 79
 * active members who can never be greeted: the birthday cron filters on
 * `date_of_birth`, and a null never matches, so nobody ever notices the gap.
 *
 * The rule this file exists to state: **an altar server has a date of birth.**
 * Without one the parish cannot wish them a happy birthday, and the applicant
 * path already treats it as required, so the only members missing one are the
 * ones added by hand. That is a data bug, not a preference, and the three write
 * paths (add, edit, CSV import) now enforce it in one place instead of leaving
 * the cron to silently skip.
 *
 * Nothing here is a "confirmed from the database" claim: the practical server
 * criterion for years is `batch`, and clearing it is how a graduated member is
 * retired from the ministry. `formation_year` is what a batch value means --
 * `"2026"` means the batch formed in 2026, not a birth year.
 */

import { isReasonableBirthDate } from "@/features/members/member-input";

/** How old a member has to be for the birthday job's list to be plausible. */
export const MAX_ALTAR_SERVER_AGE = 45;

/** Plain-language rule, for the form, the sheet and the error answers. */
export const BIRTHDAY_RULE_HELP =
  `Every member needs a date of birth: the parish announces birthdays, and a member without one ` +
  `can never be greeted. Use the date on the child's record (year included).`;

/** Whole years since `iso`, in UTC, the same arithmetic everywhere else uses. */
export function ageOn(iso: string, onIso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  const [yy, mm, dd] = onIso.split("-").map(Number);
  let age = yy - y;
  if (mm < m || (mm === m && dd < d)) age -= 1;
  return age;
}

/**
 * Whether this row should be greeted by the birthday job.
 *
 * Clearing `batch` is how the parish retires a member from the ministry, so it
 * is the closest thing the data has to "still an altar server". A member with no
 * batch is kept unless their own record says they have aged out -- an
 * unretired 23-year-old (there are three) is somebody the office may well still
 * want greeted, and quietly dropping them is a different complaint waiting to
 * happen.
 */
export function isBirthdayEligible(row: {
  date_of_birth?: string | null;
  batch?: string | null;
  is_active?: boolean | null;
}): boolean {
  if (row.is_active === false) return false;
  const dob = row.date_of_birth;
  if (!dob || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) return false;

  const batch = typeof row.batch === "string" ? row.batch.trim() : "";
  if (batch) return true;

  const age = ageOn(dob, new Date().toISOString().slice(0, 10));
  return age <= MAX_ALTAR_SERVER_AGE;
}

/** Whether a stored date of birth can be announced at all. Re-exported for one import site. */
export { isReasonableBirthDate };
