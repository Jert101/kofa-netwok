import { describe, expect, it } from "vitest";
import {
  addMonths,
  amountDueByDate,
  amountStillDue,
  balance,
  cumulativeDueAt,
  installmentAmount,
  installmentCount,
  installmentSchedule,
  installmentStatus,
  monthDistance,
  paidTotal,
  round2,
  suggestedPaymentAmount,
  type PaymentRow,
  type PaymentStructure,
} from "./proration";

function structure(over: Partial<PaymentStructure> = {}): PaymentStructure {
  return {
    amount: 1000,
    deadline: null,
    installment_months: null,
    created_at: "2026-01-10T09:00:00Z",
    for_all: true,
    batch: null,
    ...over,
  };
}

function payment(amount: number, paidAt: string, voided = false): PaymentRow {
  return { amount_paid: amount, paid_at: paidAt, voided };
}

// ======================================================================================
// round2
// ======================================================================================

describe("round2", () => {
  it("rounds to two decimals", () => {
    expect(round2(333.333)).toBe(333.33);
    expect(round2(333.335)).toBe(333.34);
  });

  it("never returns -0, which prints as a minus sign next to a peso", () => {
    expect(Object.is(round2(-0.001), -0)).toBe(false);
  });

  it("treats a non-finite input as zero rather than propagating NaN", () => {
    expect(round2(Number.NaN)).toBe(0);
    expect(round2(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

// ======================================================================================
// Date helpers
// ======================================================================================

describe("monthDistance", () => {
  it("is zero within the same month", () => {
    expect(monthDistance("2026-10-01", "2026-10-28")).toBe(0);
  });

  it("counts whole months across a year boundary", () => {
    expect(monthDistance("2026-11-15", "2027-02-03")).toBe(3);
  });

  it("is negative when the target is before the start", () => {
    expect(monthDistance("2026-10-01", "2026-07-01")).toBe(-3);
  });
});

describe("addMonths", () => {
  it("rolls over the year", () => {
    expect(addMonths("2026-11-01", 3)).toBe("2027-02-01");
  });

  it("is a no-op for zero", () => {
    expect(addMonths("2026-05-01", 0)).toBe("2026-05-01");
  });
});

// ======================================================================================
// balance: the one formula the app already had, pinned
// ======================================================================================

describe("balance", () => {
  it("is the full amount when nothing is paid", () => {
    expect(balance(structure(), [])).toEqual({
      amount: 1000,
      paid: 0,
      remaining: 1000,
      credit: 0,
      paidUp: false,
    });
  });

  it("subtracts payments from the amount", () => {
    const b = balance(structure(), [payment(400, "2026-01-05")]);
    expect(b.paid).toBe(400);
    expect(b.remaining).toBe(600);
    expect(b.paidUp).toBe(false);
  });

  it("excludes voided payments", () => {
    const b = balance(structure(), [payment(400, "2026-01-05"), payment(600, "2026-01-06", true)]);
    expect(b.paid).toBe(400);
    expect(b.remaining).toBe(600);
  });

  it("clamps remaining at zero and reports overpayment as credit", () => {
    // Spec §7: overpayment is allowed and shown as a credit on the ledger. It is not clamped away,
    // because a treasurer needs to see that the parish is holding this member's money.
    const b = balance(structure(), [payment(1250, "2026-01-05")]);
    expect(b.remaining).toBe(0);
    expect(b.credit).toBe(250);
    expect(b.paidUp).toBe(true);
  });

  it("reads NUMERIC strings from Postgres without breaking", () => {
    expect(balance(structure({ amount: "1000.00" }), [{ amount_paid: "250.50", paid_at: "2026-01-05" }]).paid).toBe(
      250.5,
    );
  });

  it("is exactly paid when the total matches", () => {
    const b = balance(structure(), [payment(1000, "2026-01-05")]);
    expect(b.remaining).toBe(0);
    expect(b.credit).toBe(0);
    expect(b.paidUp).toBe(true);
  });

  it("ignores the date entirely, because no screen ever showed a date-dependent balance", () => {
    // Deliberate. amountDueByDate is the date-aware function; changing this one would move every
    // number the parish has already been shown.
    const payments = [payment(100, "2026-01-05")];
    expect(balance(structure({ deadline: "2026-06-30" }), payments)).toEqual(
      balance(structure({ deadline: "2030-01-01" }), payments),
    );
  });
});

describe("paidTotal", () => {
  it("includes voided rows only when asked", () => {
    const rows = [payment(100, "2026-01-05"), payment(50, "2026-01-06", true)];
    expect(paidTotal(rows)).toBe(100);
    expect(paidTotal(rows, true)).toBe(150);
  });

  it("is zero for no payments", () => {
    expect(paidTotal([])).toBe(0);
  });
});

// ======================================================================================
// installmentCount
// ======================================================================================

describe("installmentCount", () => {
  it("is null when there are no installments", () => {
    expect(installmentCount(structure())).toBeNull();
  });

  it("reads a numeric string", () => {
    expect(installmentCount(structure({ installment_months: "4" }))).toBe(4);
  });

  it("treats zero and negative as 'pay in full', not as 'free'", () => {
    // Zero installments would mean the structure costs nothing, which is not what a stored 0 means.
    expect(installmentCount(structure({ installment_months: 0 }))).toBeNull();
    expect(installmentCount(structure({ installment_months: -2 }))).toBeNull();
  });
});

describe("installmentAmount", () => {
  it("divides the amount", () => {
    expect(installmentAmount(1200, 4)).toBe(300);
  });

  it("rounds to centavos", () => {
    expect(installmentAmount(1000, 3)).toBe(333.33);
  });
});

// ======================================================================================
// amountDueByDate: the one new rule
// ======================================================================================

describe("amountDueByDate", () => {
  it("is the full amount with no installments, whatever the date", () => {
    // The old behavior exactly. The deadline never reduced what was owed.
    expect(amountDueByDate(structure({ deadline: "2026-06-30" }), "2026-01-01")).toBe(1000);
    expect(amountDueByDate(structure({ deadline: null }), "2030-01-01")).toBe(1000);
  });

  it("owes the first installment in the month the structure was created", () => {
    const s = structure({ installment_months: 4 });
    expect(amountDueByDate(s, "2026-01-10")).toBe(250);
  });

  it("adds an installment each month", () => {
    const s = structure({ installment_months: 4 });
    expect(amountDueByDate(s, "2026-02-01")).toBe(500);
    expect(amountDueByDate(s, "2026-03-01")).toBe(750);
  });

  it("never exceeds the full amount, however late it is", () => {
    const s = structure({ installment_months: 4 });
    expect(amountDueByDate(s, "2026-09-01")).toBe(1000);
    expect(amountDueByDate(s, "2040-01-01")).toBe(1000);
  });

  it("owes nothing before the structure's month", () => {
    // asOf in the past relative to created_at. Possible when an admin backdates a structure.
    const s = structure({ installment_months: 4, created_at: "2026-06-10T00:00:00Z" });
    expect(amountDueByDate(s, "2026-03-01")).toBe(0);
  });

  it("owes everything once the deadline has passed", () => {
    const s = structure({ installment_months: 12, deadline: "2026-03-31" });
    expect(amountDueByDate(s, "2026-04-01")).toBe(1000);
  });

  it("keeps prorating on the deadline day itself", () => {
    // 249.99, not 250: 1000 over 12 is 83.33 a month and the last installment carries the odd cent,
    // so the running total drifts by centavos until it lands exactly on 1000. Reconstructing a clean
    // 250 here would mean the installments no longer sum to the amount.
    const s = structure({ installment_months: 12, deadline: "2026-03-31" });
    expect(amountDueByDate(s, "2026-03-31")).toBe(249.99);
    expect(amountDueByDate(s, "2026-03-30")).toBe(249.99);
  });

  it("lets the final installment close the gap exactly", () => {
    const s = structure({ amount: 1000, installment_months: 12 });
    expect(amountDueByDate(s, "2026-12-01")).toBe(1000);
  });

  it("anchors on today's month when created_at is missing", () => {
    const s = structure({ installment_months: 4, created_at: null });
    expect(amountDueByDate(s, "2026-02-10")).toBe(250);
  });

  it("makes the last installment absorb the rounding so the schedule reconciles", () => {
    // 1000 over 3: 333.33 x 3 is 999.99, a peso short on every instalment plan ever printed.
    const s = structure({ amount: 1000, installment_months: 3 });
    expect(cumulativeDueAt(s, 0)).toBe(333.33);
    expect(cumulativeDueAt(s, 1)).toBe(666.66);
    expect(cumulativeDueAt(s, 2)).toBe(1000);
  });
});

// ======================================================================================
// installmentSchedule
// ======================================================================================

describe("installmentSchedule", () => {
  const s = structure({ amount: 1200, installment_months: 4 });

  it("produces one row per installment, in month order", () => {
    const { installments } = installmentSchedule(s, [], "2026-01-15");
    expect(installments).toHaveLength(4);
    expect(installments.map((i) => i.month)).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
    ]);
  });

  it("is empty with no installments configured", () => {
    expect(installmentSchedule(structure(), [], "2026-01-15").installments).toEqual([]);
  });

  it("sums to exactly the structure amount, rounding included", () => {
    const { installments } = installmentSchedule(
      structure({ amount: 1000, installment_months: 3 }),
      [],
      "2026-01-15",
    );
    expect(installments.reduce((n, i) => n + i.amount, 0)).toBe(1000);
  });

  it("allocates an early payment to the earliest installment first", () => {
    const { installments } = installmentSchedule(s, [payment(400, "2026-01-05")], "2026-04-01");
    expect(installments[0].status).toBe("paid");
    expect(installments[1].paid).toBe(100);
    expect(installments[1].status).toBe("partly_paid");
    expect(installments[2].paid).toBe(0);
  });

  it("spreads two payments across the schedule in date order", () => {
    const { installments } = installmentSchedule(
      s,
      [payment(300, "2026-01-05"), payment(500, "2026-02-05")],
      "2026-04-01",
    );
    expect(installments.map((i) => i.paid)).toEqual([300, 300, 200, 0]);
    expect(installments[0].status).toBe("paid");
    expect(installments[1].status).toBe("paid");
    expect(installments[2].status).toBe("partly_paid");
  });

  it("ignores a voided payment entirely", () => {
    const { installments, unallocated } = installmentSchedule(
      s,
      [payment(400, "2026-01-05", true)],
      "2026-04-01",
    );
    expect(installments.every((i) => i.paid === 0)).toBe(true);
    expect(unallocated).toBe(0);
  });

  it("reports a payment it cannot place rather than dropping it", () => {
    // Money with no home in the schedule still counts towards balance().paid, so it has to be
    // visible somewhere or the treasurer sees a paid row and an unpaid schedule.
    const { unallocated } = installmentSchedule(s, [payment(9999, "2026-01-05")], "2026-04-01");
    expect(unallocated).toBe(9999 - 1200);
  });

  it("does not count a payment against an installment that had not come round yet", () => {
    // Paying in February for April's instalment is a prepayment, not an April payment.
    const { installments, unallocated } = installmentSchedule(s, [payment(300, "2026-01-20")], "2026-01-25");
    expect(installments[0].paid).toBe(300);
    expect(unallocated).toBe(0);
  });

  it("marks an untouched past installment overdue", () => {
    // Measured on 1 March: January and February have closed unpaid, March has not.
    const { installments } = installmentSchedule(s, [], "2026-03-01");
    expect(installments[0].status).toBe("overdue");
    expect(installments[1].status).toBe("overdue");
    expect(installments[2].status).toBe("due");
    expect(installments[3].status).toBe("due");
  });

  it("does not call an installment overdue before its month closes", () => {
    // The 15th is still inside February. Marking it overdue a fortnight early is the kind of thing
    // that makes a treasurer stop trusting the column.
    const { installments } = installmentSchedule(s, [], "2026-02-15");
    expect(installments[1].status).toBe("due");
    expect(installments[0].status).toBe("overdue");
  });
});

describe("installmentStatus", () => {
  const base = {
    index: 0,
    month: "2026-01",
    dueOn: "2026-01-31",
    amount: 300,
    paid: 0,
  };

  it("is paid when the amount is covered", () => {
    expect(installmentStatus({ ...base, paid: 300 }, "2026-02-01")).toBe("paid");
  });

  it("is partly_paid when some money is in", () => {
    expect(installmentStatus({ ...base, paid: 100 }, "2026-02-01")).toBe("partly_paid");
  });

  it("is due on the day it is charged, inclusive", () => {
    expect(installmentStatus(base, "2026-01-31")).toBe("due");
  });

  it("is overdue the day after", () => {
    expect(installmentStatus(base, "2026-02-01")).toBe("overdue");
  });

  it("is partly_paid rather than overdue once any money is in", () => {
    // "Overdue but partly paid" is true but is not something a treasurer needs to be told; the
    // money being partly there is the more useful fact, and the ledger shows the date anyway.
    expect(installmentStatus({ ...base, paid: 1 }, "2026-06-01")).toBe("partly_paid");
  });
});

// ======================================================================================
// What the record sheet should default to
// ======================================================================================

describe("amountStillDue", () => {
  it("is the whole amount when nothing is paid", () => {
    expect(amountStillDue(structure(), [], "2026-01-15")).toBe(1000);
  });

  it("is the next installment once the first is paid", () => {
    const s = structure({ amount: 1200, installment_months: 4 });
    expect(amountStillDue(s, [payment(300, "2026-01-05")], "2026-02-10")).toBe(300);
  });

  it("is never negative", () => {
    expect(amountStillDue(structure(), [payment(5000, "2026-01-05")], "2026-01-15")).toBe(0);
  });
});

describe("suggestedPaymentAmount", () => {
  it("is zero for a fully paid structure, so the form does not invite a second payment", () => {
    expect(suggestedPaymentAmount(structure(), [payment(1000, "2026-01-05")], "2026-01-15")).toBe(0);
  });

  it("is the remaining balance on a pay-in-full structure", () => {
    expect(suggestedPaymentAmount(structure(), [payment(250, "2026-01-05")], "2026-01-15")).toBe(750);
  });

  it("ignores a voided payment when working out what is still owed", () => {
    const b = [payment(1000, "2026-01-05", true)];
    expect(suggestedPaymentAmount(structure(), b, "2026-01-15")).toBe(1000);
  });
});