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
  const g = await requireRole(req.headers.get("cookie"), ["admin", "treasurer", "member", "officer", "secretary"]);
  if (!g.ok) return g.response;

  const url = new URL(req.url);
  const member_id = url.searchParams.get("member_id");
  const structure_id = url.searchParams.get("structure_id");
  const includeVoided = url.searchParams.get("include_voided") === "1";

  const sb = getSupabaseAdmin();
  let q = sb
    .from("payments")
    .select("id, amount_paid, paid_at, notes, voided, payment_structures(name, amount), members(full_name)")
    .order("paid_at", { ascending: false })
    .order("created_at", { ascending: false });

  if (!includeVoided) q = q.eq("voided", false);
  if (member_id) q = q.eq("member_id", member_id);
  if (structure_id) q = q.eq("payment_structure_id", structure_id);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ payments: data ?? [] });
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
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: data?.id });
}
