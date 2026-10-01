import { describe, expect, it } from "vitest";
import { comingSunday, nextSunday, weekendForSunday } from "./weekend";

describe("nextSunday", () => {
  it("finds the coming Sunday from each day of the week", () => {
    // 2026-08-16 is a Sunday, so this week is 16th..22nd.
    expect(nextSunday("2026-08-17")).toBe("2026-08-23"); // Monday
    expect(nextSunday("2026-08-18")).toBe("2026-08-23"); // Tuesday
    expect(nextSunday("2026-08-19")).toBe("2026-08-23"); // Wednesday
    expect(nextSunday("2026-08-20")).toBe("2026-08-23"); // Thursday  <- the cron day
    expect(nextSunday("2026-08-21")).toBe("2026-08-23"); // Friday
    expect(nextSunday("2026-08-22")).toBe("2026-08-23"); // Saturday
  });

  it("skips a week when called on a Sunday itself", () => {
    // The bug this avoids: by Sunday the Mass has been attended. Creating its
    // session then puts a session in the past with nobody there to mark.
    expect(nextSunday("2026-08-16")).toBe("2026-08-23");
  });

  it("is idempotent for a whole week of cron runs", () => {
    // Even if the job runs daily instead of weekly, each run in the same week
    // targets the same Sunday, so the unique key makes the repeats harmless.
    const targets = ["2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20"].map(nextSunday);
    expect(new Set(targets).size).toBe(1);
    expect(targets[0]).toBe("2026-08-23");
  });

  it("rolls into the next month", () => {
    expect(nextSunday("2026-08-27")).toBe("2026-08-30");
    expect(nextSunday("2026-08-28")).toBe("2026-08-30");
    expect(nextSunday("2026-08-29")).toBe("2026-08-30");
    expect(nextSunday("2026-08-31")).toBe("2026-09-06");
  });

  it("rolls into the next year", () => {
    expect(nextSunday("2026-12-24")).toBe("2026-12-27");
    expect(nextSunday("2026-12-25")).toBe("2026-12-27");
    expect(nextSunday("2026-12-28")).toBe("2027-01-03");
    expect(nextSunday("2026-12-31")).toBe("2027-01-03");
  });

  it("handles a Sunday that falls on the 31st", () => {
    // 2026-05-31 is a Sunday. Getting this wrong with naive date arithmetic
    // produces 2026-06-07 or an invalid 2026-05-32.
    expect(nextSunday("2026-05-28")).toBe("2026-05-31");
    expect(nextSunday("2026-05-31")).toBe("2026-06-07");
  });

  it("always lands on a Sunday", () => {
    for (let day = 1; day <= 28; day++) {
      const from = `2026-08-${String(day).padStart(2, "0")}`;
      expect(nextSunday(from)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(new Date(`${nextSunday(from)}T00:00:00Z`).getUTCDay()).toBe(0);
    }
  });

  it("never returns the date it was given", () => {
    for (let day = 1; day <= 28; day++) {
      const from = `2026-08-${String(day).padStart(2, "0")}`;
      expect(nextSunday(from)).not.toBe(from);
    }
  });
});

describe("comingSunday", () => {
  it("matches nextSunday, so the cron and the button agree", () => {
    expect(comingSunday("2026-08-20")).toBe(nextSunday("2026-08-20"));
    expect(comingSunday("2026-12-31")).toBe("2027-01-03");
  });
});

describe("weekendForSunday", () => {
  it("returns the Saturday and Sunday together", () => {
    expect(weekendForSunday("2026-08-23")).toEqual({ saturday: "2026-08-22", sunday: "2026-08-23" });
  });

  it("crosses a month boundary", () => {
    expect(weekendForSunday("2026-09-06")).toEqual({ saturday: "2026-09-05", sunday: "2026-09-06" });
  });

  it("crosses a year boundary", () => {
    expect(weekendForSunday("2027-01-03")).toEqual({ saturday: "2027-01-02", sunday: "2027-01-03" });
  });
});
