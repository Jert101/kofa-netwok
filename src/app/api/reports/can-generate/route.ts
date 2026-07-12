import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api/guard";
import { getAllSettings } from "@/lib/settings/store";
import {
  canGenerateMonthlyReport,
  previousReportMonthStartForNow,
  reportMonthStartForNow,
} from "@/lib/reports/rules";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export async function GET(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["admin", "secretary"]);
  if (!g.ok) return g.response;

  const settings = await getAllSettings();
  const tz = settings.report_timezone || "UTC";
  const now = new Date();
  const scheduleAllowed = canGenerateMonthlyReport(now, tz);
  const monthStart = reportMonthStartForNow(now, tz);
  const previousMonthStart = previousReportMonthStartForNow(now, tz);
  const superAdminConfigured = (settings.pin_super_admin_hash ?? "").length > 0;

  const sb = getSupabaseAdmin();
  const [{ data: existing }, { data: previousExisting }] = await Promise.all([
    sb.from("reports").select("id, status").eq("report_month", monthStart).maybeSingle(),
    sb.from("reports").select("id, status").eq("report_month", previousMonthStart).maybeSingle(),
  ]);
  const reportExists = existing?.id ? existing.status !== "rejected" : false;
  const previousReportExists = previousExisting?.id ? previousExisting.status !== "rejected" : false;
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
    super_admin_configured: superAdminConfigured,
  });
}
