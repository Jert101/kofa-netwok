import { describe, expect, it } from "vitest";
import {
  attentionSummary,
  clampWindowDays,
  countOwnAssignments,
  datesBetween,
  filterUpcoming,
  formatDayLabel,
  formatMassTime,
  markOwnSlots,
  needsAttention,
  pinOwnDays,
  windowFor,
  pickEffectiveSlots,
  type PlanRow,
  type UpcomingDay,
  type UpcomingSlot,
} from "./upcoming";

function slot(
  position_label: string,
  member_id: string | null,
  member_name: string | null,
  free_text: string | null = null,
): UpcomingSlot {
  return { position_label, member_id, member_name, free_text, mine: false };
}

function day(date: string, masses: UpcomingDay["masses"]): UpcomingDay {
  return { date, masses };
}

function mass(id: string, name: string, slots: UpcomingSlot[]) {
  return { mass_id: id, mass_name: name, session_id: null, slots };
}

/**
 * Marks the viewer's own rows the way the route does, using `me` as the viewer id.
 *
 * Fixtures do not hand-set `mine`, because a fixture that sets it can pass while the real marker
 * is broken — the `pinOwnDays` and `countOwnAssignments` tests failed exactly that way first.
 */
const VIEWER = "me";

function asViewer(days: UpcomingDay[]): UpcomingDay[] {
  return days.map((d) => ({
    ...d,
    masses: d.masses.map((m) => ({ ...m, slots: markOwnSlots(m.slots, VIEWER) })),
  }));
}

// ======================================================================================
// Window
// ======================================================================================

describe("clampWindowDays", () => {
  it("defaults to 14", () => {
    expect(clampWindowDays(null)).toBe(14);
  });

  it("reads a valid number", () => {
    expect(clampWindowDays("7")).toBe(7);
  });

  it("falls back on nonsense", () => {
    expect(clampWindowDays("abc")).toBe(14);
    expect(clampWindowDays("0")).toBe(14);
    expect(clampWindowDays("-3")).toBe(14);
  });

  it("caps a huge window rather than loading a decade of plans", () => {
    expect(clampWindowDays("9999")).toBe(60);
  });
});

describe("windowFor", () => {
  it("runs from today to today for one day", () => {
    expect(windowFor("2026-10-02", 1)).toEqual({ start: "2026-10-02", end: "2026-10-02" });
  });

  it("covers 14 inclusive days", () => {
    // Inclusive both ends, so 14 days from 2 Oct is the 2nd to the 15th.
    expect(windowFor("2026-10-02", 14)).toEqual({ start: "2026-10-02", end: "2026-10-15" });
  });

  it("crosses a month boundary", () => {
    expect(windowFor("2026-10-25", 14).end).toBe("2026-11-07");
  });

  it("crosses a year boundary", () => {
    expect(windowFor("2026-12-25", 14).end).toBe("2027-01-07");
  });

  it("is not shifted by the host timezone", () => {
    // Parsed as UTC midnight, so a machine west of Greenwich cannot move the window a day.
    expect(windowFor("2026-01-01", 2)).toEqual({ start: "2026-01-01", end: "2026-01-02" });
  });
});

describe("datesBetween", () => {
  it("includes both ends", () => {
    expect(datesBetween("2026-10-02", "2026-10-04")).toEqual([
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
    ]);
  });

  it("returns one day when start equals end", () => {
    expect(datesBetween("2026-10-02", "2026-10-02")).toEqual(["2026-10-02"]);
  });

  it("returns nothing when the range is inverted", () => {
    expect(datesBetween("2026-10-04", "2026-10-02")).toEqual([]);
  });

  it("handles a leap day", () => {
    expect(datesBetween("2028-02-28", "2028-03-01")).toHaveLength(3);
  });
});

// ======================================================================================
// Own rows
// ======================================================================================

describe("markOwnSlots", () => {
  it("marks the viewer's own rows", () => {
    const out = markOwnSlots([slot("Crucifix", "m1", "Reyes, Ben")], "m1");
    expect(out[0].mine).toBe(true);
  });

  it("leaves other people alone", () => {
    const out = markOwnSlots([slot("Crucifix", "m2", "Santos, Ana")], "m1");
    expect(out[0].mine).toBe(false);
  });

  it("marks nothing when there is no declared identity", () => {
    // LIT-5: without a declared identity the list is still browsable, just not personalised.
    const out = markOwnSlots([slot("Crucifix", "m1", "Reyes, Ben")], null);
    expect(out[0].mine).toBe(false);
  });

  it("never marks a guest, even when the name matches the viewer", () => {
    const out = markOwnSlots([slot("Guest", null, null, "Ben Reyes")], "m1");
    expect(out[0].mine).toBe(false);
  });
});

describe("countOwnAssignments", () => {
  it("counts across the whole window", () => {
    const days = asViewer([
      day("2026-10-04", [mass("m1", "Anticipated", [slot("Crucifix", VIEWER, "Reyes, Ben")])]),
      day("2026-10-11", [
        mass("m1", "Anticipated", [
          slot("Crucifix", VIEWER, "Reyes, Ben"),
          slot("Thurifer", "other", "Santos, Ana"),
        ]),
      ]),
    ]);
    expect(countOwnAssignments(days)).toBe(2);
  });

  it("is zero for an empty window", () => {
    expect(countOwnAssignments([])).toBe(0);
  });

  it("does not count other people's rows", () => {
    const days = asViewer([
      day("2026-10-04", [mass("m1", "Anticipated", [slot("Crucifix", "other", "Santos, Ana")])]),
    ]);
    expect(countOwnAssignments(days)).toBe(0);
  });
});

describe("pinOwnDays", () => {
  const days = asViewer([
    day("2026-10-04", [mass("m1", "A", [slot("Crucifix", "other", "Santos, Ana")])]),
    day("2026-10-11", [mass("m1", "A", [slot("Crucifix", VIEWER, "Reyes, Ben")])]),
    day("2026-10-18", [mass("m1", "A", [slot("Crucifix", VIEWER, "Reyes, Ben")])]),
  ]);

  it("floats the days the viewer is serving to the top", () => {
    const out = pinOwnDays(days);
    expect(out.map((d) => d.date)).toEqual(["2026-10-11", "2026-10-18", "2026-10-04"]);
  });

  it("keeps own days in date order", () => {
    const out = pinOwnDays(days);
    expect(out.slice(0, 2).map((d) => d.date)).toEqual(["2026-10-11", "2026-10-18"]);
  });

  it("does not mutate the input", () => {
    const before = days.map((d) => d.date);
    pinOwnDays(days);
    expect(days.map((d) => d.date)).toEqual(before);
  });

  it("leaves the order alone when the viewer serves nowhere", () => {
    const none = asViewer([
      day("2026-10-04", [mass("m1", "A", [slot("Crucifix", "other", "Santos, Ana")])]),
    ]);
    expect(pinOwnDays(none).map((d) => d.date)).toEqual(["2026-10-04"]);
  });
});

// ======================================================================================
// Search
// ======================================================================================

describe("filterUpcoming", () => {
  const days = [
    day("2026-10-04", [
      mass("m1", "Anticipated", [
        slot("Crucifix", "m1", "Santos, Ana"),
        slot("Thurifer", "m2", "Reyes, Ben"),
      ]),
    ]),
    day("2026-10-11", [mass("m1", "Anticipated", [slot("Crucifix", "m3", "Cruz, Carla")])]),
  ];

  it("returns everything for an empty query", () => {
    expect(filterUpcoming(days, "")).toHaveLength(2);
    expect(filterUpcoming(days, null)).toHaveLength(2);
    expect(filterUpcoming(days, "   ")).toHaveLength(2);
  });

  it("finds a name on any day", () => {
    const out = filterUpcoming(days, "reyes");
    expect(out).toHaveLength(1);
    expect(out[0].date).toBe("2026-10-04");
  });

  it("is case insensitive", () => {
    expect(filterUpcoming(days, "REYES")).toHaveLength(1);
  });

  it("keeps the whole day, not just the matching row", () => {
    // The question being asked is "when am I on?", so the rest of that Mass's lineup stays.
    const out = filterUpcoming(days, "reyes");
    expect(out[0].masses[0].slots).toHaveLength(2);
  });

  it("matches part of a name", () => {
    expect(filterUpcoming(days, "ruz")).toHaveLength(1);
  });

  it("matches a guest's free text", () => {
    const withGuest = [day("2026-10-04", [mass("m1", "A", [slot("Guest", null, null, "Maria")])])];
    expect(filterUpcoming(withGuest, "maria")).toHaveLength(1);
  });

  it("matches a position label", () => {
    expect(filterUpcoming(days, "thurifer")).toHaveLength(1);
  });

  it("matches the Mass name", () => {
    const named = [day("2026-10-04", [mass("m1", "Solemnity", [slot("Crucifix", null, null, "X")])])];
    expect(filterUpcoming(named, "solemnity")).toHaveLength(1);
  });

  it("returns nothing when there is no match", () => {
    expect(filterUpcoming(days, "nobody")).toHaveLength(0);
  });
});

// ======================================================================================
// Needs attention
// ======================================================================================

describe("needsAttention", () => {
  const masses = [
    { id: "m1", name: "Anticipated" },
    { id: "m2", name: "Midnight" },
  ];

  it("reports a Mass with no plan at all", () => {
    const items = needsAttention({ days: [], masses, today: "2026-10-02", windowDays: 2 });
    expect(items).toHaveLength(4);
    expect(items.every((i) => i.reason === "no_plan")).toBe(true);
  });

  it("reports a plan with an empty position", () => {
    const days = [
      day("2026-10-03", [
        mass("m1", "Anticipated", [
          slot("Crucifix", "m1", "Santos, Ana"),
          // A row with nobody in it: the position exists, the seat does not.
          slot("Thurifer", null, null),
        ]),
      ]),
    ];
    const items = needsAttention({ days, masses, today: "2026-10-02", windowDays: 2 });
    const gap = items.find((i) => i.reason === "unassigned");
    expect(gap?.date).toBe("2026-10-03");
    expect(gap?.mass_id).toBe("m1");
    expect(gap?.unassigned).toBe(1);
    expect(gap?.positions).toBe(2);
  });

  it("names an unassigned position as the parish spells it", () => {
    // The key is normalized for grouping, but the card shows the label as typed.
    const items = needsAttention({
      days: [
        {
          date: "2026-10-05",
          masses: [
            {
              mass_id: "m1",
              mass_name: "Anticipated",
              session_id: null,
              time: "5:30",
              slots: [{ position_label: "  Crucifix  ", member_id: null, member_name: null, free_text: null, mine: false }],
            },
          ],
        },
      ],
      masses: [{ id: "m1", name: "Anticipated" }],
      today: "2026-10-05",
      windowDays: 1,
    });
    expect(items[0].unassigned_labels).toEqual(["Crucifix"]);
  });

it("counts one position split only by case or spacing", () => {
    const items = needsAttention({
      days: [
        {
          date: "2026-10-05",
          masses: [
            {
              mass_id: "m1",
              mass_name: "Anticipated",
              session_id: null,
              time: "5:30",
              slots: [
                { position_label: "Crucifix", member_id: "u1", member_name: "A", free_text: null, mine: false },
                { position_label: "crucifix", member_id: null, member_name: null, free_text: null, mine: false },
              ],
            },
          ],
        },
      ],
      masses: [{ id: "m1", name: "Anticipated" }],
      today: "2026-10-05",
      windowDays: 1,
    });
    // One position, filled by one of its two rows: not attention-worthy.
    expect(items).toEqual([]);
  });

it("names the unassigned position", () => {
    const days = [day("2026-10-03", [mass("m1", "Anticipated", [slot("thurifer", null, null)])])];
    const items = needsAttention({ days, masses, today: "2026-10-02", windowDays: 2 });
    expect(items.find((i) => i.reason === "unassigned")?.unassigned_labels).toEqual(["thurifer"]);
  });

  it("treats a guest as filling the position", () => {
    const days = [day("2026-10-03", [mass("m1", "Anticipated", [slot("Thurifer", null, null, "John")])])];
    const items = needsAttention({ days, masses, today: "2026-10-02", windowDays: 2 });
    expect(items.some((i) => i.reason === "unassigned")).toBe(false);
  });

  it("treats a whitespace-only guest as still empty", () => {
    const days = [day("2026-10-03", [mass("m1", "Anticipated", [slot("Thurifer", null, null, "  ")])])];
    const items = needsAttention({ days, masses, today: "2026-10-02", windowDays: 2 });
    expect(items.some((i) => i.reason === "unassigned")).toBe(true);
  });

  it("does not report a fully staffed plan", () => {
    const days = [
      day("2026-10-02", [
        mass("m1", "Anticipated", [
          slot("Crucifix", "m1", "Santos, Ana"),
          slot("Thurifer", "m2", "Reyes, Ben"),
        ]),
      ]),
      day("2026-10-03", [mass("m2", "Midnight", [slot("Crucifix", "m1", "Santos, Ana")])]),
    ];
    const items = needsAttention({ days, masses, today: "2026-10-02", windowDays: 2 });
    // Only the two Masses with no plan at all; the staffed ones are silent.
    expect(items.filter((i) => i.reason === "unassigned")).toEqual([]);
    expect(items.map((i) => `${i.date}/${i.mass_id}`).sort()).toEqual([
      "2026-10-02/m2",
      "2026-10-03/m1",
    ]);
  });

  it("counts a position filled by one of two rows as filled", () => {
    // Two people at one position is a staffing choice, not a gap.
    const days = [
      day("2026-10-03", [
        mass("m1", "Anticipated", [
          slot("Candle 1", "m1", "Santos, Ana"),
          slot("Candle 1", null, null),
        ]),
      ]),
    ];
    const items = needsAttention({ days, masses, today: "2026-10-02", windowDays: 2 });
    expect(items.some((i) => i.reason === "unassigned")).toBe(false);
  });

  it("ignores dates outside the window", () => {
    const days = [day("2026-11-30", [mass("m1", "Anticipated", [slot("Crucifix", null, null)])])];
    const items = needsAttention({ days, masses, today: "2026-10-02", windowDays: 2 });
    expect(items.some((i) => i.date === "2026-11-30")).toBe(false);
  });

  it("is empty when every Mass is planned and full", () => {
    // One Mass in the catalog, staffed on both days of the window.
    const one = [{ id: "m1", name: "Anticipated" }];
    const days = [
      day("2026-10-02", [mass("m1", "Anticipated", [slot("Crucifix", "m1", "Santos, Ana")])]),
      day("2026-10-03", [mass("m1", "Anticipated", [slot("Crucifix", "m1", "Santos, Ana")])]),
    ];
    expect(needsAttention({ days, masses: one, today: "2026-10-02", windowDays: 2 })).toEqual([]);
  });

  it("ignores a plan for a Mass that is not in the catalog", () => {
    // A Mass retired from the catalog but still carrying planned rows must not report as
    // "not started" for every date, which is what walking the catalog alone would do.
    const one = [{ id: "m1", name: "Anticipated" }];
    const days = [
      day("2026-10-02", [mass("m1", "Anticipated", [slot("Crucifix", "m1", "Santos, Ana")])]),
    ];
    const items = needsAttention({ days, masses: one, today: "2026-10-02", windowDays: 1 });
    expect(items).toEqual([]);
  });
});

describe("attentionSummary", () => {
  it("says so when nothing is outstanding", () => {
    expect(attentionSummary([])).toBe("Nothing needs attention in the next two weeks.");
  });

  it("counts gaps and unstarted plans separately", () => {
    const items = [
      { date: "2026-10-03", mass_id: "m1", mass_name: "A", reason: "unassigned" as const, positions: 2, unassigned: 1, unassigned_labels: [] },
      { date: "2026-10-04", mass_id: "m1", mass_name: "A", reason: "no_plan" as const, positions: 0, unassigned: 0, unassigned_labels: [] },
      { date: "2026-10-05", mass_id: "m1", mass_name: "A", reason: "no_plan" as const, positions: 0, unassigned: 0, unassigned_labels: [] },
    ];
    const out = attentionSummary(items);
    expect(out).toContain("1 plan with gaps");
    expect(out).toContain("2 not started");
  });

  it("uses the singular for one gap", () => {
    const items = [
      { date: "2026-10-03", mass_id: "m1", mass_name: "A", reason: "unassigned" as const, positions: 2, unassigned: 1, unassigned_labels: [] },
    ];
    expect(attentionSummary(items)).toContain("1 plan with gaps");
  });
});

// ======================================================================================
// Labels
// ======================================================================================

describe("formatDayLabel", () => {
  it("reads as a short day and date", () => {
    expect(formatDayLabel("2026-11-02")).toBe("Mon 2 Nov");
  });

  it("returns the input unchanged when it is not a date", () => {
    expect(formatDayLabel("not a date")).toBe("not a date");
  });
});

describe("formatMassTime", () => {
  it("converts a Postgres time to a readable hour", () => {
    expect(formatMassTime("05:30:00")).toBe("5:30 AM");
    expect(formatMassTime("17:30:00")).toBe("5:30 PM");
  });

  it("handles midnight and noon", () => {
    expect(formatMassTime("00:00:00")).toBe("12:00 AM");
    expect(formatMassTime("12:00:00")).toBe("12:00 PM");
  });

  it("returns null when no time is configured", () => {
    expect(formatMassTime(null)).toBeNull();
    expect(formatMassTime(undefined)).toBeNull();
  });

  it("returns null for an unparseable value", () => {
    expect(formatMassTime("noon")).toBeNull();
  });
});
describe("pickEffectiveSlots", () => {
  const planned: PlanRow[] = [
    { position_label: "Crucifix", member_id: "m1", free_text: null, member_name: "Ana" },
    { position_label: "Candles", member_id: "m2", free_text: null, member_name: "Bela" },
  ];
  const served: PlanRow[] = [
    { position_label: "Crucifix", member_id: "m3", free_text: null, member_name: "Cris" },
  ];

  it("prefers the session rows once the session has any", () => {
    // Spec 7: after the session exists, editing planned rows does not change it.
    const later = [...planned, { position_label: "Thurifer", member_id: "m9", free_text: null, member_name: "Dan" }];
    expect(pickEffectiveSlots(later, served)).toEqual({ source: "session", slots: served });
  });

  it("falls back to the planned rows when the session is empty", () => {
    // The weekend cron creates sessions with no rows at all. Without this the officer's own plan
    // would read as "no plan" until they retyped it.
    expect(pickEffectiveSlots(planned, [])).toEqual({ source: "planned", slots: planned });
  });

  it("reports planned with nothing when neither side has rows", () => {
    // The source label is what tells the card whether to say "not planned" or "nothing assigned",
    // so an empty pair must not masquerade as a session that has been worked on.
    expect(pickEffectiveSlots([], [])).toEqual({ source: "planned", slots: [] });
  });

  it("does not merge the two sources", () => {
    // Merging would resurrect a position the secretary removed from the roster, and would show an
    // assignment twice under different names.
    const result = pickEffectiveSlots(planned, served);
    expect(result.slots).toHaveLength(1);
    expect(result.slots[0]?.position_label).toBe("Crucifix");
    expect(result.slots.some((r) => r.member_id === "m2")).toBe(false);
  });
});
