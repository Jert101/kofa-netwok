import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api/guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

function dataArchivedFromSummary(summaryJson: unknown): boolean {
  if (summaryJson && typeof summaryJson === "object" && summaryJson !== null && "data_archived" in summaryJson) {
    return (summaryJson as { data_archived?: boolean }).data_archived !== false;
  }
  return true;
}

export async function GET(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["admin", "secretary"]);
  if (!g.ok) return g.response;

  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("reports")
    .select("id, report_month, title, generated_by, created_at, summary_json")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const reports = (data ?? []).map((row) => {
    const { summary_json, ...rest } = row as typeof row & { summary_json?: unknown };
    return {
      ...rest,
      data_archived: dataArchivedFromSummary(summary_json),
    };
  });

  return NextResponse.json({ reports });
}
