import { describe, expect, it } from "vitest";

import {
  canDelete,
  isModerator,
  postsRemaining,
  toModeratorViews,
  toPostViews,
  wallReadError,
  MAX_POSTS_PER_DAY,
  postSchema,
  type AuthorRow,
  type PostRow,
  type Viewer,
} from "./wall";

const JOSE: Viewer = { role: "member", memberId: "m-jose" };
const MARIA: Viewer = { role: "member", memberId: "m-maria" };
const ADMIN: Viewer = { role: "admin", memberId: "m-admin" };
const SUPER: Viewer = { role: "super_admin", memberId: "m-super" };

function post(over: Partial<PostRow> = {}): PostRow {
  return {
    id: "p1",
    body: "Thank you to the ministry team.",
    created_at: "2026-10-12T09:00:00.000Z",
    hidden_at: null,
    hidden_reason: null,
    ...over,
  };
}

function author(over: Partial<AuthorRow> = {}): AuthorRow {
  return {
    post_id: "p1",
    member_id: "m-jose",
    member_name: "Jose",
    role: "member",
    ...over,
  };
}

const AUTHORS = new Map<string, AuthorRow>([["p1", author()]]);

describe("postSchema", () => {
  it("trims and accepts ordinary text", () => {
    expect(postSchema.parse({ body: "  Salamat, mga kaibigan.  " }).body).toBe("Salamat, mga kaibigan.");
  });

  it("rejects an empty or whitespace-only post", () => {
    expect(postSchema.safeParse({ body: "   " }).success).toBe(false);
    expect(postSchema.safeParse({ body: "" }).success).toBe(false);
  });

  it("rejects a post past the limit", () => {
    expect(postSchema.safeParse({ body: "a".repeat(1001) }).success).toBe(false);
    expect(postSchema.safeParse({ body: "a".repeat(1000) }).success).toBe(true);
  });
});

describe("isModerator", () => {
  it("is the super admin alone", () => {
    expect(isModerator("super_admin")).toBe(true);
    // `admin` reaches every section except super-admin, so it must not moderate here either.
    expect(isModerator("admin")).toBe(false);
    expect(isModerator("member")).toBe(false);
  });
});

describe("canDelete", () => {
  it("lets an author take back their own post", () => {
    expect(canDelete(post(), author(), JOSE)).toBe(true);
  });

  it("stops anyone else", () => {
    expect(canDelete(post(), author(), MARIA)).toBe(false);
  });

  it("gives the admin no removal rights at all, not even on its own post", () => {
    // The parish asked for this: the admin removes nothing from the wall.
    const adminIsAuthor: AuthorRow = { ...author(), member_id: "m-admin", role: "admin" };
    expect(canDelete(post(), author(), ADMIN)).toBe(false);
    expect(canDelete(post(), adminIsAuthor, ADMIN)).toBe(false);
  });

  it("stops every role without the author's own-post right when there is no author row", () => {
    expect(canDelete(post(), undefined, JOSE)).toBe(false);
    expect(canDelete(post(), undefined, ADMIN)).toBe(false);
    // The moderator is the exception: they act on the wall, not on authorship.
    expect(canDelete(post(), undefined, SUPER)).toBe(true);
  });

  it("lets the moderator remove anyone's post", () => {
    expect(canDelete(post(), author(), SUPER)).toBe(true);
    expect(canDelete(post(), { ...author(), member_id: "m-admin" }, SUPER)).toBe(true);
  });

  it("refuses a session with no member behind it", () => {
    expect(canDelete(post(), author(), { role: "member", memberId: null })).toBe(false);
  });
});

describe("toPostViews", () => {
  it("carries no author and no moderation fields at all", () => {
    const [view] = toPostViews([post()], AUTHORS, MARIA);
    expect(Object.keys(view).sort()).toEqual(["body", "can_delete", "created_at", "id"]);
    expect(JSON.stringify(view)).not.toContain("Jose");
  });

  it("omits a hidden post entirely", () => {
    const rows = [post(), post({ id: "p2", hidden_at: "2026-10-12T10:00:00.000Z" })];
    expect(toPostViews(rows, AUTHORS, SUPER).map((v) => v.id)).toEqual(["p1"]);
  });

  it("marks only the viewer's own post as removable", () => {
    const views = toPostViews([post()], AUTHORS, JOSE);
    expect(views[0].can_delete).toBe(true);
    expect(toPostViews([post()], AUTHORS, MARIA)[0].can_delete).toBe(false);
  });
});

describe("toModeratorViews", () => {
  it("includes hidden posts with the reason and the name", () => {
    const views = toModeratorViews(
      [post({ hidden_at: "2026-10-12T10:00:00.000Z", hidden_reason: "reported" })],
      AUTHORS,
      SUPER,
    );
    expect(views).toEqual([
      {
        id: "p1",
        body: "Thank you to the ministry team.",
        created_at: "2026-10-12T09:00:00.000Z",
        can_delete: true,
        hidden: true,
        hidden_reason: "reported",
        author_name: "Jose",
        author_role: "member",
      },
    ]);
  });

  it("says Unknown rather than inventing a name for an orphaned post", () => {
    const [view] = toModeratorViews([post()], new Map(), SUPER);
    expect(view.author_name).toBe("Unknown");
    expect(view.author_role).toBe("unknown");
  });
});

describe("wallReadError", () => {
  it("names the migration when the tables are not there yet", () => {
    expect(wallReadError({ code: "42P01", message: 'relation "public.freedom_wall_posts" does not exist' })).toContain(
      "043_freedom_wall.sql",
    );
    // The RPC goes with the tables, so a missing function is the same problem.
    expect(wallReadError({ code: "42883", message: "function create_freedom_wall_post does not exist" })).toContain(
      "043_freedom_wall.sql",
    );
  });

  it("stays out of the way for an ordinary failure", () => {
    expect(wallReadError({ code: "57014", message: "statement timeout" })).toBeNull();
    expect(wallReadError(null)).toBeNull();
  });
});

describe("postsRemaining", () => {
  it("counts down and never goes below zero", () => {
    expect(postsRemaining(0)).toBe(MAX_POSTS_PER_DAY);
    expect(postsRemaining(3)).toBe(2);
    expect(postsRemaining(MAX_POSTS_PER_DAY)).toBe(0);
    expect(postsRemaining(99)).toBe(0);
  });
});
