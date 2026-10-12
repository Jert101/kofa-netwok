import { describe, expect, it } from "vitest";

import {
  buildPassage,
  chapterKey,
  parseCitation,
  parseCitationsDay,
  plainText,
  resolveBookId,
  type VerseRef,
} from "./text";

function refs(pairs: [number, number][]): VerseRef[] {
  return pairs.map(([chapter, verse]) => ({ chapter, verse }));
}

describe("resolveBookId", () => {
  it("maps the books a lectionary actually cites", () => {
    expect(resolveBookId("Genesis")).toBe(1);
    expect(resolveBookId("Galatians")).toBe(48);
    expect(resolveBookId("1 Corinthians")).toBe(46);
    expect(resolveBookId("Philemon")).toBe(57);
    expect(resolveBookId("Revelation")).toBe(66);
  });

  it("resolves the spelling differences between lectionary and WEB", () => {
    expect(resolveBookId("Psalm")).toBe(19);
    expect(resolveBookId("Psalms")).toBe(19);
    expect(resolveBookId("Responsorial Psalm")).toBe(19);
    expect(resolveBookId("Song of Songs")).toBe(22);
    expect(resolveBookId("Wisdom")).toBe(70);
    expect(resolveBookId("Sirach")).toBe(71);
    expect(resolveBookId("Tobit")).toBe(68);
    expect(resolveBookId("2 Maccabees")).toBe(75);
  });

  it("returns null for a book WEB does not carry", () => {
    expect(resolveBookId("The Book of Enoch")).toBeNull();
    expect(resolveBookId("")).toBeNull();
  });
});

describe("parseCitation", () => {
  it("reads the real citation for Oct 12 2026", () => {
    const parsed = parseCitation("firstReading", "Galatians 4:22-24, 26-27, 31–5:1");
    expect(parsed).not.toBeNull();
    expect(parsed?.bookName).toBe("Galatians");
    expect(parsed?.bookId).toBe(48);
    // The en dash between 31 and 5:1 crosses a chapter.
    expect(parsed?.refs).toEqual(refs([[4, 22], [4, 23], [4, 24], [4, 26], [4, 27], [4, 31], [5, 1]]));
  });

  it("reads a responsorial psalm with subdivision letters", () => {
    const parsed = parseCitation("psalm", "Psalm 113:1b-2, 3-4, 5a, 6-7");
    expect(parsed?.bookId).toBe(19);
    expect(parsed?.refs).toEqual(refs([[113, 1], [113, 2], [113, 3], [113, 4], [113, 5], [113, 6], [113, 7]]));
  });

  it("joins verses with 'and' as well as commas", () => {
    const parsed = parseCitation("psalm", "Psalm 90:3-4, 5-6, 12-13, 14 and 17");
    expect(parsed?.refs).toEqual(
      refs([[90, 3], [90, 4], [90, 5], [90, 6], [90, 12], [90, 13], [90, 14], [90, 17]]),
    );
  });

  it("reads single-chapter lists and numbered books", () => {
    expect(parseCitation("secondReading", "Philemon 9-10, 12-17")?.refs).toEqual(
      refs([[1, 9], [1, 10], [1, 12], [1, 13], [1, 14], [1, 15], [1, 16], [1, 17]]),
    );
    const cor = parseCitation("firstReading", "1 Corinthians 1:2-4");
    expect(cor?.bookId).toBe(46);
    expect(cor?.refs).toEqual(refs([[1, 2], [1, 3], [1, 4]]));
  });

  it("keeps the citation text exactly as published", () => {
    expect(parseCitation("gospel", "Luke 11:29-32")?.citation).toBe("Luke 11:29-32");
  });

  it("rejects what it cannot read instead of returning empty refs", () => {
    expect(parseCitation("gospel", "")).toBeNull();
    expect(parseCitation("gospel", "The Word of the Lord")).toBeNull();
    expect(parseCitation("gospel", "Enoch 1:1")).toBeNull();
    expect(parseCitation("gospel", "Genesis")).toBeNull();
    expect(parseCitation("gospel", "Genesis 1:")).toBeNull();
  });

  it("drops an unreadable piece but keeps the rest of the citation", () => {
    const parsed = parseCitation("gospel", "Luke 11:29-32, ???, 33-35");
    expect(parsed?.refs).toEqual(refs([[11, 29], [11, 30], [11, 31], [11, 32], [11, 33], [11, 34], [11, 35]]));
  });
});

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

  it("rejects a payload that is not a readings file", () => {
    expect(() => parseCitationsDay({ readings: { gospel: "Luke 11:29-32" } })).toThrow();
    expect(() => parseCitationsDay("nope")).toThrow();
  });
});

describe("plainText", () => {
  it("strips the markup bolls.life ships and tidies the spacing", () => {
    expect(plainText("<b>A Prayer by Moses, the man of God. </b>   Lord, you have been our dwelling place.")).toBe(
      "A Prayer by Moses, the man of God. Lord, you have been our dwelling place.",
    );
  });

  it("refuses anything that still looks like markup", () => {
    expect(plainText("a < b")).toBeNull();
    expect(plainText("   ")).toBeNull();
    // Tags are stripped, so nothing upstream can arrive as live HTML.
    expect(plainText("<script>alert(1)</script>")).toBe("alert(1)");
    expect(plainText("<b>unclosed")).toBe("unclosed");
  });
});

describe("buildPassage", () => {
  const chapters = new Map<string, Map<number, string>>([
    [chapterKey(48, 4), new Map([[22, "Christ freed us"], [23, "The Law says"], [24, "The child"]])],
    [chapterKey(48, 5), new Map([[1, "A son, not a slave"]])],
  ]);

  it("keeps citation order and crosses chapters", () => {
    const parsed = parseCitation("firstReading", "Galatians 4:22-24, 31–5:1");
    expect(parsed).not.toBeNull();
    const passage = buildPassage(parsed!, chapters);
    // 4:31 is absent from the fixture, so it is the only verse dropped.
    expect(passage).toEqual({
      citation: "Galatians 4:22-24, 31–5:1",
      verses: [
        { verse: 22, text: "Christ freed us" },
        { verse: 23, text: "The Law says" },
        { verse: 24, text: "The child" },
        { verse: 1, text: "A son, not a slave" },
      ],
    });
  });

  it("drops only the verses whose chapter is missing", () => {
    const parsed = parseCitation("firstReading", "Galatians 4:22-24, 31–5:1");
    const partial = new Map(chapters);
    partial.delete(chapterKey(48, 4));
    const passage = buildPassage(parsed!, partial);
    expect(passage?.verses).toEqual([{ verse: 1, text: "A son, not a slave" }]);
  });

  it("returns null when nothing resolves, so the section is left out", () => {
    const parsed = parseCitation("gospel", "Luke 11:29-32");
    expect(buildPassage(parsed!, chapters)).toBeNull();
    expect(buildPassage(parsed!, new Map())).toBeNull();
  });
});
