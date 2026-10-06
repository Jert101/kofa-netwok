import { describe, expect, it } from "vitest";

import {
  MAX_DRAFTS,
  activeMasses,
  announcementBody,
  announcementTitle,
  draftKey,
  endOfDayInstant,
  rosterLines,
  upsertDraft,
  validateDraft,
  type AssignmentDraft,
  type MassOption,
  type TemplateOption,
} from "./assign-batch";
import { BODY_MAX, TITLE_MAX } from "@/lib/announcements/audience";

const MANILA = "Asia/Manila";

const masses: MassOption[] = [
  { id: "m-high", name: "High Mass", is_active: true },
  { id: "m-solemn", name: "Solemn High Mass", is_active: false },
];

const templates: TemplateOption[] = [{ id: "t-sunday", name: "Sunday servers" }];

function draft(patch: Partial<AssignmentDraft> = {}): AssignmentDraft {
  return {
    session_date: "2026-10-11",
    mass_id: "m-high",
    template_id: "t-sunday",
    announce: false,
    announce_delete_at: "2026-10-11",
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

  it("rejects a draft with no template, because the template is what supplies the lineup", () => {
    expect(validateDraft(draft({ template_id: "" }), context)).toMatch(/template/i);
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

describe("MAX_DRAFTS", () => {
  it("is a season rather than a plan", () => {
    expect(MAX_DRAFTS).toBe(62);
  });
});