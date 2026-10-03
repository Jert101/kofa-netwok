import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/api/guard";
import { badRequest, zodFields } from "@/lib/api/response";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { describePendingAppeals } from "@/lib/appeals/report-warning";
import { pendingAppealsInMonth } from "@/features/appeals/server/appeals";
import { buildReportGrid } from "@/lib/reports/build-grid";
import { monthBoundsFromStart } from "@/lib/reports/rules";

export const runtime = "nodejs";

const bodySchema = z.object({
  month_start: z.string().regex(/^\d{4}-\d{2}-01$/, "month_start must be the first day of a month"),
  session_ids: z.array(z.string().uuid()).min(1, "Select at least one Mass session."),
});

/**
 * RPT-2: the on-screen grid, built and returned without saving anything.
 *
 * Shares `buildReportGrid` with generation, so the preview cannot drift from the PDF. It
 * deliberately does not enforce the schedule or refuse because a report already exists: the
 * wizard calls it to show the grid *before* the user decides, and refusing early would show
 * an error instead of the thing they asked for. The generate path is the gate.
 */
export async function POST(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["admin", "secretary"]);
  if (!g.ok) return g.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Invalid request.", zodFields(parsed.error));
  }

  const { month_start, session_ids } = parsed.data;
  const { end } = monthBoundsFromStart(month_start);

  const sb = getSupabaseAdmin();

  // Same helper the generate path's warning comes from, so the wizard and the server cannot
  // describe the same month differently.
  let pending_appeals_warning: string | null = null;
  try {
    const { pendingCount, sessionCount } = await pendingAppealsInMonth(sb, month_start, end);
    const warning = describePendingAppeals({
      monthStart: month_start,
      monthEnd: end,
      pendingCount,
      sessionCount,
    });
    pending_appeals_warning = warning.blocking ? warning.message : null;
  } catch {
    // A failed warning read must not block the preview. Generation warns again, and it is
    // the step that actually closes the month.
    pending_appeals_warning = null;
  }

  const built = await buildReportGrid(sb, month_start, session_ids);
  if (!built.ok) return badRequest(built.message);

  return NextResponse.json({
    ok: true,
    month_start,
    month_label: built.data.monthLabel,
    columns: built.data.grid.columns,
    rows: built.data.grid.rows,
    totals: built.data.totals,
    pending_appeals_warning,
  });
}
