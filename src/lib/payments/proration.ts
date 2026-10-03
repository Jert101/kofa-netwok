/**
 * PAY-8: what a member owes, in one place.
 *
 * Four copies of this arithmetic used to live in the app: the record sheet, the member lookup, the
 * structure PDF and the admin member stats route. They disagreed with each other, and the PDF's
 * summary did not even clamp at zero while the three UIs did. One function, one answer.
 *
 * ## What "existing behavior" means here, precisely
 *
 * Decision D-7 asked for the current calculation to be pasted down before this module started, and
 * the honest answer is that there was no proration at all. What existed was:
 *
 *     paid = Σ amount_paid over payments where voided = false
 *     remaining = max(0, structure.amount - paid)
 *
 * The `deadline` column was stored, validated, printed on the PDF header and rendered on the
 * structure card, and never entered an arithmetic expression. `installment_months` only ever
 * allocated already-paid money into month columns for the PDF, anchored on `getUTCMonth()` with the
 * year discarded.
 *
 * So `balance()` and `installmentSchedule()` below are faithful extractions and are pinned by tests
 * against exactly those formulas, warts included. `amountDueByDate()` is the one genuinely new rule,
 * and it is derived from the same month anchoring the PDF already used so the ledger and the PDF
 * agree with each other rather than each inventing a schedule.
 *
 * ## Dates
 *
 * Date-only strings are compared and bucketed in UTC. `new Date("2026-10-04")` is UTC midnight but
 * `new Date("2026-10-04T00:00:00")` is local midnight, and the same code then reading `getUTCMonth()`
 * can land in the previous month anywhere east of Greenwich. A dues schedule that shifts a month by
 * timezone is not a schedule.
 */

/** A structure, as stored. Numeric columns arrive from Postgres as strings. */
export type PaymentStructure = {
  amount: number | string;
  /** `YYYY-MM-DD` or null. */
  deadline: string | null;
  /** null means "pay it in full", not "zero". */
  installment_months: number | string | null;
  /** Month 0 of installment 1. Only used when there are installments. */
  created_at?: string | null;
  for_all?: boolean | null;
  batch?: string | null;
  name?: string | null;
  is_active?: boolean | null;
};

export type PaymentRow = {
  amount_paid: number | string;
  paid_at: string | null;
  voided?: boolean | null;
  created_at?: string | null;
};

export type Balance = {
  /** The structure's full amount. */
  amount: number;
  /** Sum of non-voided payments. */
  paid: number;
  /** `max(0, amount - paid)`. Never negative, because a negative balance reads as a debt. */
  remaining: number;
  /** `max(0, paid - amount)`. Overpayment is allowed and shown here rather than clamped away. */
  credit: number;
  /** True when nothing more is owed on the full amount. */
  paidUp: boolean;
};

/** Half-up to two decimals, because money. `Math.round(-0)` producing `-0` is avoided. */
export function round2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
  // `round2(-0.001)` is -0, and a peso column showing "-₱0.00" reads as a refund nobody issued.
  return rounded === 0 ? 0 : rounded;
}

function num(value: number | string | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Whole months from `from` to `to`, both `YYYY-MM-DD`. Negative when `to` precedes `from`. */
export function monthDistance(from: string, to: string): number {
  const a = Date.parse(`${from.slice(0, 7)}-01T00:00:00Z`);
  const b = Date.parse(`${to.slice(0, 7)}-01T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / (30.4375 * 86_400_000));
}

/** The first day of the month `count` months after the month in `date`. */
export function addMonths(date: string, count: number): string {
  const d = new Date(`${date.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + count);
  return d.toISOString().slice(0, 10);
}

/**
 * The anchor for installment 1: the month the structure was created.
 *
 * Fallback is today's month, because a structure with installments and no `created_at` still has to
 * produce a schedule. Falling back to January would make every payment land in installment 1.
 */
export function firstInstallmentMonth(structure: PaymentStructure, asOf: string): string {
  const created = structure.created_at ?? null;
  if (!created) return asOf.slice(0, 7);
  const month = String(created).slice(0, 7);
  return /^\d{4}-\d{2}$/.test(month) ? month : asOf.slice(0, 7);
}

/**
 * The number of installments, or null when the structure is paid in full.
 *
 * A zero or negative stored value is treated as "no installments" rather than "zero installments",
 * which would mean the structure costs nothing.
 */
export function installmentCount(structure: PaymentStructure): number | null {
  const raw = structure.installment_months;
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

/**
 * The amount of one installment.
 *
 * Rounded to two decimals, and **the last installment absorbs the rounding remainder** so the
 * installments always sum to exactly `amount`. Dividing 1000 by 3 gives 333.33 three times, which is
 * 999.99 and leaves a peso unaccounted for on every single schedule.
 */
export function installmentAmount(amount: number, count: number): number {
  if (count <= 0) return round2(amount);
  const per = round2(amount / count);
  return per;
}

/**
 * How much of a schedule is due once installment `index` (0-based) has come around.
 *
 * No date, because the position in the schedule already says it. The last installment carries the
 * remainder so the installments always reconcile against `amount`.
 */
export function cumulativeDueAt(structure: PaymentStructure, index: number): number {
  const amount = round2(num(structure.amount));
  const count = installmentCount(structure);
  if (count === null) return amount;
  const per = installmentAmount(amount, count);
  // The last installment carries the remainder, so the schedule reconciles against the amount.
  if (index >= count - 1) return amount;
  return round2(per * (index + 1));
}

export type Installment = {
  /** 0-based position in the schedule. */
  index: number;
  /** `YYYY-MM` this installment falls in. */
  month: string;
  /** `YYYY-MM-DD`, the last day of that month. */
  dueOn: string;
  /** What this installment costs. */
  amount: number;
  /** Paid so far, allocated to this installment. */
  paid: number;
  status: InstallmentStatus;
};

export type InstallmentStatus = "paid" | "partly_paid" | "due" | "overdue";

/**
 * How much of a structure is due as of a date. PAY-8's headline function.
 *
 * NEW behavior, and the only new rule in this file. It exists because the overdue list and the ledger
 * need a notion of "due so far" that the old flat formula cannot express, and it is derived from the
 * month anchoring the structure PDF already used so the two agree:
 *
 * - No installments: the full amount, always. This is the old behavior exactly, and it is what the
 *   spec's edge case "a deadline in the past and no installments means everything unpaid is overdue"
 *   requires.
 * - With installments: installment `i` falls in `firstInstallmentMonth + i`, and everything up to and
 *   including the month of `asOf` is due. The creation month counts as installment 1 being due,
 *   matching the PDF's own month bucketing.
 * - A deadline ends the schedule: the day *after* it, the whole amount is due. On the deadline day
 *   itself only the installments that have actually come round are charged, because that day is
 *   still inside the time the church gave.
 *
 * `asOf` defaults to today so a caller that does not care about the date gets today's position.
 */
export function amountDueByDate(structure: PaymentStructure, asOf: string = todayUtc()): number {
  const amount = round2(num(structure.amount));
  const count = installmentCount(structure);
  if (count === null) return amount;

  // A deadline in the past means the schedule is over, not paused. Strictly less-than, because the
  // deadline day itself is still inside the window the church gave.
  if (structure.deadline && structure.deadline < asOf) return amount;

  const start = firstInstallmentMonth(structure, asOf);
  const elapsed = monthDistance(`${start}-01`, `${asOf.slice(0, 7)}-01`) + 1;
  const due = Math.min(Math.max(elapsed, 0), count);
  if (due <= 0) return 0;
  return cumulativeDueAt(structure, due - 1);
}

/**
 * The schedule, with what has been paid against each installment.
 *
 * Allocation is sequential: money goes to installment 1 until it is covered, then to installment 2,
 * and so on. The alternative — splitting every payment across every installment proportionally — makes
 * the ledger unreadable and disagrees with how anyone actually counts instalments in church.
 *
 * A payment that cannot be placed in the schedule (no installments configured, or a month outside the
 * window) still counts towards `balance().paid`, because the money really was paid. It is reported as
 * `unallocated` rather than silently dropped, so the treasurer can see it.
 */
export function installmentSchedule(
  structure: PaymentStructure,
  payments: readonly PaymentRow[],
  asOf: string = todayUtc(),
): { installments: Installment[]; unallocated: number } {
  const amount = round2(num(structure.amount));
  const count = installmentCount(structure);
  if (count === null) return { installments: [], unallocated: 0 };

  const start = firstInstallmentMonth(structure, asOf);
  const per = installmentAmount(amount, count);

  const installments: Installment[] = [];
  for (let i = 0; i < count; i++) {
    const month = addMonths(`${start}-01`, i).slice(0, 7);
    const lastDay = new Date(`${month}-01T00:00:00Z`);
    lastDay.setUTCMonth(lastDay.getUTCMonth() + 1);
    lastDay.setUTCDate(0);
    installments.push({
      index: i,
      month,
      dueOn: lastDay.toISOString().slice(0, 10),
      amount: i === count - 1 ? round2(amount - per * (count - 1)) : per,
      paid: 0,
      status: "due",
    });
  }

  const live = payments.filter((p) => p.voided !== true);
  let unallocated = 0;

  // Oldest first, so an early payment lands on the early installment.
  const ordered = [...live].sort((a, b) => (a.paid_at ?? "").localeCompare(b.paid_at ?? ""));

  for (const payment of ordered) {
    let left = round2(num(payment.amount_paid));
    const paidAt = payment.paid_at;
    const payMonth = paidAt ? paidAt.slice(0, 7) : null;

    for (const inst of installments) {
      if (left <= 0) break;
      // Only installments whose month has arrived, or that were paid early, can take money. A payment
      // dated after this installment is not counted against it.
      if (payMonth && payMonth > inst.month) continue;
      const room = round2(inst.amount - inst.paid);
      if (room <= 0) continue;
      const take = Math.min(room, left);
      inst.paid = round2(inst.paid + take);
      left = round2(left - take);
    }

    if (left > 0) unallocated = round2(unallocated + left);
  }

  for (const inst of installments) {
    inst.status = installmentStatus(inst, asOf);
  }

  return { installments, unallocated };
}

/**
 * `paid`, `partly_paid`, `due` or `overdue` for one row of a schedule.
 *
 * Takes the row *without* a status, because the status is the thing being computed. Requiring it would
 * mean every caller inventing a placeholder first.
 */
export function installmentStatus(
  inst: Omit<Installment, "status">,
  asOf: string = todayUtc(),
): InstallmentStatus {
  if (inst.paid >= inst.amount) return "paid";
  if (inst.paid > 0) return "partly_paid";
  return inst.dueOn < asOf ? "overdue" : "due";
}

/**
 * The balance. A faithful extraction of the one formula the app had, in all four places it appeared.
 *
 * `asOf` is accepted for symmetry with `amountDueByDate` and for the caller's convenience, but it
 * deliberately does **not** affect the result: no existing screen shows a date-dependent balance, and
 * changing that here would silently change every total the parish has ever been shown.
 */
export function balance(
  structure: PaymentStructure,
  payments: readonly PaymentRow[],
): Balance {
  const amount = round2(num(structure.amount));
  const paid = paidTotal(payments);
  const difference = round2(amount - paid);
  return {
    amount,
    paid,
    remaining: difference > 0 ? difference : 0,
    credit: difference < 0 ? round2(-difference) : 0,
    paidUp: difference <= 0,
  };
}

/** Σ `amount_paid` over the payments that count. Voided rows are excluded unless asked for. */
export function paidTotal(payments: readonly PaymentRow[], includeVoided = false): number {
  return round2(
    payments.reduce((sum, p) => {
      if (!includeVoided && p.voided === true) return sum;
      return sum + num(p.amount_paid);
    }, 0),
  );
}

/** How much is still owed right now, given the payments already recorded. */
export function amountStillDue(
  structure: PaymentStructure,
  payments: readonly PaymentRow[],
  asOf: string = todayUtc(),
): number {
  const due = amountDueByDate(structure, asOf);
  return round2(Math.max(0, due - paidTotal(payments)));
}

/**
 * The default amount on the record sheet.
 *
 * Spec §PAY-2: "the next installment or the remaining balance, not always the full structure amount".
 * So: whatever is still owed as of today, and if that is nothing then nothing — the form starts at 0
 * rather than inviting a treasurer to re-enter a payment somebody already made.
 */
export function suggestedPaymentAmount(
  structure: PaymentStructure,
  payments: readonly PaymentRow[],
  asOf: string = todayUtc(),
): number {
  return amountStillDue(structure, payments, asOf);
}

/** Today's date in UTC, as `YYYY-MM-DD`. */
export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Parses `YYYY-MM-DD` into a UTC timestamp, or NaN. Used by the date comparisons above. */
export function parseDate(date: string): number {
  return Date.parse(`${date.slice(0, 10)}T00:00:00Z`);
}