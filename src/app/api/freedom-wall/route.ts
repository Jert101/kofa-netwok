import { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/api/guard";
import { badRequest, forbidden, internalError, jsonOk } from "@/lib/api/response";
import type { Role } from "@/lib/auth/roles";
import {
  FEED_LIMIT,
  MAX_POSTS_PER_DAY,
  postsRemaining,
  postSchema,
  toModeratorViews,
  toPostViews,
  wallReadError,
  type AuthorRow,
  type PostRow,
} from "@/lib/freedom-wall/wall";

/**
 * Every signed-in person in the ministry may use the wall.
 *
 * The list is the four sections that are their own: `member` covers the member,
 * and an admin or the super admin answers to it through the reach table. An
 * officer, treasurer or secretary cannot reach `/member`, so they are named
 * here as well -- otherwise the wall would be reachable only by the roles that
 * happen to share the member's section.
 */
const WALL_ROLES: Role[] = ["member", "officer", "treasurer", "secretary"];

async function loadAuthors(postIds: readonly string[]): Promise<Map<string, AuthorRow>> {
  if (postIds.length === 0) return new Map();
  const { data } = await getSupabaseAdmin()
    .from("freedom_wall_authors")
    .select("post_id, member_id, member_name, role")
    .in("post_id", postIds as string[]);
  const out = new Map<string, AuthorRow>();
  for (const row of data ?? []) {
    out.set(String(row.post_id), {
      post_id: String(row.post_id),
      member_id: row.member_id === null ? null : String(row.member_id),
      member_name: String(row.member_name),
      role: String(row.role),
    });
  }
  return out;
}

/**
 * `GET /api/freedom-wall` -- the wall.
 *
 * `?moderation=1` is the super admin's view: hidden posts included, names
 * attached. The branch is on the *session's* role, not on the query, so a
 * member who adds `?moderation=1` by hand gets a 403 rather than a second shape
 * of the same response.
 */
export async function GET(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), WALL_ROLES);
  if (!g.ok) return g.response;

  const wantsModeration = new URL(req.url).searchParams.get("moderation") === "1";
  const moderator = g.session.role === "super_admin";
  if (wantsModeration && !moderator) {
    return forbidden("Only the super admin can see who wrote a post.");
  }

  const sb = getSupabaseAdmin();
  // Hidden posts are filtered in SQL rather than in the view builder, so they
  // never reach the browser for anyone but the moderator.
  let query = sb
    .from("freedom_wall_posts")
    .select("id, body, created_at, hidden_at, hidden_reason")
    .order("created_at", { ascending: false })
    .limit(FEED_LIMIT);
  if (!moderator) query = query.is("hidden_at", null);

  const { data, error } = await query;
  if (error) {
    const undeployed = wallReadError(error);
    return internalError(undeployed ?? "The Freedom Wall could not be loaded.");
  }

  const rows = (data ?? []) as unknown as PostRow[];
  const authors = await loadAuthors(rows.map((r) => r.id));
  const viewer = { role: g.session.role as Role, memberId: g.session.actor?.id ?? null };

  return jsonOk({
    posts: wantsModeration
      ? toModeratorViews(rows, authors, viewer)
      : toPostViews(rows, authors, viewer),
    can_post: g.session.actor != null,
    remaining_today: await remainingForToday(g.session.actor?.id ?? null),
    max_per_day: MAX_POSTS_PER_DAY,
  });
}

/** Posts already written today, so the composer can stop offering a full box. */
async function remainingForToday(memberId: string | null): Promise<number> {
  if (!memberId) return 0;
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count } = await getSupabaseAdmin()
    .from("freedom_wall_authors")
    .select("post_id", { count: "exact", head: true })
    .eq("member_id", memberId)
    .gte("created_at", since);
  return postsRemaining(count ?? 0);
}

/**
 * `POST /api/freedom-wall` -- write something.
 *
 * Deliberately does not write an audit row. Every other write in this app does,
 * and an audit row names its actor: the audit page is admin-visible, so logging
 * every post would publish the author's name to exactly the people the wall
 * hides it from. Moderation actions *are* audited, in the `[id]` route.
 */
export async function POST(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), WALL_ROLES);
  if (!g.ok) return g.response;

  const memberId = g.session.actor?.id ?? null;
  const memberName = g.session.actor?.name ?? null;
  // A session with no actor behind it has nobody to be anonymous *for*, and an
  // author row is mandatory. Refusing here beats a wall full of "Unknown".
  if (!memberId || !memberName) {
    return forbidden("Sign in with a parish account to post.");
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return badRequest("Invalid body");
  }
  const parsed = postSchema.safeParse(json);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Invalid body");
  }

  if ((await remainingForToday(memberId)) === 0) {
    return badRequest(`You have already written ${MAX_POSTS_PER_DAY} posts in the last day.`);
  }

  // The function writes the post and its author row in one transaction, so a
  // post the super admin cannot trace is not a state this system can reach.
  const { data, error } = await getSupabaseAdmin().rpc("create_freedom_wall_post", {
    p_body: parsed.data.body,
    p_member_id: memberId,
    p_member_name: memberName,
    p_role: g.session.role,
  });

  if (error) return internalError(wallReadError(error) ?? "The post could not be saved.");

  return jsonOk({ id: String(data ?? "") }, { status: 201 });
}
