import { describe, expect, it } from "vitest";

import { createSessionBodySchema } from "./create-session";

const MASS = "11111111-2222-3333-8444-555555555555";

describe("createSessionBodySchema", () => {
  it("accepts a Mass session exactly as before", () => {
    const parsed = createSessionBodySchema.safeParse({
      session_date: "2026-10-11",
      mass_id: MASS,
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts a gathering with a name and no Mass", () => {
    const parsed = createSessionBodySchema.safeParse({
      session_date: "2026-10-11",
      title: "Monthly Meeting",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.title).toBe("Monthly Meeting");
  });

  it("refuses a session for nothing", () => {
    // Neither a Mass nor a name is a session the database can store: the shape constraint would refuse
    // the row with a constraint name the secretary cannot act on, so it is refused here with a sentence.
    const parsed = createSessionBodySchema.safeParse({ session_date: "2026-10-11" });
    expect(parsed.success).toBe(false);
  });

  it("refuses a Mass with a name", () => {
    // A Mass with a title is two answers to "what is this", and the database constraint refuses the row
    // for the same reason. The message says which choice to make rather than naming the constraint.
    const parsed = createSessionBodySchema.safeParse({
      session_date: "2026-10-11",
      mass_id: MASS,
      title: "Monthly Meeting",
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues[0]?.message).toMatch(/either/i);
  });

  it("refuses a blank title, which is an untitled gathering wearing whitespace", () => {
    expect(
      createSessionBodySchema.safeParse({ session_date: "2026-10-11", title: "   " }).success,
    ).toBe(false);
  });

  it("trims the title it keeps", () => {
    const parsed = createSessionBodySchema.safeParse({
      session_date: "2026-10-11",
      title: "  Monthly Meeting  ",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.title).toBe("Monthly Meeting");
  });

  it("still rejects a bad date and a bad Mass id", () => {
    expect(
      createSessionBodySchema.safeParse({ session_date: "11-10-2026", mass_id: MASS }).success,
    ).toBe(false);
    expect(
      createSessionBodySchema.safeParse({ session_date: "2026-10-11", mass_id: "nope" }).success,
    ).toBe(false);
  });
});
