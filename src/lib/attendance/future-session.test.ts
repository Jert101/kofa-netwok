import { describe, expect, it } from "vitest";
import { canEncodeSession, isFutureSession } from "./future-session";

/** UTC+8, no daylight saving, which is what the parish runs on. */
const MANILA = "Asia/Manila";

/** 2026-08-16T12:00:00Z is 20:00 on the 16th in Manila. */
const EVENING = new Date("2026-08-16T12:00:00Z");

describe("canEncodeSession", () => {
  it("allows today's Mass", () => {
    expect(canEncodeSession("2026-08-16", EVENING, MANILA)).toEqual({ allowed: true });
  });

  it("allows a Mass that already happened", () => {
    expect(canEncodeSession("2026-08-15", EVENING, MANILA)).toEqual({ allowed: true });
  });

  it("blocks tomorrow and says why", () => {
    const check = canEncodeSession("2026-08-17", EVENING, MANILA);
    expect(check.allowed).toBe(false);
    if (!check.allowed) expect(check.message).toBe("This Mass hasn't happened yet.");
  });

  it("blocks a session far in the future", () => {
    expect(canEncodeSession("2026-12-25", EVENING, MANILA).allowed).toBe(false);
  });

  it("uses the parish date, not the server's UTC date", () => {
    // 17:30 UTC is already 01:30 on the 17th in Manila. So at this instant the 17th
    // is "today" for the parish and the 18th is tomorrow. Judged in UTC instead,
    // the 17th would still be tomorrow and the secretary would be told a Mass that
    // already ran had not happened yet.
    const manilaJustAfterMidnight = new Date("2026-08-16T17:30:00Z");

    expect(canEncodeSession("2026-08-16", manilaJustAfterMidnight, MANILA).allowed).toBe(true);
    expect(canEncodeSession("2026-08-17", manilaJustAfterMidnight, MANILA).allowed).toBe(true);
    expect(canEncodeSession("2026-08-18", manilaJustAfterMidnight, MANILA).allowed).toBe(false);

    // The same instant judged in UTC gives the opposite answer for the 17th.
    expect(canEncodeSession("2026-08-17", manilaJustAfterMidnight, "UTC").allowed).toBe(false);
  });

  it("allows the evening Mass on the day it ends, not the next morning", () => {
    // A Sunday Mass at 19:00 finishes around 20:30. By the time the secretary
    // finishes tidying up it is past midnight in Manila, and the encode must not
    // then be refused for the Mass they just ran.
    const justAfterMidnightMonday = new Date("2026-08-16T17:00:00Z"); // 01:00 Mon 17th
    expect(canEncodeSession("2026-08-16", justAfterMidnightMonday, MANILA).allowed).toBe(true);
  });

  it("falls back to UTC when no timezone is configured", () => {
    // With no timezone the parish date is the UTC date, so at 17:30 UTC it is still
    // the 16th and the 17th is blocked. Safe, if slightly early for a parish that
    // is actually in Manila — which is why the setting has a default.
    const justAfterMidnightManila = new Date("2026-08-16T17:30:00Z");
    expect(canEncodeSession("2026-08-16", justAfterMidnightManila, null).allowed).toBe(true);
    expect(canEncodeSession("2026-08-17", justAfterMidnightManila, null).allowed).toBe(false);
    expect(canEncodeSession("2026-08-18", justAfterMidnightManila, null).allowed).toBe(false);
  });

  it("falls back to UTC for an unusable timezone rather than throwing", () => {
    // A typo in the settings must not make the roster unusable for the whole parish.
    expect(canEncodeSession("2026-08-16", EVENING, "Not/AZone").allowed).toBe(true);
    expect(canEncodeSession("2026-08-17", EVENING, "Not/AZone").allowed).toBe(false);
  });

  it("handles a parish behind UTC as well as ahead", () => {
    // Hawaii is UTC-10: at 05:00 UTC on the 17th it is still the 16th there.
    const honolulu = "Pacific/Honolulu";
    const earlyUtc = new Date("2026-08-17T05:00:00Z");
    expect(canEncodeSession("2026-08-16", earlyUtc, honolulu).allowed).toBe(true);
    expect(canEncodeSession("2026-08-17", earlyUtc, honolulu).allowed).toBe(false);
  });

  it("crosses a month boundary without a gap", () => {
    const endOfAugust = new Date("2026-08-31T12:00:00Z");
    expect(canEncodeSession("2026-08-31", endOfAugust, MANILA).allowed).toBe(true);
    expect(canEncodeSession("2026-09-01", endOfAugust, MANILA).allowed).toBe(false);
  });

  it("crosses a year boundary", () => {
    const newYearsEve = new Date("2026-12-31T12:00:00Z");
    expect(canEncodeSession("2026-12-31", newYearsEve, MANILA).allowed).toBe(true);
    expect(canEncodeSession("2027-01-01", newYearsEve, MANILA).allowed).toBe(false);
  });

  it("compares calendar dates, so month lengths do not matter", () => {
    // String comparison on YYYY-MM-DD is what makes "2026-09-01" > "2026-08-31" and
    // "2026-02-28" > "2026-01-31" both true. Anything numeric here would break on
    // one of those.
    const february = new Date("2026-02-20T12:00:00Z");
    expect(canEncodeSession("2026-01-31", february, MANILA).allowed).toBe(true);
    expect(canEncodeSession("2026-02-01", february, MANILA).allowed).toBe(true);
    expect(canEncodeSession("2026-03-01", february, MANILA).allowed).toBe(false);
  });
});

describe("isFutureSession", () => {
  it("is the inverse of the check", () => {
    expect(isFutureSession("2026-08-17", EVENING, MANILA)).toBe(true);
    expect(isFutureSession("2026-08-16", EVENING, MANILA)).toBe(false);
  });
});
