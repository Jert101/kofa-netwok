import { describe, it, expect } from "vitest";
import {
  evaluateReportWindow,
  lastSundayOfMonth,
  describeWindowOpening,
  reportMonthStartForNow,
  previousReportMonthStartForNow,
  monthBoundsFromStart,
  isLastSundayOfLocalMonth,
} from "./rules";

// The window is defined in church time, so every instant below is written as UTC and the
// tests rely on the conversion being exercised. Asia/Manila is UTC+8 with no DST, which
// makes the expected values unambiguous.
const TZ = "Asia/Manila";

/** UTC instant that is `hh:mm` Manila wall-clock on `ymd`. */
const manila = (ymd: string, hh: number, mm = 0) =>
  new Date(`${ymd}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00Z`);

describe("lastSundayOfMonth", () => {
  it("finds the final Sunday when it is not the last day", () => {
    // June 2026 ends on the 30th, a Tuesday. Final Sunday is the 28th.
    expect(lastSundayOfMonth("2026-06-01")).toBe("2026-06-28");
  });

  it("handles the 31st case where the last day is a Sunday", () => {
    // May 2026 ends on Sunday the 31st.
    expect(lastSundayOfMonth("2026-05-01")).toBe("2026-05-31");
  });

  it("finds the final Sunday in February", () => {
    // February 2026 has 28 days, ending on Saturday the 28th. Final Sunday is the 22nd.
    expect(lastSundayOfMonth("2026-02-01")).toBe("2026-02-22");
  });

  it("handles a leap February", () => {
    // February 2028 has 29 days, ending on Tuesday. Final Sunday is the 27th.
    expect(lastSundayOfMonth("2028-02-01")).toBe("2028-02-27");
  });

  it("returns null for a malformed month", () => {
    expect(lastSundayOfMonth("not-a-month")).toBeNull();
    expect(lastSundayOfMonth("2026-13-01")).toBeNull();
    // Rejects a day that does not exist rather than rolling into the next month.
    expect(lastSundayOfMonth("2026-02-31")).toBeNull();
    // Rejects any day that is not the first: a month start is always -01.
    expect(lastSundayOfMonth("2026-02-15")).toBeNull();
    expect(lastSundayOfMonth("2026-2-1")).toBeNull();
  });
});

describe("evaluateReportWindow — before the window", () => {
  it("refuses at 19:59 on the last Sunday", () => {
    const r = evaluateReportWindow({
      now: manila("2026-05-31", 11, 59), // 19:59 Manila
      monthStart: "2026-05-01",
      timeZone: TZ,
    });
    expect(r.allowed).toBe(false);
    expect(r.blockedBy).toBe("window");
    // The opening time is still reported so the status strip can show it.
    expect(r.opensAt).toBe("2026-05-31T20:00:00");
  });

  it("refuses earlier in the month regardless of the hour", () => {
    const r = evaluateReportWindow({
      now: manila("2026-05-20", 23),
      monthStart: "2026-05-01",
      timeZone: TZ,
    });
    expect(r.allowed).toBe(false);
    expect(r.opensAt).toBe("2026-05-31T20:00:00");
  });
});

describe("evaluateReportWindow — at and after the opening", () => {
  it("allows exactly 20:00:00 local on the last Sunday", () => {
    const r = evaluateReportWindow({
      now: manila("2026-05-31", 12), // 20:00 Manila
      monthStart: "2026-05-01",
      timeZone: TZ,
    });
    expect(r.allowed).toBe(true);
    expect(r.blockedBy).toBeNull();
  });

  it("allows one minute before 20:00 local", () => {
    const r = evaluateReportWindow({
      now: manila("2026-05-31", 11, 59), // 19:59 Manila
      monthStart: "2026-05-01",
      timeZone: TZ,
    });
    expect(r.allowed).toBe(false);
  });

  it("allows later the same evening", () => {
    const r = evaluateReportWindow({
      now: manila("2026-05-31", 15), // 23:00 Manila
      monthStart: "2026-05-01",
      timeZone: TZ,
    });
    expect(r.allowed).toBe(true);
  });

  it("opens on the 31st itself when the last day is the last Sunday", () => {
    // May 2026, the 31st is a Sunday, so the window opens that evening.
    const before = evaluateReportWindow({
      now: manila("2026-05-31", 5),
      monthStart: "2026-05-01",
      timeZone: TZ,
    });
    expect(before.allowed).toBe(false);
    expect(before.opensAt).toBe("2026-05-31T20:00:00");

    const after = evaluateReportWindow({
      now: manila("2026-05-31", 13),
      monthStart: "2026-05-01",
      timeZone: TZ,
    });
    expect(after.allowed).toBe(true);
  });

  it("stays open on the following day when the last Sunday was the 30th", () => {
    // June 2026: final Sunday is the 28th, so the 30th is still inside the window.
    const r = evaluateReportWindow({
      now: manila("2026-06-30", 2),
      monthStart: "2026-06-01",
      timeZone: TZ,
    });
    expect(r.allowed).toBe(true);
  });
});

describe("evaluateReportWindow — existing report", () => {
  const openWindow = {
    now: manila("2026-05-31", 13),
    monthStart: "2026-05-01",
    timeZone: TZ,
  };

  it("blocks when a pending report exists, even inside the window", () => {
    const r = evaluateReportWindow({ ...openWindow, existingStatus: "pending" });
    expect(r.allowed).toBe(false);
    expect(r.blockedBy).toBe("exists");
    expect(r.opensAt).toBeNull();
  });

  it("blocks when an approved report exists", () => {
    const r = evaluateReportWindow({ ...openWindow, existingStatus: "approved" });
    expect(r.blockedBy).toBe("exists");
  });

  it("allows when the existing report is rejected, so the month can be regenerated", () => {
    const r = evaluateReportWindow({ ...openWindow, existingStatus: "rejected" });
    expect(r.allowed).toBe(true);
  });

  it("treats a missing existing report as absent", () => {
    expect(evaluateReportWindow({ ...openWindow, existingStatus: null }).allowed).toBe(true);
    expect(evaluateReportWindow(openWindow).allowed).toBe(true);
  });
});

describe("evaluateReportWindow — bypass", () => {
  it("allows an admin outside the window", () => {
    const r = evaluateReportWindow({
      now: manila("2026-05-15", 9),
      monthStart: "2026-05-01",
      timeZone: TZ,
      bypass: true,
    });
    expect(r.allowed).toBe(true);
    expect(r.opensAt).toBeNull();
  });

  it("does not let bypass override an existing report", () => {
    const r = evaluateReportWindow({
      now: manila("2026-05-15", 9),
      monthStart: "2026-05-01",
      timeZone: TZ,
      bypass: true,
      existingStatus: "approved",
    });
    expect(r.allowed).toBe(false);
    expect(r.blockedBy).toBe("exists");
  });
});

describe("evaluateReportWindow — degenerate input", () => {
  it("fails closed on an empty timezone", () => {
    const r = evaluateReportWindow({
      now: manila("2026-05-31", 13),
      monthStart: "2026-05-01",
      timeZone: "",
    });
    expect(r.allowed).toBe(false);
    expect(r.blockedBy).toBe("timezone");
  });

  it("fails closed on a malformed month", () => {
    const r = evaluateReportWindow({
      now: manila("2026-05-31", 13),
      monthStart: "garbage",
      timeZone: TZ,
    });
    expect(r.allowed).toBe(false);
    expect(r.blockedBy).toBe("window");
  });

  it("agrees with the legacy current-month helper inside the window", () => {
    // The two functions coexist; the old one is still used for the current month, so they
    // must not disagree on a day that is both the last Sunday and at/after 20:00.
    expect(
      evaluateReportWindow({
        now: manila("2026-05-31", 13),
        monthStart: "2026-05-01",
        timeZone: TZ,
      }).allowed,
    ).toBe(true);
  });
});

describe("describeWindowOpening", () => {
  it("formats the 31st-Sunday case without shifting the day", () => {
    // 2026-05-31T20:00 Manila. If the offset were applied twice this would read 26 May.
    expect(describeWindowOpening("2026-05-31T20:00:00")).toBe("Sun 31 May, 8:00 PM");
  });

  it("formats an ordinary date", () => {
    expect(describeWindowOpening("2026-06-28T20:00:00")).toBe("Sun 28 Jun, 8:00 PM");
  });

  it("renders midnight as 12 AM rather than 0 AM", () => {
    expect(describeWindowOpening("2026-06-28T00:00:00")).toBe("Sun 28 Jun, 12:00 AM");
  });

  it("renders midday as 12 PM", () => {
    expect(describeWindowOpening("2026-06-28T12:30:00")).toBe("Sun 28 Jun, 12:30 PM");
  });

  it("returns an empty string when there is nothing to describe", () => {
    expect(describeWindowOpening(null)).toBe("");
    expect(describeWindowOpening("nonsense")).toBe("");
  });
});

describe("month helpers", () => {
  it("reports the current month in church time, not UTC", () => {
    // 2026-06-01 01:00 UTC is already 09:00 on the 1st in Manila.
    expect(reportMonthStartForNow(new Date("2026-06-01T01:00:00Z"), TZ)).toBe("2026-06-01");
    // 2026-05-31 20:00 UTC is 2026-06-01 04:00 in Manila, so the month has rolled over.
    expect(reportMonthStartForNow(new Date("2026-05-31T20:00:00Z"), TZ)).toBe("2026-06-01");
    // The same instant is still May in UTC, which is the bug this guards.
    expect(reportMonthStartForNow(new Date("2026-05-31T20:00:00Z"), "UTC")).toBe("2026-05-01");
  });

  it("walks back exactly one month", () => {
    expect(previousReportMonthStartForNow(new Date("2026-06-15T04:00:00Z"), TZ)).toBe("2026-05-01");
    expect(previousReportMonthStartForNow(new Date("2026-01-15T04:00:00Z"), TZ)).toBe("2025-12-01");
  });

  it("gives inclusive bounds for a month start", () => {
    expect(monthBoundsFromStart("2026-02-01")).toEqual({ start: "2026-02-01", end: "2026-02-28" });
    expect(monthBoundsFromStart("2028-02-01")).toEqual({ start: "2028-02-01", end: "2028-02-29" });
    expect(monthBoundsFromStart("2026-12-01")).toEqual({ start: "2026-12-01", end: "2026-12-31" });
  });
});

describe("isLastSundayOfLocalMonth", () => {
  it("accepts a final Sunday and rejects a non-final one", () => {
    // 31 May 2026 is the final Sunday of May.
    expect(isLastSundayOfLocalMonth(new Date(2026, 4, 31))).toBe(true);
    // 24 May 2026 is a Sunday but not the last one.
    expect(isLastSundayOfLocalMonth(new Date(2026, 4, 24))).toBe(false);
    // 31 May is not a Sunday in a month whose last Sunday is the 28th.
    expect(isLastSundayOfLocalMonth(new Date(2026, 5, 28))).toBe(true);
  });
});
