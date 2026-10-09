import { describe, expect, it } from "vitest";

import { ROLE_ICONS, isRoleIcon } from "./ministry";
import { glyphFor } from "./icons";

describe("glyphFor", () => {
  it("draws a character for every key the API will accept", () => {
    // A key with no glyph renders as an empty box on the parish's public page, silently. The API's closed
    // list and this map have to stay in step, and this is the only thing that checks it.
    for (const key of ROLE_ICONS) {
      expect(glyphFor(key), key).toBeTypeOf("string");
      expect(glyphFor(key).trim(), key).not.toBe("");
    }
  });

  it("uses the symbols the supplied reference chose", () => {
    // These are the parish's characters, not ours. Changing one to a "better" drawn icon would be
    // disagreeing with the design they handed over, so it is pinned.
    expect(glyphFor("cross")).toBe("✝");
    expect(glyphFor("candle")).toBe("🕯");
    expect(glyphFor("censer")).toBe("♨");
    expect(glyphFor("bell")).toBe("🔔");
  });

  it("falls back rather than rendering nothing", () => {
    // Reachable only by a row written before the API checked its icon, and by anything writing straight
    // to the table. A wrong answer that is visible beats an empty box that is not.
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