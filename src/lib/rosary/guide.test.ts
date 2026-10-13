import { describe, expect, it } from "vitest";

import {
  assembleGuide,
  buildHeader,
  mmddyy,
  mysterySetFor,
  parseMysteries,
  parsePrayers,
  parseTodayReading,
  sundaySet,
  weekdayMysterySet,
  weekdayOf,
  type TodayReading,
} from "./guide";

function todayRow(over: Record<string, unknown> = {}) {
  return [
    {
      id: "285",
      rosary_date: "10/12/2026",
      rosary_day: "Monday",
      mystery: "Joyful",
      season: "Ordinary Time",
      currentDate: "October 12, 2026",
      dateMMDDYY: "101226",
      youtubeLink: "https://youtu.be/NC-laJrHcM4",
      mp3AudioUrl: "https://example.test/audio.mp3",
      ...over,
    },
  ];
}

function service(over: Partial<TodayReading> = {}): TodayReading {
  return {
    set: "Joyful",
    season: "Ordinary Time",
    dayLabel: "Monday",
    serviceDate: "101226",
    youtubeUrl: "https://youtu.be/NC-laJrHcM4",
    audioUrl: "https://example.test/audio.mp3",
    ...over,
  };
}

describe("parseTodayReading", () => {
  it("reads the live shape", () => {
    expect(parseTodayReading(todayRow())).toEqual({
      set: "Joyful",
      season: "Ordinary Time",
      dayLabel: "Monday",
      serviceDate: "101226",
      youtubeUrl: "https://youtu.be/NC-laJrHcM4",
      audioUrl: "https://example.test/audio.mp3",
    });
  });

  it("rejects an empty array and an unknown set, so the fallback takes over", () => {
    expect(() => parseTodayReading([])).toThrow();
    expect(() => parseTodayReading(todayRow({ mystery: "Mournful" }))).toThrow(/unknown mystery set/i);
  });

  it("canonicalises case instead of rejecting it", () => {
    expect(parseTodayReading(todayRow({ mystery: "sorrowful" })).set).toBe("Sorrowful");
  });

  it("tolerates missing links, labels and the date it answers for", () => {
    const reading = parseTodayReading(
      todayRow({ youtubeLink: " ", mp3AudioUrl: undefined, dateMMDDYY: undefined }),
    );
    expect(reading.youtubeUrl).toBeNull();
    expect(reading.audioUrl).toBeNull();
    // No date from the service means it can never be shown as agreeing with ours.
    expect(reading.serviceDate).toBeNull();
  });
});

describe("weekdayOf and mmddyy", () => {
  it("reads a civil date without a timezone", () => {
    expect(weekdayOf("2026-10-12")).toBe(1); // Monday
    expect(weekdayOf("2026-10-13")).toBe(2); // Tuesday
    expect(weekdayOf("2026-10-18")).toBe(0); // Sunday
    expect(mmddyy("2026-10-12")).toBe("101226");
  });
});

describe("mysterySetFor: the parish's date decides, not the service", () => {
  it("follows the collection's weekday pairing", () => {
    // Verified against the audio it publishes: monday_joyful, tuesday_sorrowful,
    // wednesday_glorious, thursday_luminous, friday_sorrowful, saturday_joyful.
    // Not the classic Dominican order (Tuesday Glorious, Wednesday Sorrowful) --
    // this guide's texts come from this collection, so the collection wins.
    expect(mysterySetFor("2026-10-12", "Ordinary Time")).toBe("Joyful"); // Monday
    expect(mysterySetFor("2026-10-13", "Ordinary Time")).toBe("Sorrowful"); // Tuesday
    expect(mysterySetFor("2026-10-14", "Ordinary Time")).toBe("Glorious"); // Wednesday
    expect(mysterySetFor("2026-10-15", "Ordinary Time")).toBe("Luminous"); // Thursday
    expect(mysterySetFor("2026-10-16", "Ordinary Time")).toBe("Sorrowful"); // Friday
    expect(mysterySetFor("2026-10-17", "Ordinary Time")).toBe("Joyful"); // Saturday
  });

  it("moves Sunday with the season, as the collection's Sunday files do", () => {
    expect(sundaySet("Ordinary Time")).toBe("Glorious");
    expect(sundaySet("Advent")).toBe("Joyful");
    expect(sundaySet("Christmas")).toBe("Joyful");
    expect(sundaySet("Easter")).toBe("Joyful");
    expect(sundaySet("Lent")).toBe("Sorrowful");
    expect(sundaySet("Triduum")).toBe("Sorrowful");
    // 2026-10-18 is a Sunday; the weekday rules do not apply to it.
    expect(mysterySetFor("2026-10-18", "Ordinary Time")).toBe("Glorious");
    expect(mysterySetFor("2026-02-22", "Lent")).toBe("Sorrowful"); // Lent I, 2026
    expect(mysterySetFor("2026-11-29", "Advent")).toBe("Joyful"); // Advent I, 2026
  });

  it("keeps weekdayMysterySet for callers with no calendar", () => {
    const monday = new Date("2026-10-12T00:00:00Z");
    expect(weekdayMysterySet(monday)).toBe("Joyful");
    expect(weekdayMysterySet(new Date("2026-10-18T00:00:00Z"))).toBe("Glorious");
  });
});

describe("buildHeader", () => {
  it("uses the parish's date and set, and the service's links when it agrees", () => {
    const header = buildHeader("2026-10-12", "Ordinary Time", service());
    expect(header).toMatchObject({
      date: "2026-10-12",
      dayLabel: "Monday",
      set: "Joyful",
      youtubeUrl: "https://youtu.be/NC-laJrHcM4",
      audioUrl: "https://example.test/audio.mp3",
      liveSeason: true,
    });
    expect(header.notices).toEqual([]);
  });

  it("drops yesterday's links when the service has not rolled over", () => {
    // The bug this page had: the service answering "October 12" on the 13th.
    const header = buildHeader("2026-10-13", "Ordinary Time", service());
    expect(header.date).toBe("2026-10-13");
    expect(header.dayLabel).toBe("Tuesday");
    // Tuesday's own set, not the service's Monday.
    expect(header.set).toBe("Sorrowful");
    expect(header.youtubeUrl).toBeNull();
    expect(header.audioUrl).toBeNull();
    expect(header.liveSeason).toBe(false);
    expect(header.notices[0]).toMatch(/not rolled over/i);
  });

  it("says so plainly when the service cannot be reached at all", () => {
    const header = buildHeader("2026-10-13", "Ordinary Time", null);
    expect(header.liveSeason).toBe(false);
    expect(header.notices[0]).toMatch(/could not be reached/i);
    // Still a complete header: the guide is correct on our calendar alone.
    expect(header.set).toBe("Sorrowful");
  });

  it("does not count a service with no date as agreeing", () => {
    const header = buildHeader("2026-10-12", "Ordinary Time", service({ serviceDate: null }));
    expect(header.liveSeason).toBe(false);
    expect(header.youtubeUrl).toBeNull();
  });
});

describe("parseMysteries", () => {
  it("keeps five titled mysteries with verse, fruit and text", () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({
      id: String(i + 1),
      title: `Mystery ${i + 1}`,
      verse: "Luke 1:1",
      fruit: "Fruit: Hope",
      text: "Meditation text.",
      textHTML: "<p>never rendered</p>",
    }));
    const parsed = parseMysteries(rows);
    expect(parsed).toHaveLength(5);
    expect(parsed[0]).toEqual({
      title: "Mystery 1",
      verse: "Luke 1:1",
      fruit: "Fruit: Hope",
      meditation: "Meditation text.",
    });
  });

  it("drops untitled rows and caps at five", () => {
    const rows = Array.from({ length: 7 }, (_, i) => ({ title: i === 2 ? "  " : `M ${i}` }));
    expect(parseMysteries(rows)).toHaveLength(5);
  });
});

describe("parsePrayers", () => {
  it("maps titles to texts and drops empties", () => {
    const map = parsePrayers([
      { id: "1", title: "Our Father", prayerText: "Our Father…" },
      { id: "2", title: "Empty", prayerText: "   " },
    ]);
    expect(map.get("Our Father")).toBe("Our Father…");
    expect(map.has("Empty")).toBe(false);
  });
});

describe("assembleGuide", () => {
  const mysteries = Array.from({ length: 5 }, (_, i) => ({
    title: `M ${i + 1}`,
    verse: null,
    fruit: null,
    meditation: null,
  }));
  const prayers = new Map([
    ["Sign of the Cross", "In the name…"],
    ["Apostles' Creed", "I believe…"],
    ["Our Father", "Our Father…"],
    ["Hail Mary", "Hail Mary…"],
    ["Glory Be", "Glory be…"],
    ["Hail Holy Queen", "Hail, holy Queen…"],
    ["Final Prayer", "O God…"],
  ]);

  it("orders opening prayers, five decades, closing prayers", () => {
    const steps = assembleGuide(mysteries, prayers);
    expect(steps.filter((s) => s.kind === "decade")).toHaveLength(5);
    expect(steps[0]).toEqual({ kind: "prayer", title: "Sign of the Cross", text: "In the name…" });
    expect(steps[steps.length - 1]).toEqual({ kind: "prayer", title: "Final Prayer", text: "O God…" });
    const first = steps.find((s) => s.kind === "decade");
    expect(first).toMatchObject({ index: 1, repeated: ["Our Father", "Hail Mary ×10", "Glory Be", "Oh My Jesus"] });
  });

  it("keeps the step when its text is missing, with a null body", () => {
    const steps = assembleGuide(mysteries, new Map());
    // Every step still present; a dropped Glory Be would teach the wrong order.
    expect(steps).toHaveLength(5 + 5 + 2);
    expect(steps.every((s) => (s.kind === "prayer" ? s.text === null : true))).toBe(true);
  });
});
