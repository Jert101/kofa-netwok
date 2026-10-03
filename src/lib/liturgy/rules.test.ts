import { describe, expect, it } from "vitest";
import {
  NOTHING_TO_COPY,
  buildCopy,
  countUnassigned,
  copyOutcomeMessage,
  detectConflicts,
  distinctLabels,
  isRosterOverlapAConflict,
  isSameLabel,
  mergePositionCatalog,
  moveRow,
  normaliseSortOrder,
  normalizeLabel,
  summariseConflicts,
  unassignedSummary,
  validateTemplateLabels,
  validateTemplateName,
  type LiturgyEntry,
  type LiturgyMemberRef,
} from "./rules";

function member(id: string, full_name: string, is_active = true): LiturgyMemberRef {
  return { id, full_name, is_active };
}

function members(...list: LiturgyMemberRef[]): Map<string, LiturgyMemberRef> {
  return new Map(list.map((m) => [m.id, m]));
}

function entry(
  position_label: string,
  member_id: string | null,
  memberName: string | null = null,
): LiturgyEntry {
  return { position_label, member_id, free_text: null, memberName };
}

// ======================================================================================
// Labels
// ======================================================================================

describe("normalizeLabel", () => {
  it("folds case, trims and collapses inner whitespace", () => {
    expect(normalizeLabel("  Candle   1 ")).toBe("candle 1");
    expect(normalizeLabel("CRUCIFIX")).toBe("crucifix");
    expect(normalizeLabel("thurifer")).toBe("thurifer");
  });

  it("treats a blank label as nothing", () => {
    expect(normalizeLabel("   ")).toBe("");
  });

  it("leaves punctuation alone, since positions are written as words", () => {
    expect(normalizeLabel("Candle 1 (left)")).toBe("candle 1 (left)");
  });
});

describe("isSameLabel", () => {
  it("matches across case and spacing", () => {
    // P1 in the spec: "Candle 1", "candle 1" and "Candle One" all exist today.
    expect(isSameLabel("Candle 1", "candle  1")).toBe(true);
  });

  it("does not match different positions", () => {
    expect(isSameLabel("Crucifix", "Thurifer")).toBe(false);
  });

  it("never treats two blank labels as the same", () => {
    // Otherwise every empty row would collapse into one position.
    expect(isSameLabel("", "")).toBe(false);
    expect(isSameLabel("   ", "")).toBe(false);
  });
});

describe("mergePositionCatalog", () => {
  it("keeps the existing casing and inserts nothing new", () => {
    // Spec §7: "the stored casing is the first one seen".
    const out = mergePositionCatalog(["Candle 1"], ["candle 1"]);
    expect(out.labels).toEqual(["Candle 1"]);
    expect(out.toInsert).toEqual([]);
  });

  it("adds a genuinely new label", () => {
    const out = mergePositionCatalog(["Crucifix"], ["Candle 1"]);
    expect(out.toInsert).toEqual(["Candle 1"]);
    expect(out.labels).toEqual(["Crucifix", "Candle 1"]);
  });

  it("collapses duplicates within the incoming batch too", () => {
    const out = mergePositionCatalog([], ["Thurifer", "thurifer", " THURIFER "]);
    expect(out.labels).toEqual(["Thurifer"]);
  });

  it("ignores blank incoming labels", () => {
    const out = mergePositionCatalog(["Crucifix"], ["", "   "]);
    expect(out.toInsert).toEqual([]);
    expect(out.labels).toEqual(["Crucifix"]);
  });

  it("trims what it stores", () => {
    expect(mergePositionCatalog([], ["  Candle 1  "]).labels).toEqual(["Candle 1"]);
  });

  it("keeps the first of several existing variants", () => {
    // A catalog that already drifted keeps its earliest spelling rather than rewriting it.
    const out = mergePositionCatalog(["Candle 1", "candle 1"], []);
    expect(out.labels).toEqual(["Candle 1"]);
  });
});

describe("distinctLabels", () => {
  it("returns each position once, in first-seen order", () => {
    const rows = [
      { position_label: "Crucifix", member_id: "a", free_text: null },
      { position_label: "Crucifix", member_id: "b", free_text: null },
      { position_label: "Candle 1", member_id: "c", free_text: null },
    ];
    expect(distinctLabels(rows)).toEqual(["Crucifix", "Candle 1"]);
  });

  it("drops blank labels", () => {
    expect(distinctLabels([{ position_label: " ", member_id: null, free_text: null }])).toEqual([]);
  });
});

// ======================================================================================
// Conflicts
// ======================================================================================

describe("detectConflicts", () => {
  it("finds nothing in a clean sheet", () => {
    const out = detectConflicts({
      entries: [entry("Crucifix", "m1", "Santos, Ana"), entry("Thurifer", "m2", "Reyes, Ben")],
    });
    expect(out).toEqual([]);
  });

  it("flags a member at two positions in one Mass", () => {
    const out = detectConflicts({
      entries: [entry("Crucifix", "m1", "Santos, Ana"), entry("Thurifer", "m1", "Santos, Ana")],
    });
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("duplicate_in_mass");
    expect(out[0].detail).toBe("Santos, Ana is also assigned to Crucifix at this Mass.");
  });

  it("reports once per extra position, not once per pair", () => {
    // Three roles for one member is two problems, not three.
    const out = detectConflicts({
      entries: [
        entry("Crucifix", "m1", "Santos, Ana"),
        entry("Thurifer", "m1", "Santos, Ana"),
        entry("Candle 1", "m1", "Santos, Ana"),
      ],
    });
    expect(out.filter((c) => c.kind === "duplicate_in_mass")).toHaveLength(2);
  });

  it("names every other position the member holds", () => {
    const out = detectConflicts({
      entries: [
        entry("Crucifix", "m1", "Santos, Ana"),
        entry("Thurifer", "m1", "Santos, Ana"),
        entry("Candle 1", "m1", "Santos, Ana"),
      ],
    });
    const detail = out.find((c) => c.positionLabel === "Candle 1")!.detail;
    expect(detail).toContain("Crucifix, Thurifer");
  });

  it("flags the same member in two Masses on one date", () => {
    const out = detectConflicts({
      entries: [entry("Crucifix", "m1", "Santos, Ana")],
      sameDayMasses: [
        {
          massId: "mass2",
          massName: "Anticipated",
          time: "17:30:00",
          entries: [entry("Thurifer", "m1", "Santos, Ana")],
        },
      ],
    });
    const cross = out.filter((c) => c.kind === "double_booked");
    expect(cross).toHaveLength(1);
    expect(cross[0].detail).toContain("Anticipated");
    expect(cross[0].detail).toContain("5:30 PM");
  });

  it("omits the time when the Mass has none configured", () => {
    const out = detectConflicts({
      entries: [entry("Crucifix", "m1", "Santos, Ana")],
      sameDayMasses: [{ massId: "m2", massName: "Midnight", entries: [entry("Thurifer", "m1")] }],
    });
    expect(out[0].detail).toBe("Santos, Ana is also serving Midnight on this date.");
  });

  it("converts midnight and noon correctly", () => {
    const out = detectConflicts({
      entries: [entry("Crucifix", "m1", "Santos, Ana")],
      sameDayMasses: [
        { massId: "m2", massName: "Midnight", time: "00:00:00", entries: [entry("T", "m1")] },
        { massId: "m3", massName: "Noon", time: "12:00:00", entries: [entry("T", "m1")] },
      ],
    });
    const details = out.filter((c) => c.kind === "double_booked").map((c) => c.detail);
    expect(details.join(" ")).toContain("12:00 AM");
    expect(details.join(" ")).toContain("12:00 PM");
  });

  it("does not flag a member in a Mass on a different date", () => {
    // Only same-day Masses are passed in, so a different date cannot reach this.
    const out = detectConflicts({
      entries: [entry("Crucifix", "m1", "Santos, Ana")],
      sameDayMasses: [],
    });
    expect(out.filter((c) => c.kind === "double_booked")).toEqual([]);
  });

  it("does not treat two guests as the same person", () => {
    // Free text has no id, so "John" appearing twice cannot be recognised as a clash.
    const out = detectConflicts({
      entries: [
        { position_label: "Crucifix", member_id: null, free_text: "John", memberName: null },
        { position_label: "Thurifer", member_id: null, free_text: "John", memberName: null },
      ],
    });
    expect(out).toEqual([]);
  });

  it("flags an assigned member who is no longer active", () => {
    const out = detectConflicts({
      entries: [entry("Crucifix", "m1", "Santos, Ana")],
      members: members(member("m1", "Santos, Ana", false)),
    });
    const inactive = out.filter((c) => c.kind === "inactive_member");
    expect(inactive).toHaveLength(1);
    expect(inactive[0].detail).toBe("Santos, Ana is no longer an active member.");
  });

  it("does not flag an active member as inactive", () => {
    const out = detectConflicts({
      entries: [entry("Crucifix", "m1", "Santos, Ana")],
      members: members(member("m1", "Santos, Ana", true)),
    });
    expect(out.filter((c) => c.kind === "inactive_member")).toEqual([]);
  });

  it("tolerates a member missing from the lookup", () => {
    // Copy can reference a member the sheet has not loaded; that is unknown, not inactive.
    const out = detectConflicts({ entries: [entry("Crucifix", "m1", "Santos, Ana")], members: members() });
    expect(out.filter((c) => c.kind === "inactive_member")).toEqual([]);
  });

  it("reports every kind together", () => {
    const out = detectConflicts({
      entries: [entry("Crucifix", "m1", "Santos, Ana"), entry("Thurifer", "m1", "Santos, Ana")],
      sameDayMasses: [
        { massId: "m2", massName: "Anticipated", entries: [entry("Crucifix", "m1")] },
      ],
      members: members(member("m1", "Santos, Ana", false)),
    });
    expect(new Set(out.map((c) => c.kind)).size).toBe(3);
  });

  it("treats serving and roster duty in one session as not a conflict", () => {
    // Spec LIT-3, stated as a rule so it is not "fixed" later.
    expect(isRosterOverlapAConflict()).toBe(false);
  });
});

describe("summariseConflicts", () => {
  it("says nothing when there are none", () => {
    expect(summariseConflicts([])).toBe("");
  });

  it("counts each kind", () => {
    const out = detectConflicts({
      entries: [entry("Crucifix", "m1", "Santos, Ana"), entry("Thurifer", "m1", "Santos, Ana")],
    });
    expect(summariseConflicts(out)).toBe("Check 1 at two positions in one Mass.");
  });

  it("lists several kinds in one sentence", () => {
    const out = detectConflicts({
      entries: [entry("Crucifix", "m1", "Santos, Ana"), entry("Thurifer", "m1", "Santos, Ana")],
      sameDayMasses: [{ massId: "m2", massName: "Anticipated", entries: [entry("Crucifix", "m1")] }],
    });
    const summary = summariseConflicts(out);
    expect(summary).toContain("one Mass");
    expect(summary).toContain("two Masses on this date");
  });
});

// ======================================================================================
// Copy
// ======================================================================================

describe("buildCopy", () => {
  const from = [
    { position_label: "Crucifix", member_id: "m1", free_text: null },
    { position_label: "Thurifer", member_id: "m2", free_text: null },
    { position_label: "Guest role", member_id: null, free_text: "John" },
  ];

  it("copies positions with their members", () => {
    const out = buildCopy({
      from,
      members: members(member("m1", "Santos, Ana"), member("m2", "Reyes, Ben")),
      includeMembers: true,
    });
    expect(out.rows).toHaveLength(3);
    expect(out.droppedInactive).toEqual([]);
  });

  it("copies positions only when members are not wanted", () => {
    const out = buildCopy({ from, members: members(), includeMembers: false });
    expect(out.rows.map((r) => r.position_label)).toEqual(["Crucifix", "Thurifer", "Guest role"]);
    expect(out.rows.every((r) => r.member_id === null)).toBe(true);
  });

  it("collapses a two-person position when copying positions only", () => {
    const out = buildCopy({
      from: [
        { position_label: "Candle 1", member_id: "m1", free_text: null },
        { position_label: "Candle 1", member_id: "m2", free_text: null },
      ],
      includeMembers: false,
    });
    expect(out.rows).toHaveLength(1);
  });

  it("drops an inactive member and says who", () => {
    const out = buildCopy({
      from,
      members: members(member("m1", "Santos, Ana", false), member("m2", "Reyes, Ben")),
      includeMembers: true,
    });
    expect(out.rows.some((r) => r.member_id === "m1")).toBe(false);
    expect(out.droppedInactive).toEqual(["Santos, Ana"]);
  });

  it("keeps an active member", () => {
    const out = buildCopy({
      from,
      members: members(member("m1", "Santos, Ana"), member("m2", "Reyes, Ben")),
      includeMembers: true,
    });
    expect(out.rows.some((r) => r.member_id === "m1")).toBe(true);
  });

  it("carries guests over as guests", () => {
    const out = buildCopy({ from, members: members(), includeMembers: true });
    const guest = out.rows.find((r) => r.position_label === "Guest role");
    expect(guest?.free_text).toBe("John");
  });

  it("collapses case-variant labels into one position", () => {
    const out = buildCopy({
      from: [
        { position_label: "Crucifix", member_id: "m1", free_text: null },
        { position_label: "crucifix", member_id: "m2", free_text: null },
      ],
      includeMembers: false,
    });
    expect(out.rows).toHaveLength(1);
  });

  it("returns nothing to copy for an empty source", () => {
    const out = buildCopy({ from: [], members: members(), includeMembers: true });
    expect(out.rows).toEqual([]);
    expect(NOTHING_TO_COPY).toMatch(/Nothing to copy/);
  });

  it("skips a row whose label is blank", () => {
    const out = buildCopy({
      from: [{ position_label: "  ", member_id: "m1", free_text: null }],
      includeMembers: false,
    });
    expect(out.rows).toEqual([]);
  });
});

describe("copyOutcomeMessage", () => {
  it("says nothing when nobody was dropped", () => {
    expect(copyOutcomeMessage([])).toBeNull();
  });

  it("names the dropped members", () => {
    expect(copyOutcomeMessage(["Santos, Ana"])).toContain("Santos, Ana");
  });

  it("uses the singular for one member", () => {
    expect(copyOutcomeMessage(["Santos, Ana"])).toContain("1 inactive member:");
  });

  it("pluralises for several", () => {
    expect(copyOutcomeMessage(["A", "B"])).toContain("2 inactive members:");
  });
});

// ======================================================================================
// Sorting
// ======================================================================================

describe("normaliseSortOrder", () => {
  it("numbers from zero without gaps", () => {
    const out = normaliseSortOrder(["a", "b", "c"]);
    expect(out.map((x) => x.sort_order)).toEqual([0, 1, 2]);
    expect(out.map((x) => x.row)).toEqual(["a", "b", "c"]);
  });

  it("renumbers identically for an unchanged list", () => {
    // Re-saving without reordering must not move anything.
    const rows = ["a", "b", "c"];
    expect(normaliseSortOrder(rows)).toEqual(normaliseSortOrder(rows));
  });

  it("handles an empty list", () => {
    expect(normaliseSortOrder([])).toEqual([]);
  });
});

describe("moveRow", () => {
  it("moves a row up", () => {
    expect(moveRow(["a", "b", "c"], 2, 1)).toEqual(["a", "c", "b"]);
  });

  it("moves a row down", () => {
    expect(moveRow(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
  });

  it("ignores a move out of range rather than throwing", () => {
    expect(moveRow(["a", "b"], 5, 0)).toEqual(["a", "b"]);
    expect(moveRow(["a", "b"], 0, 9)).toEqual(["a", "b"]);
    expect(moveRow(["a", "b"], -1, 0)).toEqual(["a", "b"]);
  });

  it("does not mutate the input", () => {
    const rows = ["a", "b", "c"];
    moveRow(rows, 0, 2);
    expect(rows).toEqual(["a", "b", "c"]);
  });

  it("is a no-op when the indices match", () => {
    expect(moveRow(["a", "b"], 1, 1)).toEqual(["a", "b"]);
  });
});

// ======================================================================================
// Templates
// ======================================================================================

describe("validateTemplateLabels", () => {
  it("accepts a normal lineup", () => {
    const out = validateTemplateLabels(["Crucifix", "Thurifer", "Candle 1"]);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.labels).toEqual(["Crucifix", "Thurifer", "Candle 1"]);
  });

  it("refuses an empty template", () => {
    const out = validateTemplateLabels([]);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.message).toMatch(/at least one position/);
  });

  it("refuses a template of only blanks", () => {
    expect(validateTemplateLabels(["", "   "]).ok).toBe(false);
  });

  it("refuses duplicate labels", () => {
    const out = validateTemplateLabels(["Crucifix", "Crucifix"]);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.message).toMatch(/twice/);
  });

  it("refuses duplicates that differ only in case", () => {
    expect(validateTemplateLabels(["Crucifix", "crucifix"]).ok).toBe(false);
  });

  it("refuses duplicates that differ only in spacing", () => {
    expect(validateTemplateLabels(["Candle 1", "Candle  1"]).ok).toBe(false);
  });

  it("normalises whitespace in what it accepts", () => {
    const out = validateTemplateLabels(["  Candle   1  "]);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.labels).toEqual(["Candle 1"]);
  });
});

describe("validateTemplateName", () => {
  it("accepts a name", () => {
    expect(validateTemplateName("Weekday")).toEqual({ ok: true, name: "Weekday" });
  });

  it("refuses a blank name", () => {
    expect(validateTemplateName("   ").ok).toBe(false);
  });

  it("trims and collapses", () => {
    expect(validateTemplateName("  Sunday   lineup ")).toEqual({ ok: true, name: "Sunday lineup" });
  });

  it("refuses an over-long name", () => {
    expect(validateTemplateName("x".repeat(61)).ok).toBe(false);
  });
});

// ======================================================================================
// Editor summary
// ======================================================================================

describe("countUnassigned", () => {
  it("counts a position with no people as unassigned", () => {
    const rows = [
      { position_label: "Crucifix", member_id: "m1", free_text: null },
      { position_label: "Thurifer", member_id: null, free_text: null },
    ];
    expect(countUnassigned(rows)).toEqual({ total: 2, unassigned: 1 });
  });

  it("counts a position filled by a guest as assigned", () => {
    const rows = [{ position_label: "Guest role", member_id: null, free_text: "John" }];
    expect(countUnassigned(rows).unassigned).toBe(0);
  });

  it("treats a whitespace-only guest as unassigned", () => {
    const rows = [{ position_label: "Guest role", member_id: null, free_text: "   " }];
    expect(countUnassigned(rows).unassigned).toBe(1);
  });

  it("counts by position, not by row", () => {
    // Two people on one position is one assigned position, however many rows it took.
    const rows = [
      { position_label: "Candle 1", member_id: "m1", free_text: null },
      { position_label: "Candle 1", member_id: "m2", free_text: null },
    ];
    expect(countUnassigned(rows)).toEqual({ total: 1, unassigned: 0 });
  });

  it("ignores blank labels entirely", () => {
    expect(countUnassigned([{ position_label: " ", member_id: null, free_text: null }])).toEqual({
      total: 0,
      unassigned: 0,
    });
  });
});

describe("unassignedSummary", () => {
  it("reports none when everything is filled", () => {
    expect(unassignedSummary({ total: 9, unassigned: 0 })).toBe("All 9 positions assigned.");
  });

  it("reads the way the spec's example does", () => {
    expect(unassignedSummary({ total: 9, unassigned: 2 })).toBe("2 of 9 positions unassigned.");
  });

  it("says so when there are no positions at all", () => {
    expect(unassignedSummary({ total: 0, unassigned: 0 })).toBe("No positions yet.");
  });
});