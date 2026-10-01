/**
 * Why a member was deactivated (module 03, MEM-3).
 *
 * Separate from the write helpers because the dialog that uses these is a client
 * component, and the helpers reach the Supabase client.
 */

export const DEACTIVATION_PRESETS = [
  "Moved away",
  "Aged out",
  "Left the group",
  "Other",
] as const;

export type DeactivationPreset = (typeof DEACTIVATION_PRESETS)[number];

export const DEACTIVATION_REASON_MAX = 200;

/** The preset always comes first so a note can never stand in for the reason. */
export function formatDeactivationReason(reason: string, note?: string | null): string {
  const clean = note?.trim();
  return (clean ? `${reason.trim()}: ${clean}` : reason.trim()).slice(
    0,
    DEACTIVATION_REASON_MAX,
  );
}
