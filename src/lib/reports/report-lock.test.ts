import { describe, expect, it } from "vitest";
import { decideReportLock, monthBounds, monthLabel } from "./report-lock";

describe("monthBounds", () => {
  it("returns the first and last day of the month", () => {
    expect(monthBounds("2026-02-14")).toEqual({ monthStart: "2026-02-01", monthEnd: "2026-02-28" });
  });

  it("handles a leap February", () => {
    expect(monthBounds("2028-02-14").monthEnd).toBe("2028-02-29");
  });

  it("handles December without rolling into the next year", () => {
    expect(monthBounds("2026-12-01")).toEqual({ monthStart: "2026-12-01", monthEnd: "2026-12-31" });
  });

  it("uses the month of the date given, not today's", () => {
    expect(monthBounds("2026-01-31").monthStart).toBe("2026-01-01");
  });
});

describe("monthLabel", () => {
  it("names the month and year for the banner", () => {
    expect(monthLabel("2026-08-01")).toBe("August 2026");
  });

  it("returns the input unchanged when it cannot be parsed", () => {
    expect(monthLabel("nonsense")).toBe("nonsense");
  });
});

describe("decideReportLock", () => {
  it("leaves a month open when no report exists", () => {
    expect(decideReportLock(null, "2026-08-01").locked).toBe(false);
    expect(decideReportLock(undefined, "2026-08-01").locked).toBe(false);
  });

  it("locks while a report is waiting for approval", () => {
    const lock = decideReportLock("pending", "2026-08-01");
    expect(lock.locked).toBe(true);
    expect(lock.reason).toBe("pending_approval");
    expect(lock.message).toContain("August 2026");
    expect(lock.message).toContain("pending approval");
  });

  it("locks once approved", () => {
    const lock = decideReportLock("approved", "2026-08-01");
    expect(lock.locked).toBe(true);
    expect(lock.reason).toBe("approved");
    expect(lock.message).toContain("approved");
  });

  it("unlocks a rejected report so the month can be corrected", () => {
    // The bug this replaced: any existing report locked the month, so a rejected
    // report left the secretary unable to fix the mistakes it was sent back about.
    expect(decideReportLock("rejected", "2026-08-01").locked).toBe(false);
    expect(decideReportLock("rejected", "2026-08-01").message).toBeNull();
  });

  it("treats an unrecognised status as locked", () => {
    // Guessing that a new status means "open" would quietly reopen a month nobody
    // meant to reopen.
    expect(decideReportLock("draft", "2026-08-01").locked).toBe(true);
    expect(decideReportLock("archived", "2026-08-01").locked).toBe(true);
  });

  it("mentions the month so the secretary knows which one is closed", () => {
    expect(decideReportLock("approved", "2026-12-01").message).toContain("December 2026");
  });
});
