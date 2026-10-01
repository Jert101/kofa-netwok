import { comingSunday } from "@/lib/attendance/weekend";
import { todayInTimeZone } from "@/lib/attendance/metrics";
import { guardReportNotGenerated } from "@/lib/reports/check-report-lock";
import { getSetting } from "@/lib/settings/store";
import { notifyAttendanceSessionUpdated } from "@/lib/push/attendance-notify";
import { createSessionAtDate } from "@/features/attendance/server/create-session";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export type WeekendResult = {
  sunday: string;
  created: { id: string; mass_name: string }[];
  skipped: string[];
  reason: string | null;
};

/**
 * ATT-2: create the coming weekend's sessions, one per active Mass flagged
 * `default_sunday`.
 *
 * Shared by the Thursday cron and the manual button on the calendar. This is
 * deliberate: if the button had its own copy of the logic, the parish could be told
 * "done, they were created" while the cron quietly created something different.
 *
 * Reruns are harmless. The unique key on (date, mass) means a second run finds the
 * sessions already there and reports them as skipped, so a cron that fires twice, or
 * that runs after someone used the button, needs no special handling.
 *
 * A locked month is skipped entirely rather than half-created. Sessions may still be
 * created ahead of time per ATT-8, but a locked month is read-only, so new rows would
 * only sit on the calendar looking like data that can never be filled in.
 */
export async function createWeekendSessions(): Promise<WeekendResult> {
  const sb = getSupabaseAdmin();

  const { data: masses, error: massError } = await sb
    .from("masses")
    .select("id, name, sort_order")
    .eq("is_active", true)
    .eq("default_sunday", true)
    .order("sort_order", { ascending: true });

  if (massError) throw new Error(massError.message);

  const timeZone = await getSetting("report_timezone");
  const sunday = comingSunday(todayInTimeZone(new Date(), timeZone));

  if (!masses?.length) {
    return { sunday, created: [], skipped: [], reason: "no_default_sunday_masses" };
  }

  const guard = await guardReportNotGenerated(sb, sunday);
  if (guard.blocked) {
    // Not an error. The month's attendance is closed, so there is nothing useful to
    // create. Saying so plainly beats returning a 409 the button renders as a failure.
    return { sunday, created: [], skipped: masses.map((m) => m.name), reason: guard.message };
  }

  const created: { id: string; mass_name: string }[] = [];
  const skipped: string[] = [];

  for (const mass of masses) {
    const result = await createSessionAtDate(sb, {
      sessionDate: sunday,
      massId: mass.id,
      notify: false,
    });

    if (result.status === "created") {
      created.push({ id: result.id, mass_name: mass.name });
    } else {
      skipped.push(mass.name);
    }
  }

  // Notified once for the batch rather than per session, so a parish with several
  // Sunday Masses gets one push notification instead of several arriving at once.
  for (const session of created) void notifyAttendanceSessionUpdated(session.id);

  return { sunday, created, skipped, reason: null };
}
