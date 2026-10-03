import { describe, it, expect } from "vitest";
import {
  validateReviewNote,
  describeRejection,
  presetLabel,
  REVIEW_NOTE_MIN,
  REPORT_REJECT_PRESETS,
} from "./review-reasons";

describe("validateReviewNote", () => {
  it("accepts a preset with no note and stores the label", () => {
    const r = validateReviewNote({ preset: "wrong_attendance", note: null });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.note).toBe("Wrong attendance");
    expect(r.preset).toBe("wrong_attendance");
  });

  it("accepts a preset plus a longer note", () => {
    const r = validateReviewNote({
      preset: "missing_sessions",
      note: "The 17 May second Mass was not included",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.note).toBe("The 17 May second Mass was not included");
    expect(r.preset).toBe("missing_sessions");
  });

  it("requires free text when the preset is Other", () => {
    const blank = validateReviewNote({ preset: "other", note: "" });
    expect(blank.ok).toBe(false);
    if (blank.ok) return;
    expect(blank.reason).toBe("required");

    const spaces = validateReviewNote({ preset: "other", note: "    " });
    expect(spaces.ok).toBe(false);
  });

  it("rejects a note under the minimum length", () => {
    const r = validateReviewNote({ preset: "wrong_attendance", note: "no" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("too_short");
    expect(r.message).toContain(String(REVIEW_NOTE_MIN));
  });

  it("rejects the short non-answers the minimum exists to catch", () => {
    // Blank is excluded on purpose: a blank note alongside a chosen preset is valid,
    // because the preset is itself the reason. Only a *partial* note is too short to be one.
    for (const note of ["n/a", "fix", "no", "x", "nope"]) {
      expect(validateReviewNote({ preset: "wrong_attendance", note }).ok).toBe(false);
    }
  });

  it("accepts a note exactly at the minimum length", () => {
    expect(validateReviewNote({ preset: "wrong_attendance", note: "wrong!" }).ok).toBe(true);
  });

  it("counts the trimmed length, so padding cannot sneak a short note through", () => {
    const r = validateReviewNote({ preset: "wrong_attendance", note: "  no  " });
    expect(r.ok).toBe(false);
  });

  it("rejects a preset that is not one of the listed ones", () => {
    const r = validateReviewNote({ preset: "because_i_said_so", note: "a long enough note" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("unknown_preset");
  });

  it("accepts a free-text reason with no preset", () => {
    const r = validateReviewNote({ note: "Attendance for the 24th looks wrong" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.preset).toBeNull();
    expect(r.note).toBe("Attendance for the 24th looks wrong");
  });

  it("trims the stored note", () => {
    const r = validateReviewNote({ note: "   padded reason   " });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.note).toBe("padded reason");
  });
});

describe("describeRejection", () => {
  it("prefixes the preset label when there is extra detail", () => {
    expect(describeRejection("missing_sessions", "The 17 May Mass was left out")).toBe(
      "Missing sessions: The 17 May Mass was left out",
    );
  });

  it("does not repeat the label when the note is just the label", () => {
    expect(describeRejection("wrong_attendance", "Wrong attendance")).toBe("Wrong attendance");
  });

  it("matches the label case-insensitively", () => {
    expect(describeRejection("wrong_attendance", "wrong attendance")).toBe("Wrong attendance");
  });

  it("returns the note alone when there is no preset", () => {
    expect(describeRejection(null, "Just a note")).toBe("Just a note");
  });

  it("returns an empty string for an empty note", () => {
    expect(describeRejection("wrong_attendance", "   ")).toBe("");
  });
});

describe("presetLabel", () => {
  it("resolves every declared preset", () => {
    for (const p of REPORT_REJECT_PRESETS) {
      expect(presetLabel(p.id)).toBe(p.label);
    }
  });

  it("falls back for an unknown id", () => {
    expect(presetLabel("nope" as never)).toBe("Other");
  });
});
