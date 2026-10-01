/**
 * Why an application was rejected (module 03, REG-5).
 *
 * Kept apart from the server decision logic because the reject dialog is a client
 * component: importing these from a module that reaches the Supabase client would
 * drag node:crypto into the browser bundle.
 */

export const REJECT_PRESETS = [
  "Incomplete details",
  "Not eligible",
  "Duplicate application",
  "Other",
] as const;

export type RejectPreset = (typeof REJECT_PRESETS)[number];

export const REJECT_REASON_MAX = 200;

export type RejectInput = {
  /** One of REJECT_PRESETS, or a custom reason when the preset is "Other". */
  reason: string;
  note?: string | null;
};

/**
 * Joins a preset and its note into the single string stored on the row and shown
 * to the applicant. Always starts with the preset, so a note can never replace
 * the reason and leave a bare sentence.
 */
export function formatRejectReason(input: RejectInput): string | null {
  const reason = input.reason.trim();
  if (!reason) return null;
  const note = (input.note ?? "").trim();
  const text = note ? `${reason}: ${note}` : reason;
  return text.slice(0, REJECT_REASON_MAX);
}
