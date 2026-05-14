import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api/guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  const g = await requireRole(req.headers.get("cookie"), ["admin", "secretary"]);
  if (!g.ok) return g.response;

  const { id } = await ctx.params;
  const toRole = g.session.role === "admin" ? "admin" : "secretary";
  const sb = getSupabaseAdmin();

  const { data: row, error: fErr } = await sb
    .from("notifications")
    .select("id")
    .eq("id", id)
    .eq("to_role", toRole)
    .maybeSingle();

  if (fErr || !row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { error } = await sb.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
