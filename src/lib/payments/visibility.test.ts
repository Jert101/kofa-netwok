import { describe, expect, it } from "vitest";
import {
  applyLookupVisibility,
  canSeeAmountsFor,
  lookupVisibilityNote,
  type LookupEntry,
} from "./visibility";

function entry(over: Partial<LookupEntry> = {}): LookupEntry {
  return {
    structureId: "s1",
    structureName: "Dues 2026",
    amount: "1000.00",
    paid: "160.00",
    remaining: "840.00",
    credit: null,
    settled: false,
    isActive: true,
    ...over,
  };
}

const treasurer = { role: "treasurer" as const, actorId: null };
const admin = { role: "admin" as const, actorId: null };
const secretary = { role: "secretary" as const, actorId: "m-sec" };
const memberSelf = { role: "member" as const, actorId: "m-1" };
const memberOther = { role: "member" as const, actorId: "m-2" };
const officer = { role: "officer" as const, actorId: null };

describe("canSeeAmountsFor", () => {
  it("lets the treasurer see anybody's figures", () => {
    expect(canSeeAmountsFor(treasurer, "m-99")).toBe(true);
  });

  it("lets the admin see anybody's figures", () => {
    expect(canSeeAmountsFor(admin, "m-99")).toBe(true);
  });

  it("lets a member see their own figures", () => {
    expect(canSeeAmountsFor(memberSelf, "m-1")).toBe(true);
  });

  it("does not let a member see somebody else's", () => {
    expect(canSeeAmountsFor(memberOther, "m-1")).toBe(false);
  });

  it("does not let a secretary or officer see somebody else's figures", () => {
    expect(canSeeAmountsFor(secretary, "m-99")).toBe(false);
    expect(canSeeAmountsFor(officer, "m-1")).toBe(false);
  });

  it("still lets a secretary or officer see their own", () => {
    // The self-exception is about the person, not the role. A treasurer who also serves is still owed
    // the right to know what they owe.
    expect(canSeeAmountsFor(secretary, "m-sec")).toBe(true);
  });

  it("does not let a member with no declared identity see their own", () => {
    // Nobody signed in as a declared person, so there is no "them" to compare against. Falling back
    // to "it is the only role with no id" would let every undeclared member read every balance.
    expect(canSeeAmountsFor({ role: "member", actorId: null }, "m-1")).toBe(false);
  });

  it("does not let the super admin see figures, because they decide reports, not money", () => {
    expect(canSeeAmountsFor({ role: "super_admin", actorId: null }, "m-1")).toBe(false);
  });
});

describe("applyLookupVisibility", () => {
  it("passes the numbers through for the treasurer", () => {
    const result = applyLookupVisibility([entry()], treasurer, "m-1");
    expect(result.amountsVisible).toBe(true);
    expect(result.entries[0].remaining).toBe("840.00");
  });

  it("nulls every number for a member looking at somebody else", () => {
    const result = applyLookupVisibility([entry()], memberOther, "m-1");
    expect(result.amountsVisible).toBe(false);
    expect(result.entries[0].remaining).toBeNull();
    expect(result.entries[0].amount).toBeNull();
    expect(result.entries[0].paid).toBeNull();
    expect(result.entries[0].credit).toBeNull();
  });

  it("keeps the settled flag, which is the fact the parish is entitled to", () => {
    const result = applyLookupVisibility([entry({ settled: true })], memberOther, "m-1");
    expect(result.entries[0].settled).toBe(true);
  });

  it("keeps the structure name so the page is still useful", () => {
    const result = applyLookupVisibility([entry()], secretary, "m-1");
    expect(result.entries[0].structureName).toBe("Dues 2026");
  });

  it("leaves the settled flag able to say true with nothing else populated", () => {
    const result = applyLookupVisibility([entry({ settled: true, credit: "50.00" })], officer, "m-1");
    expect(result.entries[0].settled).toBe(true);
    expect(result.entries[0].credit).toBeNull();
  });

  it("does not mutate the input", () => {
    const input = [entry()];
    applyLookupVisibility(input, memberOther, "m-1");
    expect(input[0].remaining).toBe("840.00");
  });

  it("keeps the array length stable so the client shape does not change per role", () => {
    const result = applyLookupVisibility([entry(), entry({ structureId: "s2" })], secretary, "m-1");
    expect(result.entries).toHaveLength(2);
  });
});

describe("lookupVisibilityNote", () => {
  it("says so for the treasurer looking at somebody else", () => {
    expect(lookupVisibilityNote(true, false)).toBe("Full payment record.");
  });

  it("says so for a member looking at themselves", () => {
    expect(lookupVisibilityNote(true, true)).toBe("Your own payment record.");
  });

  it("says why the numbers are missing otherwise", () => {
    expect(lookupVisibilityNote(false, false)).toMatch(/treasurer/);
  });
});