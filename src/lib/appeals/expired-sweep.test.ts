import { describe, expect, it } from "vitest";
import { monthStartOf, selectStrandedAppealIds } from "./expired-sweep";

describe("monthStartOf", () => {
  it("takes the month off an ISO date", () => {
    expect(monthStartOf("2026-09-14")).toBe("2026-09-01");
    expect(monthStartOf("2026-01-01")).toBe("2026-01-01");
    expect(monthStartOf("2026-12-31")).toBe("2026-12-01");
  });
});

describe("selectStrandedAppealIds", () => {
  const pending = [
    { id: "a1", session_date: "2026-09-14" },
    { id: "a2", session_date: "2026-08-02" },
    { id: "a3", session_date: "2026-10-05" },
    { id: "a4", session_date: "2026-08-30" },
  ];

  it("strands appeals in a locked month", () => {
    expect(selectStrandedAppealIds(pending, ["2026-08-01"])).toEqual(["a2", "a4"]);
  });

  it("leaves an editable month alone", () => {
    // No report for October, so those appeals can still be answered.
    expect(selectStrandedAppealIds(pending, ["2026-08-01", "2026-09-01"])).not.toContain("a3");
  });

  it("strands nothing when no month is locked", () => {
    expect(selectStrandedAppealIds(pending, [])).toEqual([]);
  });

  it("matches by month, not by the exact date", () => {
    // The report rows store the first of the month; an appeal dated the 30th still belongs
    // to it. An exact-date comparison here would leave most of a locked month pending.
    expect(selectStrandedAppealIds([{ id: "x", session_date: "2026-08-31" }], ["2026-08-01"])).toEqual(["x"]);
  });

  it("does not confuse neighbouring months", () => {
    const ids = selectStrandedAppealIds([{ id: "x", session_date: "2026-09-01" }], ["2026-08-01"]);
    expect(ids).toEqual([]);
  });

  it("keeps the caller's order", () => {
    expect(selectStrandedAppealIds(pending, ["2026-08-01", "2026-09-01"])).toEqual(["a1", "a2", "a4"]);
  });

  it("handles an empty pending list", () => {
    expect(selectStrandedAppealIds([], ["2026-08-01"])).toEqual([]);
  });
});
