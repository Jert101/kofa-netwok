import { NextRequest } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/api/guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { badRequest, conflict, internalError, jsonOk, validationFailed, zodFields } from "@/lib/api/response";
import { logAudit } from "@/lib/audit/log-audit";
import { getSetting } from "@/lib/settings/store";
import { round2, suggestedPaymentAmount } from "@/lib/payments/proration";
import {
  canRecordPaymentFor,
  duplicateWarning,
  findDuplicatePayment,
  type DuplicateCandidate,
} from "@/lib/payments/rules";
import { churchToday, isIsoDate, zoneOffsetMinutes } from "@/lib/time/church-time";

const postSchema = z.object({
  member_id: z.string().uuid(),
  payment_structure_id: z.string().uuid(),
  amount_paid: z.number().positive(),
  paid_at: z.string().optional(),
  notes: z.string().max(500).trim().optional(),
  /**
   * PAY-2's duplicate guard. The first attempt comes back 409 with the warning; the treasurer confirms
   * by sending it back with this set.
   */
  confirm_duplicate: z.boolean().optional(),
});

/**
 * PAY-2: record a payment.
 *
 * Replaces the old handler, which inserted whatever it was given. Three things happen here that it did
 * not do:
 *
 * 1. The duplicate guard, before anything is written.
 * 2. Scope and active checks, so a payment cannot be recorded against a structure that does not apply to
 *    the member. An out-of-scope payment is not a data-entry slip, it is a wrong number on a real
 *    person's ledger.
 * 3. An audit row, because `payment_recorded` has existed in the action list since module 02 with
 *    nothing ever emitting it.
 */
export async function POST(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["treasurer", "admin"]);
  if (!g.ok) return g.response;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return badRequest("Could not read the request.");
  }

  const parsed = postSchema.safeParse(json);
  if (!parsed.success) return validationFailed("Check the payment details.", zodFields(parsed.error));

  const paidAt = parsed.data.paid_at ?? churchToday(await getSetting("report_timezone"));
  if (!isIsoDate(paidAt)) {
    return validationFailed("That date is not a real date.", { paid_at: "Use a valid date." });
  }
  // `isIsoDate` only checks the shape. The column is a plain DATE with no CHECK, so a payment dated in
  // the future used to be stored verbatim and then feed proration -- making a member look like they
  // still owed money on a date that has not happened. Compare against the parish's today, not the
  // server's, or the check would refuse an honest payment on the evening of a Manila morning.
  const today = churchToday(await getSetting("report_timezone"));
  if (paidAt > today) {
    return validationFailed("A payment cannot be dated in the future.", {
      paid_at: `Use today (${today}) or earlier.`,
    });
  }

  const amount = round2(parsed.data.amount_paid);
  if (amount <= 0) {
    return validationFailed("Enter an amount above zero.", { amount_paid: "Must be above zero." });
  }

  const sb = getSupabaseAdmin();

  const [structureResult, memberResult] = await Promise.all([
    sb
      .from("payment_structures")
      .select("id, name, amount, deadline, installment_months, created_at, for_all, batch, is_active")
      .eq("id", parsed.data.payment_structure_id)
      .maybeSingle(),
    sb
      .from("members")
      .select("id, full_name, batch, is_active")
      .eq("id", parsed.data.member_id)
      .maybeSingle(),
  ]);

  const structure = structureResult.data as Record<string, unknown> | null;
  const member = memberResult.data as Record<string, unknown> | null;

  if (!structure) return validationFailed("That structure no longer exists.", { payment_structure_id: "Unknown." });
  if (!member) return validationFailed("That member no longer exists.", { member_id: "Unknown." });

  const scope = canRecordPaymentFor(
    { for_all: (structure.for_all as boolean | null) ?? null, batch: (structure.batch as string | null) ?? null },
    { is_active: (member.is_active as boolean | null) ?? null, batch: (member.batch as string | null) ?? null },
  );
  if (!scope.allowed) {
    return validationFailed(
      "That structure does not apply to this member.",
      { member_id: `This structure applies to batch ${structure.batch ?? "(none)"} only.` },
    );
  }

  // Voided rows are excluded from the query as well as the comparison, so a voided payment cannot
  // occupy the guard's window and block a legitimate new one.
  const { data: recent, error: recentError } = await sb
    .from("payments")
    .select("id, amount_paid, paid_at, created_at, voided")
    .eq("member_id", parsed.data.member_id)
    .eq("payment_structure_id", parsed.data.payment_structure_id)
    .eq("voided", false)
    .order("created_at", { ascending: false })
    .limit(20);

  if (recentError) return internalError("Could not check for a duplicate.");

  if (parsed.data.confirm_duplicate !== true) {
    const offset = zoneOffsetMinutes(await getSetting("report_timezone"));
    const match = findDuplicatePayment(
      { amount },
      (recent ?? []) as DuplicateCandidate[],
      Date.now(),
      offset,
    );
    if (match) {
      return conflict("CONFLICT", duplicateWarning(match), {
        duplicate_payment_id: match.id,
        duplicate_recorded_at: match.recordedAt,
      });
    }
  }

  const { data, error } = await sb
    .from("payments")
    .insert({
      member_id: parsed.data.member_id,
      payment_structure_id: parsed.data.payment_structure_id,
      amount_paid: amount,
      paid_at: paidAt,
      notes: parsed.data.notes || null,
      created_by: g.session.role,
      recorded_by_member_id: g.session.actor?.id ?? null,
    })
    .select("id, paid_at, amount_paid")
    .single();

  if (error) return internalError("Could not save the payment.");
  if (!data) return internalError("Could not save the payment.");

  await logAudit({
    actor: {
      role: g.session.role,
      memberId: g.session.actor?.id ?? null,
      name: g.session.actor?.name ?? null,
    },
    action: "payment_recorded",
    entityType: "payment",
    entityId: String(data.id),
    meta: {
      member_id: parsed.data.member_id,
      structure_id: parsed.data.payment_structure_id,
      amount,
      paid_at: paidAt,
      confirmed_duplicate: parsed.data.confirm_duplicate === true,
    },
  });

  // What the member still owes after this, so the record sheet can say so without a second round trip
  // and without the treasurer doing the subtraction in their head.
  const remainingRows = [...((recent ?? []) as DuplicateCandidate[])].filter(
    (p) => p.voided !== true && round2(Number(p.amount_paid)) !== amount,
  );
  const stillDue = suggestedPaymentAmount(
    structure as never,
    [...remainingRows, { amount_paid: amount, paid_at: paidAt, voided: false }] as never,
    paidAt,
  );

  return jsonOk({
    id: String(data.id),
    paid_at: String(data.paid_at),
    amount,
    still_due: stillDue,
    // Spec §PAY-2: the sheet keeps the structure selected so three payments in a row is three fields.
    keep_structure_selected: true,
    member_note: scope.note ?? null,
  });
}