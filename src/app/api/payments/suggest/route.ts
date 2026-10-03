import { NextRequest } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/api/guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { badRequest, internalError, jsonOk } from "@/lib/api/response";
import { getSetting } from "@/lib/settings/store";
import {
  amountDueByDate,
  amountStillDue,
  balance,
  installmentSchedule,
  round2,
} from "@/lib/payments/proration";
import { churchToday } from "@/lib/time/church-time";

/**
 * What the record sheet should open at, for one member and one structure.
 *
 * Separate from `/api/payments/lookup` because this one carries peso figures and the lookup does not.
 * Keeping them apart means the limited pages cannot accidentally be given the rich version by changing
 * one endpoint instead of two.
 */
export async function GET(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["treasurer", "admin"]);
  if (!g.ok) return g.response;

  const url = new URL(req.url);
  const parsed = z
    .object({ member_id: z.string().uuid(), structure_id: z.string().uuid() })
    .safeParse({
      member_id: url.searchParams.get("member_id"),
      structure_id: url.searchParams.get("structure_id"),
    });
  if (!parsed.success) return badRequest("Choose a member and a structure.");

  const sb = getSupabaseAdmin();
  const asOf = churchToday(await getSetting("report_timezone"));

  const { data: structure, error } = await sb
    .from("payment_structures")
    .select("id, name, amount, deadline, installment_months, created_at, for_all, batch, is_active")
    .eq("id", parsed.data.structure_id)
    .maybeSingle();
  if (error) return internalError("Could not load that structure.");
  if (!structure) return badRequest("That structure no longer exists.");

  const { data: payments } = await sb
    .from("payments")
    .select("amount_paid, paid_at, voided, created_at")
    .eq("member_id", parsed.data.member_id)
    .eq("payment_structure_id", parsed.data.structure_id)
    .eq("voided", false);

  const rows = payments ?? [];
  const b = balance(structure, rows);
  const schedule = installmentSchedule(structure, rows, asOf);
  const nextUnpaid = schedule.installments.find((i) => i.paid < i.amount);
  const stillDue = amountStillDue(structure, rows, asOf);

  return jsonOk({
    as_of: asOf,
    structure_name: structure.name,
    amount: b.amount,
    paid: b.paid,
    remaining: b.remaining,
    credit: b.credit,
    paid_up: b.paidUp,
    due_to_date: amountDueByDate(structure, asOf),
    still_due: stillDue,
    // Spec §PAY-2: default to what is actually owed now, not the full amount. Zero when nothing is
    // outstanding, so the field does not open pre-filled with a payment that would be wrong.
    suggested_amount: round2(stillDue),
    next_installment: nextUnpaid
      ? { month: nextUnpaid.month, amount: nextUnpaid.amount, paid: nextUnpaid.paid }
      : null,
  });
}