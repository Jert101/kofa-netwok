import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api/guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { normalizePhone } from "@/lib/sms/send";

/**
 * POST /api/sms/inactivity
 *
 * Admin-only. Queues a one-time inactivity notice for every active member who
 * has served at Mass before but has no attendance in the last 2 complete months.
 *
 * This is triggered manually from the SMS queue page -- it is NOT run by the
 * cron, so no member is ever texted without the admin choosing to.
 *
 * One notice per member per month (dedupe key), so re-running does not nag the
 * same person twice in a month.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const g = await requireRole(req.headers.get("cookie"), ["admin"]);
  if (!g.ok) return g.response;

  const sb = getSupabaseAdmin();

  // Two complete months back from today.
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const endDate = new Date(y, m, 0);
  const startDate = new Date(y, m - 2, 1);
  const startStr = startDate.toISOString().slice(0, 10);
  const endStr = endDate.toISOString().slice(0, 10);

  // Mass sessions only -- a meeting is not serving.
  const [liveSessions, archiveSessions] = await Promise.all([
    sb
      .from("attendance_sessions")
      .select("id")
      .gte("session_date", startStr)
      .lte("session_date", endStr)
      .not("mass_id", "is", null),
    sb
      .from("attendance_sessions_archive")
      .select("id")
      .gte("session_date", startStr)
      .lte("session_date", endStr)
      .not("mass_id", "is", null),
  ]);

  const liveIds = (liveSessions.data ?? []).map((s) => s.id as string);
  const archiveIds = (archiveSessions.data ?? []).map((s) => s.id as string);

  const servedInWindow = new Set<string>();
  if (liveIds.length > 0) {
    const { data: liveRecords } = await sb
      .from("attendance_records")
      .select("member_id")
      .in("session_id", liveIds);
    for (const r of (liveRecords ?? [])) servedInWindow.add(r.member_id);
  }
  if (archiveIds.length > 0) {
    const { data: archiveRecords } = await sb
      .from("attendance_records_archive")
      .select("member_id")
      .in("session_id", archiveIds);
    for (const r of (archiveRecords ?? [])) servedInWindow.add(r.member_id);
  }

  // Active members with a phone who have served at least once before.
  const { data: members, error: membersErr } = await sb
    .from("members")
    .select("id, full_name, contact_number")
    .eq("is_active", true)
    .not("contact_number", "is", null);
  if (membersErr) throw membersErr;

  // Already sent an inactivity notice this calendar month (dedupe).
  const monthTag = now.toISOString().slice(0, 7);
  const nextMonth = new Date(Date.UTC(y, m + 1, 1)).toISOString().slice(0, 7);
  const { data: alreadyNoticed } = await sb
    .from("sms_queue")
    .select("member_id")
    .eq("type", "inactivity_notice")
    .eq("status", "sent")
    .gte("created_at", `${monthTag}-01T00:00:00Z`)
    .lt("created_at", `${nextMonth}-01T00:00:00Z`);
  const noticed = new Set((alreadyNoticed ?? []).map((r) => r.member_id as string));

  let queued = 0;
  for (const m of (members ?? [])) {
    const memberId = m.id as string;
    if (servedInWindow.has(memberId)) continue;
    if (noticed.has(memberId)) continue;

    const phone = normalizePhone(m.contact_number);
    if (!phone) continue;

    const dedupeKey = `inactivity_notice:${memberId}:${monthTag}`;
    await sb.from("sms_queue").insert({
      recipient: phone,
      member_id: memberId,
      message: `Hi ${m.full_name ?? "there"}, we noticed you have not served at Mass in the past two months. We would love to see you back.`,
      type: "inactivity_notice",
      priority: 1,
      dedupe_key: dedupeKey,
    });
    queued += 1;
  }

  return NextResponse.json({
    ok: true,
    queued,
    period: { start: startStr, end: endStr },
  });
}
