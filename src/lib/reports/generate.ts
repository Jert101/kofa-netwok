import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { existsSync, readFileSync } from "fs";
import path from "path";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getAllInternalSettings } from "@/lib/settings/store";
import {
  canGenerateMonthlyReport,
  previousReportMonthStartForNow,
  reportMonthStartForNow,
  monthBoundsFromStart,
} from "@/lib/reports/rules";
import { buildGridAttendancePdf } from "@/lib/reports/pdf";
import { buildReportGrid, buildSummaryJson } from "@/lib/reports/build-grid";
import { moveLiveMonthAttendanceToArchive } from "@/lib/reports/archive-month";
import {
  REPORTS_BUCKET,
  discardReportPdf,
  storeReportPdf,
} from "@/lib/reports/storage";
import type { Role } from "@/lib/auth/roles";
import { notify } from "@/lib/notify/notify";

export type GenerateReportResult =
  | { ok: true; reportId: string; expiredAppeals?: number }
  | { ok: false; code: "NOT_ALLOWED_WINDOW" | "ALREADY_EXISTS" | "PENDING_APPEALS" | "SERVER"; message: string; pendingAppeals?: number };

export async function generateMonthlyReport(params: {
  now: Date;
  generatedBy: Extract<Role, "admin" | "secretary">;
  /** Admin-only: skip last-Sunday / 8pm rule. Still enforces one report per month and archive rules. */
  bypassSchedule?: boolean;
  /** Sessions to show as columns in the PDF (must all belong to the report month). */
  includedSessionIds: string[];
  /** Optional target month (YYYY-MM-DD). Admins may target previous month if still missing. */
  targetMonthStart?: string;
  /** When true (default), live attendance for the month is copied to archive tables and removed from live tables. */
  archiveAfterGenerate?: boolean;
  /** APL-8: the secretary has seen the pending-appeal warning and chosen to close anyway. */
  acknowledgePendingAppeals?: boolean;
}): Promise<GenerateReportResult> {
  const archiveAfterGenerate = params.archiveAfterGenerate !== false;
  const sb = getSupabaseAdmin();
  let settings: Record<string, string>;
  try {
    settings = await getAllInternalSettings();
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
  const currentMonthStart = reportMonthStartForNow(params.now, tz);
  const previousMonthStart = previousReportMonthStartForNow(params.now, tz);
  const requestedMonthStart = params.targetMonthStart ?? currentMonthStart;
  const isCurrentMonth = requestedMonthStart === currentMonthStart;
  const isPreviousMonth = requestedMonthStart === previousMonthStart;

  if (requestedMonthStart !== currentMonthStart) {
    if (params.generatedBy !== "admin" || !isPreviousMonth) {
      return {
        ok: false,
        code: "NOT_ALLOWED_WINDOW",
        message: "Only administrators can generate a missing report for the previous month.",
      };
    }
  }

  const requiresScheduleWindow = isCurrentMonth && !params.bypassSchedule;
  if (requiresScheduleWindow && !canGenerateMonthlyReport(params.now, tz)) {
    return {
      ok: false,
      code: "NOT_ALLOWED_WINDOW",
      message: "Reports are only allowed on the last Sunday of the month at or after 8:00 PM (church time).",
    };
  }

  const monthStart = requestedMonthStart;
  // Only `end` is needed here: the session and record queries moved into buildReportGrid,
  // which derives its own bounds from the month so the preview and generate cannot
  // disagree about which rows belong to the month.
  const { end } = monthBoundsFromStart(monthStart);

  const { data: existing } = await sb
    .from("reports")
    .select("id, status")
    .eq("report_month", monthStart)
    .neq("status", "rejected")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing?.id) {
    return { ok: false, code: "ALREADY_EXISTS", message: "A report for this month already exists." };
  }

  // APL-8: pending appeals have to be dealt with before the month is frozen, because
  // once a report exists the attendance is read-only and the appeal can no longer be
  // resolved into a record. So the first attempt warns and stops; the retry, carrying the
  // caller's confirmation, expires them.
  //
  // Expiring is the right outcome here rather than approving them automatically. The
  // secretary has just been told there is unreviewed work and chosen to close the month;
  // quietly adding those names to attendance would be a bigger surprise than the one
  // they just consented to.
  let expiredAppeals = 0;
  const appealRollover = await sb.rpc("expire_pending_appeals_for_month", {
    p_month_start: monthStart,
    p_month_end: end,
    p_only_past_window: params.acknowledgePendingAppeals !== true,
  });

  if (appealRollover.error) {
    return { ok: false, code: "SERVER", message: appealRollover.error.message };
  }
  const appealRow = (Array.isArray(appealRollover.data) ? appealRollover.data[0] : appealRollover.data) as
    | { expired_count?: number; still_open_count?: number }
    | null;

  if ((appealRow?.expired_count ?? 0) > 0) expiredAppeals = appealRow?.expired_count ?? 0;

  if ((appealRow?.still_open_count ?? 0) > 0) {
    return {
      ok: false,
      code: "PENDING_APPEALS",
      message:
        `${appealRow?.still_open_count} attendance appeal${appealRow?.still_open_count === 1 ? "" : "s"} ` +
        `for this month ${appealRow?.still_open_count === 1 ? "is" : "are"} still waiting for review. ` +
        `Generating the report closes the month and ${appealRow?.still_open_count === 1 ? "settles" : "settles"} ` +
        `${appealRow?.still_open_count === 1 ? "it" : "them"} as declined. Review them first, or confirm to continue.`,
      pendingAppeals: appealRow?.still_open_count ?? 0,
    };
  }

  // 029/RPT-3: rejected reports are kept as history, so there is nothing to delete here.
  // The existence check above already ignores rejected rows, which is what frees the
  // month for a fresh attempt; the new row lands alongside the old one and the partial
  // unique index still refuses a second non-rejected row for the same month.

  const churchName = settings.church_name || "Church";
  const churchAddress = settings.church_address || "";
  const reportTitle = settings.report_title || "Attendance Report";

  // The same loader the preview endpoint uses, so the grid the secretary approved on
  // screen is the grid the PDF is drawn from. Regenerated here on purpose: the wizard is
  // explicit that the preview is never trusted, and attendance may have moved between the
  // preview and this call.
  const built = await buildReportGrid(sb, monthStart, params.includedSessionIds);
  if (!built.ok) {
    return { ok: false, code: "SERVER", message: built.message };
  }

  const { grid, columnGroups, sessionList, records } = built.data;
  const monthLabel = built.data.monthLabel;

  // `pdf.ts` predates the stored grid and still takes the richer cell kinds plus the
  // month-wide served count it tints Remarks by.
  const memberRows = grid.rows.map((r) => ({
    memberId: r.memberId,
    fullName: r.name,
    cells: r.cells.map((c) => (c === "S" ? ("served" as const) : ("absent" as const))),
    servedInMonth: r.servedInMonth,
    remarks: r.remarks,
  }));

  const summaryJson = buildSummaryJson({
    built: built.data,
    includedSessionIds: [...new Set(params.includedSessionIds)],
    dataArchived: archiveAfterGenerate && !((settings.pin_super_admin_hash ?? "").length > 0),
    churchName,
    churchAddress,
    reportTitle,
    version: 5,
  });

  const superAdminHash = settings.pin_super_admin_hash ?? "";
  const needsApproval = superAdminHash.length > 0;

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

  // 029/RPT-4: the PDF goes to the private `reports` bucket rather than into the row as
  // base64. The upload happens before the insert because the reports row is the thing that
  // decides whether the report exists at all; if the insert fails there is no report to fix,
  // only an orphaned object, which discardReportPdf cleans up.
  const { stored, degraded } = await storeReportPdf(sb, Buffer.from(pdfBytes), monthStart);

  const status = needsApproval ? "pending" : "approved";
  // Named once so the notification and the stored row cannot drift apart.
  const reportLabel = `${reportTitle} - ${monthLabel}`;
  const { data: reportRow, error: repErr } = await sb
    .from("reports")
    .insert({
      report_month: monthStart,
      title: reportLabel,
      generated_by: params.generatedBy,
      status,
      summary_json: summaryJson,
      pdf_storage_path: stored.storageKind === "object" ? stored.path : stored.base64,
      pdf_storage_kind: stored.storageKind,
    })
    .select("id")
    .single();

  if (repErr || !reportRow) {
    if (stored.storageKind === "object") discardReportPdf(sb, stored.path);

    // Spec §8: two people press Generate at once and the partial unique index rejects the
    // second. That is a conflict between two valid requests, not a server fault, so it is
    // 409 rather than 500 — the caller's correct move is to reload, not to retry blindly.
    if (isUniqueViolation(repErr)) {
      return {
        ok: false,
        code: "ALREADY_EXISTS",
        message: "Someone else generated this report a moment ago. Reload to see it.",
      };
    }
    return { ok: false, code: "SERVER", message: repErr?.message ?? "Insert failed" };
  }

  const reportId = reportRow.id as string;

  if (degraded) {
    // Storage was unreachable, so the PDF fell back to base64 in the row. Nothing is broken
    // for the user, but it is worth knowing the bucket is misconfigured rather than
    // discovering it when a reports query starts timing out.
    console.warn(
      `[reports] ${monthLabel}: PDF stored inline because the "${REPORTS_BUCKET}" bucket upload failed`,
    );
  }

  if (archiveAfterGenerate && !needsApproval) {
    const moved = await moveLiveMonthAttendanceToArchive(sb, reportId, sessionList, records);
    if (!moved.ok) {
      return { ok: false, code: "SERVER", message: moved.message };
    }
  }

  // Both branches go through the catalog, so the wording and the recipients for "your report is
  // waiting" and "your report is ready" live in one file rather than being retyped here every time
  // the flow changes.
  if (needsApproval) {
    await notify(
      "report_pending",
      { report_label: reportLabel, period_label: monthLabel },
      { fromRole: params.generatedBy },
    );
  } else {
    const toRole = params.generatedBy === "secretary" ? "admin" : "secretary";
    await notify(
      "report_generated",
      { role: toRole, report_label: reportLabel, period_label: monthLabel },
      { fromRole: params.generatedBy },
    );
  }

  return { ok: true, reportId, ...(expiredAppeals > 0 ? { expiredAppeals } : {}) };
}

/**
 * Postgres 23505, unique_violation.
 *
 * Matched on the code rather than on the index name: PostgREST reports the constraint for a
 * raw unique index as the index name, so matching `reports_month_active` would work today
 * and break the moment the index is renamed. Code 23505 is unambiguous for this insert,
 * since the only unique constraint on `reports` that an insert can hit is the month one.
 */
function isUniqueViolation(error: { code?: string } | null | undefined): boolean {
  return error?.code === "23505";
}
