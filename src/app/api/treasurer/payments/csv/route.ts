import { NextRequest } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/api/guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { badRequest, internalError } from "@/lib/api/response";
import { round2 } from "@/lib/payments/proration";
import { isIsoDate } from "@/lib/time/church-time";

/**
 * PAY-6: the payments CSV.
 *
 * Date range and optional structure, treasurer and admin only. Voided rows are included and labelled,
 * because the bookkeeper reconciling the parish's bank statement needs to see that a receipt exists and
 * was struck out -- not to have it quietly absent and wonder where the money went.
 */
const filterSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  structure_id: z.string().uuid().optional(),
});

export async function GET(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["treasurer", "admin"]);
  if (!g.ok) return g.response;

  const url = new URL(req.url);
  const parsed = filterSchema.safeParse({
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
    structure_id: url.searchParams.get("structure_id") ?? undefined,
  });
  if (!parsed.success) return badRequest("Check the date range.");

  const from = parsed.data.from;
  const to = parsed.data.to;
  if (from && !isIsoDate(from)) return badRequest("The 'from' date is not a real date.");
  if (to && !isIsoDate(to)) return badRequest("The 'to' date is not a real date.");
  if (from && to && from > to) return badRequest("The 'from' date is after the 'to' date.");

  const sb = getSupabaseAdmin();
  let query = sb
    .from("payments")
    .select(
      // Three foreign keys point at `members` from `payments` (member_id, recorded_by_member_id,
      // voided_by_member_id), so the embed has to name which one. This is the payer.
      "id, amount_paid, paid_at, notes, voided, void_reason, void_note, voided_at, created_at, payment_structures(name), members!payments_member_id_fkey(full_name)",
    )
    .order("paid_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (parsed.data.structure_id) query = query.eq("payment_structure_id", parsed.data.structure_id);
  // A NULL paid_at is a payment with no date. It is excluded from a date range rather than guessed
  // into one, and the caller is told how many rows were dropped.
  if (from) query = query.gte("paid_at", from);
  if (to) query = query.lte("paid_at", to);

  const { data, error } = await query;
  if (error) return internalError("Could not read the payments.");

  // Supabase types the embedded relations as arrays because the tables could in principle be
  // many-to-one-many; the ones selected here are not. Normalised through `unknown` rather than
  // asserted, which would hide a real shape change on the next migration.
  const rows = (data ?? []) as unknown as Array<{
    amount_paid: number | string;
    paid_at: string | null;
    notes: string | null;
    voided: boolean;
    void_reason: string | null;
    void_note: string | null;
    voided_at: string | null;
    created_at: string;
    payment_structures: { name: string } | null;
    members: { full_name: string } | null;
  }>;

  const header = [
    "Date",
    "Member",
    "Structure",
    "Amount",
    "Status",
    "Void reason",
    "Void note",
    "Voided at",
    "Notes",
  ];

  const lines = [header.map(cell).join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.paid_at ?? "",
        row.members?.full_name ?? "",
        row.payment_structures?.name ?? "",
        round2(Number(row.amount_paid)).toFixed(2),
        row.voided ? "voided" : "recorded",
        row.void_reason ?? "",
        row.void_note ?? "",
        row.voided_at ?? "",
        row.notes ?? "",
      ]
        .map(cell)
        .join(","),
    );
  }

  const stamp = to ?? from ?? "all";
  const body = `﻿${lines.join("\r\n")}\r\n`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="payments-${stamp}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}

/** RFC 4180 quoting. A peso amount never needs it; a member called O'Brien, or a note with a comma, does. */
function cell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? "" : String(value);
  if (/[",\n\r]/.test(text) || text !== text.trim()) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}