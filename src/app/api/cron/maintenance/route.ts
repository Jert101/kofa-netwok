import { LOGIN_ATTEMPTS_RETENTION_DAYS, parseAuditRetentionMonths, parseAppealRetentionMonths, retentionCutoff } from "@/lib/maintenance/retention";
import { selectStrandedAppealIds } from "@/lib/appeals/expired-sweep";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getSetting } from "@/lib/settings/store";
import { jsonOk, internalError, unauthenticated } from "@/lib/api/response";
import {
  reminderPayload,
  selectPendingReminders,
  type PendingReportRow,
} from "@/lib/reports/reminders";
import { notify } from "@/lib/notify/notify";
import { logAudit } from "@/lib/audit/log-audit";
import { recordCronRun } from "@/lib/system/cron-run";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * AUTH-8 daily sweep. Module 02 leaves the cron entry to module 11.
 *
 * Fails closed when CRON_SECRET is missing. It used to skip the check entirely in
 * that case, which left a route that deletes audit rows reachable by anyone who
 * could guess the URL — and a misconfigured environment is exactly when you least
 * want a stranger running the retention sweep. Refusing loudly is the safe
 * failure: the alternative is deleting history nobody asked to delete.
 */
async function run(req: Request): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error(
      "[cron/maintenance] CRON_SECRET is not set. Refusing to run the sweep. Set it to a random value.",
    );
    // INTERNAL_ERROR, not UNAUTHENTICATED: nothing is wrong with the caller, the
    // server is misconfigured, and the operator needs it to read that way.
    return internalError("This job is not configured.");
  }
  if (req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return unauthenticated("Unauthorized");
  }

  try {
    const sb = getSupabaseAdmin();
    const now = new Date();

    const attemptsCutoff = retentionCutoff(now, LOGIN_ATTEMPTS_RETENTION_DAYS);
    const { error: attemptsError, count: attemptsDeleted } = await sb
      .from("login_attempts")
      .delete({ count: "exact" })
      .lt("attempted_at", attemptsCutoff.toISOString());
    if (attemptsError) throw new Error(`login_attempts: ${attemptsError.message}`);

    const months = parseAuditRetentionMonths(await getSetting("audit_retention_months"));
    const auditCutoff = retentionCutoff(now, months);
    const { error: auditError, count: auditDeleted } = await sb
      .from("audit_log")
      .delete({ count: "exact" })
      .lt("at", auditCutoff.toISOString());
    if (auditError) throw new Error(`audit_log: ${auditError.message}`);

    // APL-8 safety net, run before retention so a freshly expired item is not immediately
    // eligible for the purge.
    const strandedExpired = await expireStrandedAppeals(sb);

    // APL-3 retention: decided appeal items are kept as history, then pruned. Pending
    // rows are never touched, so the sweep cannot quietly dispose of work nobody has
    // looked at.
    const appealMonths = parseAppealRetentionMonths(await getSetting("appeal_retention_months"));
    const appealCutoff = retentionCutoff(now, appealMonths);
    const { error: appealError, count: appealDeleted } = await sb.rpc("purge_resolved_appeal_items", {
      p_before: appealCutoff.toISOString(),
    });
    if (appealError) throw new Error(`appeals: ${appealError.message}`);

    // Recorded as its own job because the spec lists it separately, and because "the sweep ran" and
    // "the reminders were sent" fail for completely different reasons.
    const remindersSent = await recordCronRun(
      "report-reminders",
      () => sendPendingReportReminders(sb, now),
      (n) => `reminders sent: ${n}`,
    );

    return jsonOk({
      loginAttemptsDeleted: attemptsDeleted ?? 0,
      auditRowsDeleted: auditDeleted ?? 0,
      auditRetentionMonths: months,
      strandedAppealsExpired: strandedExpired,
      appealItemsDeleted: appealDeleted ?? 0,
      appealRetentionMonths: appealMonths,
      reportRemindersSent: remindersSent,
    });
  } catch (e) {
    console.error("[cron/maintenance] sweep failed:", e instanceof Error ? e.message : e);
    return internalError("Sweep failed.");
  }
}

/**
 * APL-8: close appeals that the report lock made unanswerable.
 *
 * The expiry inside report generation only covers the month being generated. This covers
 * every other month, which matters because a lock can land on appeals from before the
 * expiry code existed — those items would otherwise sit pending forever, showing in every
 * review queue and in the calendar's pending count, with no way for a reviewer to touch
 * them.
 *
 * Writes only rows that are still `pending`, so it is safe to run twice and safe to run
 * against a month a reviewer is working on right now: nothing decided is ever rewritten.
 */
async function expireStrandedAppeals(sb: ReturnType<typeof getSupabaseAdmin>): Promise<number> {
  const { data: locked } = await sb
    .from("reports")
    .select("report_month")
    .neq("status", "rejected");

  const lockedMonths = (locked ?? []).map((r) => String(r.report_month));
  if (lockedMonths.length === 0) return 0;

  const { data: pendingRows } = await sb
    .from("attendance_appeal_items")
    .select("id, attendance_appeals!inner(session_id, attendance_sessions!inner(session_date))")
    .eq("status", "pending")
    .limit(2000);

  const candidates = (pendingRows ?? []).map((row) => {
    const parent = (Array.isArray(row.attendance_appeals) ? row.attendance_appeals[0] : row.attendance_appeals) as
      | { attendance_sessions?: unknown }
      | null;
    const session = (
      Array.isArray(parent?.attendance_sessions) ? parent?.attendance_sessions[0] : parent?.attendance_sessions
    ) as { session_date?: string } | null;
    return { id: String(row.id), session_date: String(session?.session_date ?? "") };
  });

  const ids = selectStrandedAppealIds(candidates, lockedMonths);
  if (ids.length === 0) return 0;

  // The status stays in the WHERE clause on purpose: if a reviewer approved one of these
  // between the read and this update, the row is no longer pending and is left alone.
  const { data: updated, error } = await sb
    .from("attendance_appeal_items")
    .update({ status: "expired", resolution: "expired", reviewed_at: new Date().toISOString() })
    .in("id", ids)
    .eq("status", "pending")
    .select("id");

  if (error) throw new Error(`expire stranded appeals: ${error.message}`);

  console.log(`[cron/maintenance] expired ${updated?.length ?? 0} appeals stranded by a report lock`);
  return updated?.length ?? 0;
}

/**
 * RPT-5: remind the super admin about a report that has been waiting too long.
 *
 * Returns the number of reminders sent, which is the number of reports nudged — each plan
 * writes one notification per recipient.
 *
 * The "already reminded?" question is answered from `audit_log` rather than a dedicated
 * table. That keeps this to no new schema, and the audit trail is the right home for it
 * anyway: it records who was told what, and it survives any later cleanup of the
 * notifications table. The one consequence is that audit retention bounds the memory of
 * what has been sent — if retention is set very short, a report left pending for longer
 * than that window could start its three reminders again. The result is duplicate nagging,
 * never a missed or incorrect decision.
 */
async function sendPendingReportReminders(
  sb: ReturnType<typeof getSupabaseAdmin>,
  now: Date,
): Promise<number> {
  const { data: pending, error: pendingError } = await sb
    .from("reports")
    .select("id, report_month, title, status, created_at")
    .eq("status", "pending");

  if (pendingError) throw new Error(`pending reports: ${pendingError.message}`);
  if (!pending?.length) return 0;

  const ids = pending.map((r) => String(r.id));

  // Prior reminders for these reports only. Bounded by the cap in the planner, but the
  // query is not: a report that keeps being re-generated accumulates rows, so the read is
  // limited rather than assumed small.
  const { data: priorRows, error: priorError } = await sb
    .from("audit_log")
    .select("entity_id, at")
    .eq("action", "report_reminder_sent")
    .eq("entity_type", "report")
    .in("entity_id", ids)
    .order("at", { ascending: true })
    .limit(1000);

  if (priorError) throw new Error(`prior reminders: ${priorError.message}`);

  const plans = selectPendingReminders({
    now,
    reports: (pending as PendingReportRow[]).map((r) => ({
      id: String(r.id),
      report_month: String(r.report_month),
      title: (r.title as string | null) ?? null,
      status: String(r.status),
      created_at: String(r.created_at),
    })),
    priorReminders: (priorRows ?? []).map((r) => ({
      reportId: String(r.entity_id),
      sentAt: String(r.at),
    })),
  });

  if (plans.length === 0) return 0;

  let sent = 0;
  for (const plan of plans) {
    // The catalog owns the reminder text and the recipients. This file owns the decision to send
    // and the audit row that proves it was sent.
    //
    // `from_role` is 'system', not 'super_admin': this is the scheduler speaking, not a person,
    // and the audit row below is the honest record of that.
    const outcome = await notify("report_reminder", reminderPayload(plan), { fromRole: "system" });

    // A failed notification must not stop the audit row, or the report would be silently marked as
    // reminded today and never nudged again. So: no inbox row, no claim that there was one.
    if (outcome.inbox === "failed") {
      console.error(
        `[cron/maintenance] reminder insert failed for report ${plan.reportId}; not marking as sent`,
      );
      continue;
    }

    await logAudit({
      action: "report_reminder_sent",
      actor: { role: null, memberId: null, name: null },
      entityType: "report",
      entityId: plan.reportId,
      meta: { report_month: plan.reportMonth, reminder_number: plan.reminderNumber, waiting_hours: plan.waitingHours },
    });

    sent++;
  }

  if (sent > 0) {
    console.log(`[cron/maintenance] sent ${sent} pending report reminder(s)`);
  }
  return sent;
}

/**
 * SYS-4: every run is recorded.
 *
 * Two rows, not one: this endpoint does the retention sweep and the report reminders, and the spec's job
 * list treats them separately. A single row would answer "did maintenance run" without answering "were
 * the pending reports nudged", which is the question somebody actually has at 8am on a Monday.
 */
async function recorded(req: Request): Promise<NextResponse> {
  return recordCronRun(
    "maintenance",
    () => run(req),
    (res) => `status ${res.status}`,
  );
}

export const GET = recorded;

/** Kept so a scheduler can POST as well as GET. Both need the same secret. */
export const POST = recorded;
