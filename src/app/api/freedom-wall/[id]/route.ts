import { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/api/guard";
import { badRequest, forbidden, internalError, jsonOk, notFound } from "@/lib/api/response";
import { logAudit } from "@/lib/audit/log-audit";
import type { Role } from "@/lib/auth/roles";
import {
  canDelete,
  hideSchema,
  wallReadError,
  type AuthorRow,
  type PostRow,
} from "@/lib/freedom-wall/wall";

/**
 * One post: take it down, put it back, or remove it.
 *
 * Two different people can act here and the route has to tell them apart, so
 * the guard admits everyone who may use the wall and the decision is made after
 * the author row is loaded. The moderator branch is `super_admin` only: an admin
 * may remove their own post like anyone else, and no one else's.
 */

const WALL_ROLES: Role[] = ["member", "officer", "treasurer", "secretary"];

type Ctx = { params: Promise<{ id: string }> };

async function loadPost(
  id: string,
): Promise<
  | { post: PostRow; author: AuthorRow | undefined; missing?: false; undeployed?: null }
  | { missing: true; undeployed: string | null }
> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("freedom_wall_posts")
    .select("id, body, created_at, hidden_at, hidden_reason")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) {
    const undeployed = wallReadError(error);
    return { missing: true, undeployed };
  }

  const post = data as unknown as PostRow;
  const { data: authorRow } = await sb
    .from("freedom_wall_authors")
    .select("post_id, member_id, member_name, role")
    .eq("post_id", id)
    .maybeSingle();
  const author = authorRow
    ? {
        post_id: String(authorRow.post_id),
        member_id: authorRow.member_id === null ? null : String(authorRow.member_id),
        member_name: String(authorRow.member_name),
        role: String(authorRow.role),
      }
    : undefined;

  return { post, author, missing: false, undeployed: null };
}

/**
 * `PATCH /api/freedom-wall/[id]` -- hide or restore.
 *
 * Super admin only, and `selfOnly` so the reach table cannot borrow it: hiding
 * something on the wall is a moderation act, not a page an overseer opens.
 * Nothing is destroyed, so a hiding done by mistake is one tap back.
 */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const g = await requireRole(req.headers.get("cookie"), ["super_admin"], { selfOnly: true });
  if (!g.ok) return g.response;
  const { id } = await ctx.params;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return badRequest("Invalid body");
  }
  const parsed = hideSchema.safeParse(json);
  if (!parsed.success) return badRequest("Invalid body");

  const loaded = await loadPost(id);
  if (loaded.missing) {
    return loaded.undeployed ? internalError(loaded.undeployed) : notFound("That post is not on the wall.");
  }

  const update = parsed.data.hidden
    ? {
        hidden_at: new Date().toISOString(),
        hidden_by: g.session.actor?.id ?? null,
        hidden_reason: parsed.data.reason ?? null,
      }
    : { hidden_at: null, hidden_by: null, hidden_reason: null };

  const { error } = await getSupabaseAdmin().from("freedom_wall_posts").update(update).eq("id", id);
  if (error) return internalError(wallReadError(error) ?? "The post could not be updated.");

  await logAudit({
    actor: { role: g.session.role, memberId: g.session.actor?.id ?? null, name: g.session.actor?.name ?? null },
    action: parsed.data.hidden ? "freedom_wall_hidden" : "freedom_wall_restored",
    entityType: "freedom_wall_post",
    entityId: id,
    meta: { reason: parsed.data.reason ?? null },
  });

  return jsonOk({ hidden: parsed.data.hidden });
}

/**
 * `DELETE /api/freedom-wall/[id]` -- remove it for good.
 *
 * The author's own post, or the moderator's call. The author row cascades away
 * with the post, which is the point: a deleted post leaves nothing behind to
 * identify anybody.
 */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const g = await requireRole(req.headers.get("cookie"), WALL_ROLES);
  if (!g.ok) return g.response;
  const { id } = await ctx.params;

  const loaded = await loadPost(id);
  if (loaded.missing) {
    return loaded.undeployed ? internalError(loaded.undeployed) : notFound("That post is not on the wall.");
  }

  const viewer = { role: g.session.role as Role, memberId: g.session.actor?.id ?? null };
  if (!canDelete(loaded.post, loaded.author, viewer)) {
    return forbidden("You can only remove a post you wrote.");
  }

  const { error } = await getSupabaseAdmin().from("freedom_wall_posts").delete().eq("id", id);
  if (error) return internalError(wallReadError(error) ?? "The post could not be removed.");

  await logAudit({
    actor: { role: g.session.role, memberId: g.session.actor?.id ?? null, name: g.session.actor?.name ?? null },
    action: "freedom_wall_deleted",
    entityType: "freedom_wall_post",
    entityId: id,
    // Who removed it is the moderator's business, not the author's: the trail
    // records the hand that acted, and says nothing about who wrote the post.
    meta: { moderator: g.session.role === "super_admin" },
  });

  return jsonOk({ ok: true });
}
