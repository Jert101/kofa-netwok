import { NextRequest } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/api/guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { badRequest, internalError, jsonOk } from "@/lib/api/response";
import { formatNameLastFirst } from "@/lib/members/name-format";
import { getSetting } from "@/lib/settings/store";
import { balance } from "@/lib/payments/proration";
import { structureAppliesTo } from "@/lib/payments/rules";
import {
  applyLookupVisibility,
  lookupVisibilityNote,
  type LookupEntry,
} from "@/lib/payments/visibility";
import { churchToday } from "@/lib/time/church-time";

/** Any signed-in user may search. What they get back is decided by `visibility.ts`, not by this route. */
const READER_ROLES = ["admin", "secretary", "officer", "member", "treasurer", "super_admin"] as const;

const querySchema = z
  .object({
    q: z.string().trim().optional(),
    member_id: z.string().uuid().optional(),
  })
  .refine((d) => d.member_id || (d.q && d.q.length >= 2), {
    message: "Type at least two letters.",
    path: ["q"],
  });

/**
 * PAY-7: the limited lookup, in place of the four identical PaymentLookup pages.
 *
 * ## Why the shape changed
 *
 * `PaymentLookup` was mounted on the admin, secretary, officer and member pages, identical except for
 * one line of wording, and it called `GET /api/admin/payments`, which allowed all four roles. Any
 * signed-in member could type any other member's name and read their exact peso amounts. Spec §P6.
 *
 * So the endpoint no longer decides who may ask; it decides what each asker gets back, and that
 * decision lives in `visibility.ts` where it can be tested without a database. A member sees names and
 * a settled-or-not flag. A treasurer sees pesos.
 *
 * Searches by name first, then answers the one member that was asked for. Two steps rather than one
 * because the member search endpoint already exists and already handles the matching rules.
 */
export async function GET(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), [...READER_ROLES]);
  if (!g.ok) return g.response;

  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    q: url.searchParams.get("q") ?? "",
    member_id: url.searchParams.get("member_id") ?? undefined,
  });
  if (!parsed.success) return badRequest("Type at least two letters.");

  const sb = getSupabaseAdmin();
  const asOf = churchToday(await getSetting("report_timezone"));

  // Step 1: find the member. `member_id` short-circuits it, which is what the member's own payments
  // page uses so it does not have to search for itself by name.
  let member: { id: string; full_name: string; batch: string | null; is_active: boolean | null } | null = null;

  if (parsed.data.member_id) {
    const { data } = await sb
      .from("members")
      .select("id, full_name, batch, is_active")
      .eq("id", parsed.data.member_id)
      .maybeSingle();
    member = data as typeof member;
  } else {
    const { data } = await sb
      .from("members")
      .select("id, full_name, batch, is_active")
      .ilike("full_name", `%${parsed.data.q}%`)
      .order("full_name")
      .limit(10);
    member = (data ?? [])[0] ?? null;
  }

  if (!member) return jsonOk({ found: false, results: [], results_count: 0 });

  const memberId = String(member.id);
  const viewer = { role: g.session.role, actorId: g.session.actor?.id ?? null };
const isSelf = viewer.actorId === memberId;

  // Step 2: only the structures that actually apply to this member. A batch structure belonging to
  // another batch says nothing about their balance, and listing it would read as though they owe it.
  const [structuresResult, paymentsResult] = await Promise.all([
    sb
      .from("payment_structures")
      .select("id, name, amount, deadline, installment_months, created_at, for_all, batch, is_active"),
    sb
      .from("payments")
      .select("payment_structure_id, amount_paid, paid_at, voided")
      .eq("member_id", memberId)
      .eq("voided", false),
  ]);

  if (structuresResult.error) return internalError("Could not load payment structures.");
  if (paymentsResult.error) return internalError("Could not load payments.");

  const memberMeta = { is_active: member.is_active ?? null, batch: member.batch ?? null };
  const payments = paymentsResult.data ?? [];

  const entries: LookupEntry[] = (
    (structuresResult.data ?? []) as Array<{
      id: string;
      name: string;
      amount: number | string;
      deadline: string | null;
      installment_months: number | null;
      created_at: string;
      for_all: boolean | null;
      batch: string | null;
      is_active: boolean | null;
    }>
  )
    .filter((s) => structureAppliesTo(s, memberMeta))
    .map((s) => {
      const rows = payments.filter((p) => String(p.payment_structure_id) === String(s.id));
      const b = balance(s, rows);
      return {
        structureId: String(s.id),
        structureName: s.name,
        amount: b.amount.toFixed(2),
        paid: b.paid.toFixed(2),
        remaining: b.remaining.toFixed(2),
        credit: b.credit > 0 ? b.credit.toFixed(2) : null,
        settled: b.paidUp,
        isActive: s.is_active !== false,
      };
    });

  const { entries: visibleEntries, amountsVisible: visible } = applyLookupVisibility(
    entries,
    viewer,
    memberId,
  );

  return jsonOk({
    found: true,
    as_of: asOf,
    member: {
      id: memberId,
      full_name: formatNameLastFirst(String(member.full_name ?? "")),
      batch: member.batch,
      is_active: member.is_active !== false,
    },
    amounts_visible: visible,
    is_self: isSelf,
    note: lookupVisibilityNote(visible, isSelf),
    entries: visibleEntries,
  });
}