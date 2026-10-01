export const MIN_PIN_LENGTH = 4;
export const MAX_PIN_LENGTH = 12;

/** PINs that are too guessable to accept, even though they pass the digit check. */
const COMMON_PINS = new Set([
  "1111",
  "2222",
  "3333",
  "4444",
  "5555",
  "6666",
  "7777",
  "8888",
  "9999",
  "0000",
  "1010",
  "1122",
  "1212",
  "1234",
  "2345",
  "3456",
  "4567",
  "5678",
  "6789",
  "7890",
  "0123",
  "0123456789",
  "9876543210",
  "2000",
  "2001",
  "2002",
]);

export type PinRuleCode =
  | "PIN_REQUIRED"
  | "PIN_LENGTH"
  | "PIN_DIGITS_ONLY"
  | "PIN_REPEATED"
  | "PIN_SEQUENTIAL"
  | "PIN_TOO_COMMON"
  | "PIN_IN_USE"
  | "PIN_MISMATCH";

export type PinRuleResult = { ok: true } | { ok: false; code: PinRuleCode; message: string };

const MESSAGES: Record<PinRuleCode, string> = {
  PIN_REQUIRED: "Enter a PIN.",
  PIN_LENGTH: `PIN must be ${MIN_PIN_LENGTH} to ${MAX_PIN_LENGTH} characters.`,
  PIN_DIGITS_ONLY: "Use digits only.",
  PIN_REPEATED: "Avoid repeated digits, for example 0000 or 1111.",
  PIN_SEQUENTIAL: "Avoid sequential digits, for example 1234 or 4321.",
  PIN_TOO_COMMON: "That PIN is too easy to guess. Choose a less common one.",
  PIN_IN_USE: "This PIN is already used by another role. Choose a different one.",
  PIN_MISMATCH: "The two PINs do not match.",
};

const fail = (code: PinRuleCode): PinRuleResult => ({ ok: false, code, message: MESSAGES[code] });

function hasRun(digits: string, length: number, step: 1 | -1): boolean {
  for (let i = 0; i + length <= digits.length; i++) {
    let ok = true;
    for (let j = 1; j < length; j++) {
      if (Number(digits[i + j]) - Number(digits[i + j - 1]) !== step) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

function isSingleRepeatedDigit(digits: string): boolean {
  return digits.length >= 4 && new Set(digits).size === 1;
}

/**
 * Validates a PIN being set. Pure: no hashing, no database, no I/O. Uniqueness
 * against other roles is checked separately by the caller with bcrypt compares.
 */
export function checkPin(pin: string): PinRuleResult {
  const value = pin.trim();
  if (value.length === 0) return fail("PIN_REQUIRED");
  if (value.length < MIN_PIN_LENGTH || value.length > MAX_PIN_LENGTH) return fail("PIN_LENGTH");
  if (!/^\d+$/.test(value)) return fail("PIN_DIGITS_ONLY");

  if (isSingleRepeatedDigit(value)) return fail("PIN_REPEATED");
  if (hasRun(value, 4, 1)) return fail("PIN_SEQUENTIAL");
  if (hasRun(value, 4, -1)) return fail("PIN_SEQUENTIAL");
  if (COMMON_PINS.has(value)) return fail("PIN_TOO_COMMON");

  return { ok: true };
}

export function checkPinConfirmation(pin: string, confirm: string): PinRuleResult {
  if (pin.trim() !== confirm.trim()) return fail("PIN_MISMATCH");
  return { ok: true };
}

/**
 * AUTH-7: clearing the super admin PIN is refused while reports await approval,
 * because nobody would be able to approve them afterwards.
 */
export function canClearSuperAdminPin(pendingReportCount: number): PinRuleResult {
  if (pendingReportCount > 0) {
    return {
      ok: false,
      code: "PIN_IN_USE",
      message: `Resolve the ${pendingReportCount} pending report${
        pendingReportCount === 1 ? "" : "s"
      } before turning approval off.`,
    };
  }
  return { ok: true };
}

/** The PIN every fresh install ships with, used for the default-PIN banner. */
export const DEFAULT_PIN = "1234";
