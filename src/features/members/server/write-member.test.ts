import { describe, expect, it } from "vitest";

import { buildMemberUpdates } from "./write-member";

/**
 * Every column `members` actually has. `first_name` / `last_name` /
 * `middle_initial` are form fields and CSV headers, not columns -- the table
 * stores one `full_name`. Sending a part through makes PostgREST answer 400
 * PGRST204 ("Could not find the 'first_name' column of 'members' in the
 * schema cache"), which is exactly the error that reached the screen.
 */
const MEMBER_COLUMNS = new Set([
  "full_name",
  "date_of_birth",
  "gender",
  "contact_number",
  "batch",
]);

function keysOf(result: ReturnType<typeof buildMemberUpdates>): string[] {
  if (!result.ok) throw new Error(`expected ok, got: ${result.message}`);
  return Object.keys(result.updates);
}

describe("buildMemberUpdates", () => {
  it("never sends name parts to the table, even though the sheet always submits them", () => {
    // The edit sheet submits first/middle/last on every save, renamed or not.
    // Before the fix these rode along into the UPDATE and every edit failed.
    const result = buildMemberUpdates(
      {
        first_name: "Jerson",
        middle_initial: null,
        last_name: "Catadman",
        date_of_birth: null,
        gender: null,
        contact_number: "0917",
        batch: null,
      },
      "Jerson Catadman",
    );
    const keys = keysOf(result);
    expect(keys).not.toContain("first_name");
    expect(keys).not.toContain("last_name");
    expect(keys).not.toContain("middle_initial");
    for (const key of keys) {
      expect(MEMBER_COLUMNS.has(key), key).toBe(true);
    }
  });

  it("composes full_name from touched parts and untouched stored parts", () => {
    // "Jerson L Catadman" splits as first "Jerson L" (a bare letter with no
    // period is not read as an initial -- see splitName), so touching only
    // the first name drops the "L", exactly as the form shows it.
    const result = buildMemberUpdates({ first_name: "Jay" }, "Jerson L Catadman");
    if (!result.ok) throw new Error(result.message);
    expect(result.updates.full_name).toBe("Jay Catadman");
    expect(Object.keys(result.updates)).toEqual(["full_name"]);
  });

  it("handles a stored single-token name", () => {
    const result = buildMemberUpdates({ last_name: "Santos" }, "Maria");
    if (!result.ok) throw new Error(result.message);
    expect(result.updates.full_name).toBe("Maria Santos");
  });

  it("leaves full_name out when no name part was touched", () => {
    const result = buildMemberUpdates({ contact_number: "0917" }, "Jerson Catadman");
    if (!result.ok) throw new Error(result.message);
    expect(result.updates).toEqual({ contact_number: "0917" });
  });

  it("maps empty strings to null and drops undefined", () => {
    const result = buildMemberUpdates(
      { contact_number: "", batch: undefined, gender: "male" },
      "Jerson Catadman",
    );
    if (!result.ok) throw new Error(result.message);
    expect(result.updates).toEqual({ contact_number: null, gender: "male" });
  });

  it("refuses an empty change set", () => {
    const result = buildMemberUpdates({}, "Jerson Catadman");
    expect(result.ok).toBe(false);
  });
});
