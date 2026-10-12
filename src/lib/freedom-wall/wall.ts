import { z } from "zod";

import type { Role } from "@/lib/auth/roles";
import { isUndeployedSchemaError, migrationMessage } from "@/lib/supabase/migration-error";

/**
 * Freedom Wall rules, kept pure so they can be tested without a database.
 *
 * The shape of the feature is one promise and one privilege: everybody reads
 * anonymously, and one role can also read the name. Everything here exists to
 * make that promise hard to break by accident -- in particular
 * `toPostViews`, which is the only way a non-moderator's list is ever built,
 * and which cannot emit an author field because its return type has nowhere to
 * put one.
 */

/** Named so a database without the tables says which file to apply. */
export const FREEDOM_WALL_MIGRATION = "043_freedom_wall.sql";

export const BODY_MIN = 1;
export const BODY_MAX = 1000;
/** A wall nobody is asked to post on becomes a wall that is only read. */
export const MAX_POSTS_PER_DAY = 5;
/** Enough for a parish wall; a member paging back further is not a use case. */
export const FEED_LIMIT = 100;
export const MAX_HIDE_REASON = 200;

export const postSchema = z.object({
  body: z.string().trim().min(BODY_MIN, "Write something first.").max(BODY_MAX, `Keep it under ${BODY_MAX} characters.`),
});

export const hideSchema = z.object({
  hidden: z.boolean(),
  reason: z.string().trim().max(MAX_HIDE_REASON).optional(),
});

export type PostRow = {
  id: string;
  body: string;
  created_at: string;
  hidden_at: string | null;
  hidden_reason: string | null;
};

export type AuthorRow = {
  post_id: string;
  member_id: string | null;
  member_name: string;
  role: string;
};

/** Who is asking. The member id is null for a session with no actor behind it. */
export type Viewer = {
  role: Role;
  memberId: string | null;
};

/**
 * A post as the wall shows it. There is no author field here and there cannot
 * be one: this is the type the browser receives, so a leak would have to be a
 * change to this file rather than a forgotten `select` in a route.
 */
export type PostView = {
  id: string;
  body: string;
  created_at: string;
  can_delete: boolean;
};

/** The same post for the one role that moderates and may identify. */
export type ModeratorPostView = PostView & {
  hidden: boolean;
  hidden_reason: string | null;
  author_name: string;
  author_role: string;
};

/** The moderator of record. Not reachable by `admin`, by design: see roles.ts. */
export function isModerator(role: Role): boolean {
  return role === "super_admin";
}

/**
 * The two administrative roles.
 *
 * Listed because neither of them gets the *author's* privilege below. That is a
 * decision the parish asked for: the admin removes nothing, so a post written
 * from the parish's own administrative account cannot be taken back by that
 * role -- not even by the person who wrote it. `super_admin` keeps the separate
 * moderation right above, which is the one authority over the wall.
 */
const ADMIN_ROLES: readonly Role[] = ["admin", "super_admin"];

/**
 * A member may take back what they wrote; the moderator may take down anything.
 * Nothing here tells a caller *whose* post it is beyond their own.
 */
export function canDelete(post: PostRow, author: AuthorRow | undefined, viewer: Viewer): boolean {
  if (isModerator(viewer.role)) return true;
  if (ADMIN_ROLES.includes(viewer.role)) return false;
  if (!viewer.memberId) return false;
  return author?.member_id === viewer.memberId;
}

/**
 * The wall for everybody else: visible posts only, no author, no moderation
 * fields. Hidden posts are not "shown as hidden" to the ministry -- they are
 * absent, because a post nobody can see must not be discoverable by its
 * presence in a count.
 */
export function toPostViews(
  rows: readonly PostRow[],
  authors: ReadonlyMap<string, AuthorRow>,
  viewer: Viewer,
): PostView[] {
  return rows
    .filter((row) => row.hidden_at === null)
    .map((row) => ({
      id: row.id,
      body: row.body,
      created_at: row.created_at,
      can_delete: canDelete(row, authors.get(row.id), viewer),
    }));
}

/** Same list for the moderator: hidden posts included, names attached. */
export function toModeratorViews(
  rows: readonly PostRow[],
  authors: ReadonlyMap<string, AuthorRow>,
  viewer: Viewer,
): ModeratorPostView[] {
  return rows.map((row) => {
    const author = authors.get(row.id);
    return {
      id: row.id,
      body: row.body,
      created_at: row.created_at,
      can_delete: canDelete(row, author, viewer),
      hidden: row.hidden_at !== null,
      hidden_reason: row.hidden_reason,
      author_name: author?.member_name ?? "Unknown",
      author_role: author?.role ?? "unknown",
    };
  });
}

/**
 * How many posts this person may still write today. The cap is on the author
 * table's own count rather than a token bucket, so it cannot be reset by
 * clearing anything, and it is enforced server-side where it counts.
 */
export function postsRemaining(writtenToday: number): number {
  return Math.max(0, MAX_POSTS_PER_DAY - writtenToday);
}

/**
 * The wording for a database that has not been migrated yet.
 *
 * A wall that 500s with `relation "public.freedom_wall_posts" does not exist`
 * tells whoever is deploying nothing useful; the same failure with the file name
 * in it is a step they can take.
 */
export function wallReadError(error: { code?: string | null; message?: string | null } | null): string | null {
  return isUndeployedSchemaError(error) ? migrationMessage(FREEDOM_WALL_MIGRATION) : null;
}
