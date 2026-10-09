import { describe, expect, it } from "vitest";

import { ROLE_ICONS, isRoleIcon } from "./ministry";
import { glyphFor } from "./icons";

describe("glyphFor", () => {
  it("draws a component for every key the API will accept", () => {
    // A key with no glyph renders as an empty box on the parish's public page, silently. The API's
    // closed list and this map have to stay in step, and this is the only thing that checks it.
    // Lucide icons are `forwardRef` objects rather than functions, so the check is "is there
    // something renderable" rather than "is it a function".
    for (const key of ROLE_ICONS) {
      const glyph = glyphFor(key);
      expect(glyph, key).toBeTruthy();
      expect(["function", "object"], `${key} (${typeof glyph})`).toContain(typeof glyph);
    }
  });

  it("falls back rather than rendering nothing", () => {
    // Reachable only by a row written before the API checked its icon, and by anything that writes
    // straight to the table. A wrong answer that is visible beats an empty box that is not.
    expect(glyphFor("no-such-icon")).toBe(glyphFor("cross"));
    expect(glyphFor(null)).toBe(glyphFor("cross"));
    expect(glyphFor(undefined)).toBe(glyphFor("cross"));
    expect(glyphFor("")).toBe(glyphFor("cross"));
  });

  it("gives different keys different glyphs, so a role is not identified by luck", () => {
    const seen = new Set(ROLE_ICONS.map((key) => glyphFor(key)));
    expect(seen.size).toBe(ROLE_ICONS.length);
  });

  it("still accepts exactly the keys it claims to", () => {
    expect(isRoleIcon("censer")).toBe(true);
    expect(isRoleIcon("no-such-icon")).toBe(false);
  });
});