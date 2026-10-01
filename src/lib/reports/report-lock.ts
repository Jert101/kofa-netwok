/**
 * When a month of attendance is read-only, and why.
 *
 * The rule is simple to state and was previously implemented wrongly: a month is
 * locked while a report for it exists, *unless* that report was rejected. Rejection
 * is how a super admin sends a month back for correction, so a rejected report has
 * to let editing start again. The old guard asked only "does a report row exist",
 * which meant a rejected report kept the month locked and the secretary could not
 * fix the very mistakes the rejection was about.
 *
 * The decision is kept separate from the database read so it can be tested without
 * one. `guardReportNotGenerated` in check-report-lock.ts does the reading.
 */

export type ReportStatus = "pending" | "approved" | "rejected";

export type ReportLockReason = "pending_approval" | "approved";

export type ReportLock =
  | { locked: false; blocked: false; reason: null; message: null }
  | { locked: true; blocked: true; reason: ReportLockReason; message: string };

/** "2026-08-01" -> "August 2026", for the banner and the 409 message. */
export function monthLabel(monthStart: string): string {
  const parsed = new Date(`${monthStart}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return monthStart;
  return parsed.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** First and last day of the month a session date falls in, as ISO dates. */
export function monthBounds(sessionDate: string): { monthStart: string; monthEnd: string } {
  const monthStart = `${sessionDate.slice(0, 7)}-01`;
  const [year, month] = monthStart.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { monthStart, monthEnd: `${monthStart.slice(0, 7)}-${String(lastDay).padStart(2, "0")}` };
}

/**
 * `status` is null when no report exists for the month.
 *
 * An unrecognised status is treated as locked rather than open. Only an explicit
 * "rejected" unlocks a month, because that is the one status that is a decision to
 * send work back. Guessing that some new status is also permission to keep editing
 * would quietly reopen a month nobody meant to reopen.
 */
export function decideReportLock(status: string | null | undefined, monthStart: string): ReportLock {
  if (status === null || status === undefined || status === "rejected") {
    return { locked: false, blocked: false, reason: null, message: null };
  }

  const month = monthLabel(monthStart);
  const reason: ReportLockReason = status === "pending" ? "pending_approval" : "approved";
  const state = status === "pending" ? "pending approval" : "approved";
  return {
    locked: true,
    blocked: true,
    reason,
    message: `Cannot modify attendance: the ${month} report is ${state}.`,
  };
}
