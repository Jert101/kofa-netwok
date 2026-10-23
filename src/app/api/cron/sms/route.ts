import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getIntegerSetting } from "@/lib/settings/store";
import { sendSms } from "@/lib/sms/send";

const CRON_SECRET = process.env.CRON_SECRET;

/**
 * Send up to the daily limit of pending messages, oldest first by priority.
 *
 * Runs once per day on the Vercel hobby plan (daily cron only), so it processes
 * the whole remaining allowance in one go. textbee.dev queues the messages and
 * paces the actual delivery through the paired phone, so we send as fast as
 * textbee accepts them rather than adding our own delay.
 *
 * Inactivity notices are NOT queued here. The admin triggers them manually from
 * the SMS queue page, so there is no silent automatic texting of members.
 */
async function sendDueMessages(sb: ReturnType<typeof getSupabaseAdmin>): Promise<{
  sent: number;
  failed: number;
  remainingToday: number;
}> {
  const dailyLimit = await getIntegerSetting("sms_daily_limit");
  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  const { count: sentToday } = await sb
    .from("sms_queue")
    .select("id", { count: "exact", head: true })
    .eq("status", "sent")
    .gte("created_at", `${today}T00:00:00Z`)
    .lt("created_at", `${today}T23:59:59Z`);

  const alreadySent = sentToday ?? 0;
  const remaining = Math.max(dailyLimit - alreadySent, 0);
  if (remaining === 0) {
    return { sent: 0, failed: 0, remainingToday: remaining };
  }

  const { data: pending, error } = await sb
    .from("sms_queue")
    .select("id, recipient, message, retries")
    .eq("status", "pending")
    .order("priority", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(remaining);

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
  }

  return { sent, failed, remainingToday: remaining };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = req.headers.get("authorization");
  if (!CRON_SECRET || auth !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sb = getSupabaseAdmin();

  try {
    const sent = await sendDueMessages(sb);

    return NextResponse.json({
      ok: true,
      sent: sent.sent,
      failed: sent.failed,
      remainingToday: sent.remainingToday,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
