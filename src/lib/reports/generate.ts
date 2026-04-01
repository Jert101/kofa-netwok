import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { existsSync, readFileSync } from "fs";
import path from "path";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getAllSettings } from "@/lib/settings/store";
import {
  canGenerateMonthlyReport,
  reportMonthStartForNow,
  monthBoundsFromStart,
} from "@/lib/reports/rules";
import { buildGridAttendancePdf } from "@/lib/reports/pdf";
import {
  buildReportColumnGroups,
  cellKindForSession,
  flattenSessionOrder,
  remarksForServedCount,
  servedCountForSessions,
} from "@/lib/reports/weekend-grid";
import { moveLiveMonthAttendanceToArchive } from "@/lib/reports/archive-month";
import type { Role } from "@/lib/auth/roles";

export type GenerateReportResult =
  | { ok: true; reportId: string }
  | { ok: false; code: "NOT_ALLOWED_WINDOW" | "ALREADY_EXISTS" | "SERVER"; message: string };

export async function generateMonthlyReport(params: {
  now: Date;
  generatedBy: Extract<Role, "admin" | "secretary">;
  /** Admin-only: skip last-Sunday / 8pm rule. Still enforces one report per month and archive rules. */
  bypassSchedule?: boolean;
  /** Sessions to show as columns in the PDF (must all belong to the report month). */
  includedSessionIds: string[];
  /** When true (default), live attendance for the month is copied to archive tables and removed from live tables. */
  archiveAfterGenerate?: boolean;
}): Promise<GenerateReportResult> {
  const archiveAfterGenerate = params.archiveAfterGenerate !== false;
  const sb = getSupabaseAdmin();
  let settings: Record<string, string>;
  try {
    settings = await getAllSettings();
  } catch {
    return { ok: false, code: "SERVER", message: "Settings unavailable" };
  }

  if (params.bypassSchedule && params.generatedBy !== "admin") {
    return {
      ok: false,
      code: "NOT_ALLOWED_WINDOW",
      message: "Only an administrator can bypass the report schedule.",
    };
  }

  const tz = settings.report_timezone || "UTC";
  if (!params.bypassSchedule && !canGenerateMonthlyReport(params.now, tz)) {
    return {
      ok: false,
      code: "NOT_ALLOWED_WINDOW",
      message: "Reports are only allowed on the last Sunday of the month at or after 8:00 PM (church time).",
    };
  }

  const monthStart = reportMonthStartForNow(params.now, tz);
  const { start, end } = monthBoundsFromStart(monthStart);

  const { data: existing } = await sb.from("reports").select("id").eq("report_month", monthStart).maybeSingle();
  if (existing?.id) {
    return { ok: false, code: "ALREADY_EXISTS", message: "A report for this month already exists." };
  }

  const { data: sessions, error: sErr } = await sb
    .from("attendance_sessions")
    .select("id, session_date, notes, mass_id, created_at, masses(name)")
    .gte("session_date", start)
    .lte("session_date", end);

  if (sErr) {
    return { ok: false, code: "SERVER", message: sErr.message };
  }

  const sessionList = sessions ?? [];
  const sessionIds = sessionList.map((s) => s.id);
  const monthSessionIdSet = new Set(sessionIds.map((id) => id as string));

  const uniqueIncluded = [...new Set(params.includedSessionIds)];
  if (uniqueIncluded.length === 0) {
    return {
      ok: false,
      code: "SERVER",
      message: "Select at least one Mass session to include in the report.",
    };
  }
  for (const id of uniqueIncluded) {
    if (!monthSessionIdSet.has(id)) {
      return {
        ok: false,
        code: "SERVER",
        message: "One or more selected sessions are not in this report month.",
      };
    }
  }
  const includedSet = new Set(uniqueIncluded);

  let records: {
    id: string;
    session_id: string;
    member_id: string;
    members: { full_name: string } | null;
  }[] = [];

  if (sessionIds.length) {
    const { data: recs, error: rErr } = await sb
      .from("attendance_records")
      .select("id, session_id, member_id, members(full_name)")
      .in("session_id", sessionIds);
    if (rErr) {
      return { ok: false, code: "SERVER", message: rErr.message };
    }
    records = (recs ?? []) as unknown as typeof records;
  }

  const churchName = settings.church_name || "Church";
  const churchAddress = settings.church_address || "";
  const reportTitle = settings.report_title || "Attendance Report";
  const monthLabel = format(new Date(monthStart + "T12:00:00"), "MMMM yyyy");

  const { data: memberRowsDb, error: memErr } = await sb
    .from("members")
    .select("id, full_name")
    .order("full_name", { ascending: true });

  if (memErr) {
    return { ok: false, code: "SERVER", message: memErr.message };
  }

  const columnGroups = buildReportColumnGroups(sessionList, includedSet);
  const sessionOrder = flattenSessionOrder(columnGroups);

  const attended = new Set<string>();
  for (const r of records) {
    attended.add(`${r.member_id}:${r.session_id}`);
  }

  const memberRows = (memberRowsDb ?? []).map((m) => {
    const id = m.id as string;
    const cells = sessionOrder.map((sessionId) => cellKindForSession(sessionId, id, attended));
    const n = servedCountForSessions(id, records, includedSet);
    return {
      memberId: id,
      fullName: m.full_name as string,
      cells,
      remarks: remarksForServedCount(n),
      servedInMonth: n,
    };
  });

  const summaryJson = {
    version: 4,
    format: "selected_sessions_grid" as const,
    data_archived: archiveAfterGenerate,
    churchName,
    churchAddress,
    reportTitle,
    monthLabel,
    monthStart,
    included_session_ids: uniqueIncluded,
    columnGroups,
    totals: {
      sessions_in_month: sessionList.length,
      sessions_in_report: sessionOrder.length,
      attendance: records.length,
      memberCount: memberRows.length,
    },
    memberSummary: memberRows.map((row) => ({
      name: row.fullName,
      remarks: row.remarks,
      servedInSelectedSessions: servedCountForSessions(row.memberId, records, includedSet),
    })),
  };

  const zNow = toZonedTime(params.now, tz);
  const generatedAtLabel = format(zNow, "PPpp");

  const logoPath = path.join(process.cwd(), "public", "logo.png");
  const logoDataUrl = existsSync(logoPath)
    ? `data:image/png;base64,${readFileSync(logoPath).toString("base64")}`
    : undefined;

  const pdfBytes = buildGridAttendancePdf({
    churchName,
    churchAddress,
    reportTitle,
    monthLabel,
    generatedAtLabel,
    logoDataUrl,
    columnGroups,
    memberRows,
  });

  const pdfB64 = Buffer.from(pdfBytes).toString("base64");

  const { data: reportRow, error: repErr } = await sb
    .from("reports")
    .insert({
      report_month: monthStart,
      title: `${reportTitle} — ${monthLabel}`,
      generated_by: params.generatedBy,
      summary_json: summaryJson,
      pdf_storage_path: pdfB64,
    })
    .select("id")
    .single();

  if (repErr || !reportRow) {
    return { ok: false, code: "SERVER", message: repErr?.message ?? "Insert failed" };
  }

  const reportId = reportRow.id as string;

  if (archiveAfterGenerate) {
    const moved = await moveLiveMonthAttendanceToArchive(sb, reportId, sessionList, records);
    if (!moved.ok) {
      return { ok: false, code: "SERVER", message: moved.message };
    }
  }

  const toRole = params.generatedBy === "secretary" ? "admin" : "secretary";
  await sb.from("notifications").insert({
    from_role: params.generatedBy,
    to_role: toRole,
    title: "Monthly report generated",
    body: `${monthLabel} report is ready. You can download the PDF from Reports.`,
  });

  return { ok: true, reportId };
}
