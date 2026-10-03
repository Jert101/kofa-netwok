import {
  describeWindowOpening,
  evaluateReportWindow,
  type ReportWindowStatus,
} from "@/lib/reports/rules";

/**
 * RPT-1 status strip.
 *
 * The strip has to answer one question — "what can I do about this month right now?" — and
 * give a specific reason either way. That decision is pure once the three inputs are known,
 * so it lives here and is tested rather than being assembled inside the component from
 * several loosely related booleans. The previous UI threaded `allowed`, `schedule_allowed`,
 * `report_exists`, `can_generate_previous_month` and `activeMonthHasReport` through five
 * different state values, which is exactly the shape that produces contradictory copy when
 * two of them disagree.
 */

export type StatusTone = "ready" | "waiting" | "blocked" | "neutral";

export type StatusStripInput = {
  /** Target month, YYYY-MM-DD. */
  monthStart: string;
  now: Date;
  timeZone: string;
  /** Status of the month's active report, or null when none exists. */
  existingStatus: ReportWindowStatus;
  /** Whether the viewer may bypass the schedule (admin only). */
  canBypass: boolean;
};

export type StatusStrip = {
  tone: StatusTone;
  label: string;
  detail: string;
  /** True when the Generate action should be offered. */
  canGenerate: boolean;
  /** True when the admin override should be offered instead. */
  canBypass: boolean;
};

export function buildStatusStrip(input: StatusStripInput): StatusStrip {
  const { monthStart, now, timeZone, existingStatus, canBypass } = input;
  const decision = evaluateReportWindow({
    now,
    monthStart,
    timeZone,
    existingStatus,
    bypass: canBypass,
  });

  const monthLabel = monthLabelFrom(monthStart);

  // An existing report outranks the schedule. A month whose report is already approved is
  // "done", and saying "opens Sunday evening" would read as though it were still waiting.
  if (existingStatus === "pending") {
    return {
      tone: "waiting",
      label: "Pending approval",
      detail: `The ${monthLabel} report was generated and is waiting for the super admin to review it.`,
      canGenerate: false,
      canBypass: false,
    };
  }

  if (existingStatus === "approved") {
    return {
      tone: "neutral",
      label: "Already exists",
      detail: `The ${monthLabel} report has been generated and approved.`,
      canGenerate: false,
      canBypass: false,
    };
  }

  // A rejected row does not hold the month, so the strip behaves exactly as if there were
  // no report at all: the month can be generated again.
  if (decision.allowed) {
    return {
      tone: "ready",
      label: "Ready to generate",
      detail: `The ${monthLabel} report can be generated now.`,
      canGenerate: true,
      canBypass: canBypass,
    };
  }

  if (decision.blockedBy === "timezone") {
    return {
      tone: "blocked",
      label: "Schedule unavailable",
      detail: "The church timezone is not configured correctly, so the report window cannot be checked.",
      canGenerate: false,
      canBypass: canBypass,
    };
  }

  // Outside the window, with no report to show. Naming the moment is the difference between
  // a user who knows when to come back and one who has to keep guessing.
  const opens = describeWindowOpening(decision.opensAt);
  return {
    tone: "blocked",
    label: "Outside schedule",
    detail: opens
      ? `Reports open ${opens} (church time).`
      : `The ${monthLabel} report opens on the last Sunday of the month at 8:00 PM.`,
    canGenerate: false,
    canBypass: canBypass,
  };
}

/** "September 2026" from a YYYY-MM-DD month start. Tolerant of a bad value. */
export function monthLabelFrom(monthStart: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(monthStart);
  if (!m) return monthStart;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(date.getTime())) return monthStart;
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

/**
 * RPT-1 "Past reports" row, and the reason a status badge exists at all.
 *
 * The download button is only offered for approved reports, because the PDF route refuses
 * every other status for non-super-admins. Rendering the same condition here keeps the
 * button from appearing and then 403-ing on click.
 */
export type ReportRowView = {
  id: string;
  title: string;
  month: string;
  monthLabel: string;
  status: string;
  generatedBy: string;
  generatedAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  dataArchived: boolean;
};

export type PastReportRow = {
  id: string;
  report_month: string;
  title: string | null;
  status: string;
  generated_by: string;
  created_at: string;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  review_note?: string | null;
  /** Only the flags this view needs; the grid is fetched on demand. */
  summary_json?: unknown;
};

export function toReportRowView(row: PastReportRow): ReportRowView {
  const summary = row.summary_json;
  const dataArchived =
    summary && typeof summary === "object" && summary !== null && "data_archived" in summary
      ? (summary as { data_archived?: boolean }).data_archived !== false
      : true;

  const month = String(row.report_month ?? "");
  return {
    id: String(row.id),
    title: row.title || `${monthLabelFrom(month)} report`,
    month,
    monthLabel: monthLabelFrom(month),
    status: String(row.status ?? "approved"),
    generatedBy: row.generated_by === "admin" ? "Admin" : "Secretary",
    generatedAt: String(row.created_at ?? ""),
    reviewedBy: row.reviewed_by ?? null,
    reviewedAt: row.reviewed_at ?? null,
    reviewNote: row.review_note ?? null,
    dataArchived,
  };
}

/** RPT-1: approved rows get Download; every other status gets a pill instead. */
export function isDownloadable(status: string): boolean {
  return status === "approved";
}

export function statusLabel(status: string): string {
  switch (status) {
    case "approved":
      return "Approved";
    case "pending":
      return "Pending approval";
    case "rejected":
      return "Rejected";
    default:
      return status;
  }
}

/**
 * How long a report has been waiting, for the pending card (RPT-4) and the strip.
 *
 * Rendered coarsely on purpose: "3 days" is what matters for deciding whether to chase
 * someone. Minutes-level precision invites reading "waiting 4 minutes" as "no problem".
 */
export function describeWait(createdAt: string, now: Date): string {
  const then = Date.parse(createdAt);
  if (Number.isNaN(then)) return "unknown";

  const hours = Math.floor((now.getTime() - then) / 3_600_000);
  if (hours < 1) return "under an hour";
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"}`;

  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}