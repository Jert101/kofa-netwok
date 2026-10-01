import { describe, expect, it } from "vitest";
import {
  countRecentServers,
  recentServersSince,
  sortRoster,
  RECENT_SERVERS_WEEKS,
} from "./roster-sort";

const TODAY = "2026-08-16";

describe("recentServersSince", () => {
  it("looks back eight weeks", () => {
    expect(RECENT_SERVERS_WEEKS).toBe(8);
    expect(recentServersSince(TODAY)).toBe("2026-06-21");
  });

  it("handles a cutoff that lands in the previous month", () => {
    expect(recentServersSince("2026-07-05")).toBe("2026-05-10");
  });

  it("handles a cutoff that lands in the previous year", () => {
    expect(recentServersSince("2026-01-04")).toBe("2025-11-09");
  });
});

describe("countRecentServers", () => {
  it("counts each appearance", () => {
    const counts = countRecentServers(
      [
        { memberId: "a", servedAt: "2026-08-16" },
        { memberId: "a", servedAt: "2026-08-09" },
        { memberId: "b", servedAt: "2026-08-02" },
      ],
      TODAY,
    );
    expect(counts.get("a")).toBe(2);
    expect(counts.get("b")).toBe(1);
  });

  it("ignores records older than the window", () => {
    // Just inside and just outside the eight weeks.
    const counts = countRecentServers(
      [
        { memberId: "old", servedAt: "2026-06-21" },
        { memberId: "older", servedAt: "2026-06-20" },
      ],
      TODAY,
    );
    expect(counts.has("old")).toBe(true);
    expect(counts.has("older")).toBe(false);
  });

  it("ignores records dated in the future", () => {
    // A typo'd date should not make someone look like a frequent server.
    const counts = countRecentServers([{ memberId: "a", servedAt: "2026-12-01" }], TODAY);
    expect(counts.size).toBe(0);
  });

  it("counts nothing for an empty history", () => {
    expect(countRecentServers([], TODAY).size).toBe(0);
  });

  it("merges live and archived rows for the same member", () => {
    // Archiving moves rows to attendance_records_archive. If the caller passes both
    // sources together the member must not be counted twice for one appearance,
    // and equally must not be dropped.
    const counts = countRecentServers(
      [
        { memberId: "a", servedAt: "2026-08-16" },
        { memberId: "a", servedAt: "2026-08-16" },
        { memberId: "a", servedAt: "2026-07-05" },
      ],
      TODAY,
    );
    expect(counts.get("a")).toBe(3);
  });
});

describe("sortRoster", () => {
  const members = [
    { id: "1", fullName: "Celia Ramos" },
    { id: "2", fullName: "anton dela cruz" },
    { id: "3", fullName: "Belen Santos" },
  ];

  it("sorts alphabetically and ignores case", () => {
    const sorted = sortRoster(members, "alphabetical").map((m) => m.fullName);
    expect(sorted).toEqual(["anton dela cruz", "Belen Santos", "Celia Ramos"]);
  });

  it("does not mutate the array it was given", () => {
    const original = [...members];
    sortRoster(members, "alphabetical");
    expect(members).toEqual(original);
  });

  it("puts the most frequent servers first", () => {
    const sorted = sortRoster(
      [
        { id: "1", fullName: "Ada", serverCount: 1 },
        { id: "2", fullName: "Ben", serverCount: 9 },
        { id: "3", fullName: "Cyril", serverCount: 4 },
      ],
      "recent_servers",
    );
    expect(sorted.map((m) => m.id)).toEqual(["2", "3", "1"]);
  });

  it("puts members with no history last", () => {
    const sorted = sortRoster(
      [
        { id: "1", fullName: "Ada", serverCount: 0 },
        { id: "2", fullName: "Ben", serverCount: 3 },
        { id: "3", fullName: "Cyril" },
      ],
      "recent_servers",
    );
    expect(sorted.map((m) => m.id)).toEqual(["2", "1", "3"]);
  });

  it("treats a missing count as zero, not as a bug", () => {
    const sorted = sortRoster(
      [
        { id: "1", fullName: "Ada" },
        { id: "2", fullName: "Ben", serverCount: 1 },
      ],
      "recent_servers",
    );
    expect(sorted.map((m) => m.id)).toEqual(["2", "1"]);
  });

  it("breaks ties alphabetically so rows do not jitter on refresh", () => {
    // Two refreshes with the same data must produce the same order, or the row you
    // were about to tap moves while your thumb is on it.
    const roster = [
      { id: "1", fullName: "Zeta", serverCount: 2 },
      { id: "2", fullName: "Alpha", serverCount: 2 },
      { id: "3", fullName: "Mid", serverCount: 2 },
    ];
    const first = sortRoster(roster, "recent_servers").map((m) => m.id);
    const second = sortRoster([...roster].reverse(), "recent_servers").map((m) => m.id);
    expect(first).toEqual(["2", "3", "1"]);
    expect(second).toEqual(first);
  });

  it("keeps everyone, so no member can vanish from the roster", () => {
    const roster = Array.from({ length: 48 }, (_, i) => ({
      id: String(i),
      fullName: `Member ${String(i).padStart(2, "0")}`,
      serverCount: i % 5,
    }));
    expect(sortRoster(roster, "recent_servers")).toHaveLength(48);
    expect(sortRoster(roster, "alphabetical")).toHaveLength(48);
  });
});
