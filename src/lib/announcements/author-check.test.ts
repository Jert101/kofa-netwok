import { describe, expect, it } from "vitest";
import { authorForConstraint, isAuthorCheckViolation } from "@/lib/announcements/author-check";

describe("isAuthorCheckViolation", () => {
  it("recognises the created_by check by name", () => {
    expect(
      isAuthorCheckViolation({
        code: "23514",
        message:
          'new row for relation "announcements" violates check constraint "announcements_created_by_check"',
      }),
    ).toBe(true);
  });

  it("ignores a check violation on some other constraint", () => {
    // A retry here would be a lie: the row is bad for a reason the author fold
    // cannot fix, and the composer must still see the real error.
    expect(
      isAuthorCheckViolation({
        code: "23514",
        message:
          'new row for relation "announcements" violates check constraint "announcements_title_check"',
      }),
    ).toBe(false);
  });

  it("ignores a different error class entirely", () => {
    expect(
      isAuthorCheckViolation({
        code: "23505",
        message: 'duplicate key value violates unique constraint "announcements_dedupe_key_idx"',
      }),
    ).toBe(false);
    expect(isAuthorCheckViolation({ message: "created_by" })).toBe(false);
    expect(isAuthorCheckViolation({})).toBe(false);
  });
});

describe("authorForConstraint", () => {
  it("folds a super admin into admin, the role it reaches", () => {
    expect(authorForConstraint("super_admin")).toBe("admin");
  });

  it("leaves every role that can actually post unchanged", () => {
    expect(authorForConstraint("admin")).toBe("admin");
    expect(authorForConstraint("secretary")).toBe("secretary");
    expect(authorForConstraint("officer")).toBe("officer");
  });
});
