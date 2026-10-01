import type { SupabaseClient } from "@supabase/supabase-js";
import { decideReportLock, monthBounds, type ReportLock } from "./report-lock";

export type GuardResult = ReportLock;

/**
 * Blocks attendance writes for a month whose report is awaiting approval or has
 * been approved. A rejected report does not block: rejection means "send it back",
 * so the month has to become editable again.
 *
 * `status` is selected rather than just the id because the answer depends on it.
 */
export async function guardReportNotGenerated(
  sb: SupabaseClient,
  sessionDate: string,
): Promise<GuardResult> {
  const { monthStart } = monthBounds(sessionDate);
  const { data, error } = await sb
    .from("reports")
    .select("status")
    .eq("report_month", monthStart)
    .maybeSingle();

  if (error) {
    // A guard that cannot read the reports table cannot promise the month is open.
    // Failing closed here is the difference between "the secretary sees a 500" and
    // "someone rewrites an approved month".
    return {
      locked: true,
      blocked: true,
      reason: "approved",
      message: "Cannot check whether this month is locked. Try again.",
    };
  }

  return decideReportLock(data?.status ?? null, monthStart);
}
