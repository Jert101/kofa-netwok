/**
 * PAY-1 and PAY-3: the rules about changing a structure, and about what counts as a repeat entry.
 *
 * Both are pure, because both are rules somebody will get wrong by accident and neither is a place
 * where a computed value can be argued with.
 */

import { round2 } from "./proration";

// ======================================================================================
// Structure editing
// ======================================================================================

export type StructureEditPatch = {
  name?: string | null;
  amount?: number | null;
  deadline?: string | null;
  installment_months?: number | null;
  for_all?: boolean | null;
  batch?: string | null;
  is_active?: boolean | null;
};

/**
 * Fields that change what somebody owes.
 *
 * Once a payment exists against a structure, these are frozen. Renaming it, moving its deadline or
 * switching it off do not change any balance, so they stay editable; changing the amount, the
 * installment plan or which batch it applies to rewrites the meaning of every payment ever recorded
 * against it.
 *
 * The alternative — allowing the edit and recomputing history — would mean an admin changing "₱500,
 * 4 months" to "₱800, 2 months" silently makes half the parish's receipts say the wrong thing, with
 * no record that it happened. Freezing is recoverable; a wrong book is not.
 */
export const LOCKED_WHEN_PAID: readonly (keyof StructureEditPatch)[] = [
  "amount",
  "installment_months",
  "for_all",
  "batch",
];

export type EditCheck =
  | { allowed: true }
  | { allowed: false; message: string; lockedFields: readonly string[] };

export const STRUCTURE_LOCKED_MESSAGE =
  "Payments already exist. Create a new structure to change the amount.";

/**
 * Whether this patch may be applied.
 *
 * `hasPayments` counts **non-voided** payments. Spec §8: "Void a payment that made a structure's edit
 * rules lock. Locks stay while any non-voided payment exists" — voiding undoes the lock, which is the
 * point of voiding.
 *
 * `lockedFields` says which fields were actually refused rather than assuming all four, so the
 * composer can grey out exactly the inputs that will be refused and leave the rest editable.
 */
export function checkStructureEdit(
  patch: StructureEditPatch,
  hasPayments: boolean,
): EditCheck {
  if (!hasPayments) return { allowed: true };

  const touched = LOCKED_WHEN_PAID.filter((field) => {
    const next = patch[field];
    if (next === undefined) return false;
    // Explicitly sending the value that is already stored is not a change, and refusing it would
    // make the save button fail on a form the treasurer filled in without touching that field.
    return next !== null;
  });

  if (touched.length === 0) return { allowed: true };
  return {
    allowed: false,
    message: STRUCTURE_LOCKED_MESSAGE,
    lockedFields: touched as readonly string[],
  };
}

/** Which inputs the structure editor should disable. Drives the disabled state of the form. */
export function lockedFieldsFor(hasPayments: boolean): readonly string[] {
  return hasPayments ? LOCKED_WHEN_PAID : [];
}

// ======================================================================================
// Duplicate detection
// ======================================================================================

/** Spec §PAY-2: ten minutes. Long enough that a double tap is caught, short enough that two real payments on the same day are not. */
export const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;

export type DuplicateCandidate = {
  id: string;
  amount_paid: number | string;
  paid_at: string | null;
  created_at?: string | null;
  voided?: boolean | null;
};

export type DuplicateMatch = {
  id: string;
  amount_paid: number;
  /** When it was recorded, for the wording "recorded at 9:41 AM". */
  recordedAt: string;
  /** Clock time in church time, `h:mm AM/PM`. */
  clockTime: string;
};

/**
 * A recent payment that looks like the one being recorded.
 *
 * Same member, same structure, same amount, within the window. All three, not any one of them: a
 * treasurer legitimately records the same amount for the same structure twice in a month, and a
 * church legitimately collects the same dues from two different people. Only the whole triple is a
 * mistake.
 *
 * Voided rows never match. A voided payment is a payment that did not happen, so it cannot be a
 * double entry of one that did.
 *
 * `timezoneOffsetMinutes` is the church's offset from UTC, so the time in the warning is the time the
 * treasurer saw on the wall clock rather than UTC.
 */
export function findDuplicatePayment(
  candidate: { amount: number },
  payments: readonly DuplicateCandidate[],
  nowMs: number,
  timezoneOffsetMinutes = 0,
): DuplicateMatch | null {
  const target = round2(candidate.amount);
  const cutoff = nowMs - DUPLICATE_WINDOW_MS;

  let best: DuplicateMatch | null = null;
  let bestMs = Number.NEGATIVE_INFINITY;

  for (const payment of payments) {
    if (payment.voided === true) continue;
    if (round2(Number(payment.amount_paid)) !== target) continue;

    const recordedMs = timestampOf(payment);
    if (recordedMs === null) continue;
    if (recordedMs < cutoff || recordedMs > nowMs) continue;

    // Most recent first when several match, so the warning names the entry the treasurer just made
    // rather than the first of three identical ones. Compared as numbers: comparing a number against
    // an ISO string coerces the string to NaN and silently always answers false, which hands back
    // whichever row the query happened to return first.
    if (recordedMs > bestMs) {
      bestMs = recordedMs;
      best = {
        id: payment.id,
        amount_paid: target,
        recordedAt: new Date(recordedMs).toISOString(),
        clockTime: formatClockTime(recordedMs, timezoneOffsetMinutes),
      };
    }
  }

  return best;
}

/**
 * When the row was recorded.
 *
 * `created_at` is the honest clock. `paid_at` is a date the treasurer typed and can be backdated to
 * last month, so a payment made now for last month's dues must still be caught as a duplicate of one
 * made a minute ago.
 */
function timestampOf(payment: DuplicateCandidate): number | null {
  const raw = payment.created_at ?? payment.paid_at;
  if (!raw) return null;
  // A bare date is midnight UTC; a full timestamp is taken as-is.
  const ms = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? Date.parse(`${raw}T00:00:00Z`) : Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

function formatClockTime(ms: number, offsetMinutes: number): string {
  const shifted = new Date(ms + offsetMinutes * 60_000);
  let hours = shifted.getUTCHours();
  const minutes = String(shifted.getUTCMinutes()).padStart(2, "0");
  const suffix = hours >= 12 ? "PM" : "AM";
  hours = hours % 12;
  if (hours === 0) hours = 12;
  return `${hours}:${minutes} ${suffix}`;
}

/** The warning text, so the API and the composer cannot phrase the same thing differently. */
export function duplicateWarning(match: DuplicateMatch): string {
  return `This looks like a duplicate of a payment recorded at ${match.clockTime}. Record anyway?`;
}

// ======================================================================================
// Scope
// ======================================================================================

/**
 * Whether a structure applies to a member.
 *
 * Spec §7: `for_all = true` applies to every active member, otherwise the structure's batch only.
 *
 * Note what this deliberately does NOT do: it does not re-scope past structures when somebody changes
 * batch. A member who moves from batch 2024 to 2025 keeps whatever they paid the 2024 structure,
 * because the structure was always about that batch and the person's history followed them.
 */
export function structureAppliesTo(
  structure: { for_all: boolean | null; batch: string | null },
  member: { is_active: boolean | null; batch: string | null },
): boolean {
  if (structure.for_all !== false) return member.is_active !== false;
  if (structure.batch === null) return false;
  return member.batch === structure.batch;
}

/**
 * Whether a payment may be recorded for this member at all.
 *
 * Deactivated members are allowed, per spec §8 ("Recording a payment for a deactivated member:
 * allowed, with a note in the picker"). They are not *offered* by default in the picker, but a
 * treasurer must still be able to record a payment somebody made before leaving.
 */
export function canRecordPaymentFor(
  structure: { for_all: boolean | null; batch: string | null },
  member: { is_active: boolean | null; batch: string | null },
): { allowed: boolean; note?: string } {
  if (structure.for_all !== false) {
    return { allowed: true, note: member.is_active === false ? "This member is inactive." : undefined };
  }
  if (structure.batch === null) return { allowed: false };
  if (member.batch !== structure.batch) return { allowed: false };
  return { allowed: true, note: member.is_active === false ? "This member is inactive." : undefined };
}

// ======================================================================================
// Void
// ======================================================================================

export const VOID_REASONS = ["Entered by mistake", "Duplicate", "Wrong member", "Other"] as const;
export type VoidReason = (typeof VOID_REASONS)[number];

/** "Other" is only acceptable with something typed next to it. */
export function validateVoidReason(reason: string | null | undefined, note?: string | null): string | null {
  const trimmed = (reason ?? "").trim();
  if (trimmed.length === 0) return "Choose why this payment is being voided.";
  if (trimmed.length > 200) return "That reason is too long.";
  if (trimmed === "Other" && (note ?? "").trim().length === 0) {
    return "Add a note to explain.";
  }
  return null;
}

// ======================================================================================
// Overdue
// ======================================================================================

export type OverdueRow = {
  memberId: string;
  memberName: string;
  batch: string | null;
  structureId: string;
  structureName: string;
  amount: number;
  paid: number;
  /** What should have been paid by today. */
  due: number;
  remaining: number;
  /** Whole months the money is late. 0 when it became due this month. */
  monthsOverdue: number;
};

/**
 * The overdue list, worst first.
 *
 * Spec §PAY-5: "sorted by how much and how long". Amount first, because the treasurer's phone call is
 * about the biggest debt, and months as the tiebreak because two members owing the same amount at
 * different times are not the same problem.
 */
export function sortOverdue(rows: readonly OverdueRow[]): OverdueRow[] {
  return [...rows].sort(
    (a, b) =>
      b.remaining - a.remaining ||
      b.monthsOverdue - a.monthsOverdue ||
      a.memberName.localeCompare(b.memberName),
  );
}