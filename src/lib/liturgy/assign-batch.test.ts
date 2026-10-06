import { describe, expect, it } from "vitest";

import {
  MAX_DRAFTS,
  LIST_MAX_DAYS,
  activeMasses,
  announcementBody,
  announcementTitle,
  draftDemand,
  draftFilled,
  draftKey,
  draftSlots,
  draftUnassigned,
  endOfDayInstant,
  listWindow,
  rosterLines,
  seedRowsFromTemplate,
  upsertDraft,
  validateDraft,
  type AssignmentDraft,
  type DraftRow,
  type MassOption,
  type TemplateOption,
} from "./assign-batch";
import { BODY_MAX, TITLE_MAX } from "@/lib/announcements/audience";
import { daysBetween, shiftDays } from "@/lib/time/church-time";

const MANILA = "Asia/Manila";

const masses: MassOption[] = [
  { id: "m-high", name: "High Mass", is_active: true },
  { id: "m-solemn", name: "Solemn High Mass", is_active: false },
];

const templates: TemplateOption[] = [{ id: "t-sunday", name: "Sunday servers" }];

/** A position, optionally with the given servers on it. */
function row(patch: Partial<DraftRow> = {}): DraftRow {
  return {
    key: `k-${Math.random()}`,
    position_label: "Thurifer",
    members: [{ member_id: "m1", member_name: "Ana Reyes" }],
    required_gender: "any",
    ...patch,
  };
}

/** One position with `slots` server slots, the first `filled` of them holding a member. */
function position(label: string, slots: number, filled = slots, prefix = "m"): DraftRow {
  return {
    key: `k-${label}-${slots}-${prefix}-${Math.random()}`,
    position_label: label,
    members: Array.from({ length: slots }, (_, i) => ({
      member_id: i < filled ? `${prefix}${i + 1}` : "",
      member_name: i < filled ? `${prefix} name ${i + 1}` : "",
    })),
    required_gender: "any",
  };
}

function draft(patch: Partial<AssignmentDraft> = {}): AssignmentDraft {
  return {
    session_date: "2026-10-11",
    mass_id: "m-high",
    template_id: "t-sunday",
    announce: false,
    announce_delete_at: "2026-10-11",
    rows: [row()],
    ...patch,
  };
}

describe("activeMasses", () => {
  it("keeps only the Masses the parish has switched on", () => {
    expect(activeMasses(masses).map((m) => m.id)).toEqual(["m-high"]);
  });

  it("does not treat a Mass with no flag as active", () => {
    // Defaulting to true would put an unknown Mass in the picker, which is the same as no filter.
    expect(activeMasses([{ id: "x", name: "Unknown" }])).toEqual([]);
  });

  it("is empty rather than throwing when there are no Masses at all", () => {
    expect(activeMasses([])).toEqual([]);
  });
});

describe("validateDraft", () => {
  const context = { masses, templates };

  it("accepts a complete draft", () => {
    expect(validateDraft(draft(), context)).toBeNull();
  });

  it("rejects a missing date rather than writing it", () => {
    expect(validateDraft(draft({ session_date: "" }), context)).toMatch(/date/i);
  });

  it("rejects a date that only looks like one", () => {
    expect(validateDraft(draft({ session_date: "2026-02-31" }), context)).toMatch(/date/i);
  });

  it("rejects a Mass that is not in the list", () => {
    expect(validateDraft(draft({ mass_id: "nope" }), context)).toMatch(/Mass/i);
  });

  it("rejects an inactive Mass, and says which one", () => {
    const problem = validateDraft(draft({ mass_id: "m-solemn" }), context);
    expect(problem).toContain("Solemn High Mass");
  });

  it("rejects a draft with no positions at all", () => {
    expect(validateDraft(draft({ rows: [] }), context)).toMatch(/position/i);
    // A row with a blank name is not a position, and writing it would store an empty label.
    expect(validateDraft(draft({ rows: [row({ position_label: "  " })] }), context)).toMatch(/position/i);
  });

  it("allows no template, because it is a shortcut and not a requirement", () => {
    // Required while the draw was the only way to get somebody on a position, which meant a saved
    // roster -- which does not remember where it came from -- could not be opened for correction.
    expect(validateDraft(draft({ template_id: "" }), context)).toBeNull();
  });

  it("rejects a template that has been deleted since it was chosen", () => {
    expect(validateDraft(draft({ template_id: "t-gone" }), context)).toMatch(/no longer exists/i);
  });

  it("allows positions the officer typed even with no template", () => {
    expect(
      validateDraft(draft({ template_id: "", rows: [row({ position_label: "Candle 1" })] }), context),
    ).toBeNull();
  });

  it("allows a missing delete date when the draft is not announced", () => {
    expect(validateDraft(draft({ announce: false, announce_delete_at: "" }), context)).toBeNull();
  });

  it("requires a delete date once announcing is on", () => {
    expect(validateDraft(draft({ announce: true, announce_delete_at: "" }), context)).toMatch(
      /removed/i,
    );
  });

  it("refuses an announcement that would vanish before the Mass it announces", () => {
    const problem = validateDraft(
      draft({ announce: true, announce_delete_at: "2026-10-04" }),
      context,
    );
    expect(problem).toMatch(/before the Mass/i);
  });

  it("accepts an announcement removed on the day of the Mass itself", () => {
    expect(
      validateDraft(draft({ announce: true, announce_delete_at: "2026-10-11" }), context),
    ).toBeNull();
  });

  it("runs against whatever lists the caller has", () => {
    expect(
      validateDraft(draft({ mass_id: "other" }), {
        masses: [{ id: "other", name: "Other", is_active: true }],
        templates,
      }),
    ).toBeNull();
  });
});

describe("endOfDayInstant", () => {
  it("is the last instant of that day in the church's timezone", () => {
    // 23:59:59.999 on 11 Oct in Manila is 15:59:59.999 UTC.
    expect(endOfDayInstant("2026-10-11", MANILA)).toBe("2026-10-11T15:59:59.999Z");
  });

  it("keeps a UTC church on UTC", () => {
    expect(endOfDayInstant("2026-10-11", "UTC")).toBe("2026-10-11T23:59:59.999Z");
  });

  it("puts the instant after the start of the day, so the post is readable all day", () => {
    const instant = Date.parse(endOfDayInstant("2026-10-11", MANILA));
    const startOfManilaDay = Date.parse("2026-10-10T16:00:00Z");
    expect(instant).toBeGreaterThan(startOfManilaDay);
  });

  it("moves with the parish's timezone setting", () => {
    expect(endOfDayInstant("2026-10-11", "America/New_York")).not.toBe(
      endOfDayInstant("2026-10-11", MANILA),
    );
  });

  it("falls back to Manila rather than throwing on a zone that does not exist", () => {
    expect(endOfDayInstant("2026-10-11", "Not/AZone")).toBe(endOfDayInstant("2026-10-11", MANILA));
  });

  it("lands on the right side of a daylight-saving transition", () => {
    // 8 March 2026 is the day New York springs forward. Reading the offset once, at the UTC instant
    // for 23:59:59, gives EST (-5) because that instant is still the evening of the 8th locally --
    // which would put the answer at 14:59 local, four hours early. The second pass re-reads at the
    // instant the first produced and lands on EDT (-4): 23:59:59 on the 8th.
    expect(endOfDayInstant("2026-03-08", "America/New_York")).toBe("2026-03-09T03:59:59.999Z");
  });
});

describe("rosterLines", () => {
  it("reads as position then name, one line each", () => {
    expect(
      rosterLines([
        { position_label: "Thurifer", member_name: "Ana Reyes" },
        { position_label: "Cantor", member_name: "Ben Cruz" },
      ]),
    ).toEqual(["Thurifer: Ana Reyes", "Cantor: Ben Cruz"]);
  });

  it("says so when a position has nobody rather than printing a blank", () => {
    expect(rosterLines([{ position_label: "Crucifix", member_name: null }])).toEqual([
      "Crucifix: not filled",
    ]);
  });

  it("treats a name of only spaces as unfilled", () => {
    expect(rosterLines([{ position_label: "Crucifix", member_name: "   " }])[0]).toContain(
      "not filled",
    );
  });

  it("puts everybody on one position on the same line", () => {
    // "Crucifix: Ana" then "Crucifix: Ben" reads as two positions the officer mistyped. This is the
    // case the multi-server position exists for, so it is also the case the parish has to read right.
    expect(
      rosterLines([
        { position_label: "Crucifix", member_name: "Ana Reyes" },
        { position_label: "Crucifix", member_name: "Ben Cruz" },
      ]),
    ).toEqual(["Crucifix: Ana Reyes, Ben Cruz"]);
  });

  it("puts three on one position on one line", () => {
    expect(
      rosterLines([
        { position_label: "Candle", member_name: "Ana" },
        { position_label: "Candle", member_name: "Ben" },
        { position_label: "Candle", member_name: "Cora" },
      ]),
    ).toEqual(["Candle: Ana, Ben, Cora"]);
  });

  it("keeps first-seen order when a label comes back later", () => {
    expect(
      rosterLines([
        { position_label: "Thurifer", member_name: "Ana" },
        { position_label: "Crucifix", member_name: "Ben" },
        { position_label: "Thurifer", member_name: "Cora" },
      ]),
    ).toEqual(["Thurifer: Ana, Cora", "Crucifix: Ben"]);
  });

  it("says so inside the group when one of them is unfilled", () => {
    expect(
      rosterLines([
        { position_label: "Crucifix", member_name: "Ana" },
        { position_label: "Crucifix", member_name: null },
      ]),
    ).toEqual(["Crucifix: Ana, not filled"]);
  });

  it("skips a slot with no label at all", () => {
    expect(rosterLines([{ position_label: "   ", member_name: "Ana" }])).toEqual([]);
  });
});

describe("announcementTitle", () => {
  it("names the Mass and the day", () => {
    expect(announcementTitle("High Mass", "11 Oct 2026")).toBe("Servers · High Mass · 11 Oct 2026");
  });

  it("cannot exceed the column", () => {
    expect(announcementTitle("x".repeat(200), "11 Oct 2026")).toHaveLength(TITLE_MAX);
  });
});

describe("announcementBody", () => {
  it("leads with the heading and lists the roster", () => {
    expect(announcementBody("High Mass · 11 Oct 2026", ["Thurifer: Ana Reyes"])).toBe(
      "High Mass · 11 Oct 2026\n\nThurifer: Ana Reyes",
    );
  });

  it("is just the heading when nobody is assigned", () => {
    expect(announcementBody("High Mass · 11 Oct 2026", [])).toBe("High Mass · 11 Oct 2026");
  });

  it("drops whole lines and says how many, rather than failing to save", () => {
    const body = announcementBody("Head", Array.from({ length: 200 }, (_, i) => `Position ${i}: Somebody Longname`));
    expect(body.length).toBeLessThanOrEqual(BODY_MAX + 60);
    expect(body).toMatch(/…and \d+ more positions\./);
  });

  it("counts a single omission in the singular", () => {
    // Derived rather than hard-coded: `cost` is a 90-character line plus the newline that joins it,
    // and one more line than fits is exactly one omission.
    const cost = 91;
    const fits = Math.floor((BODY_MAX - "Head".length) / cost);
    const lines = Array.from({ length: fits + 1 }, () => "N".repeat(90));
    expect(announcementBody("Head", lines)).toMatch(/…and 1 more position\./);
  });
});

describe("upsertDraft", () => {
  it("appends a new date and Mass", () => {
    const result = upsertDraft([draft()], draft({ session_date: "2026-10-18" }));
    expect(result.drafts).toHaveLength(2);
    expect(result.replaced).toBe(false);
  });

  it("replaces rather than stacking the same date and Mass", () => {
    const result = upsertDraft(
      [draft(), draft({ session_date: "2026-10-18" })],
      draft({ template_id: "t-other" }),
    );
    expect(result.drafts).toHaveLength(2);
    expect(result.replaced).toBe(true);
  });

  it("keys on the date and Mass, so two Masses on one Sunday are both kept", () => {
    const result = upsertDraft([draft()], draft({ mass_id: "m-other" }));
    expect(result.drafts).toHaveLength(2);
  });

  it("does not mutate the list it was given", () => {
    const original = [draft()];
    upsertDraft(original, draft({ mass_id: "m-other" }));
    expect(original).toHaveLength(1);
  });

  it("keys the same way everywhere", () => {
    expect(draftKey(draft())).toBe("2026-10-11|m-high");
  });
});

describe("seedRowsFromTemplate", () => {
  const template = [
    { position_label: "Thurifer", required_gender: "female" as const },
    { position_label: "Cantor", required_gender: "any" as const },
  ];

  it("brings in every position the template names", () => {
    const rows = seedRowsFromTemplate([], template);
    expect(rows.map((r) => r.position_label)).toEqual(["Thurifer", "Cantor"]);
    expect(rows[0].required_gender).toBe("female");
  });

  it("leaves an existing row exactly as it is, servers included", () => {
    // The rule that stops picking a template from silently un-booking somebody.
    const mine = [
      row({ position_label: "Thurifer", members: [{ member_id: "m9", member_name: "Ben Cruz" }] }),
    ];
    const rows = seedRowsFromTemplate(mine, template);
    expect(rows).toHaveLength(2);
    expect(rows[0].members).toEqual([{ member_id: "m9", member_name: "Ben Cruz" }]);
  });

  it("leaves a two-server position with both of its servers", () => {
    const mine = [position("Thurifer", 2, 2, "x")];
    const rows = seedRowsFromTemplate(mine, template);
    expect(rows[0].members).toHaveLength(2);
  });

  it("matches a position regardless of case or stray spaces", () => {
    const mine = [row({ position_label: "  thurifer " })];
    const rows = seedRowsFromTemplate(mine, template);
    expect(rows).toHaveLength(2);
  });

  it("still adds the template positions the sheet does not have yet", () => {
    const rows = seedRowsFromTemplate([row({ position_label: "Extra" })], template);
    expect(rows.map((r) => r.position_label)).toEqual(["Extra", "Thurifer", "Cantor"]);
  });

  it("adds nothing for a template that repeats a position", () => {
    const rows = seedRowsFromTemplate([], [
      { position_label: "Crucifix", required_gender: "any" },
      { position_label: "crucifix", required_gender: "any" },
    ]);
    expect(rows).toHaveLength(1);
  });

  it("skips a blank position rather than adding an empty row", () => {
    expect(seedRowsFromTemplate([], [{ position_label: "   ", required_gender: "any" }])).toEqual([]);
  });

  it("does not mutate the rows it was given", () => {
    const mine = [row({ position_label: "Thurifer" })];
    seedRowsFromTemplate(mine, template);
    expect(mine).toHaveLength(1);
  });
});

describe("draftSlots", () => {
  it("writes one row per person and drops the empty slots", () => {
    const slots = draftSlots(draft({ rows: [position("Thurifer", 1), position("Cantor", 1, 0)] }));
    expect(slots).toEqual([{ position_label: "Thurifer", member_id: "m1" }]);
  });

  it("writes two rows for a position that has two servers", () => {
    // The feature: one label, two people, two stored rows.
    const slots = draftSlots(draft({ rows: [position("Crucifix", 2, 2)] }));
    expect(slots).toEqual([
      { position_label: "Crucifix", member_id: "m1" },
      { position_label: "Crucifix", member_id: "m2" },
    ]);
  });

  it("writes only the filled slot of a half-filled two-server position", () => {
    const slots = draftSlots(draft({ rows: [position("Crucifix", 2, 1)] }));
    expect(slots).toEqual([{ position_label: "Crucifix", member_id: "m1" }]);
  });

  it("keeps the order the officer arranged, across positions", () => {
    const slots = draftSlots(
      draft({ rows: [position("Thurifer", 1, 1, "a"), position("Crucifix", 2, 2, "b")] }),
    );
    expect(slots.map((s) => `${s.position_label}/${s.member_id}`)).toEqual([
      "Thurifer/a1",
      "Crucifix/b1",
      "Crucifix/b2",
    ]);
  });

  it("trims the label and drops a position whose name is only spaces", () => {
    const slots = draftSlots(
      draft({ rows: [row({ position_label: "  Thurifer  " }), position("   ", 1, 1, "z")] }),
    );
    expect(slots).toEqual([{ position_label: "Thurifer", member_id: "m1" }]);
  });

  it("is empty for a draft with nothing on it, which the save refuses", () => {
    expect(draftSlots(draft({ rows: [position("Thurifer", 1, 0)] }))).toEqual([]);
  });
});

describe("draftUnassigned, draftFilled and draftDemand", () => {
  it("count server slots, not positions", () => {
    const d = draft({ rows: [position("Thurifer", 1, 1), position("Cantor", 1, 0)] });
    expect(draftFilled(d)).toBe(1);
    expect(draftUnassigned(d)).toBe(1);
    expect(draftDemand(d)).toBe(2);
  });

  it("reports one short for a half-filled two-server position, not the whole position", () => {
    // Saying "Crucifix is unfilled" when one of its two servers is on the roster is how an officer
    // ends up putting a third person there.
    const d = draft({ rows: [position("Crucifix", 2, 1)] });
    expect(draftUnassigned(d)).toBe(1);
    expect(draftDemand(d)).toBe(2);
  });

  it("does not count a blank position as an unfilled slot", () => {
    const d = draft({ rows: [position("Thurifer", 1, 0), position("", 1, 0, "z")] });
    expect(draftUnassigned(d)).toBe(1);
    expect(draftDemand(d)).toBe(1);
  });
});

describe("MAX_DRAFTS", () => {
  it("is a season rather than a plan", () => {
    expect(MAX_DRAFTS).toBe(62);
  });
});

describe("listWindow", () => {
  const today = "2026-10-11";
  const soon = "2027-01-08";

  it("uses what it is given when both ends are dates", () => {
    expect(listWindow("2026-11-01", "2026-12-01", today, soon)).toEqual({
      from: "2026-11-01",
      to: "2026-12-01",
    });
  });

  it("falls back per end rather than discarding the one that worked", () => {
    expect(listWindow("2026-11-01", null, today, soon)).toEqual({ from: "2026-11-01", to: soon });
    expect(listWindow(null, "2026-12-01", today, soon)).toEqual({ from: today, to: "2026-12-01" });
  });

  it("recovers from a date field that was left empty", () => {
    // What a screen with no date in it sends, not a mistake anybody made on purpose.
    expect(listWindow("", "", today, soon)).toEqual({ from: today, to: soon });
    expect(listWindow(null, null, today, soon)).toEqual({ from: today, to: soon });
  });

  it("recovers from a date that only looks like one", () => {
    expect(listWindow("not-a-date", "2026-13-40", today, soon)).toEqual({ from: today, to: soon });
  });

  it("puts the ends the right way round rather than returning an empty range", () => {
    expect(listWindow("2026-12-01", "2026-11-01", today, soon)).toEqual({
      from: "2026-11-01",
      to: "2026-12-01",
    });
  });

  it("keeps an end that is after the window rather than swapping it in", () => {
    // Measured back from the far end, which is the direction the officer asked for: they want the
    // near future, so a request that reaches a year out is shortened from the start, not the end.
    const far = "2027-10-01";
    expect(listWindow(far, null, today, soon)).toEqual({
      from: shiftDays(far, -LIST_MAX_DAYS),
      to: far,
    });
  });

  it("caps an absurd request rather than reading the parish's whole history", () => {
    const win = listWindow("2000-01-01", null, today, soon);
    expect(daysBetween(win.from, win.to)).toBeLessThanOrEqual(LIST_MAX_DAYS);
  });
});