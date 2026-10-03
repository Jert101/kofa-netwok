/**
 * RPT-3: why a report was sent back.
 *
 * Pure and separate from the route so the rules are testable without a super admin session.
 * The presets exist because "Wrong attendance" is a sentence people can pick but not one
 * they reliably retype, and a rejection the secretary cannot act on gets worked around by
 * not rejecting at all.
 */

export const REPORT_REJECT_PRESETS = [
  { id: "missing_sessions", label: "Missing sessions", hint: "A Mass in the month was left out." },
  { id: "wrong_attendance", label: "Wrong attendance", hint: "The marks do not match the roster." },
  { id: "other", label: "Other", hint: "Explain below." },
] as const;

export type ReportRejectPresetId = (typeof REPORT_REJECT_PRESETS)[number]["id"];

/**
 * Minimum note length.
 *
 * Five characters is a floor, not a target: "wrong", "n/a" and "fix" all fail, while
 * "Attendance for 17 May is wrong" passes. The point is that the secretary should not have
 * to come back and ask what was meant.
 */
export const REVIEW_NOTE_MIN = 5;

export type ReviewNoteResult =
  | { ok: true; note: string; preset: ReportRejectPresetId | null }
  | { ok: false; reason: "required" | "too_short" | "unknown_preset"; message: string };

export function validateReviewNote(input: {
  preset?: string | null;
  note?: string | null;
}): ReviewNoteResult {
  const rawPreset = (input.preset ?? "").trim();

  // Resolved to the declared preset object rather than kept as a string, so the narrowed
  // id and its label come from one place and cannot drift from REPORT_REJECT_PRESETS.
  const matched =
    rawPreset.length > 0
      ? (REPORT_REJECT_PRESETS.find((p) => p.id === rawPreset) ?? null)
      : null;

  if (rawPreset.length > 0 && !matched) {
    return {
      ok: false,
      reason: "unknown_preset",
      message: "Choose one of the listed reasons.",
    };
  }

  const preset = matched ? matched.id : null;
  const note = (input.note ?? "").trim();

  // "Other" is the escape hatch, so it is the one preset where free text is the whole answer
  // and a bare selection is not enough.
  if (matched?.id === "other" && note.length === 0) {
    return {
      ok: false,
      reason: "required",
      message: "Describe what needs fixing so the secretary knows what to change.",
    };
  }

  if (note.length > 0 && note.length < REVIEW_NOTE_MIN) {
    return {
      ok: false,
      reason: "too_short",
      message: `Give at least ${REVIEW_NOTE_MIN} characters so the reason is clear.`,
    };
  }

  if (note.length === 0) {
    // Preset chosen, no note: the preset label is the reason and is stored on its own.
    return { ok: true, note: matched!.label, preset };
  }

  return { ok: true, note, preset };
}

export function presetLabel(id: ReportRejectPresetId): string {
  return REPORT_REJECT_PRESETS.find((p) => p.id === id)?.label ?? "Other";
}

/** The sentence the secretary sees in the row and in the notification body. */
export function describeRejection(preset: string | null, note: string): string {
  const trimmed = note.trim();
  if (!trimmed) return "";
  const label = REPORT_REJECT_PRESETS.find((p) => p.id === preset)?.label;
  // When the note *is* just the preset label, showing "Wrong attendance — Wrong attendance"
  // helps nobody.
  if (label && trimmed.toLowerCase() === label.toLowerCase()) return label;
  return label ? `${label}: ${trimmed}` : trimmed;
}
