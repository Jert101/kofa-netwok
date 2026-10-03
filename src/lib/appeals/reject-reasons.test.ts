import { describe, expect, it } from "vitest";
import {
  APPEAL_NOTE_MAX,
  APPEAL_REJECT_PRESETS,
  APPEAL_REJECT_REASON_MAX,
  formatAppealRejectReason,
  normalizeAppealNote,
} from "./reject-reasons";

describe("formatAppealRejectReason", () => {
  it("keeps the preset on its own when there is no note", () => {
    expect(formatAppealRejectReason({ reason: "Duplicate" })).toBe("Duplicate");
  });

  it("joins preset and note", () => {
    expect(formatAppealRejectReason({ reason: "Not on my records", note: "She was at the 6am" })).toBe(
      "Not on my records: She was at the 6am",
    );
  });

  it("drops a leading Other so the member reads a reason, not a category", () => {
    expect(formatAppealRejectReason({ reason: "Other", note: "Count was wrong" })).toBe(
      "Count was wrong",
    );
  });

  it("returns null when there is nothing at all", () => {
    // The route refuses this before it reaches the database; a null here is the second
    // line of defence rather than a stored empty rejection.
    expect(formatAppealRejectReason({ reason: "   " })).toBeNull();
    expect(formatAppealRejectReason({ reason: "Other", note: "   " })).toBeNull();
  });

  it("trims surrounding whitespace", () => {
    expect(formatAppealRejectReason({ reason: "  Duplicate  ", note: "  same appeal  " })).toBe(
      "Duplicate: same appeal",
    );
  });

  it("caps the stored reason", () => {
    const long = formatAppealRejectReason({ reason: "Other", note: "x".repeat(500) });
    expect(long?.length).toBe(APPEAL_REJECT_REASON_MAX);
  });

  it("offers the four presets the spec asks for", () => {
    expect(APPEAL_REJECT_PRESETS).toEqual([
      "Not on my records",
      "Duplicate",
      "Outside the window",
      "Other",
    ]);
  });
});

describe("normalizeAppealNote", () => {
  it("keeps a real note", () => {
    expect(normalizeAppealNote("Served as thurifer")).toBe("Served as thurifer");
  });

  it("treats a blank note as absent", () => {
    // Optional by design: most members have nothing to add, and requiring it would just
    // discourage appealing at all.
    expect(normalizeAppealNote("")).toBeNull();
    expect(normalizeAppealNote("   ")).toBeNull();
    expect(normalizeAppealNote(null)).toBeNull();
    expect(normalizeAppealNote(undefined)).toBeNull();
  });

  it("caps the note", () => {
    expect(normalizeAppealNote("x".repeat(500))?.length).toBe(APPEAL_NOTE_MAX);
  });
});
