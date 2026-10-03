/**
 * PAY-4: one member's whole position, across every structure that applies to them.
 *
 * Server-side because it needs four tables at once. The arithmetic itself is not here: `proration.ts`
 * owns it and this file only gathers rows and hands them over, so the numbers on the ledger and the
 * numbers on the record sheet come from the same function or they disagree.
 */

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { formatNameLastFirst } from "@/lib/members/name-format";
import { getSetting } from "@/lib/settings/store";
import {
  amountDueByDate,
  balance,
  installmentCount,
  installmentSchedule,
  monthDistance,
  paidTotal,
  round2,
  type Installment,
  type PaymentRow,
  type PaymentStructure,
} from "@/lib/payments/proration";
import { sortOverdue, structureAppliesTo, type OverdueRow } from "@/lib/payments/rules";
import { churchToday } from "@/lib/time/church-time";

type StructureRow = PaymentStructure & {
  id: string;
  name: string;
  for_all: boolean | null;
  batch: string | null;
  is_active: boolean | null;
};

export type LedgerBlock = {
  structureId: string;
  structureName: string;
  isActive: boolean;
  forAll: boolean;
  batch: string | null;
  deadline: string | null;
  installmentMonths: number | null;
  amount: number;
  paid: number;
  /** Still owed against the full amount. */
  remaining: number;
  /** Money held on account. */
  credit: number;
  paidUp: boolean;
  /** What should have been paid by today. */
  dueToDate: number;
  /** `dueToDate - paid`, floored at zero. */
  outstanding: number;
  installments: Installment[];
  /** Money paid that fits no installment. Surfaced rather than hidden. */
  unallocated: number;
  /** True when this structure is scoped to a batch the member is no longer in. */
  outOfScope: boolean;
};

export type LedgerPayment = {
  id: string;
  amountPaid: number;
  paidAt: string | null;
  notes: string | null;
  voided: boolean;
  voidReason: string | null;
  voidNote: string | null;
  voidedAt: string | null;
  voidedByRole: string | null;
  recordedByRole: string | null;
  structureId: string;
  structureName: string;
};

export type MemberLedger = {
  memberId: string;
  fullName: string;
  batch: string | null;
  isActive: boolean;
  asOf: string;
  blocks: LedgerBlock[];
  payments: LedgerPayment[];
  totals: {
    /** Everything owed against full amounts, across applicable structures. */
    outstanding: number;
    /** Money held on account. */
    credit: number;
    /** Collected against this member, live payments only. */
    paidToDate: number;
  };
};

/**
 * The ledger for one member.
 *
 * `asOf` defaults to today in church time, not in server time, because "how much do they still owe"
 * is a question about the parish's calendar.
 */
export async function fetchMemberLedger(
  memberId: string,
  asOf?: string,
  options: { includeVoided?: boolean } = {},
): Promise<MemberLedger | null> {
  const sb = getSupabaseAdmin();
  const today = asOf ?? churchToday(await getSetting("report_timezone"));

  const { data: member, error: memberError } = await sb
    .from("members")
    .select("id, full_name, batch, is_active")
    .eq("id", memberId)
    .maybeSingle();

  if (memberError || !member) return null;

  const [structuresResult, paymentsResult] = await Promise.all([
    sb
      .from("payment_structures")
      .select("id, name, amount, deadline, installment_months, created_at, for_all, batch, is_active"),
    sb
      .from("payments")
      .select(
        "id, member_id, payment_structure_id, amount_paid, paid_at, notes, voided, void_reason, void_note, voided_at, voided_by_role, created_by, created_at",
      )
      .eq("member_id", memberId)
      .order("paid_at", { ascending: false, nullsFirst: false }),
  ]);

  if (structuresResult.error) throw new Error(`structures: ${structuresResult.error.message}`);
  if (paymentsResult.error) throw new Error(`payments: ${paymentsResult.error.message}`);

  const structures = (structuresResult.data ?? []) as StructureRow[];
  const payments = (paymentsResult.data ?? []) as Array<
    PaymentRow & {
      id: string;
      member_id: string;
      payment_structure_id: string;
      notes: string | null;
      void_reason: string | null;
      void_note: string | null;
      voided_at: string | null;
      voided_by_role: string | null;
      created_by: string | null;
    }
  >;

  const byStructure = new Map<string, typeof payments>();
  for (const payment of payments) {
    const list = byStructure.get(payment.payment_structure_id);
    if (list) list.push(payment);
    else byStructure.set(payment.payment_structure_id, [payment]);
  }

  const memberMeta = {
    is_active: (member.is_active as boolean | null) ?? null,
    batch: (member.batch as string | null) ?? null,
  };

  const blocks: LedgerBlock[] = structures.map((structure) => {
    const rows = byStructure.get(structure.id) ?? [];
    const b = balance(structure, rows);
    const dueToDate = amountDueByDate(structure, today);
    const schedule = installmentSchedule(structure, rows, today);

    return {
      structureId: structure.id,
      structureName: structure.name,
      isActive: structure.is_active !== false,
      forAll: structure.for_all !== false,
      batch: structure.batch,
      deadline: structure.deadline,
      installmentMonths:
        structure.installment_months === null ? null : Number(structure.installment_months),
      amount: b.amount,
      paid: b.paid,
      remaining: b.remaining,
      credit: b.credit,
      paidUp: b.paidUp,
      dueToDate,
      outstanding: round2(Math.max(0, dueToDate - b.paid)),
      installments: schedule.installments,
      unallocated: schedule.unallocated,
      outOfScope: !structureAppliesTo(structure, memberMeta),
    };
  });

  // Structures this member actually owes come first, and among those, the ones with money outstanding.
  // A deactivated structure nobody is chasing should not sit above an unpaid one.
  blocks.sort((a, b) => {
    if (a.outOfScope !== b.outOfScope) return a.outOfScope ? 1 : -1;
    if (a.outstanding > 0 !== b.outstanding > 0) return a.outstanding > 0 ? -1 : 1;
    return a.structureName.localeCompare(b.structureName);
  });

  const ledgerPayments: LedgerPayment[] = payments
    .filter((p) => options.includeVoided || p.voided !== true)
    .map((p) => ({
      id: p.id,
      amountPaid: round2(Number(p.amount_paid)),
      paidAt: p.paid_at,
      notes: p.notes,
      voided: p.voided === true,
      voidReason: p.void_reason,
      voidNote: p.void_note,
      voidedAt: p.voided_at,
      voidedByRole: p.voided_by_role,
      recordedByRole: p.created_by,
      structureId: p.payment_structure_id,
      structureName: structures.find((s) => s.id === p.payment_structure_id)?.name ?? "Unknown",
    }));

  return {
    memberId: String(member.id),
    fullName: formatNameLastFirst(String(member.full_name ?? "")),
    batch: memberMeta.batch,
    isActive: memberMeta.is_active !== false,
    asOf: today,
    blocks,
    payments: ledgerPayments,
    totals: {
      outstanding: round2(blocks.reduce((n, b) => n + (b.outOfScope ? 0 : b.outstanding), 0)),
      credit: round2(blocks.reduce((n, b) => n + b.credit, 0)),
      paidToDate: paidTotal(payments),
    },
  };
}

// ======================================================================================
// Overdue and summary
// ======================================================================================

/**
 * Everybody who should be paying a structure and is not.
 *
 * One query for every structure in scope rather than one query per structure, because a treasurer
 * opening the overdue list with eight structures live would otherwise wait for eight round trips
 * before the page rendered anything.
 */
export async function fetchOverdue(options: {
  structureId?: string;
  batch?: string;
  asOf?: string;
}): Promise<OverdueRow[]> {
  const sb = getSupabaseAdmin();
  const today = options.asOf ?? churchToday(await getSetting("report_timezone"));

  let structureQuery = sb
    .from("payment_structures")
    .select("id, name, amount, deadline, installment_months, created_at, for_all, batch, is_active");
  if (options.structureId) structureQuery = structureQuery.eq("id", options.structureId);
  const structures = ((await structureQuery).data ?? []) as StructureRow[];
  if (structures.length === 0) return [];

  const structureIds = structures.map((s) => s.id);

  const [membersResult, paymentsResult] = await Promise.all([
    sb.from("members").select("id, full_name, batch, is_active").eq("is_active", true),
    sb
      .from("payments")
      .select("member_id, payment_structure_id, amount_paid, paid_at, voided")
      .in("payment_structure_id", structureIds)
      .eq("voided", false),
  ]);

  const members = membersResult.data ?? [];
  const payments = paymentsResult.data ?? [];

  let candidateMembers = members;
  if (options.batch) candidateMembers = candidateMembers.filter((m) => m.batch === options.batch);

  const paidByPair = new Map<string, PaymentRow[]>();
  for (const payment of payments) {
    const key = `${payment.payment_structure_id}:${payment.member_id}`;
    const list = paidByPair.get(key);
    const row: PaymentRow = {
      amount_paid: payment.amount_paid,
      paid_at: payment.paid_at,
      voided: payment.voided,
    };
    if (list) list.push(row);
    else paidByPair.set(key, [row]);
  }

  const rows: OverdueRow[] = [];

  for (const member of candidateMembers) {
    const memberBatch = (member.batch as string | null) ?? null;
    const memberActive = (member.is_active as boolean | null) ?? null;

    for (const structure of structures) {
      const applies = structureAppliesTo(structure, { is_active: memberActive, batch: memberBatch });
      if (!applies) continue;

      const memberPayments = paidByPair.get(`${structure.id}:${member.id}`) ?? [];
      const b = balance(structure, memberPayments);
      const due = amountDueByDate(structure, today);
      const outstanding = round2(Math.max(0, due - b.paid));
      if (outstanding <= 0) continue;

      rows.push({
        memberId: String(member.id),
        memberName: formatNameLastFirst(String(member.full_name ?? "")),
        batch: memberBatch,
        structureId: structure.id,
        structureName: structure.name,
        amount: b.amount,
        paid: b.paid,
        due,
        remaining: outstanding,
        monthsOverdue: monthsBehind(structure, memberPayments, today),
      });
    }
  }

  return sortOverdue(rows);
}

/**
 * How many whole months late this member is on this structure.
 *
 * For an installment plan the answer is about the *first unpaid installment*, not about today. A member
 * who paid January and February and has not paid since is three months behind from March, and telling
 * the treasurer they are zero months behind because the count is measured from now would put them at
 * the wrong end of the phone-call list.
 *
 * For a pay-in-full structure there is no installment, so the deadline is the only thing that can say
 * how late. With no deadline either, the money has been outstanding for an unknown time and 0 is the
 * honest answer rather than a fabricated one.
 */
function monthsBehind(structure: PaymentStructure, payments: readonly PaymentRow[], today: string): number {
  const thisMonth = `${today.slice(0, 7)}-01`;

  if (installmentCount(structure) !== null) {
    const { installments } = installmentSchedule(structure, payments, today);
    const firstUnpaid = installments.find((i) => i.paid < i.amount);
    if (!firstUnpaid) return 0;
    return Math.max(0, monthDistance(`${firstUnpaid.month}-01`, thisMonth));
  }

  if (structure.deadline && structure.deadline < today) {
    return Math.max(0, monthDistance(`${structure.deadline.slice(0, 7)}-01`, thisMonth));
  }

  return 0;
}

export type TreasurerSummary = {
  asOf: string;
  collectedThisMonth: number;
  outstandingTotal: number;
  overdueCount: number;
  byStructure: Array<{
    structureId: string;
    structureName: string;
    isActive: boolean;
    collected: number;
    expected: number;
    outstanding: number;
    paidCount: number;
    memberCount: number;
  }>;
};

/** The treasurer's home cards. Spec §PAY-5. */
export async function fetchTreasurerSummary(asOf?: string): Promise<TreasurerSummary> {
  const sb = getSupabaseAdmin();
  const today = asOf ?? churchToday(await getSetting("report_timezone"));
  const monthStartIso = `${today.slice(0, 7)}-01`;

  const [structuresResult, paymentsResult] = await Promise.all([
    sb
      .from("payment_structures")
      .select("id, name, amount, deadline, installment_months, created_at, for_all, batch, is_active"),
    sb
      .from("payments")
      .select("member_id, payment_structure_id, amount_paid, paid_at, voided")
      .eq("voided", false),
  ]);

  const structures = (structuresResult.data ?? []) as StructureRow[];
  const payments = paymentsResult.data ?? [];

  const collectedThisMonth = round2(
    payments
      .filter((p) => typeof p.paid_at === "string" && p.paid_at >= monthStartIso)
      .reduce((n, p) => n + Number(p.amount_paid ?? 0), 0),
  );

  const paidTotals = new Map<string, { total: number; members: Set<string> }>();
  for (const payment of payments) {
    const key = String(payment.payment_structure_id);
    const entry = paidTotals.get(key);
    const amount = Number(payment.amount_paid ?? 0);
    const memberId = String(payment.member_id);
    if (entry) {
      entry.total = round2(entry.total + amount);
      entry.members.add(memberId);
    } else {
      paidTotals.set(key, { total: amount, members: new Set([memberId]) });
    }
  }

  // How many members each structure covers. Loaded once here rather than per row: a card reading "18 of
  // 34 paid" is useful, and "18" on its own does not tell a treasurer whether that is most of the
  // parish or a handful of people.
  const { data: memberRows } = await sb.from("members").select("id, batch, is_active");
  const members = (memberRows ?? []) as Array<{ id: string; batch: string | null; is_active: boolean | null }>;

  const overdue = await fetchOverdue({ asOf: today });

  const byStructure = structures
    .map((structure) => {
      const entry = paidTotals.get(structure.id);
      const collected = entry?.total ?? 0;
      const memberRowsInScope = members.filter((m) =>
        structureAppliesTo(structure, { is_active: m.is_active, batch: m.batch }),
      ).length;
      const memberOverdue = overdue.filter((r) => r.structureId === structure.id);
      return {
        structureId: structure.id,
        structureName: structure.name,
        isActive: structure.is_active !== false,
        collected,
        expected: round2(Number(structure.amount ?? 0)),
        outstanding: round2(memberOverdue.reduce((n, r) => n + r.remaining, 0)),
        paidCount: entry?.members.size ?? 0,
        memberCount: memberRowsInScope,
      };
    })
    .sort(
      (a, b) =>
        Number(b.isActive) - Number(a.isActive) || a.structureName.localeCompare(b.structureName),
    );

  return {
    asOf: today,
    collectedThisMonth,
    outstandingTotal: round2(overdue.reduce((n, r) => n + r.remaining, 0)),
    overdueCount: new Set(overdue.map((r) => r.memberId)).size,
    byStructure,
  };
}