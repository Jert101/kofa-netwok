import { internalError, jsonOk, unauthenticated } from "@/lib/api/response";
import { NextResponse } from "next/server";
import { createWeekendSessions } from "@/features/attendance/server/create-weekend-sessions";
import { getSetting } from "@/lib/settings/store";
import { recordCronRun } from "@/lib/system/cron-run";

export const dynamic = "force-dynamic";

/**
 * ATT-2 cron: pre-create the coming Sunday's sessions.
 *
 * Runs Thursday 00:00 UTC (see vercel.json) so the secretary opens the week with the
 * sessions already on the calendar instead of adding them on Sunday morning with a
 * phone in one hand.
 *
 * Fails closed when CRON_SECRET is missing, for the same reason the maintenance sweep
 * does. Skipping the check would leave a public endpoint that writes to the parish's
 * attendance data on guessable dates — and a missing secret is a misconfiguration,
 * which is exactly when that should be loud rather than convenient.
 *
 * The setting check is the difference between "cron" and "should create". With
 * auto_create_sunday_sessions off, the job still runs and still answers, it just
 * leaves the decision to the secretary. Silently exiting would look identical to the
 * cron not firing at all, which is a much harder thing to notice.
 */
async function run(req: Request): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error(
      "[cron/sessions] CRON_SECRET is not set. Refusing to run. Set it to a random value.",
    );
    return internalError("This job is not configured.");
  }
  if (req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return unauthenticated("Unauthorized");
  }

  try {
    const enabled = (await getSetting("auto_create_sunday_sessions")) === "true";
    if (!enabled) {
      return jsonOk({
        skipped: true,
        reason: "auto_create_sunday_sessions is off",
      });
    }

    return jsonOk(await createWeekendSessions());
  } catch (e) {
    console.error("[cron/sessions] failed:", e instanceof Error ? e.message : e);
    return internalError();
  }
}

/** SYS-4: every run is recorded, so a weekly job that stops is visible rather than silent. */
async function recorded(req: Request): Promise<NextResponse> {
  return recordCronRun("sessions", () => run(req), (res) => `status ${res.status}`);
}

export const GET = recorded;

/** Kept so a scheduler can POST as well as GET. Both need the same secret. */
export const POST = recorded;
