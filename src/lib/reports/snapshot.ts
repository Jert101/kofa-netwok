/**
 * Reading a report's stored summary, in one place.
 *
 * Two shapes reach the UI and they are not the same. `summary_json` stores totals in
 * snake_case (`sessions_in_report`), because that is what the PDF renderer reads. The preview
 * endpoint returns the builder's own camelCase (`sessionsInReport`), because it hands
 * `buildReportGrid`'s result straight through. Reading either key against the other produces
 * "—" in the UI with no error anywhere, which is how the hub's totals tiles looked correct in
 * code and wrong on screen.
 *
 * So the mapping is explicit and both shapes are accepted.
 */

export type ReportTotals = {
  sessionsInReport: number | null;
  sessionsInMonth: number | null;
  attendance: number | null;
  memberCount: number | null;
  zeroAttendanceMembers: number | null;
};

function num(...values: unknown[]): number | null {
  for (const v of values) {
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

export function normaliseTotals(raw: Record<string, unknown> | null): ReportTotals {
  const r = raw ?? {};
  return {
    sessionsInReport: num(r.sessions_in_report, r.sessionsInReport),
    sessionsInMonth: num(r.sessions_in_month, r.sessionsInMonth),
    attendance: num(r.attendance),
    memberCount: num(r.memberCount, r.member_count),
    zeroAttendanceMembers: num(r.zero_attendance_members, r.zeroAttendanceMembers),
  };
}

/** `2026-09-06` to `6 Sep`. Short, because a month of columns is already wide. */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function columnHeading(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${Number(m[3])} ${month}` : date;
}