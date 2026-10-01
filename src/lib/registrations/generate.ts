/**
 * Reference code generation. Server only: this is the one file that touches
 * node:crypto, so it must not be imported by anything the browser bundles.
 */

import { randomInt } from "node:crypto";
import { REFERENCE_ALPHABET, REFERENCE_CODE_LENGTH } from "./reference-code";

/**
 * Generates one code.
 *
 * `randomInt` is used rather than `Math.random` so codes cannot be predicted from
 * timing. With 31^8 combinations a clash is not realistic, but the unique index
 * would reject one and losing someone's application over it is not acceptable, so
 * the insert is retried by the caller.
 */
export function generateReferenceCode(length: number = REFERENCE_CODE_LENGTH): string {
  const size = Math.max(4, Math.min(length, 16));
  let code = "";
  for (let i = 0; i < size; i += 1) {
    code += REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)];
  }
  return code;
}

/**
 * A caller-supplied source of indexes, for tests that need a deterministic
 * sequence. Kept next to the generator so the two cannot drift apart.
 */
export function generateReferenceCodeWith(
  pick: () => number,
  length: number = REFERENCE_CODE_LENGTH,
): string {
  const size = Math.max(4, Math.min(length, 16));
  let code = "";
  for (let i = 0; i < size; i += 1) {
    const index = Math.abs(Math.trunc(pick())) % REFERENCE_ALPHABET.length;
    code += REFERENCE_ALPHABET[index];
  }
  return code;
}
