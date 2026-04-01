import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api/guard";
import { getAllSettings } from "@/lib/settings/store";
import { canGenerateMonthlyReport, reportMonthStartForNow } from "@/lib/reports/rules";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export async function GET(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["admin", "secretary"]);
  if (!g.ok) return g.response;

  const settings = await getAllSettings();
  const tz = settings.report_timezone || "UTC";
  const now = new Date();
  const scheduleAllowed = canGenerateMonthlyReport(now, tz);
  const monthStart = reportMonthStartForNow(now, tz);

  const sb = getSupabaseAdmin();
  const { data: existing } = await sb.from("reports").select("id").eq("report_month", monthStart).maybeSingle();
  const reportExists = Boolean(existing);

  return NextResponse.json({
    schedule_allowed: scheduleAllowed,
    report_exists: reportExists,
    allowed: scheduleAllowed && !reportExists,
    reason: reportExists
      ? "Report already exists for this month."
      : !scheduleAllowed
        ? "Only on the last Sunday of the month, from 8:00 PM (church time)."
        : null,
    month_start: monthStart,
  });
}
