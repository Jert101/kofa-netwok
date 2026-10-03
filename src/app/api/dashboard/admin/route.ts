import { NextRequest } from "next/server";
import { requireRole } from "@/lib/api/guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { internalError, jsonOk } from "@/lib/api/response";
import { getSetting } from "@/lib/settings/store";
import { loadDashboardHistory, pastSessions } from "@/lib/insights/server/history";
import {
  atRiskMembers,
  attendanceTrend,
  averageAttendance,
  birthdaysWithin,
  describeTrend,
  describeTurnout,
  inactiveMembers,
  sessionsHeld,
  turnoutByMass,
} from "@/lib/insights/metrics";
import { churchToday, monthEnd, monthStart } from "@/lib/time/church-time";
import { truncateName } from "@/lib/time/church-time-labels";
import { AUDIT_ACTION_LABELS, type AuditAction } from "@/lib/audit/actions";

/**
 * DSH-1 and DSH-7: the admin dashboard.
 *
 * One endpoint rather than seven fetches from the page, because every figure here is derived from a
 * single history read and fetching them separately would run that read seven times. The alternative --
 * the page calling `/api/admin/inactive-members` and `/api/admin/top-servers` as well -- is what the
 * spec's "moved onto shared metrics" line asks to remove.
 */
export async function GET(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["admin"]);
  if (!g.ok) return g.response;

  try {
    const asOf = churchToday(await getSetting("report_timezone"));
    const history = await loadDashboardHistory({ weeks: 12, months: 4 });
    const sessions = pastSessions(history.sessions, asOf);

    const monthFrom = monthStart(asOf);
    const monthTo = monthEnd(asOf);
    const monthSessions = sessions.filter((s) => s.date >= monthFrom && s.date <= monthTo);

    const trendPoints = attendanceTrend(sessions, asOf, 12);
    const turnout = turnoutByMass(sessions, asOf, 8);
    const atRisk = atRiskMembers(history.members, sessions, history.marks, asOf);
    const inactive = inactiveMembers(history.members, history.marks, asOf);
    const birthdays = birthdaysWithin(history.members, asOf, 7);

    const [registrations, appeals, reports, activity] = await Promise.all([
      countWhere("registration_requests", { status: "pending" }),
      countWhere("attendance_appeal_items", { status: "pending" }),
      countWhere("reports", { status: "pending" }),
      recentActivity(),
    ]);

    const activeMembers = history.members.filter((m) => m.isActive).length;
    const heldThisMonth = sessionsHeld(monthSessions).length;

    return jsonOk({
      as_of: asOf,
      kpis: {
        active_members: activeMembers,
        sessions_this_month: heldThisMonth,
        average_attendance: averageAttendance(monthSessions),
        pending_registrations: registrations,
        pending_appeals: appeals,
        pending_reports: reports,
      },
      trend: trendPoints,
      // Spec §DSH-1: every chart carries a text summary, because a chart is a picture of numbers and a
      // screen reader cannot read a picture of numbers.
      trend_summary: describeTrend(trendPoints),
      turnout,
      turnout_summary: describeTurnout(turnout),
      at_risk: atRisk.map((r) => ({
        member_id: r.memberId,
        full_name: r.fullName,
        truncated_name: truncateName(r.fullName).text,
        reasons: r.reasons,
        reasons_text: r.reasons
          .map((reason) =>
            reason === "stopped"
              ? "missed the last three weekends they had been coming to"
              : "attending much less than earlier in the year",
          )
          .join("; "),
        recent_rate: r.recentRate,
        baseline_rate: r.baselineRate,
      })),
      inactive: inactive.map((m) => ({
        member_id: m.id,
        full_name: m.fullName,
        truncated_name: truncateName(m.fullName).text,
      })),
      birthdays,
      activity,
      // Spec §DSH-8: an empty database gets a sentence that says what to do next, not a zero that looks
      // like a problem.
      empty: {
        no_sessions_this_month: heldThisMonth === 0,
        no_members: activeMembers === 0,
      },
    });
  } catch (e) {
    console.error("[dashboard/admin] failed:", e instanceof Error ? e.message : e);
    return internalError("Could not build the dashboard.");
  }
}

async function countWhere(table: string, filters: Record<string, string>): Promise<number> {
  const sb = getSupabaseAdmin();
  let q = sb.from(table).select("id", { count: "exact", head: true });
  for (const [column, value] of Object.entries(filters)) {
    q = q.eq(column, value);
  }
  const { count, error } = await q;
  if (error) {
    console.error(`[dashboard/admin] count ${table} failed:`, error.message);
    return 0;
  }
  return count ?? 0;
}

/**
 * DSH-7: the last ten audit entries in plain language.
 *
 * Admin only, per spec: the audit log names who did what, which is not something every signed-in user
 * should be able to page through.
 */
async function recentActivity() {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("audit_log")
    .select("id, at, actor_role, actor_name, action, entity_type, entity_id")
    .order("at", { ascending: false })
    .limit(10);

  if (error) {
    console.error("[dashboard/admin] activity failed:", error.message);
    return [];
  }

  return (data ?? []).map((row) => {
    const action = String(row.action) as AuditAction;
    const actor = (row.actor_name as string | null) ?? null;
    return {
      id: String(row.id),
      at: String(row.at),
      actor_name: actor,
      actor_role: (row.actor_role as string | null) ?? null,
      action,
      text: describeAction(action, actor),
    };
  });
}

/**
 * "Maria Santos (Secretary) approved a registration."
 *
 * Built from the action's own label rather than a second hand-written phrase table here, because
 * `AUDIT_ACTION_LABELS` is the list that has to stay in step with module 02's action enum and a copy in
 * this file would quietly fall behind it.
 */
function describeAction(action: AuditAction, actor: string | null): string {
  const label = AUDIT_ACTION_LABELS[action] ?? action.replace(/_/g, " ");
  const verb = label.charAt(0).toLowerCase() + label.slice(1);
  return actor ? `${actor} ${verb}.` : `${label}.`;
}