import { format } from "date-fns";
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatNameLastFirst } from "@/lib/members/name-format";
import { monthBoundsFromStart } from "@/lib/reports/rules";
import type { SessionRowForArchive, RecordRowForArchive } from "@/lib/reports/archive-month";
import {
  buildReportColumnGroups,
  buildReportGridSnapshot,
  flattenSessionOrder,
  servedCountForSessions,
  type ReportDateGroup,
  type ReportGridSnapshot,
} from "@/lib/reports/weekend-grid";

/**
 * One loader for the preview and the generated report.
 *
 * RPT-2 states the preview and the PDF must not be able to disagree, and the wizard is
 * explicit that "the preview is never trusted": the server rebuilds the grid at generate
 * time. Both of those are only true if the two paths share one builder. Duplicating the
 * query and the assembly here in `generate.ts` and again in the preview route would make
 * the agreement a convention rather than a property, so both call this instead.
 */
export type BuiltReportGrid = {
  monthStart: string;
  monthLabel: string;
  columnGroups: ReportDateGroup[];
  grid: ReportGridSnapshot;
  /** The month's sessions and records, kept for the archive step, which needs the same rows. */
  sessionList: SessionRowForArchive[];
  records: RecordRowForArchive[];
  totals: {
    sessionsInMonth: number;
    sessionsInReport: number;
    /** Attendance within the report's own sessions, not the whole month. */
    attendance: number;
    memberCount: number;
    /** Active members with no attendance in the included sessions (RPT-2 warning). */
    zeroAttendanceMembers: number;
  };
};

export type BuildGridResult =
  | { ok: true; data: BuiltReportGrid }
  | { ok: false; message: string };

export async function buildReportGrid(
  sb: SupabaseClient,
  monthStart: string,
  includedSessionIds: string[],
): Promise<BuildGridResult> {
  const { start, end } = monthBoundsFromStart(monthStart);

  const uniqueIncluded = [...new Set(includedSessionIds)];
  if (uniqueIncluded.length === 0) {
    return { ok: false, message: "Select at least one Mass session to include in the report." };
  }

  // `.not("mass_id", "is", null)` -- a meeting is a session with no Mass, and the monthly report is
  // the parish's official record of who *served*, where served means served at Mass.
  //
  // Nothing else in this file filters it, and that is the point worth writing down: the report groups by
  // `session_date` and uses the Mass only as a column label, so a gathering would not be blocked -- it
  // would be printed as a column headed "Mass", counted in the number of sessions, and folded into the
  // turnout median. All of it wrong, and none of it obviously wrong on the page. One filter here, and
  // the invitation to add another is a deliberate act.
  const { data: sessions, error: sErr } = await sb
    .from("attendance_sessions")
    .select("id, session_date, notes, mass_id, created_at, masses(name)")
    .gte("session_date", start)
    .lte("session_date", end)
    .not("mass_id", "is", null);

  if (sErr) return { ok: false, message: sErr.message };

  const sessionList = sessions ?? [];
  const monthSessionIds = new Set(sessionList.map((s) => String(s.id)));

  for (const id of uniqueIncluded) {
    if (!monthSessionIds.has(id)) {
      return { ok: false, message: "One or more selected sessions are not in this report month." };
    }
  }

  const includedSet = new Set(uniqueIncluded);

  let records: RecordRowForArchive[] = [];
  if (monthSessionIds.size) {
    // `members(full_name)` is selected because the archive copy stores the member's name
    // with the record: once the live rows are deleted, the name is no longer joinable.
    const { data: recs, error: rErr } = await sb
      .from("attendance_records")
      .select("id, session_id, member_id, members(full_name)")
      .in("session_id", [...monthSessionIds]);
    if (rErr) return { ok: false, message: rErr.message };
    records = (recs ?? []) as unknown as RecordRowForArchive[];
  }

  const { data: memberRowsDb, error: memErr } = await sb
    .from("members")
    .select("id, full_name");
  if (memErr) return { ok: false, message: memErr.message };

  const columnGroups = buildReportColumnGroups(sessionList, includedSet);
  const sessionOrder = flattenSessionOrder(columnGroups);

  const attended = new Set<string>();
  for (const r of records) attended.add(`${r.member_id}:${r.session_id}`);

  const members = ((memberRowsDb ?? []) as { id: string; full_name: string }[]).map((m) => ({
    id: String(m.id),
    name: formatNameLastFirst(m.full_name),
  }));

  const grid = buildReportGridSnapshot({
    columnGroups,
    members,
    attended,
    records,
    includedSessionIds: includedSet,
    monthSessionIds,
  });

  // Scoped to the report's own sessions. The old summary reported `records.length`, which
  // counted the whole month and so disagreed with `sessions_in_report` on any report that
  // left sessions out.
  let attendance = 0;
  for (const r of records) {
    if (includedSet.has(String(r.session_id))) attendance++;
  }

  return {
    ok: true,
    data: {
      monthStart,
      monthLabel: format(new Date(`${monthStart}T12:00:00`), "MMMM yyyy"),
      columnGroups,
      grid,
      sessionList: sessionList as unknown as SessionRowForArchive[],
      records,
      totals: {
        sessionsInMonth: sessionList.length,
        sessionsInReport: sessionOrder.length,
        attendance,
        memberCount: grid.rows.length,
        zeroAttendanceMembers: grid.rows.filter((r) => r.served === 0).length,
      },
    },
  };
}

/** Assemble the stored `summary_json`. v5 adds the grid so nothing depends on live rows. */
export function buildSummaryJson(input: {
  built: BuiltReportGrid;
  includedSessionIds: string[];
  dataArchived: boolean;
  churchName: string;
  churchAddress: string;
  reportTitle: string;
  version: 4 | 5;
}): Record<string, unknown> {
  const { built } = input;
  return {
    version: input.version,
    format: "selected_sessions_grid" as const,
    data_archived: input.dataArchived,
    churchName: input.churchName,
    churchAddress: input.churchAddress,
    reportTitle: input.reportTitle,
    monthLabel: built.monthLabel,
    monthStart: built.monthStart,
    included_session_ids: input.includedSessionIds,
    // Retained in v5: the PDF renderer still reads it, and dropping it would break
    // regenerating a report from its own stored summary.
    columnGroups: built.columnGroups,
    totals: {
      sessions_in_month: built.totals.sessionsInMonth,
      sessions_in_report: built.totals.sessionsInReport,
      attendance: built.totals.attendance,
      memberCount: built.totals.memberCount,
      zero_attendance_members: built.totals.zeroAttendanceMembers,
    },
    // v5 only. Everything above is identical to v4 so an old reader can still parse it.
    ...(input.version === 5
      ? {
          grid: {
            columns: built.grid.columns,
            rows: built.grid.rows.map((r) => ({
              memberId: r.memberId,
              name: r.name,
              cells: r.cells,
              served: r.served,
              servedInMonth: r.servedInMonth,
              remarks: r.remarks,
            })),
          },
        }
      : {}),
    memberSummary: built.grid.rows.map((r) => ({
      name: r.name,
      remarks: r.remarks,
      servedInSelectedSessions: r.served,
    })),
  };
}

/** Re-exported so callers do not need a second import to count served in the report. */
export { servedCountForSessions };
