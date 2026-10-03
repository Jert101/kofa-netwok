import { NextRequest } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/api/guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { badRequest, conflict, internalError, jsonOk, notFound, validationFailed, zodFields } from "@/lib/api/response";
import { logAudit } from "@/lib/audit/log-audit";
import { checkStructureEdit, type StructureEditPatch } from "@/lib/payments/rules";
import { isIsoDate } from "@/lib/time/church-time";

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  amount: z.number().positive().optional(),
  deadline: z.string().nullable().optional(),
  installment_months: z.number().int().positive().nullable().optional(),
  for_all: z.boolean().optional(),
  batch: z.string().trim().max(20).nullable().optional(),
  is_active: z.boolean().optional(),
});

/**
 * PAY-1: edit a structure, safely.
 *
 * The rule the spec asks for: once any payment exists, name/deadline/active stay editable and
 * amount/installments/scope are refused with "Payments already exist. Create a new structure to change
 * the amount."
 *
 * The check counts **non-voided** payments, so voiding everything unlocks the structure again. That is
 * the point of voiding, and it is why the count is a filtered query rather than a row count.
 *
 * The refusal names which fields were refused, so the composer can disable exactly those inputs rather
 * than showing a form that accepts edits and then rejects them on save.
 */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const g = await requireRole(req.headers.get("cookie"), ["treasurer"]);
  if (!g.ok) return g.response;

  const { id } = await ctx.params;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return badRequest("Could not read the request.");
  }

  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) return validationFailed("Check the structure details.", zodFields(parsed.error));

  const patch: StructureEditPatch = {};
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.amount !== undefined) patch.amount = parsed.data.amount;
  if (parsed.data.deadline !== undefined) patch.deadline = parsed.data.deadline;
  if (parsed.data.installment_months !== undefined) patch.installment_months = parsed.data.installment_months;
  if (parsed.data.for_all !== undefined) patch.for_all = parsed.data.for_all;
  if (parsed.data.batch !== undefined) patch.batch = parsed.data.batch;
  if (parsed.data.is_active !== undefined) patch.is_active = parsed.data.is_active;

  if (Object.keys(patch).length === 0) return badRequest("Nothing to change.");

  if (patch.deadline && !isIsoDate(patch.deadline)) {
    return validationFailed("That deadline is not a real date.", { deadline: "Use a valid date." });
  }

  // A structure scoped to a batch needs a batch, and one scoped to everybody must not carry one. Storing
  // both means `for_all = false, batch = null`, which applies to nobody.
  const forAll = patch.for_all;
  const batch = patch.batch;
  if (forAll === false && (batch === null || batch === "")) {
    return validationFailed("Choose which batch this is for.", { batch: "Pick a batch." });
  }
  if (forAll === true && batch) {
    return validationFailed("A structure for everybody cannot also be scoped to a batch.", {
      batch: "Leave this empty.",
    });
  }

  const sb = getSupabaseAdmin();

  const { data: structure, error: readError } = await sb
    .from("payment_structures")
    .select("id, name, amount, deadline, installment_months, for_all, batch, is_active")
    .eq("id", id)
    .maybeSingle();

  if (readError) return internalError("Could not load that structure.");
  if (!structure) return notFound("That structure no longer exists.");

  // Partial index `payments_structure_live_idx` covers exactly this predicate.
  const { count, error: countError } = await sb
    .from("payments")
    .select("id", { count: "exact", head: true })
    .eq("payment_structure_id", id)
    .eq("voided", false);

  if (countError) return internalError("Could not check whether this structure has payments.");

  const check = checkStructureEdit(patch, (count ?? 0) > 0);
  if (!check.allowed) {
    return conflict("CONFLICT", check.message, {
      locked_fields: check.lockedFields.join(","),
      payment_count: String(count ?? 0),
    });
  }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const [key, value] of Object.entries(patch)) {
    update[key] = value === "" ? null : value;
  }

  const { error } = await sb.from("payment_structures").update(update).eq("id", id);
  if (error) return internalError("Could not save that structure.");

  await logAudit({
    actor: {
      role: g.session.role,
      memberId: g.session.actor?.id ?? null,
      name: g.session.actor?.name ?? null,
    },
    action: "structure_updated",
    entityType: "payment_structure",
    entityId: id,
    meta: { fields: Object.keys(update).filter((k) => k !== "updated_at") },
  });

  return jsonOk({ id, updated: Object.keys(patch) });
}