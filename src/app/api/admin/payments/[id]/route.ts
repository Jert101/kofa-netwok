import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api/guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const g = await requireRole(req.headers.get("cookie"), ["admin", "treasurer"]);
  if (!g.ok) return g.response;

  const { id } = await ctx.params;
  const sb = getSupabaseAdmin();

  const { data: existing } = await sb
    .from("payments")
    .select("id, voided")
    .eq("id", id)
    .single();

  if (!existing) {
    return NextResponse.json({ error: "Payment not found" }, { status: 404 });
  }

  if (existing.voided) {
    return NextResponse.json({ error: "Payment is already voided" }, { status: 400 });
  }

  const { error } = await sb
    .from("payments")
    .update({ voided: true })
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
