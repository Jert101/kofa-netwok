import { describe, expect, it } from "vitest";
import { describePendingAppeals, isConfirmed } from "./report-warning";

describe("describePendingAppeals", () => {
  it("stays out of the way when nothing is waiting", () => {
    expect(
      describePendingAppeals({ monthStart: "2026-08-01", monthEnd: "2026-08-31", pendingCount: 0, sessionCount: 0 }),
    ).toEqual({ blocking: false, pendingCount: 0 });
  });

  it("warns and says what closing the month would cost", () => {
    const w = describePendingAppeals({
      monthStart: "2026-08-01",
      monthEnd: "2026-08-31",
      pendingCount: 3,
      sessionCount: 2,
    });

    expect(w.blocking).toBe(true);
    expect(w.pendingCount).toBe(3);
    // Narrowed rather than cast: a message that only exists on the warning branch is the
    // whole point of the union.
    if (!w.blocking) throw new Error("expected a warning");
    expect(w.message).toContain("3 appeals");
    expect(w.message).toContain("2 Masses");
    expect(w.message).toContain("have");
    expect(w.message).toContain("declined");
  });

  it("uses singular wording for one appeal in one Mass", () => {
    const w = describePendingAppeals({
      monthStart: "2026-08-01",
      monthEnd: "2026-08-31",
      pendingCount: 1,
      sessionCount: 1,
    });

    if (!w.blocking) throw new Error("expected a warning");
    expect(w.message).toContain("1 appeal for 1 Mass");
    expect(w.message).toContain("has");
    expect(w.message).toContain("it as declined");
    // "1 appeals" is the kind of thing a secretary notices and stops trusting the rest of.
    expect(w.message).not.toContain("1 appeals");
    expect(w.message).not.toContain("Masses in this");
  });

  it("warns but does not claim it blocks", () => {
    // APL-8: the secretary decides. Refusing outright would leave a month that cannot be
    // reported on either.
    const w = describePendingAppeals({
      monthStart: "2026-08-01",
      monthEnd: "2026-08-31",
      pendingCount: 5,
      sessionCount: 4,
    });

    expect(w.blocking).toBe(true);
    if (!w.blocking) throw new Error("expected a warning");
    expect(w.message).toContain("confirm");
  });

  it("treats a negative count as nothing pending", () => {
    expect(
      describePendingAppeals({
        monthStart: "2026-08-01",
        monthEnd: "2026-08-31",
        pendingCount: -1,
        sessionCount: 0,
      }),
    ).toEqual({ blocking: false, pendingCount: 0 });
  });
});

describe("isConfirmed", () => {
  it("accepts the two ways a client sends true", () => {
    expect(isConfirmed("1")).toBe(true);
    expect(isConfirmed("true")).toBe(true);
  });

  it("treats anything else as not confirmed", () => {
    // Including "0" and "yes": a caller that meant to skip the warning must say so
    // exactly, since the cost is unreviewed work being settled without permission.
    expect(isConfirmed("0")).toBe(false);
    expect(isConfirmed("yes")).toBe(false);
    expect(isConfirmed(null)).toBe(false);
    expect(isConfirmed("")).toBe(false);
  });
});
