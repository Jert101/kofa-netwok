import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api/guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["super_admin"]);
  if (!g.ok) return g.response;

  const { searchParams } = req.nextUrl;
  const status = searchParams.get("status") ?? "pending";

  /**
   * Metadata only. `summary_json` is dropped for the same reason as `/api/reports`: it holds
   * the stored grid, and this queue renders a title, a date and a reason. The PDF link is what
   * needs the report body, and it fetches it on its own.
   *
   * `review_note` is included so the returned section can show why a report was sent back
   * without a second request per row.
   */
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("reports")
    .select("id, report_month, title, generated_by, created_at, status, reviewed_at, review_note")
    .eq("status", status)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ reports: data ?? [] });
}