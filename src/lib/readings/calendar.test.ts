import { describe, expect, it } from "vitest";

import {
  adventSunday,
  describeDate,
  easterSunday,
  otWeekOf,
  usccbLink,
  type DayInfo,
} from "./calendar";

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

describe("easterSunday (Anonymous Gregorian algorithm)", () => {
  it("lands on the known dates", () => {
    expect(fmt(easterSunday(2026))).toBe("2026-04-05");
    expect(fmt(easterSunday(2025))).toBe("2025-04-20");
    expect(fmt(easterSunday(2024))).toBe("2024-03-31");
    expect(fmt(easterSunday(2000))).toBe("2000-04-23");
  });
});

describe("adventSunday", () => {
  it("is the 4th Sunday before Christmas", () => {
    // Nov 29 2026 opens the liturgical year that runs Year B.
    expect(fmt(adventSunday(2026))).toBe("2026-11-29");
    expect(fmt(adventSunday(2025))).toBe("2025-11-30");
  });
});

describe("otWeekOf (the skipped-week rule)", () => {
  it("counts from the Baptism week and skips Lent I through Easter VI", () => {
    // Verified against the full 2026 calendar: Feb 15 is the 6th Sunday,
    // May 24-30 is week 8 (week 7 never occurs), Jun 14 the 11th Sunday.
    expect(otWeekOf("2026-01-18")).toBe(2);
    expect(otWeekOf("2026-02-15")).toBe(6);
    expect(otWeekOf("2026-05-27")).toBe(8);
    expect(otWeekOf("2026-06-14")).toBe(11);
    expect(otWeekOf("2026-09-06")).toBe(23);
    expect(otWeekOf("2026-10-11")).toBe(28);
    expect(otWeekOf("2026-11-08")).toBe(32);
    expect(otWeekOf("2026-11-15")).toBe(33);
    expect(otWeekOf("2026-11-22")).toBe(34);
  });

  it("returns null inside the skipped stretch", () => {
    // Lent I week through Easter VI week carry season labels, not OT numbers.
    expect(otWeekOf("2026-02-22")).toBeNull();
    expect(otWeekOf("2026-04-05")).toBeNull();
    expect(otWeekOf("2026-05-10")).toBeNull();
  });
});

describe("describeDate: today and the load-bearing cases", () => {
  it("reads Oct 12 2026 as Monday of week 28, Year A / Year II", () => {
    const d: DayInfo = describeDate("2026-10-12");
    expect(d.season).toBe("Ordinary Time");
    expect(d.seasonWeek).toBe(28);
    expect(d.otWeek).toBe(28);
    expect(d.color).toBe("Green");
    expect(d.rank).toBe("Weekday");
    expect(d.sundayCycle).toBe("A");
    expect(d.weekdayCycle).toBe("II");
    expect(d.title).toEqual({ kind: "ferial", season: "Ordinary Time", week: 28, weekday: 1 });
  });

  it("opens Year B on the First Sunday of Advent 2026", () => {
    const d = describeDate("2026-11-29");
    expect(d.rank).toBe("Sunday");
    expect(d.season).toBe("Advent");
    expect(d.seasonWeek).toBe(1);
    expect(d.color).toBe("Violet");
    expect(d.sundayCycle).toBe("B");
    // The year ending in 2027 is odd.
    expect(d.weekdayCycle).toBe("I");
  });

  it("keeps Year A up to the day before Advent 2026", () => {
    expect(describeDate("2026-11-22").sundayCycle).toBe("A");
    expect(describeDate("2026-11-22").title).toEqual({ kind: "named", key: "christKing" });
    expect(describeDate("2026-11-22").rank).toBe("Solemnity");
    expect(describeDate("2026-11-22").seasonWeek).toBe(34);
  });

  it("runs Year C with weekday cycle I in early 2025", () => {
    const d = describeDate("2025-01-15");
    expect(d.sundayCycle).toBe("C");
    expect(d.weekdayCycle).toBe("I");
  });
});

describe("describeDate: seasons, colors, ranks", () => {
  it("names Trinity unnumbered and Corpus Christi after it", () => {
    const trinity = describeDate("2026-05-31");
    expect(trinity.rank).toBe("Solemnity");
    expect(trinity.title).toEqual({ kind: "named", key: "trinity" });
    expect(trinity.seasonWeek).toBe(9);
    const corpus = describeDate("2026-06-07");
    expect(corpus.title).toEqual({ kind: "named", key: "corpusChristi" });
    expect(corpus.seasonWeek).toBe(10);
  });

  it("paints Gaudete and Laetare rose", () => {
    expect(describeDate("2026-12-13").color).toBe("Rose");
    expect(describeDate("2026-12-13").rank).toBe("Sunday");
    expect(describeDate("2026-03-15").color).toBe("Rose");
    expect(describeDate("2026-03-15").title).toEqual({ kind: "seasonSunday", season: "Lent", n: 4 });
  });

  it("walks Holy Week into the Triduum in order", () => {
    expect(describeDate("2026-03-29").title).toEqual({ kind: "named", key: "palmSunday" });
    expect(describeDate("2026-03-30").title).toEqual({ kind: "holyWeek", weekday: 1 });
    expect(describeDate("2026-04-02").title).toEqual({ kind: "named", key: "holyThursday" });
    expect(describeDate("2026-04-02").color).toBe("White");
    expect(describeDate("2026-04-03").title).toEqual({ kind: "named", key: "goodFriday" });
    expect(describeDate("2026-04-03").color).toBe("Red");
    expect(describeDate("2026-04-04").title).toEqual({ kind: "named", key: "holySaturday" });
  });

  it("keeps the Easter Octave white and solemn", () => {
    const mon = describeDate("2026-04-06");
    expect(mon.season).toBe("Easter");
    expect(mon.rank).toBe("Solemnity");
    expect(mon.color).toBe("White");
    expect(mon.title).toEqual({ kind: "easterOctave", weekday: 1 });
  });

  it("reads Christmas and its octave", () => {
    expect(describeDate("2026-12-25").rank).toBe("Solemnity");
    expect(describeDate("2026-12-24").color).toBe("Violet");
    expect(describeDate("2026-12-24").season).toBe("Advent");
    expect(describeDate("2026-12-27").title).toEqual({ kind: "named", key: "holyFamily" });
    expect(describeDate("2026-12-30").title).toEqual({
      kind: "christmasWeekday",
      period: "octave",
      weekday: 3,
    });
    expect(describeDate("2026-01-04").title).toEqual({ kind: "named", key: "epiphany" });
    expect(describeDate("2026-01-11").title).toEqual({ kind: "named", key: "baptism" });
    expect(describeDate("2026-01-05").title).toEqual({
      kind: "christmasWeekday",
      period: "afterEpiphany",
      weekday: 1,
    });
  });

  it("marks All Souls as a feast in violet", () => {
    const d = describeDate("2026-11-02");
    expect(d.rank).toBe("Feast");
    expect(d.color).toBe("Violet");
    expect(d.title).toEqual({ kind: "allSouls" });
  });

  it("uses the Sunday's own data on a plain Saturday vigil", () => {
    // Oct 31 has no saint in the table: a bare Saturday keeps the week's
    // season, color and number. (Oct 17 would be Ignatius of Antioch, a
    // Memorial in red -- covered by the saints tests below.)
    const sat = describeDate("2026-10-31");
    expect(sat.season).toBe("Ordinary Time");
    expect(sat.seasonWeek).toBe(30);
    expect(sat.color).toBe("Green");
    expect(sat.rank).toBe("Weekday");
  });

  it("survives Feb 29 without inventing a season", () => {
    const d = describeDate("2028-02-29");
    expect(d.season).toBe("Ordinary Time");
    expect(d.color).toBe("Green");
    expect(d.rank).toBe("Weekday");
    expect(d.seasonWeek).toBe(8);
  });
});

describe("describeDate: transfers", () => {
  it("keeps the Annunciation on Mar 25 when nothing impedes it", () => {
    // Mar 25 2026 is an ordinary Lenten Wednesday (Holy Week starts Mar 29),
    // so no transfer happens.
    const d = describeDate("2026-03-25");
    expect(d.rank).toBe("Solemnity");
    expect(d.title).toEqual({ kind: "saint", name: "The Annunciation of the Lord" });
  });

  it("moves the Annunciation out of Holy Week to Easter Monday", () => {
    // Mar 25 2024 is Monday of Holy Week: the day stays ferial and the feast
    // moves to Apr 8, Monday after the Octave.
    expect(describeDate("2024-03-25").title).toEqual({ kind: "holyWeek", weekday: 1 });
    const moved = describeDate("2024-04-08");
    expect(moved.rank).toBe("Solemnity");
    expect(moved.title).toEqual({ kind: "saint", name: "The Annunciation of the Lord" });
    expect(moved.season).toBe("Easter");
    expect(moved.seasonWeek).toBe(2);
  });

  it("moves Immaculate Conception off an Advent Sunday (US rule)", () => {
    // Dec 8 2024 is the Second Sunday of Advent: the Sunday wins.
    expect(describeDate("2024-12-08").rank).toBe("Sunday");
    const moved = describeDate("2024-12-09");
    expect(moved.rank).toBe("Solemnity");
    expect(moved.title).toEqual({
      kind: "saint",
      name: "The Immaculate Conception of the Blessed Virgin Mary",
    });
  });

  it("keeps Saint Joseph on Mar 19 outside Holy Week", () => {
    const d = describeDate("2026-03-19");
    expect(d.rank).toBe("Solemnity");
    expect(d.color).toBe("White");
  });

  it("celebrates the Baptism on Monday when Epiphany takes the Sunday", () => {
    // Epiphany Jan 7 2024 (Sunday) pushes the Baptism to Monday Jan 8.
    expect(describeDate("2024-01-07").title).toEqual({ kind: "named", key: "epiphany" });
    expect(describeDate("2024-01-08").title).toEqual({ kind: "named", key: "baptism" });
    expect(describeDate("2024-01-08").rank).toBe("Feast");
  });
});

describe("describeDate: saints, feasts, memorials", () => {
  it("reads an obligatory memorial outside Lent", () => {
    const d = describeDate("2026-10-15");
    expect(d.rank).toBe("Memorial");
    expect(d.title).toEqual({ kind: "saint", name: "Saint Teresa of Ávila, Virgin, Doctor" });
  });

  it("reads a Saturday memorial in red", () => {
    // Ignatius of Antioch, Oct 17 2026 (Saturday): a Memorial outranks the
    // ferial Saturday, so the day is red, not green.
    const d = describeDate("2026-10-17");
    expect(d.rank).toBe("Memorial");
    expect(d.color).toBe("Red");
    expect(d.title).toEqual({ kind: "saint", name: "Saint Ignatius of Antioch, Bishop, Martyr" });
  });

  it("reads an optional memorial and lists companions", () => {
    const d = describeDate("2026-10-22");
    expect(d.rank).toBe("Optional Memorial");
    expect(d.commemorations).toEqual([]);
  });

  it("reduces an obligatory memorial in Lent instead of dropping it", () => {
    // Perpetua and Felicity, Mar 7 2026 (Saturday): the ferial would hide
    // them entirely, and a full Memorial rank would overstate a Lenten
    // Saturday. Optional Memorial is the honest middle.
    const d = describeDate("2026-03-07");
    expect(d.rank).toBe("Optional Memorial");
    expect(d.title).toEqual({ kind: "saint", name: "Saints Perpetua and Felicity, Martyrs" });
  });

  it("lets an Ordinary Time Sunday suppress a feast", () => {
    // Birthday of Mary, Sep 8 2024 (Sunday): the Sunday wins.
    const d = describeDate("2024-09-08");
    expect(d.rank).toBe("Sunday");
    expect(d.title.kind).toBe("otSunday");
  });

  it("lets All Saints keep its Sunday", () => {
    const d = describeDate("2026-11-01");
    expect(d.rank).toBe("Solemnity");
    expect(d.title).toEqual({ kind: "saint", name: "All Saints" });
  });

  it("keeps the Santo Niño feast on the third Sunday of January", () => {
    const d = describeDate("2026-01-18");
    expect(d.rank).toBe("Feast");
    expect(d.title).toEqual({ kind: "saint", name: "Santo Niño" });
  });
});

describe("usccbLink", () => {
  it("builds the MMDDYY address without fetching anything", () => {
    expect(usccbLink("2026-10-12")).toBe("https://bible.usccb.org/bible/readings/101226.cfm");
    expect(usccbLink("2026-01-04")).toBe("https://bible.usccb.org/bible/readings/010426.cfm");
  });
});
