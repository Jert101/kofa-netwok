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

  // 029 made `report_month` unique only for non-rejected rows, so a month can now hold a
  // rejected row and an active row at the same time. Two consequences:
  //
  //   - The filter is mandatory. Without `.neq("status", "rejected")` this reads the
  //     rejected row and declares an open month locked, so a rejection would never free
  //     the month up.
  //   - `.limit(1)` before `.maybeSingle()` is deliberate. maybeSingle() errors on more
  //     than one match, and that would turn this guard's read error into "locked", which
  //     is the wrong way to fail. Limiting first means it can only ever return a row or
  //     null, and a genuine read failure still lands in the branch below.
  //
  // Newest first, so if a month somehow has more than one non-rejected row (the partial
  // index prevents it; a manual insert could still do it) the latest decision wins.
  const { data, error } = await sb
    .from("reports")
    .select("status, created_at")
    .eq("report_month", monthStart)
    .neq("status", "rejected")
    .order("created_at", { ascending: false })
    .limit(1)
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
