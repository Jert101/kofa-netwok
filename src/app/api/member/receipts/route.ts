import { NextRequest } from "next/server";
import { requireRole } from "@/lib/api/guard";
import { jsonOk, badRequest } from "@/lib/api/response";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * The signed-in member's own receipts.
 *
 * Self only, and self by construction rather than by filter: the member id comes from the session's
 * declared identity, never from a query parameter. There is no id in the URL to change, so there is
 * nothing to enumerate somebody else's receipts with.
 *
 * `/api/admin/payments` used to answer the whole parish's payments to any signed-in role; it is now
 * admin/treasurer only, which is why a member needs this route to see their own paperwork at all.
 */
export async function GET(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["member"], { selfOnly: true });
  if (!g.ok) return g.response;

  const memberId = g.session.actor?.id ?? null;
  if (!memberId) {
    // Without a declared identity there is no member row to read, and guessing one from a query
    // parameter is the hole this route exists to avoid.
    return badRequest(
      "Set your name on this device first, so we know whose receipts these are.",
      { _form: "Tap your name at the bottom of the menu and choose yourself." },
    );
  }

  const { data, error } = await getSupabaseAdmin()
    .from("payments")
    .select(
      "id, control_no, amount_paid, paid_at, notes, voided, void_reason, voided_at, payment_structures(name)",
    )
    .eq("member_id", memberId)
    .order("paid_at", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[member/receipts] read failed:", error.message);
    return badRequest("Could not load your receipts.");
  }

  const receipts = (data ?? []).map((row) => ({
    id: String(row.id),
    // Fall back to the id so a payment recorded before migration 037 still shows something rather
    // than a blank where the number belongs.
    control_no: (row.control_no as string | null) ?? `KOA-${String(row.id).slice(0, 8).toUpperCase()}`,
    has_control_no: typeof row.control_no === "string" && row.control_no.length > 0,
    amount_paid: Number(row.amount_paid ?? 0),
    paid_at: (row.paid_at as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    voided: row.voided === true,
    void_reason: (row.void_reason as string | null) ?? null,
    structure_name: (row.payment_structures as { name?: string } | null)?.name ?? "Payment",
  }));

  return jsonOk({ receipts });
}