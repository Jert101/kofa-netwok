import { NextRequest } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/api/guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { badRequest, internalError, jsonOk, notFound, validationFailed, zodFields } from "@/lib/api/response";
import { logAudit } from "@/lib/audit/log-audit";
import { validateVoidReason } from "@/lib/payments/rules";

type Ctx = { params: Promise<{ id: string }> };

const voidSchema = z.object({
  reason: z.string().max(200).trim(),
  note: z.string().max(400).trim().optional(),
});

/**
 * PAY-3: void a payment.
 *
 * Spec §PAY-3: treasurer only, and **the admin cannot void**. That is deliberate and unusual -- the
 * admin can edit announcements and approve registrations but not reverse money -- so it is worth saying
 * why: the treasurer is the person who reconciles the book, and a second role being able to erase an
 * entry weakens the claim that the ledger says what actually happened. An admin who needs a correction
 * asks the treasurer, which is one conversation instead of an untraceable edit.
 *
 * A reason is mandatory and stored with the row, plus who and when. The old handler voided with an
 * empty body and recorded nothing, so a voided payment and a deleted one looked identical.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const g = await requireRole(req.headers.get("cookie"), ["treasurer"]);
  if (!g.ok) return g.response;

  const { id } = await ctx.params;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return badRequest("Could not read the request.");
  }

  const parsed = voidSchema.safeParse(json);
  if (!parsed.success) {
    return validationFailed("Choose why this payment is being voided.", zodFields(parsed.error));
  }

  const reasonError = validateVoidReason(parsed.data.reason, parsed.data.note);
  if (reasonError) return validationFailed(reasonError, { reason: reasonError });

  const sb = getSupabaseAdmin();

  // Read first so the audit row can name the member and the amount. A void that says only "someone
  // voided something" is not a record.
  const { data: existing, error: readError } = await sb
    .from("payments")
    // Three foreign keys point at `members` from `payments` (member_id, recorded_by_member_id,
    // voided_by_member_id), so the embed has to name which one -- otherwise PostgREST answers PGRST201
    // and this read fails, which surfaced as "Could not load that payment." on every void attempt.
    .select(
      "id, member_id, payment_structure_id, amount_paid, paid_at, voided, members!payments_member_id_fkey(full_name), payment_structures(name)",
    )
    .eq("id", id)
    .maybeSingle();

  if (readError) return internalError("Could not load that payment.");
  if (!existing) return notFound("That payment no longer exists.");
  if (existing.voided === true) {
    return validationFailed("That payment has already been voided.", { voided: "Already voided." });
  }

  const voidedAt = new Date().toISOString();

  // `voided = false` stays in the WHERE clause so two treasurers voiding the same payment at once
  // cannot both claim to have done it: the second update matches no row.
  const { data: updated, error: updateError } = await sb
    .from("payments")
    .update({
      voided: true,
      void_reason: parsed.data.reason,
      void_note: parsed.data.note || null,
      voided_at: voidedAt,
      voided_by_role: g.session.role,
      voided_by_member_id: g.session.actor?.id ?? null,
    })
    .eq("id", id)
    .eq("voided", false)
    .select("id");

  if (updateError) return internalError("Could not void that payment.");
  if (!updated || updated.length === 0) {
    return validationFailed("That payment has already been voided.", { voided: "Already voided." });
  }

  const member = existing.members as { full_name?: string } | null;
  const structure = existing.payment_structures as { name?: string } | null;

  await logAudit({
    actor: {
      role: g.session.role,
      memberId: g.session.actor?.id ?? null,
      name: g.session.actor?.name ?? null,
    },
    action: "payment_voided",
    entityType: "payment",
    entityId: id,
    meta: {
      member_name: member?.full_name ?? null,
      structure_name: structure?.name ?? null,
      amount: Number(existing.amount_paid ?? 0),
      reason: parsed.data.reason,
      note: parsed.data.note || null,
      paid_at: existing.paid_at,
    },
  });

  return jsonOk({
    id,
    voided_at: voidedAt,
    reason: parsed.data.reason,
    // Spec §8: locks stay while any non-voided payment exists. This void may have unlocked a structure,
    // and the sheet wants to know.
    note: "This payment no longer counts towards any balance.",
  });
}