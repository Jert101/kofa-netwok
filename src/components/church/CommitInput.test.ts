import { describe, expect, it } from "vitest";

import { diffForCommit } from "./CommitInput";

describe("diffForCommit", () => {
  it("returns null when nothing changed", () => {
    expect(diffForCommit("John", "John")).toBeNull();
  });

  it("returns the draft when it differs from the committed value", () => {
    expect(diffForCommit("John", "Johnny")).toBe("Johnny");
  });

  it("compares against the committed value, not the draft itself", () => {
    // This is the regression that silently dropped every council edit: the
    // old code compared the input against the row's live state, which every
    // keystroke had already updated, so the two were always equal at blur and
    // no save ever fired. The first argument here must be the last value the
    // server confirmed -- passing the draft as both sides must yield null,
    // which is exactly the old (broken) behavior made visible.
    expect(diffForCommit("Johnny", "Johnny")).toBeNull();
    expect(diffForCommit("John", "Johnny")).toBe("Johnny");
  });

  it("normalizes before comparing", () => {
    const trim = (v: string) => v.trim();
    // Trailing space only: normalizes back to the committed value, so no
    // save fires and no pointless write bumps updated_at.
    expect(diffForCommit("John", "John ", trim)).toBeNull();
    expect(diffForCommit("John", "  Johnny  ", trim)).toBe("Johnny");
  });
});
