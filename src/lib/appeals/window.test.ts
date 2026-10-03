import { describe, expect, it } from "vitest";
import {
  checkAppealWindow,
  DEFAULT_WINDOW_DAYS,
  parseWindowDays,
  windowClosesOn,
} from "./window";

describe("parseWindowDays", () => {
  it("uses 14 days when the setting is absent", () => {
    expect(parseWindowDays(null)).toBe(DEFAULT_WINDOW_DAYS);
    expect(parseWindowDays(undefined)).toBe(14);
    expect(parseWindowDays("")).toBe(14);
    expect(parseWindowDays("   ")).toBe(14);
  });

  it("reads a valid value", () => {
    expect(parseWindowDays("30")).toBe(30);
    expect(parseWindowDays("0")).toBe(0);
    expect(parseWindowDays("1")).toBe(1);
  });

  it("truncates a fractional value rather than rounding it up", () => {
    expect(parseWindowDays("14.9")).toBe(14);
  });

  it("falls back to the default for junk rather than blocking every appeal", () => {
    // "no limit" would be the dangerous answer here: a mistyped setting would silently
    // turn off the window nobody meant to remove.
    expect(parseWindowDays("two weeks")).toBe(14);
    expect(parseWindowDays("-5")).toBe(14);
    expect(parseWindowDays("NaN")).toBe(14);
  });
});

describe("windowClosesOn", () => {
  it("counts whole days after the session", () => {
    expect(windowClosesOn("2026-08-03", 14)).toBe("2026-08-17");
  });

  it("crosses a month boundary", () => {
    expect(windowClosesOn("2026-08-25", 14)).toBe("2026-09-08");
  });

  it("crosses a year boundary", () => {
    expect(windowClosesOn("2026-12-25", 14)).toBe("2027-01-08");
  });

  it("handles a leap day", () => {
    expect(windowClosesOn("2028-02-20", 14)).toBe("2028-03-05");
  });

  it("returns null when there is no limit", () => {
    expect(windowClosesOn("2026-08-03", 0)).toBeNull();
  });

  it("returns null for a date it cannot read", () => {
    expect(windowClosesOn("nonsense", 14)).toBeNull();
  });
});

describe("checkAppealWindow", () => {
  it("allows an appeal on the session day", () => {
    expect(checkAppealWindow("2026-08-03", "2026-08-03", 14)).toEqual({
      open: true,
      closes_on: "2026-08-17",
    });
  });

  it("allows an appeal on the closing day", () => {
    // Inclusive. "Appeals close on the 17th" must mean the 17th is still allowed.
    expect(checkAppealWindow("2026-08-03", "2026-08-17", 14).open).toBe(true);
  });

  it("refuses one day after the closing day", () => {
    const result = checkAppealWindow("2026-08-03", "2026-08-18", 14);
    expect(result).toEqual({
      open: false,
      reason: "window_closed",
      closes_on: "2026-08-17",
      days_over: 1,
    });
  });

  it("reports how many days over, so the message can say so", () => {
    const result = checkAppealWindow("2026-08-03", "2026-08-24", 14);
    expect(result.open).toBe(false);
    if (!result.open) expect(result.days_over).toBe(7);
  });

  it("allows any date when the limit is zero", () => {
    expect(checkAppealWindow("2020-01-01", "2026-08-18", 0)).toEqual({
      open: true,
      closes_on: null,
    });
  });

  it("allows everything when the closing date cannot be worked out", () => {
    // A malformed session date must not close appeals. The session row itself is the
    // authority on that, and this is only the friendly message beside it.
    expect(checkAppealWindow("nonsense", "2026-08-18", 14).open).toBe(true);
  });

  it("allows a one-day window through the day after the session", () => {
    // One day means closes_on = the next day, and that day is still allowed.
    expect(windowClosesOn("2026-08-03", 1)).toBe("2026-08-04");
    expect(checkAppealWindow("2026-08-03", "2026-08-04", 1).open).toBe(true);
    expect(checkAppealWindow("2026-08-03", "2026-08-05", 1).open).toBe(false);
  });
});
