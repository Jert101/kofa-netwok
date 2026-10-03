import { describe, expect, it } from "vitest";
import {
  DEFAULT_TIMEZONE,
  addMonthsClamped,
  churchClock,
  churchToday,
  datePartsInZone,
  isIsoDate,
  isValidTimeZone,
  monthEnd,
  monthStart,
  monthsBeforeClamped,
  resolveTimeZone,
  zoneOffsetMinutes,
} from "./church-time";

// 2026-10-04T20:30:00Z is already 4:30 AM on the 5th in Manila.
const lateEveningUtc = new Date("2026-10-04T20:30:00Z");
// 2026-10-04T03:00:00Z is 11:00 AM on the 4th in Manila, and still the 3rd in New York.
const morningManila = new Date("2026-10-04T03:00:00Z");

describe("isValidTimeZone", () => {
  it("accepts real IANA names", () => {
    expect(isValidTimeZone("Asia/Manila")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("America/New_York")).toBe(true);
  });

  it("rejects nonsense", () => {
    expect(isValidTimeZone("Asia/Manilaa")).toBe(false);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
    expect(isValidTimeZone(null)).toBe(false);
    expect(isValidTimeZone(undefined)).toBe(false);
  });

  it("rejects a non-string rather than throwing", () => {
    expect(isValidTimeZone(42 as unknown as string)).toBe(false);
  });
});

describe("resolveTimeZone", () => {
  it("passes a valid zone through", () => {
    expect(resolveTimeZone("Europe/Madrid")).toBe("Europe/Madrid");
  });

  it("falls back to Manila for an invalid one instead of failing", () => {
    // Spec §SYS-8: the health page shows red, the app keeps working.
    expect(resolveTimeZone("Not/AZone")).toBe(DEFAULT_TIMEZONE);
    expect(resolveTimeZone(null)).toBe(DEFAULT_TIMEZONE);
  });
});

describe("churchToday", () => {
  it("has already rolled over when UTC has not", () => {
    expect(churchToday("Asia/Manila", lateEveningUtc)).toBe("2026-10-05");
    expect(churchToday("UTC", lateEveningUtc)).toBe("2026-10-04");
  });

  it("is behind a western zone", () => {
    expect(churchToday("America/New_York", morningManila)).toBe("2026-10-03");
  });

  it("uses the fallback for a broken setting", () => {
    expect(churchToday("Not/AZone", lateEveningUtc)).toBe("2026-10-05");
  });
});

describe("churchClock", () => {
  it("prints the wall clock in the church's zone", () => {
    expect(churchClock("Asia/Manila", lateEveningUtc)).toBe("4:30 AM");
  });

  it("prints 12, not 0, at midnight and noon", () => {
    // UTC midnight is 8 AM in Manila; UTC noon is 8 PM.
    expect(churchClock("Asia/Manila", new Date("2026-10-04T00:00:00Z"))).toBe("8:00 AM");
    expect(churchClock("UTC", new Date("2026-10-04T00:00:00Z"))).toBe("12:00 AM");
    expect(churchClock("UTC", new Date("2026-10-04T12:00:00Z"))).toBe("12:00 PM");
  });
});

describe("zoneOffsetMinutes", () => {
  it("is positive east of Greenwich", () => {
    expect(zoneOffsetMinutes("Asia/Manila", lateEveningUtc)).toBe(480);
    expect(zoneOffsetMinutes("UTC", lateEveningUtc)).toBe(0);
  });

  it("is negative west of Greenwich", () => {
    expect(zoneOffsetMinutes("America/New_York", morningManila)).toBe(-240);
  });

  it("follows daylight saving rather than a fixed offset", () => {
    // New York is -5 in January and -4 in July. A hard-coded -300 would be wrong for half the year,
    // and the duplicate-payment warning would name a time an hour off.
    expect(zoneOffsetMinutes("America/New_York", new Date("2026-01-15T12:00:00Z"))).toBe(-300);
    expect(zoneOffsetMinutes("America/New_York", new Date("2026-07-15T12:00:00Z"))).toBe(-240);
  });

  it("rounds to a whole minute", () => {
    expect(Number.isInteger(zoneOffsetMinutes("Asia/Kolkata", lateEveningUtc))).toBe(true);
  });

  it("gives the offset for a zone with a half-hour difference", () => {
    expect(zoneOffsetMinutes("Asia/Kolkata", lateEveningUtc)).toBe(330);
  });
});

describe("datePartsInZone", () => {
  it("reports midnight as hour zero, not twenty-four", () => {
    const parts = datePartsInZone("UTC", new Date("2026-10-04T00:00:00Z"));
    expect(parts.hour).toBe(0);
    expect(parts.date).toBe("2026-10-04");
  });

  it("reports the date parts a dashboard groups by", () => {
    const parts = datePartsInZone("Asia/Manila", morningManila);
    expect(parts).toMatchObject({ year: 2026, month: 10, day: 4, hour: 11, minute: 0 });
  });
});

describe("monthStart and monthEnd", () => {
  it("brackets a month", () => {
    expect(monthStart("2026-02-14")).toBe("2026-02-01");
    expect(monthEnd("2026-02-14")).toBe("2026-02-28");
  });

  it("knows February in a leap year", () => {
    expect(monthEnd("2028-02-14")).toBe("2028-02-29");
  });

  it("handles December", () => {
    expect(monthEnd("2026-12-01")).toBe("2026-12-31");
  });
});

describe("addMonthsClamped", () => {
  it("adds a month", () => {
    expect(addMonthsClamped("2026-01-15", 1)).toBe("2026-02-15");
  });

  it("clamps instead of overflowing into the next month", () => {
    // 31 January plus a month is 28 February. Rolling to 2 or 3 March would make the
    // "two complete months before now" rule describe the wrong months entirely.
    expect(addMonthsClamped("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsClamped("2028-01-31", 1)).toBe("2028-02-29");
  });

  it("handles a month boundary of more than twelve months", () => {
    expect(addMonthsClamped("2026-06-15", 18)).toBe("2027-12-15");
  });

  it("counts backwards across a year boundary", () => {
    expect(addMonthsClamped("2026-01-15", -2)).toBe("2025-11-15");
  });
});

describe("monthsBeforeClamped", () => {
  it("is the inverse of addMonthsClamped for a mid-month day", () => {
    expect(monthsBeforeClamped("2026-10-04", 2)).toBe("2026-08-04");
  });

  it("clamps going backwards too", () => {
    expect(monthsBeforeClamped("2026-03-31", 1)).toBe("2026-02-28");
  });

  it("is zero months back for zero", () => {
    expect(monthsBeforeClamped("2026-10-04", 0)).toBe("2026-10-04");
  });
});

describe("isIsoDate", () => {
  it("accepts a real date", () => {
    expect(isIsoDate("2026-10-04")).toBe(true);
    expect(isIsoDate("2024-02-29")).toBe(true);
  });

  it("rejects a day that does not exist", () => {
    // Postgres would accept it and store 1 March; the UI must not offer it.
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2025-02-29")).toBe(false);
  });

  it("rejects other shapes", () => {
    expect(isIsoDate("2026-10-04T00:00:00Z")).toBe(false);
    expect(isIsoDate("4 Oct 2026")).toBe(false);
    expect(isIsoDate("")).toBe(false);
    expect(isIsoDate(null)).toBe(false);
  });
});