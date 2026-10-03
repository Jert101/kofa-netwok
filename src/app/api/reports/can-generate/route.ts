import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api/guard";
import { getAllInternalSettings } from "@/lib/settings/store";
import {
  canGenerateMonthlyReport,
  previousReportMonthStartForNow,
  reportMonthStartForNow,
} from "@/lib/reports/rules";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export async function GET(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["admin", "secretary"]);
  if (!g.ok) return g.response;

  const settings = await getAllInternalSettings();
  const tz = settings.report_timezone || "UTC";
  const now = new Date();
  const scheduleAllowed = canGenerateMonthlyReport(now, tz);
  const monthStart = reportMonthStartForNow(now, tz);
  const previousMonthStart = previousReportMonthStartForNow(now, tz);
  const superAdminConfigured = (settings.pin_super_admin_hash ?? "").length > 0;

  const sb = getSupabaseAdmin();
  // 029: uniqueness is partial, so filter to the row that actually holds the month and
  // limit before maybeSingle() so two rows can never turn into a read error here.
  const activeFor = (m: string) =>
    sb
      .from("reports")
      .select("id, status")
      .eq("report_month", m)
      .neq("status", "rejected")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

  const [{ data: existing }, { data: previousExisting }] = await Promise.all([
    activeFor(monthStart),
    activeFor(previousMonthStart),
  ]);
  const reportExists = Boolean(existing?.id);
  const previousReportExists = Boolean(previousExisting?.id);
  const canGeneratePreviousMonth = g.session.role === "admin" && !previousReportExists;

  return NextResponse.json({
    schedule_allowed: scheduleAllowed,
    report_exists: reportExists,
    allowed: scheduleAllowed && !reportExists,
    previous_month_start: previousMonthStart,
    previous_report_exists: previousReportExists,
    can_generate_previous_month: canGeneratePreviousMonth,
    reason: reportExists && existing?.status === "pending"
      ? "A report for this month is pending approval."
      : reportExists
        ? "Report already exists for this month."
        : !scheduleAllowed
        ? "Only on the last Sunday of the month, from 8:00 PM (church time)."
        : null,
    month_start: monthStart,
    /**
     * Sent so the client can render the status strip through `buildStatusStrip` instead of
     * re-deciding the window in the browser. The browser's own timezone is the wrong one to
     * judge by — the church setting is the rule — and a user travelling or on a device set
     * elsewhere would otherwise see a different answer from the server.
     */
    time_zone: tz,
    /** The active row's status, so the strip can say "pending" vs "already exists". */
    report_status: (existing?.status ?? null) as "pending" | "approved" | "rejected" | null,
    super_admin_configured: superAdminConfigured,
  });
}
