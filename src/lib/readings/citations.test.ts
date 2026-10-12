import { describe, expect, it } from "vitest";

import { parseCitationsDay } from "./citations";

describe("parseCitationsDay", () => {
  it("keeps the citations present and omits the rest", () => {
    const day = parseCitationsDay({
      date: "2026-10-11",
      season: "Ordinary Time",
      readings: {
        firstReading: "Isaiah 25:6-10a",
        psalm: "Psalm 23:1-3a, 3b-4, 5, 6",
        secondReading: "Philippians 4:12-14, 19-20",
        gospel: "Matthew 22:1-14",
      },
      usccbLink: "https://example.test",
    });
    expect(day).toEqual({
      firstReading: "Isaiah 25:6-10a",
      psalm: "Psalm 23:1-3a, 3b-4, 5, 6",
      secondReading: "Philippians 4:12-14, 19-20",
      gospel: "Matthew 22:1-14",
    });
  });

  it("handles a ferial day with no second reading", () => {
    const day = parseCitationsDay({
      date: "2026-10-12",
      readings: {
        firstReading: "Galatians 4:22-24, 26-27, 31–5:1",
        psalm: "Psalm 113:1b-2, 3-4, 5a, 6-7",
        gospel: "Luke 11:29-32",
      },
    });
    expect(day.secondReading).toBeUndefined();
    expect(day.gospel).toBe("Luke 11:29-32");
  });

  it("drops a blank citation rather than showing an empty one", () => {
    const day = parseCitationsDay({
      date: "2026-10-12",
      readings: { firstReading: "  ", psalm: "Psalm 113:1b-2", gospel: "Luke 11:29-32" },
    });
    expect(day.firstReading).toBeUndefined();
    expect(day.psalm).toBe("Psalm 113:1b-2");
  });

  it("ignores the empty acclamation field the source carries", () => {
    const day = parseCitationsDay({
      date: "2026-10-12",
      readings: { firstReading: "Galatians 4:22-24", psalm: "Psalm 113", acclamation: "", gospel: "Luke 11:29-32" },
    });
    expect(Object.keys(day).sort()).toEqual(["firstReading", "gospel", "psalm"]);
  });

  it("rejects a payload that is not a readings file", () => {
    expect(() => parseCitationsDay({ readings: { gospel: "Luke 11:29-32" } })).toThrow();
    expect(() => parseCitationsDay("nope")).toThrow();
  });
});
