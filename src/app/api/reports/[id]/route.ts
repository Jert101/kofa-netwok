import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api/guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/**
 * A single report's stored snapshot, fetched on demand (RPT-1 "Details").
 *
 * Separate from the list endpoint because the grid is the expensive part. The list needs
 * titles and badges; this is the only request that carries member names and per-session
 * attendance, so it is fetched when someone actually opens a report rather than on every
 * page load of the hub.
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  const g = await requireRole(req.headers.get("cookie"), ["admin", "secretary", "super_admin"]);
  if (!g.ok) return g.response;

  const { id } = await ctx.params;
  const sb = getSupabaseAdmin();

  const { data, error } = await sb
    .from("reports")
    .select("id, report_month, title, status, generated_by, created_at, reviewed_by, reviewed_at, review_note, summary_json")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // A non-approved report is not readable by anyone below super admin, matching the PDF
  // route. The check is here as well as there so a rejected or pending report cannot be read
  // through this endpoint as a back door around it.
  if (g.session.role !== "super_admin" && data.status !== "approved") {
    return NextResponse.json({ error: "Report not yet approved" }, { status: 403 });
  }

  const summary = (data.summary_json ?? {}) as {
    version?: number;
    monthLabel?: string;
    totals?: Record<string, number>;
    grid?: { columns?: unknown[]; rows?: unknown[] };
  };

  return NextResponse.json({
    report: {
      id: data.id,
      report_month: data.report_month,
      title: data.title,
      status: data.status,
      generated_by: data.generated_by,
      created_at: data.created_at,
      reviewed_by: data.reviewed_by ?? null,
      reviewed_at: data.reviewed_at ?? null,
      review_note: data.review_note ?? null,
    },
    summary: {
      version: summary.version ?? 4,
      monthLabel: summary.monthLabel ?? null,
      totals: summary.totals ?? null,
    },
    // null for v4 reports, which predate the stored grid. Callers must treat this as
    // "exports and the on-screen grid are unavailable" rather than as an empty report —
    // the PDF still works for them.
    grid: summary.grid ?? null,
  });
}