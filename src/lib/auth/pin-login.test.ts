import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseSetting, validateSetting } from "@/lib/settings/registry";

const ROLES = ["admin", "secretary", "member", "officer", "treasurer", "super_admin"] as const;

/**
 * Regression tests for the "no PIN works, and the app says the PIN is wrong" outage.
 *
 * `getSetting` validates against the registry and falls back to the declared default when validation
 * fails, and `validateSetting` refuses every `exposed: false` key -- which is precisely what a PIN hash
 * is. So `getSetting("pin_admin_hash")` returns `""` even with a perfectly good hash in the row, and the
 * login loop has nothing to compare against.
 *
 * These tests pin down the two halves of that trap: the reader that loses the hash, and the reader that
 * keeps it. The second group is the one that matters -- if someone switches the login path back to
 * `getSetting`, nothing else in the suite notices, and the whole church is locked out again.
 */
describe("reading a PIN hash through the general settings reader", () => {
  it("refuses to validate an internal key, which is what empties the hash", () => {
    // This refusal is correct and deliberate. It is also, on its own, a trap for callers.
    for (const role of ROLES) {
      const result = validateSetting(`pin_${role}_hash`, "$2b$10$aRealBcryptHash");
      expect(result.ok, role).toBe(false);
    }
  });

  it("returns the empty default rather than the stored hash", () => {
    // The exact value the login loop used to receive for every role.
    const hash = "$2b$10$aRealBcryptHash";
    expect(parseSetting("pin_admin_hash", hash)).toBe("");
    expect(parseSetting("pin_admin_hash", hash)).not.toBe(hash);
  });

  it("truncates nothing and throws nothing for a hash it has never seen", () => {
    // Not a throw: `getSetting` finds the definition, so the failure is a silent empty string rather
    // than a 500. That is why the outage presented as "wrong PIN" instead of as a server error.
    expect(parseSetting("pin_super_admin_hash", null)).toBe("");
    expect(parseSetting("sessions_valid_after_admin", "2026-01-01T00:00:00.000Z")).toBe("");
  });
});

describe("the login path's reader", () => {
  const source = readFileSync(join(process.cwd(), "src/lib/auth/pin-login.ts"), "utf8");

  it("reads internal keys through the internal reader", () => {
    // `getAllInternalSettings` passes internal values through verbatim and is what `pin-service.ts` and
    // `session-valid.ts` already use. `getSetting` is the wrong tool for a secret and cannot return one.
    //
    // Asserted on the import rather than on the whole file, because a prose mention of `getSetting` in a
    // comment explaining this exact bug must not fail the test that guards this exact bug.
    const imported = [...source.matchAll(/import\s*\{([^}]*)\}\s*from\s*"@\/lib\/settings\/store"/g)]
      .flatMap((m) => m[1].split(",").map((name) => name.trim()))
      .filter(Boolean);

    expect(imported).toEqual(["getAllInternalSettings"]);
  });

  it("still refuses a PIN outside the 4-12 character rule before touching the database", () => {
    expect(source).toContain("pin.length < 4 || pin.length > 12");
  });
});