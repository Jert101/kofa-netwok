import { describe, expect, it } from "vitest";

import {
  assembleGuide,
  parseMysteries,
  parsePrayers,
  parseTodayReading,
  weekdayMysterySet,
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
      youtubeLink: "https://youtu.be/NC-laJrHcM4",
      mp3AudioUrl: "https://example.test/audio.mp3",
      ...over,
    },
  ];
}

describe("parseTodayReading", () => {
  it("reads the live shape", () => {
    expect(parseTodayReading(todayRow())).toEqual({
      set: "Joyful",
      season: "Ordinary Time",
      dayLabel: "Monday",
      dateLabel: "October 12, 2026",
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

  it("tolerates missing links and labels", () => {
    const reading = parseTodayReading(todayRow({ youtubeLink: " ", mp3AudioUrl: undefined }));
    expect(reading.youtubeUrl).toBeNull();
    expect(reading.audioUrl).toBeNull();
  });
});

describe("weekdayMysterySet", () => {
  it("follows the fixed tradition", () => {
    // 2026-10-12 is a Monday; stepping day by day covers the week.
    const monday = new Date("2026-10-12T00:00:00Z");
    const expected = ["Joyful", "Sorrowful", "Glorious", "Luminous", "Sorrowful", "Joyful", "Glorious"] as const;
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday.getTime() + i * 86400000);
      expect(weekdayMysterySet(d)).toBe(expected[(d.getUTCDay() + 6) % 7] ?? expected[0]);
    }
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
