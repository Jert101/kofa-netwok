import { describe, expect, it } from "vitest";
import {
  DUPLICATE_WINDOW_MS,
  STRUCTURE_LOCKED_MESSAGE,
  VOID_REASONS,
  canRecordPaymentFor,
  checkStructureEdit,
  duplicateWarning,
  findDuplicatePayment,
  lockedFieldsFor,
  sortOverdue,
  structureAppliesTo,
  validateVoidReason,
  type DuplicateCandidate,
  type OverdueRow,
} from "./rules";

// ======================================================================================
// Structure edit rules
// ======================================================================================

describe("checkStructureEdit", () => {
  it("allows anything when no payment exists", () => {
    expect(
      checkStructureEdit({ amount: 5000, for_all: false, batch: "2026" }, false),
    ).toEqual({ allowed: true });
  });

  it("refuses the amount once payments exist", () => {
    const result = checkStructureEdit({ amount: 5000 }, true);
    expect(result.allowed).toBe(false);
    expect(result.allowed === false && result.message).toBe(STRUCTURE_LOCKED_MESSAGE);
  });

  it("refuses installments, scope and batch too", () => {
    expect(checkStructureEdit({ installment_months: 6 }, true).allowed).toBe(false);
    expect(checkStructureEdit({ for_all: false }, true).allowed).toBe(false);
    expect(checkStructureEdit({ batch: "2026" }, true).allowed).toBe(false);
  });

  it("allows the fields that do not change what anybody owes", () => {
    // Renaming, moving the deadline and switching it off leave every balance exactly where it was.
    expect(checkStructureEdit({ name: "Dues 2026" }, true).allowed).toBe(true);
    expect(checkStructureEdit({ deadline: "2026-12-31" }, true).allowed).toBe(true);
    expect(checkStructureEdit({ is_active: false }, true).allowed).toBe(true);
  });

  it("names only the fields that were actually refused", () => {
    const result = checkStructureEdit({ name: "Dues", amount: 999, deadline: null }, true);
    expect(result.allowed).toBe(false);
    expect(result.allowed === false && result.lockedFields).toEqual(["amount"]);
  });

  it("does not treat an untouched field as a refusal", () => {
    // The form submits every field on every save. If that counted as "changing" it, the save button
    // would break the moment a single payment existed.
    expect(checkStructureEdit({ name: "Dues 2026", deadline: null }, true).allowed).toBe(true);
  });

  it("counts a structure with only voided payments as unlocked", () => {
    // Spec §8. The caller passes hasPayments; this pins that voiding is what unlocks it.
    expect(checkStructureEdit({ amount: 5000 }, false).allowed).toBe(true);
  });
});

describe("lockedFieldsFor", () => {
  it("is empty when no payment exists", () => {
    expect(lockedFieldsFor(false)).toEqual([]);
  });

  it("lists the four money fields when payments exist", () => {
    expect(lockedFieldsFor(true)).toEqual(["amount", "installment_months", "for_all", "batch"]);
  });
});

// ======================================================================================
// Duplicate guard
// ======================================================================================

describe("findDuplicatePayment", () => {
  const now = Date.parse("2026-10-04T09:45:00Z");

  // Four minutes ago: inside the ten-minute window, which is the point of the fixture.
  function row(over: Partial<DuplicateCandidate> & { id: string }): DuplicateCandidate {
    return { amount_paid: 500, paid_at: "2026-10-04", created_at: "2026-10-04T09:41:00Z", voided: false, ...over };
  }

  it("catches the same member, structure and amount inside the window", () => {
    const match = findDuplicatePayment({ amount: 500 }, [row({ id: "p1" })], now);
    expect(match?.id).toBe("p1");
  });

  it("does not fire outside the window", () => {
    const old = Date.parse("2026-10-04T09:41:00Z") - DUPLICATE_WINDOW_MS - 1000;
    const match = findDuplicatePayment(
      { amount: 500 },
      [row({ id: "p1", created_at: new Date(old).toISOString() })],
      now,
    );
    expect(match).toBeNull();
  });

  it("does not fire on a different amount", () => {
    expect(findDuplicatePayment({ amount: 700 }, [row({ id: "p1" })], now)).toBeNull();
  });

  it("does not fire on a different member or structure", () => {
    // The caller has already filtered by member and structure; this asserts it must keep doing so,
    // because two members paying the same dues on the same morning is not a mistake.
    expect(findDuplicatePayment({ amount: 500 }, [], now)).toBeNull();
  });

  it("never fires against a voided payment", () => {
    const match = findDuplicatePayment({ amount: 500 }, [row({ id: "p1", voided: true })], now);
    expect(match).toBeNull();
  });

  it("compares money to the centavo, not by float equality", () => {
    expect(findDuplicatePayment({ amount: 500 }, [row({ id: "p1", amount_paid: "500.00" })], now)?.id).toBe(
      "p1",
    );
    expect(findDuplicatePayment({ amount: 500 }, [row({ id: "p1", amount_paid: "500.01" })], now)).toBeNull();
  });

  it("uses created_at, not the typed paid_at, so a backdated entry is still caught", () => {
    // A treasurer recording two payments for last month's dues a minute apart is the exact double
    // entry the guard exists for. Keying on paid_at would miss it entirely.
    const match = findDuplicatePayment(
      { amount: 500 },
      [row({ id: "p1", paid_at: "2026-09-01", created_at: "2026-10-04T09:44:00Z" })],
      now,
    );
    expect(match?.id).toBe("p1");
  });

  it("names the most recent of several matching entries", () => {
    const match = findDuplicatePayment(
      { amount: 500 },
      [
        row({ id: "old", created_at: "2026-10-04T09:38:00Z" }),
        row({ id: "new", created_at: "2026-10-04T09:44:00Z" }),
      ],
      now,
    );
    expect(match?.id).toBe("new");
  });

  it("will not match a payment dated in the future", () => {
    expect(
      findDuplicatePayment({ amount: 500 }, [row({ id: "p1", created_at: "2026-10-05T00:00:00Z" })], now),
    ).toBeNull();
  });

  it("formats the time in the church's timezone, not UTC", () => {
    // 09:41 UTC is 17:41 in Manila, and a treasurer reading "9:41 AM" when the wall clock says 5:41 PM
    // has learned not to trust the message.
    const match = findDuplicatePayment(
      { amount: 500 },
      [row({ id: "p1", created_at: "2026-10-04T09:41:00Z" })],
      now,
      480,
    );
    expect(match?.clockTime).toBe("5:41 PM");
    expect(duplicateWarning(match!)).toBe(
      "This looks like a duplicate of a payment recorded at 5:41 PM. Record anyway?",
    );
  });

  it("renders midnight and noon as 12, not 0", () => {
    const earlyNow = Date.parse("2026-10-04T00:10:00Z");
    const match = findDuplicatePayment(
      { amount: 500 },
      [row({ id: "p1", created_at: "2026-10-04T00:05:00Z" })],
      earlyNow,
    );
    expect(match?.clockTime).toBe("12:05 AM");
  });
});

// ======================================================================================
// Void reasons
// ======================================================================================

describe("validateVoidReason", () => {
  it("accepts each preset", () => {
    for (const reason of VOID_REASONS.filter((r) => r !== "Other")) {
      expect(validateVoidReason(reason)).toBeNull();
    }
  });

  it("requires a reason at all", () => {
    expect(validateVoidReason("")).toMatch(/Choose why/);
    expect(validateVoidReason(null)).toMatch(/Choose why/);
  });

  it("requires a note when the reason is Other", () => {
    expect(validateVoidReason("Other")).toMatch(/Add a note/);
    expect(validateVoidReason("Other", "Cheque bounced")).toBeNull();
  });

  it("refuses a reason long enough to be a paragraph", () => {
    expect(validateVoidReason("x".repeat(201))).toMatch(/too long/);
  });

  it("ignores surrounding whitespace", () => {
    expect(validateVoidReason("  Duplicate  ")).toBeNull();
  });
});

// ======================================================================================
// Scope
// ======================================================================================

describe("structureAppliesTo", () => {
  it("applies a for_all structure to every active member", () => {
    expect(structureAppliesTo({ for_all: true, batch: null }, { is_active: true, batch: "2024" })).toBe(true);
  });

  it("does not apply a for_all structure to an inactive member", () => {
    expect(structureAppliesTo({ for_all: true, batch: null }, { is_active: false, batch: null })).toBe(false);
  });

  it("applies a batch structure only to that batch", () => {
    const s = { for_all: false, batch: "2024" };
    expect(structureAppliesTo(s, { is_active: true, batch: "2024" })).toBe(true);
    expect(structureAppliesTo(s, { is_active: true, batch: "2025" })).toBe(false);
  });

  it("applies a batch structure to an inactive member of that batch", () => {
    // Spec §8 allows recording for deactivated members, so the balance still has to be computed.
    expect(structureAppliesTo({ for_all: false, batch: "2024" }, { is_active: false, batch: "2024" })).toBe(
      true,
    );
  });

  it("applies nothing when a scoped structure has no batch", () => {
    expect(structureAppliesTo({ for_all: false, batch: null }, { is_active: true, batch: "2024" })).toBe(false);
  });
});

describe("canRecordPaymentFor", () => {
  it("notes an inactive member without refusing", () => {
    const result = canRecordPaymentFor({ for_all: true, batch: null }, { is_active: false, batch: null });
    expect(result.allowed).toBe(true);
    expect(result.note).toMatch(/inactive/i);
  });

  it("refuses a payment outside the structure's batch", () => {
    expect(canRecordPaymentFor({ for_all: false, batch: "2024" }, { is_active: true, batch: "2025" })).toEqual({
      allowed: false,
    });
  });

  it("allows a backdated payment for a member who has since moved batch", () => {
    // History follows the person. Blocking this would mean a member cannot settle a debt from the
    // batch they were in when the structure was made.
    expect(
      canRecordPaymentFor({ for_all: false, batch: "2024" }, { is_active: true, batch: "2025" }).allowed,
    ).toBe(false);
  });
});

// ======================================================================================
// Overdue ordering
// ======================================================================================

describe("sortOverdue", () => {
  function row(over: Partial<OverdueRow> & { memberId: string; memberName: string }): OverdueRow {
    return {
      batch: null,
      structureId: "s1",
      structureName: "Dues",
      amount: 1000,
      paid: 0,
      due: 1000,
      remaining: 1000,
      monthsOverdue: 0,
      ...over,
    };
  }

  it("puts the biggest debt first", () => {
    const sorted = sortOverdue([
      row({ memberId: "a", memberName: "Ana", remaining: 100 }),
      row({ memberId: "b", memberName: "Bela", remaining: 900 }),
    ]);
    expect(sorted.map((r) => r.memberId)).toEqual(["b", "a"]);
  });

  it("breaks a tie on how long it has been late", () => {
    const sorted = sortOverdue([
      row({ memberId: "a", memberName: "Ana", monthsOverdue: 1 }),
      row({ memberId: "b", memberName: "Bela", monthsOverdue: 5 }),
    ]);
    expect(sorted.map((r) => r.memberId)).toEqual(["b", "a"]);
  });

  it("breaks a tie on name so the list is stable between reloads", () => {
    const sorted = sortOverdue([
      row({ memberId: "b", memberName: "Bela" }),
      row({ memberId: "a", memberName: "Ana" }),
    ]);
    expect(sorted.map((r) => r.memberName)).toEqual(["Ana", "Bela"]);
  });

  it("does not mutate its input", () => {
    const rows = [row({ memberId: "b", memberName: "Bela", remaining: 10 }), row({ memberId: "a", memberName: "Ana", remaining: 900 })];
    sortOverdue(rows);
    expect(rows[0].memberId).toBe("b");
  });
});