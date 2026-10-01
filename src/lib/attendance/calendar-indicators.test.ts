import { describe, expect, it } from "vitest";
import { dayDot, needsEncoding } from "./calendar-indicators";

const HELD = { sessions: 2, held: 2 };
const EMPTY = { sessions: 2, held: 0 };

describe("needsEncoding", () => {
  it("flags a past day with sessions and nobody encoded", () => {
    expect(needsEncoding("2026-08-02", EMPTY, "2026-08-10")).toBe(true);
  });

  it("does not flag a day once someone is recorded", () => {
    expect(needsEncoding("2026-08-02", HELD, "2026-08-10")).toBe(false);
  });

  it("does not flag a day with no sessions at all", () => {
    // Nothing to encode on a day nothing was celebrated.
    expect(needsEncoding("2026-08-02", { sessions: 0, held: 0 }, "2026-08-10")).toBe(false);
  });

  it("does not flag today", () => {
    // The Mass may not have finished yet. "Needs encoding" is for days that are over.
    expect(needsEncoding("2026-08-10", EMPTY, "2026-08-10")).toBe(false);
  });

  it("does not flag a future day", () => {
    // The cron pre-creates Sunday's sessions on Thursday, so those days are empty on
    // purpose and must not show as overdue.
    expect(needsEncoding("2026-08-16", EMPTY, "2026-08-10")).toBe(false);
  });

  it("compares across a month boundary", () => {
    expect(needsEncoding("2026-03-01", EMPTY, "2026-02-28")).toBe(false);
    expect(needsEncoding("2026-02-28", EMPTY, "2026-03-01")).toBe(true);
  });

  it("ignores malformed dates rather than guessing", () => {
    expect(needsEncoding("2026-8-2", EMPTY, "2026-08-10")).toBe(false);
    expect(needsEncoding("2026-08-02", EMPTY, "")).toBe(false);
  });

  it("counts an archived-only session as encoded", () => {
    // A closed month's records live in the archive table. The indicator counts them as
    // held, so an old month never looks like it still needs typing in.
    expect(needsEncoding("2026-01-04", { sessions: 1, held: 1 }, "2026-08-10")).toBe(false);
  });
});

describe("dayDot", () => {
  const opts = { today: "2026-08-10", date: "2026-08-02" };

  it("shows an appeal marker first", () => {
    expect(dayDot(EMPTY, { ...opts, pendingAppeals: 2 })).toBe("appeal");
    expect(dayDot(HELD, { ...opts, pendingAppeals: 1 })).toBe("appeal");
  });

  it("shows recorded for a partly filled day", () => {
    // Deliberately not flagged. A day where one Mass has servers recorded is not a day
    // that was forgotten, and ambering it would train the secretary to ignore the dot:
    // a quiet weekday Mass nobody attended would light it up forever.
    expect(dayDot({ sessions: 2, held: 1 }, { ...opts, pendingAppeals: 0 })).toBe("recorded");
  });

  it("shows recorded for a finished past day", () => {
    expect(dayDot(HELD, { ...opts, pendingAppeals: 0 })).toBe("recorded");
  });

  it("shows nothing for an empty future day", () => {
    expect(dayDot(EMPTY, { today: "2026-08-10", date: "2026-08-16", pendingAppeals: 0 })).toBeNull();
  });
});
