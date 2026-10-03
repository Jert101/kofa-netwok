import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { pruneCronRuns, recordCronRun } from "@/lib/system/cron-run";

export const dynamic = "force-dynamic";

/**
 * COM-6: the daily sweep.
 *
 * The maintenance cron already owns retention for login attempts, audit rows, appeals and report
 * reminders. This route owns the announcement side of the same sweep, because an expired post that
 * somebody can still find is a bug the reader has not caught yet. The table is small enough that a
 * hard delete is honest bookkeeping, not data loss: an expired post has said its piece, and the feed
 * hides it long before this runs.
 *
 * Idempotent by construction: whatever is past `delete_at` today is gone, and running it twice
 * changes nothing the second time.
 */
async function run(req: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error("[cron/sweep] CRON_SECRET is not set. Refusing to run.");
    return NextResponse.json({ error: "This job is not configured." }, { status: 500 });
  }
  if (req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sb = getSupabaseAdmin();
  const now = new Date().toISOString();

  const { error, count } = await sb
    .from("announcements")
    .delete({ count: "exact" })
    .lt("delete_at", now);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const expiredAnnouncementsDeleted = count ?? 0;

  // SYS-4: this job is the only one allowed to delete things, so it is also where the cron log is
  // pruned. Ninety days is long enough to see a seasonal failure and short enough that the table is
  // never a candidate for the same kind of slowness this module is fixing.
  const cronRowsDeleted = await pruneCronRuns();

  return NextResponse.json({ ok: true, expiredAnnouncementsDeleted, cronRowsDeleted });
}

/** SYS-4: every run is recorded. */
async function recorded(req: NextRequest): Promise<NextResponse> {
  return recordCronRun("sweep", () => run(req), (res) => `status ${res.status}`);
}

export const GET = recorded;
export const POST = recorded;
