/**
 * Why an appeal was rejected (module 05, APL-5).
 *
 * Shaped like the registration reject reasons in features/registrations, and kept in its
 * own file for the same reason: the dialog is a client component, so it cannot import
 * from a module that reaches the Supabase client.
 *
 * Presets exist because a reviewer rejecting at 9pm on a Sunday should not have to
 * compose a sentence. The free-text note is there for the cases a preset cannot cover,
 * and "Other" is a real option rather than a fallback nobody picks.
 */

export const APPEAL_REJECT_PRESETS = [
  "Not on my records",
  "Duplicate",
  "Outside the window",
  "Other",
] as const;

export type AppealRejectPreset = (typeof APPEAL_REJECT_PRESETS)[number];

export const APPEAL_REJECT_REASON_MAX = 200;

/** APL-5: a reason is required. A bare rejection with no explanation is the bug. */
export type AppealRejectInput = {
  reason: string;
  note?: string | null;
};

/**
 * Joins preset and note into the one string stored on the item and read by the member.
 *
 * The preset always comes first, so a note cannot displace the reason and leave a
 * sentence with no explanation attached. "Other" is dropped from the front when it is
 * the preset, since "Other: the count was wrong" is worse than "the count was wrong".
 */
export function formatAppealRejectReason(input: AppealRejectInput): string | null {
  const reason = input.reason.trim();
  if (!reason) return null;

  const note = (input.note ?? "").trim();
  const head = reason === "Other" ? "" : reason;

  if (head && note) return `${head}: ${note}`.slice(0, APPEAL_REJECT_REASON_MAX);
  if (head) return head.slice(0, APPEAL_REJECT_REASON_MAX);
  if (note) return note.slice(0, APPEAL_REJECT_REASON_MAX);

  // "Other" with no note leaves nothing behind. Null rather than an empty string, so the
  // route can tell "no reason given" from a real one and refuse it: a rejection stored
  // with a blank reason is exactly the outcome APL-5 exists to prevent.
  return null;
}

/** The member's own words on an appeal (APL-1). Optional by design. */
export const APPEAL_NOTE_MAX = 200;

export function normalizeAppealNote(raw: string | null | undefined): string | null {
  const note = (raw ?? "").trim();
  return note.length ? note.slice(0, APPEAL_NOTE_MAX) : null;
}
