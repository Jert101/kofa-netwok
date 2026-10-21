import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getIntegerSetting } from "@/lib/settings/store";
import { sendSms } from "@/lib/sms/send";
import { churchToday } from "@/lib/time/church-time";

const CRON_SECRET = process.env.CRON_SECRET;
const MAX_PER_RUN = 12; // Stay well under the function timeout on the hobby plan.

/** Sleep for a number of milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A random delay between 3 and 5 seconds, so texts are not sent in a burst. */
async function throttle(): Promise<void> {
  await sleep(3000 + Math.floor(Math.random() * 2000));
}

/** Today in the parish's own timezone, used for the inactivity window. */
function todayIso(): string {
  const tz = process.env.REPORT_TIMEZONE ?? "Asia/Manila";
  return churchToday(tz);
}

/** Send up to the daily limit of pending messages, oldest first by priority. */
async function sendDueMessages(sb: ReturnType<typeof getSupabaseAdmin>): Promise<{
  sent: number;
  failed: number;
  skipped: number;
  remainingToday: number;
}> {
  const dailyLimit = getIntegerSetting("sms_daily_limit");
  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  const { count: sentToday } = await sb
    .from("sms_queue")
    .select("id", { count: "exact", head: true })
    .eq("status", "sent")
    .gte("created_at", `${today}T00:00:00Z`)
    .lt("created_at", `${today}T23:59:59Z`);

  const alreadySent = Number(sentToday ?? 0);
  const remaining = Math.max(Number(dailyLimit) - alreadySent, 0);
  const toSend = Math.min(remaining, MAX_PER_RUN);
  if (toSend === 0) {
    return { sent: 0, failed: 0, skipped: 0, remainingToday: remaining };
  }

  const { data: pending, error } = await sb
    .from("sms_queue")
    .select("id, recipient, message, retries")
    .eq("status", "pending")
    .order("priority", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(toSend);

  if (error) throw error;

  let sent = 0;
  let failed = 0;

  for (const row of (pending ?? [])) {
    const result = await sendSms(row.recipient, row.message);
    if (result.ok) {
      await sb
        .from("sms_queue")
        .update({ status: "sent", sent_at: now.toISOString() })
        .eq("id", row.id);
      sent += 1;
    } else {
      await sb
        .from("sms_queue")
        .update({ status: "failed", error: result.error, retries: (row.retries ?? 0) + 1 })
        .eq("id", row.id);
      failed += 1;
    }
    // One at a time, with a delay so we do not hammer the phone or textbee.
    await throttle();
  }

  return { sent, failed, skipped: 0, remainingToday: remaining };
}

/**
 * Queue an inactivity notice for active members who have not served at Mass in
 * the last month. One notice per member per month, so they are not nagged.
 */
async function queueInactivityNotices(sb: ReturnType<typeof getSupabaseAdmin>): Promise<number> {
  const today = todayIso();
  const monthStart = today.slice(0, 7) + "-01";

  // Mass sessions only -- a meeting is not serving.
  const [liveSessions, archiveSessions] = await Promise.all([
    sb
      .from("attendance_sessions")
      .select("id")
      .gte("session_date", monthStart)
      .lte("session_date", today)
      .not("mass_id", "is", null),
    sb
      .from("attendance_sessions_archive")
      .select("id")
      .gte("session_date", monthStart)
      .lte("session_date", today)
      .not("mass_id", "is", null),
  ]);

  const liveIds = (liveSessions.data ?? []).map((s) => s.id as string);
  const archiveIds = (archiveSessions.data ?? []).map((s) => s.id as string);

  const servedThisMonth = new Set<string>();
  if (liveIds.length > 0) {
    const { data: liveRecords } = await sb
      .from("attendance_records")
      .select("member_id")
      .in("session_id", liveIds);
    for (const r of (liveRecords ?? [])) servedThisMonth.add(r.member_id);
  }
  if (archiveIds.length > 0) {
    const { data: archiveRecords } = await sb
      .from("attendance_records_archive")
      .select("member_id")
      .in("session_id", archiveIds);
    for (const r of (archiveRecords ?? [])) servedThisMonth.add(r.member_id);
  }

  // Active members who have served at least once before.
  const { data: members, error: membersErr } = await sb
    .from("members")
    .select("id, full_name, contact_number")
    .eq("is_active", true)
    .not("contact_number", "is", null);
  if (membersErr) throw membersErr;

  // Already queued/sent an inactivity notice this month.
  const monthTag = today.slice(0, 7);
  const { data: alreadyNoticed } = await sb
    .from("sms_queue")
    .select("member_id")
    .eq("type", "inactivity_notice")
    .eq("status", "sent")
    .gte("created_at", `${monthTag}-01T00:00:00Z`)
    .lt("created_at", `${String(Number(monthTag) + 1)}-01T00:00:00Z`);
  const noticed = new Set((alreadyNoticed ?? []).map((r) => r.member_id as string));

  let queued = 0;
  for (const m of (members ?? [])) {
    const memberId = m.id as string;
    if (servedThisMonth.has(memberId)) continue;
    if (noticed.has(memberId)) continue;

    const phone = normalizePhoneForCron(m.contact_number);
    if (!phone) continue;

    const dedupeKey = `inactivity_notice:${memberId}:${monthTag}`;
    await sb
      .from("sms_queue")
      .insert({
        recipient: phone,
        member_id: memberId,
        message: `Hi ${m.full_name ?? "there"}, we noticed you have not served at Mass this month. We would love to see you back.`,
        type: "inactivity_notice",
        priority: 1,
        dedupe_key: dedupeKey,
      });
    queued += 1;
  }
  return queued;
}

function normalizePhoneForCron(raw: string | null): string | null {
  if (!raw) return null;
  let digits = raw.trim().replace(/^\+/, "").replace(/\D/g, "");
  if (digits.startsWith("0")) digits = digits.slice(1);
  if (digits.startsWith("63")) digits = digits.slice(2);
  if (!/^9\d{9}$/.test(digits)) return null;
  return `+63${digits}`;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = req.headers.get("authorization");
  if (!CRON_SECRET || auth !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sb = getSupabaseAdmin();

  try {
    const sent = await sendDueMessages(sb);
    const noticed = await queueInactivityNotices(sb);

    return NextResponse.json({
      ok: true,
      sent: sent.sent,
      failed: sent.failed,
      remainingToday: sent.remainingToday,
      inactivityNoticesQueued: noticed,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
