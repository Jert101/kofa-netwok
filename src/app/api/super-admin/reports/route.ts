import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api/guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["super_admin"]);
  if (!g.ok) return g.response;

  const { searchParams } = req.nextUrl;
  const status = searchParams.get("status") ?? "pending";

  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("reports")
    .select("id, report_month, title, generated_by, created_at, summary_json, status, reviewed_at")
    .eq("status", status)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ reports: data ?? [] });
}