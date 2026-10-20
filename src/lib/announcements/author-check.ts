/**
 * The announcement author, and the one way the database can refuse it.
 *
 * `announcements.created_by` is a `CHECK` list of roles. That list has been
 * migrated twice in SQL -- 008 added the officer, 015 added `system` -- while the
 * app has always inserted the session's own role. So a live database can still be
 * holding the narrow 002 list (`admin`, `secretary`) at the same time as the app
 * offers posting to a super admin, whose role reaches the admin section and so
 * passes the route's guard.
 *
 * Posting then fails with:
 *
 *   new row for relation "announcements" violates check constraint
 *   "announcements_created_by_check"
 *
 * 044 widens the constraint to the app's real role list, which is the fix. This
 * module is the belt to that braces: it recognises the refusal for what it is and
 * folds the author into the nearest role the old constraint accepts, so a
 * secretary is never the person who has to read a migration plan to send a notice.
 * The true author is still recorded -- the route audits `session.role`, not the
 * folded value.
 *
 * Pure on purpose: no Supabase import, so it can be tested directly.
 */

import type { Role } from "@/lib/auth/roles";

/** PostgREST's code for a `CHECK` violation (`check_violation`). */
const CHECK_VIOLATION = "23514";

/**
 * True when PostgREST refused the row only because of the `created_by` check.
 *
 * Matched on the constraint's own name rather than the column, so this cannot
 * swallow an unrelated check (a title too long, a malformed audience) and quietly
 * retry it against a database that would refuse it again.
 */
export function isAuthorCheckViolation(error: {
  message?: string | null;
  code?: string | null;
}): boolean {
  if (error.code !== CHECK_VIOLATION) return false;
  return /announcements_created_by_check/.test(error.message ?? "");
}

/**
 * The role an old constraint will accept for this author, or the author
 * unchanged when it already fits.
 *
 * The live database can still hold 002's narrow list ('admin', 'secretary'),
 * while the app lets admin, secretary and officer post -- and super_admin,
 * which reaches the admin section (`ROLE_REACH.admin`) -- passes the guard.
 * So officer and super_admin need folding into a role the narrow constraint
 * accepts; admin is the natural bucket. admin and secretary pass through
 * unchanged. Once 044 widens the constraint, no folding is needed and this is
 * never reached.
 */
export function authorForConstraint(role: Role): Role {
  if (role === "admin" || role === "secretary") return role;
  return "admin";
}
