/**
 * RPT-5: nudge the super admin about a report nobody has looked at.
 *
 * Kept free of database access so the rules that decide *whether* to send can be tested
 * directly. The awkward parts of this feature are all arithmetic on time �?" when the report
 * turned old enough, whether today has already been covered, how many have gone out �?" and
 * that is exactly what is easy to get subtly wrong and impossible to notice by reading.
 */

import { copyFor } from "@/lib/notify/events";

/** A pending report has to be this old before anyone is told about it. */
export const REMINDER_MIN_AGE_HOURS = 48;

/** Cap per report, so one forgotten report cannot spam two inboxes indefinitely. */
export const REMINDER_MAX_PER_REPORT = 3;

/** Spec §RPT-5: the super admin decides, the admin is kept in the loop. */
export const REMINDER_RECIPIENTS = ["super_admin", "admin"] as const;
export type ReminderRecipient = (typeof REMINDER_RECIPIENTS)[number];

export type PendingReportRow = {
  id: string;
  report_month: string;
  title: string | null;
  status: string;
  created_at: string;
};

/** One previously sent reminder, read back from the audit trail. */
export type PriorReminder = {
  reportId: string;
  sentAt: string;
};

export type ReminderPlan = {
  reportId: string;
  reportMonth: string;
  title: string;
  /** Whole hours the report has been waiting at the moment of planning. */
  waitingHours: number;
  /** 1-based; equals the number of reminders already sent plus one. */
  reminderNumber: number;
  recipients: readonly ReminderRecipient[];
};

/**
 * UTC calendar day, which is what "one reminder per day" is measured in.
 *
 * The cron itself fires at 00:00 UTC, so UTC days and cron runs line up exactly. Using the
 * church's timezone here instead would mean a run could fall either side of local midnight
 * and send twice, which is the specific failure this guard exists to prevent.
 */
function utcDay(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * Decide which reports deserve a reminder right now.
 *
 * A report qualifies when it is still pending, at least `REMINDER_MIN_AGE_HOURS` old, has
 * not already been reminded today, and has fewer than `REMINDER_MAX_PER_REPORT` reminders
 * in total.
 */
export function selectPendingReminders(params: {
  now: Date;
  reports: PendingReportRow[];
  priorReminders: PriorReminder[];
}): ReminderPlan[] {
  const { now, reports, priorReminders } = params;
  const nowMs = now.getTime();
  const today = utcDay(now.toISOString());

  const byReport = new Map<string, PriorReminder[]>();
  for (const r of priorReminders) {
    const list = byReport.get(r.reportId);
    if (list) list.push(r);
    else byReport.set(r.reportId, [r]);
  }

  const plans: ReminderPlan[] = [];

  for (const report of reports) {
    if (report.status !== "pending") continue;

    const created = Date.parse(report.created_at);
    // An unparseable timestamp is treated as not old enough. Reminding someone about a
    // report whose age cannot be established is worse than staying quiet for a day.
    if (Number.isNaN(created)) continue;

    const waitingHours = (nowMs - created) / 3_600_000;
    if (waitingHours < REMINDER_MIN_AGE_HOURS) continue;

    const prior = byReport.get(report.id) ?? [];
    if (prior.length >= REMINDER_MAX_PER_REPORT) continue;
    if (prior.some((r) => utcDay(r.sentAt) === today)) continue;

    plans.push({
      reportId: report.id,
      reportMonth: String(report.report_month).slice(0, 7),
      title: report.title ?? "Monthly report",
      waitingHours: Math.floor(waitingHours),
      reminderNumber: prior.length + 1,
      recipients: REMINDER_RECIPIENTS,
    });
  }

  // Oldest first, so when several reports are overdue the output is stable across runs
  // rather than following whatever order the database happened to return.
  plans.sort((a, b) => b.waitingHours - a.waitingHours || a.reportId.localeCompare(b.reportId));
  return plans;
}

/**
 * Notification payload.
 *
 * The wording lives in the event catalog (`notify.ts` owns copy, so the reminder text and every
 * other message read the same way and there is one place to change it). This function's job is to
 * turn hours into days and hand over the facts, because that conversion is the part worth testing.
 */
export function reminderPayload(plan: ReminderPlan) {
  return {
    report_label: plan.title,
    period_label: plan.reportMonth,
    waiting_days: Math.max(1, Math.floor(plan.waitingHours / 24)),
    reminder_number: plan.reminderNumber,
    max_reminders: REMINDER_MAX_PER_REPORT,
  };
}

/**
 * The rendered reminder, for the caller's own logging and for the tests that assert on wording.
 *
 * Thin by design. If this starts building strings, there are two copies of the message and one of
 * them will be wrong.
 */
export function buildReminderNotification(plan: ReminderPlan): { title: string; body: string } {
  return copyFor("report_reminder", reminderPayload(plan));
}