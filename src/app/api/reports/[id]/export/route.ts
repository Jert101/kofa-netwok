import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api/guard";
import { badRequest, forbidden, internalError, notFound } from "@/lib/api/response";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit/log-audit";
import { buildExportTable, exportFileStem, toCsv } from "@/lib/reports/export";
import type { ReportGridSnapshot } from "@/lib/reports/weekend-grid";

export const runtime = "nodejs";

type StoredGrid = {
  version?: number;
  grid?: ReportGridSnapshot;
};

/**
 * RPT-7: XLSX and CSV of the stored grid.
 *
 * Reads `summary_json.grid` and nothing else. That is the whole point of v5: once a report
 * is archived its attendance rows are gone, and an export that re-read them would work for
 * new reports and fail for old ones.
 *
 * Visibility matches the PDF route — admin and secretary for approved reports only. The
 * reason is the same: a pending or rejected report contains attendance the super admin has
 * not signed off, and a spreadsheet is as easy to forward as a PDF.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await requireRole(req.headers.get("cookie"), ["admin", "secretary"]);
  if (!g.ok) return g.response;

  const url = new URL(req.url);
  const format = url.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";

  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("reports")
    .select("id, title, status, summary_json")
    .eq("id", id)
    .maybeSingle();

  if (error) return internalError(error.message);
  if (!data) return notFound("Report not found.");
  if (data.status !== "approved") {
    return forbidden("Only approved reports can be exported.");
  }

  const summary = (data.summary_json ?? {}) as StoredGrid;
  if (!summary.grid || !Array.isArray(summary.grid.columns) || !Array.isArray(summary.grid.rows)) {
    // v4 and earlier stored no grid. Spec: those show the PDF and a note that export is
    // unavailable. 409 rather than 400 — the request was well formed, the report just
    // predates the feature.
    return badRequest(
      "This report was generated before spreadsheet export was available. Download the PDF instead.",
    );
  }

  const title = String(data.title ?? "Attendance Report");
  const stem = exportFileStem(title, format);

  // Imported lazily: the spreadsheet engine is ~1MB and only the xlsx path needs it, so a
  // CSV request should not pay for it.
  const body =
    format === "xlsx"
      ? await (await import("@/lib/reports/export-xlsx")).buildXlsx(summary.grid)
      : Buffer.from(toCsv(buildExportTable(summary.grid)), "utf8");

  const contentType =
    format === "xlsx"
      ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      : "text/csv; charset=utf-8";

  await logAudit({
    action: "report_downloaded",
    actor: { role: g.session.role, memberId: null, name: null },
    entityType: "report",
    entityId: id,
    meta: { format },
    ip: req.headers.get("x-forwarded-for"),
  });

  return new NextResponse(new Uint8Array(body), {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${stem}"`,
      "Cache-Control": "no-store",
    },
  });
}
