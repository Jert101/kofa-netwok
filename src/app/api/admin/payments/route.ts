import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/api/guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

const postSchema = z.object({
  member_id: z.string().uuid(),
  payment_structure_id: z.string().uuid(),
  amount_paid: z.number().positive(),
  paid_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes: z.string().max(500).trim().optional(),
});

export async function GET(req: NextRequest) {
  // admin and treasurer only. This route answers the whole parish's payments with names and amounts,
  // and it was still declared for member, officer and secretary -- the exact leak that PAY-7 closed
  // on the lookup route but which was left open here. A member's own receipts come from
  // `/api/member/receipts`, which can only ever answer for the signed-in member.
  const g = await requireRole(req.headers.get("cookie"), ["admin", "treasurer"]);
  if (!g.ok) return g.response;

  const url = new URL(req.url);
  const member_id = url.searchParams.get("member_id");
  const structure_id = url.searchParams.get("structure_id");
  const includeVoided = url.searchParams.get("include_voided") === "1";

  const sb = getSupabaseAdmin();
  let q = sb
    .from("payments")
    // `payments` has three foreign keys to `members` -- member_id, recorded_by_member_id and
    // voided_by_member_id -- so a bare `members(full_name)` is ambiguous and PostgREST rejects it with
    // PGRST201 "more than one relationship was found". This embed had to name the constraint. Only the
    // payer, never the recorder or the voider.
    .select(
      "id, control_no, amount_paid, paid_at, notes, voided, payment_structures(name, amount), members!payments_member_id_fkey(full_name)",
    )
    .order("paid_at", { ascending: false })
    .order("created_at", { ascending: false });

  if (!includeVoided) q = q.eq("voided", false);
  if (member_id) q = q.eq("member_id", member_id);
  if (structure_id) q = q.eq("payment_structure_id", structure_id);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // The treasurer and the admin may both void; this page is also reachable by the secretary and officer,
  // who may not. The API says so outright rather than leaving a button on screen that fails: an action
  // that is refused on every press reads as a broken page, not as a rule.
  return NextResponse.json({
    payments: data ?? [],
    can_void: g.session.role === "treasurer" || g.session.role === "admin",
  });
}

export async function POST(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["admin", "treasurer"]);
  if (!g.ok) return g.response;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = postSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("payments")
    .insert({
      member_id: parsed.data.member_id,
      payment_structure_id: parsed.data.payment_structure_id,
      amount_paid: parsed.data.amount_paid,
      paid_at: parsed.data.paid_at || undefined,
      notes: parsed.data.notes || null,
    })
    .select("id, control_no")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // `control_no` comes back from the insert because the BEFORE INSERT trigger assigned it; returning
  // it lets the caller print the receipt immediately instead of re-reading the row to find the number.
  return NextResponse.json({ id: data?.id, control_no: data?.control_no ?? null });
}
