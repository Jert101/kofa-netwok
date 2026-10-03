import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { notify } from "@/lib/notify/notify";
import { recordCronRun } from "@/lib/system/cron-run";

export const dynamic = "force-dynamic";

const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

/** "2026-10-05" — tomorrow as the parish experiences it, not as UTC sees it. */
function tomorrowInManila(): string {
  const manilaNow = Date.now() + MANILA_OFFSET_MS;
  return new Date(manilaNow + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * LIT-6: the evening before, tell each assigned member they are serving.
 *
 * 10:00 UTC is 18:00 Manila, so the job is about tomorrow by the time anyone reads the push. Only
 * this member, on devices that declared their identity when subscribing. Free-text guests get nothing
 * by design: there is no member record to attach the message to, and a "Thurifer" reminder that
 * cannot say who is useless.
 *
 * The ledger (`liturgy_reminders_sent`) makes this retry-safe: a re-run the same day finds its own
 * rows and stands down, so a scheduler retry never double-buzzes a parish that was already told.
 */
async function run(req: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error("[cron/liturgy-reminders] CRON_SECRET is not set. Refusing to run.");
    return NextResponse.json({ error: "This job is not configured." }, { status: 500 });
  }
  if (req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sb = getSupabaseAdmin();
  const tomorrow = tomorrowInManila();
  const sentOn = new Date(Date.now() + MANILA_OFFSET_MS).toISOString().slice(0, 10);

  const { data: sessions, error: sessionError } = await sb
    .from("attendance_sessions")
    .select("id, session_date, masses(name)")
    .eq("session_date", tomorrow);

  if (sessionError) {
    return NextResponse.json({ error: sessionError.message }, { status: 500 });
  }
  if (!sessions || sessions.length === 0) {
    return NextResponse.json({ ok: true, tomorrow, reminders: 0 });
  }

  const sessionIds = sessions.map((s) => String(s.id));
  const { data: servers, error: serverError } = await sb
    .from("session_liturgy_servers")
    .select("session_id, position_label, member_id")
    .in("session_id", sessionIds)
    .not("member_id", "is", null);

  if (serverError) {
    return NextResponse.json({ error: serverError.message }, { status: 500 });
  }

  const { data: already } = await sb
    .from("liturgy_reminders_sent")
    .select("session_id, member_id")
    .eq("sent_on", sentOn)
    .in("session_id", sessionIds);

  const alreadySent = new Set((already ?? []).map((r) => `${r.session_id}:${r.member_id}`));

  const massNameById = new Map(
    sessions.map((s) => [
      String(s.id),
      (s.masses as { name?: string } | null)?.name ?? "Mass",
    ]),
  );

  const due = (servers ?? []).filter(
    (row) => row.member_id && !alreadySent.has(`${row.session_id}:${row.member_id}`),
  );

  let sent = 0;
  for (const row of due) {
    await notify("liturgy_reminder", {
      member_id: String(row.member_id),
      position_label: String(row.position_label),
      mass_label: massNameById.get(String(row.session_id)) ?? "Mass",
      date: tomorrow,
    });
    sent += 1;
  }

  if (due.length > 0) {
    // Recorded after the send attempts so a crash mid-run resends rather than silently skips. The
    // primary key makes a double-run of the loop above dedupe itself on retry.
    const { error: ledgerError } = await sb.from("liturgy_reminders_sent").upsert(
      due.map((row) => ({
        session_id: String(row.session_id),
        member_id: String(row.member_id),
        sent_on: sentOn,
      })),
      { onConflict: "session_id,member_id,sent_on", ignoreDuplicates: true },
    );
    if (ledgerError) {
      // Not fatal for the run, but a loud hint: next retry may resend.
      console.error("[cron/liturgy-reminders] ledger write failed", ledgerError.message);
    }
  }

  return NextResponse.json({ ok: true, tomorrow, reminders: sent });
}

/** SYS-4: every run is recorded, including how many reminders it sent. */
async function recorded(req: NextRequest): Promise<NextResponse> {
  return recordCronRun(
    "liturgy-reminders",
    () => run(req),
    (res) => `status ${res.status}`,
  );
}

export const GET = recorded;
export const POST = recorded;
