/**
 * Reference codes for public registration (module 03, REG-3).
 *
 * The applicant reads or copies this code to check the outcome, so it must survive
 * being written down: 0/O and 1/I are omitted because they are the characters people
 * most often mistype, and a mistyped code would silently show "not found".
 *
 * This file has no imports on purpose. The status form is a client component and
 * needs the constants and the validation below; generation lives in
 * `generate.ts` because it uses node:crypto, which cannot be bundled for a browser.
 */

/** 31 characters: no 0, O, 1 or I. */
export const REFERENCE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export const REFERENCE_CODE_LENGTH = 8;

/** Every character here must be unambiguous to read aloud or transcribe. */
const FORBIDDEN = new Set(["0", "O", "1", "I", "o", "i"]);

export function hasAmbiguousCharacter(code: string): boolean {
  for (const ch of code) {
    if (FORBIDDEN.has(ch)) return true;
  }
  return false;
}

/**
 * Normalizes what a person types into the status form: case and any separators they
 * added on their own are forgiven.
 *
 * This does not try to guess at mistyped characters. A code is only ever 8 characters
 * from one alphabet, so a wrong guess would turn a typo into a silent "not found".
 * An ambiguous character is reported as a format problem instead, which reveals
 * nothing about which codes exist.
 */
export function normalizeReferenceCodeInput(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Why a typed code cannot be looked up, or null when it is worth querying.
 *
 * - too short or too long: the applicant can be told the expected length
 * - contains 0/O/1/I: those are never issued, so this is a transcription slip
 * - contains a character outside the alphabet: not a real code shape
 */
export function describeReferenceCodeProblem(
  code: string,
): "length" | "ambiguous" | "character" | null {
  if (code.length !== REFERENCE_CODE_LENGTH) return "length";
  if (hasAmbiguousCharacter(code)) return "ambiguous";
  if (![...code].every((ch) => REFERENCE_ALPHABET.includes(ch))) return "character";
  return null;
}

export function isWellFormedReferenceCode(code: string): boolean {
  return (
    code.length === REFERENCE_CODE_LENGTH &&
    hasAmbiguousCharacter(code) === false &&
    [...code].every((ch) => REFERENCE_ALPHABET.includes(ch))
  );
}
