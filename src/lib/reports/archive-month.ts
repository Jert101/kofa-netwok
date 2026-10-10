import type { SupabaseClient } from "@supabase/supabase-js";
import { selectSessionsResilient } from "@/lib/attendance/guard-session-write";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { monthBoundsFromStart } from "@/lib/reports/rules";

export type SessionRowForArchive = {
  id: string;
  session_date: string;
  notes: string | null;
  /**
   * Null for a gathering. The archive used to require this, which is why archiving a month containing
   * a meeting would have failed the whole report on a row that is not even part of the report.
   */
  mass_id: string | null;
  title?: string | null;
  masses: unknown;
};

export type RecordRowForArchive = {
  id: string;
  session_id: string;
  member_id: string;
  members: { full_name: string } | null;
};

function massNameFromJoin(masses: unknown): string {
  if (masses == null) return "";
  if (Array.isArray(masses)) {
    const m = masses[0] as { name?: string } | undefined;
    return m?.name ?? "";
  }
  return (masses as { name?: string }).name ?? "";
}

/**
 * Copies live sessions + attendance for the given rows into archive tables and deletes live sessions
 * (cascade removes attendance_records).
 */
export async function moveLiveMonthAttendanceToArchive(
  sb: SupabaseClient,
  reportId: string,
  sessionList: SessionRowForArchive[],
  records: RecordRowForArchive[]
): Promise<{ ok: true } | { ok: false; message: string }> {
  const sessionIds = sessionList.map((s) => s.id);

  if (sessionList.length) {
    const sessionArchiveRows = sessionList.map((s) => ({
      id: s.id,
      session_date: s.session_date,
      mass_id: s.mass_id,
      mass_name: massNameFromJoin(s.masses),
      // Omitted -- not nulled -- when the select did not return it, which is what happens on a
      // database predating migration 041: its archive table has no `title` column, and an explicit
      // null for a column that does not exist is still a 42703.
      ...(s.title !== undefined ? { title: s.title } : {}),
      notes: s.notes,
      report_id: reportId,
    }));
    const { error: aErr } = await sb.from("attendance_sessions_archive").insert(sessionArchiveRows);
    if (aErr) return { ok: false, message: aErr.message };
  }

  if (records.length) {
    const recordArchiveRows = records.map((r) => ({
      id: r.id,
      session_id: r.session_id,
      member_id: r.member_id,
      member_name: r.members?.full_name ?? "",
      report_id: reportId,
    }));
    const { error: arErr } = await sb.from("attendance_records_archive").insert(recordArchiveRows);
    if (arErr) return { ok: false, message: arErr.message };
  }

  if (sessionIds.length) {
    const { error: delErr } = await sb.from("attendance_sessions").delete().in("id", sessionIds);
    if (delErr) return { ok: false, message: delErr.message };
  }

  return { ok: true };
}

async function mergeReportSummaryJson(
  sb: SupabaseClient,
  reportId: string,
  existing: Record<string, unknown> | null,
  patch: Record<string, unknown>
): Promise<{ ok: true } | { ok: false; message: string }> {
  const next = { ...(existing ?? {}), ...patch };
  const { error } = await sb.from("reports").update({ summary_json: next }).eq("id", reportId);
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

/**
 * For a report that was generated without archiving: copy the month's live attendance to archive and clear live rows.
 * Idempotent if `summary_json.data_archived` is already true or archive rows already exist for this report.
 */
export async function archiveLiveDataForReport(
  reportId: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  const sb = getSupabaseAdmin();

  const { data: report, error: rErr } = await sb
    .from("reports")
    .select("id, report_month, summary_json")
    .eq("id", reportId)
    .maybeSingle();

  if (rErr || !report) {
    return { ok: false, message: "Report not found." };
  }

  const summary =
    report.summary_json && typeof report.summary_json === "object"
      ? (report.summary_json as Record<string, unknown>)
      : null;

  if (summary?.data_archived === true) {
    return { ok: true };
  }

  const { data: archRow } = await sb
    .from("attendance_sessions_archive")
    .select("id")
    .eq("report_id", reportId)
    .limit(1)
    .maybeSingle();

  if (archRow) {
    const merged = await mergeReportSummaryJson(sb, reportId, summary, { data_archived: true });
    return merged.ok ? { ok: true } : merged;
  }

  const monthStart = report.report_month as string;
  const { start, end } = monthBoundsFromStart(monthStart);

  // Resilient like the other session reads: on a pre-041 database `title` is absent and every session
  // is a Mass, so the fallback loses nothing -- and without it closing any month would fail outright
  // until the migration lands.
  const { data: sessions, error: sErr } = await selectSessionsResilient<Record<string, unknown>[]>(
    (columns) =>
      sb
        .from("attendance_sessions")
        .select(columns)
        .gte("session_date", start)
        .lte("session_date", end),
    "id, session_date, notes, mass_id, title, created_at, masses(name)",
    "id, session_date, notes, mass_id, created_at, masses(name)",
  );

  if (sErr) {
    return { ok: false, message: sErr.message ?? "The month's sessions could not be read." };
  }

  const sessionList = (sessions ?? []) as unknown as SessionRowForArchive[];
  const sessionIds = sessionList.map((s) => s.id);

  let records: RecordRowForArchive[] = [];
  if (sessionIds.length) {
    const { data: recs, error: recErr } = await sb
      .from("attendance_records")
      .select("id, session_id, member_id, members(full_name)")
      .in("session_id", sessionIds);
    if (recErr) {
      return { ok: false, message: recErr.message };
    }
    records = (recs ?? []) as unknown as RecordRowForArchive[];
  }

  const moved = await moveLiveMonthAttendanceToArchive(sb, reportId, sessionList, records);
  if (!moved.ok) {
    return moved;
  }

  return mergeReportSummaryJson(sb, reportId, summary, { data_archived: true });
}
