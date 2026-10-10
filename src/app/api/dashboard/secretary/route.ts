import { NextRequest } from "next/server";
import { requireRole } from "@/lib/api/guard";
import { selectSessionsResilient, sessionLabel } from "@/lib/attendance/guard-session-write";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { internalError, jsonOk } from "@/lib/api/response";
import { getSetting } from "@/lib/settings/store";
import { churchToday, shiftDays } from "@/lib/time/church-time";
import { isSunday } from "@/lib/insights/metrics";
import { parseWindowDays } from "@/lib/appeals/window";

/**
 * DSH-2: the secretary's "Needs attention".
 *
 * Three things, each of which is an unanswered obligation rather than a statistic: a Sunday that has
 * passed with a session and no attendance recorded, appeals waiting for an answer, and whether the
 * month's report can be generated.
 *
 * The point of this card is that it is a *worklist*. Every item carries the path that clears it, so a
 * secretary who opens the app on Monday morning knows what Monday morning is for.
 */
export async function GET(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["secretary"]);
  if (!g.ok) return g.response;

  try {
    const asOf = churchToday(await getSetting("report_timezone"));

    // How far back to look for "nobody recorded anything". Four weeks, because a report month is a
    // calendar month and anything older is the previous report's problem.
    const from = shiftDays(asOf, -28);

    const sb = getSupabaseAdmin();

    const [sessionsResult, appealsResult, reportsResult, windowDays] = await Promise.all([
      // Resilient to a pre-041 database (see guard-session-write): there every session is a Mass.
      selectSessionsResilient<Record<string, unknown>[]>(
        (columns) =>
          sb
            .from("attendance_sessions")
            .select(columns)
            .gte("session_date", from)
            .lte("session_date", asOf),
        "id, session_date, mass_id, title, masses(name)",
        "id, session_date, mass_id, masses(name)",
      ),
      sb.from("attendance_appeal_items").select("id, status").eq("status", "pending"),
      sb
        .from("reports")
        .select("id, report_month, status")
        .eq("status", "pending"),
      getSetting("appeal_window_days").then((v) => parseWindowDays(v)),
    ]);

    const sessions = sessionsResult.data ?? [];

    // A session nobody recorded anything against. Filtered to Sundays and to sessions that are over,
    // so the list is exclusively things that need doing today.
    const recordedIds = new Set<string>();
    if (sessions.length > 0) {
      const { data: records } = await sb
        .from("attendance_records")
        .select("session_id")
        .in(
          "session_id",
          sessions.map((s) => String(s.id)),
        );
      for (const r of records ?? []) recordedIds.add(String(r.session_id));
    }

    const unrecorded = sessions
      .filter((s) => !recordedIds.has(String(s.id)) && String(s.session_date) < asOf)
      .map((s) => ({
        session_id: String(s.id),
        date: String(s.session_date),
        // A meeting the secretary has not marked yet needs doing exactly as much as a Mass does --
        // the nudge is "record this", not "record a Mass" -- but it must arrive wearing its own name,
        // not the word "Mass".
        mass_name: sessionLabel({
          mass_id: s.mass_id as string | null,
          title: s.title as string | null,
          massName: (s.masses as { name?: string } | null)?.name,
        }),
        days_ago: daysAgo(String(s.session_date), asOf),
        sunday: isSunday(String(s.session_date)),
      }))
      // Sundays first: they are the Mass the parish actually attends, so an unrecorded Sunday is more
      // urgent than an unrecorded weekday.
      .sort((a, b) => Number(b.sunday) - Number(a.sunday) || b.days_ago - a.days_ago);

    const month = asOf.slice(0, 7);
    const reportForMonth = (reportsResult.data ?? []).find(
      (r) => String(r.report_month).slice(0, 7) === month,
    );
    const generated = Boolean(reportForMonth);

    return jsonOk({
      as_of: asOf,
      unrecorded_sessions: unrecorded,
      pending_appeals: (appealsResult.data ?? []).length,
      appeal_window_days: windowDays,
      // "Report opens Sunday 8:00 PM" or "Ready to generate". Spec §DSH-2.
      report_readiness: generated
        ? { state: "generated", report_id: String(reportForMonth!.id), text: "This month's report has been generated." }
        : reportOpensAt(asOf, month),
      empty: unrecorded.length === 0 && (appealsResult.data ?? []).length === 0,
    });
  } catch (e) {
    console.error("[dashboard/secretary] failed:", e instanceof Error ? e.message : e);
    return internalError("Could not build your dashboard.");
  }
}

function daysAgo(date: string, asOf: string): number {
  const a = Date.parse(`${date}T00:00:00Z`);
  const b = Date.parse(`${asOf}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

/**
 * When the month's report can be generated.
 *
 * The secretary generates a report after the month is over, so if today is inside the month there is
 * nothing to generate and saying "Ready to generate" would be wrong. The month end is returned instead,
 * and the page phrases it.
 */
function reportOpensAt(asOf: string, month: string): {
  state: "waiting_for_month_end" | "ready";
  opens_on: string;
  text: string;
} {
  const [y, m] = month.split("-").map(Number);
  const monthEndsOn = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);

  if (asOf > monthEndsOn) {
    return { state: "ready", opens_on: monthEndsOn, text: "Ready to generate." };
  }
  return {
    state: "waiting_for_month_end",
    opens_on: monthEndsOn,
    text: `The report can be generated after ${monthEndsOn}.`,
  };
}