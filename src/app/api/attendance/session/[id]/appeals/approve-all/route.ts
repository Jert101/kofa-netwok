import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api/guard";
import { notifyAttendanceSessionUpdated } from "@/lib/push/attendance-notify";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { guardReportNotGenerated } from "@/lib/reports/check-report-lock";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  const g = await requireRole(req.headers.get("cookie"), ["admin", "secretary"]);
  if (!g.ok) return g.response;

  const sessionId = (await ctx.params).id;
  const sb = getSupabaseAdmin();

  const { data: sess } = await sb
    .from("attendance_sessions")
    .select("session_date")
    .eq("id", sessionId)
    .maybeSingle();

  if (!sess) return NextResponse.json({ error: "Session not found" }, { status: 404 });

  const guard = await guardReportNotGenerated(sb, sess.session_date as string);
  if (guard.blocked) return NextResponse.json({ error: guard.message }, { status: 409 });

  const { data: appeals } = await sb
    .from("attendance_appeals")
    .select("id")
    .eq("session_id", sessionId);

  const appealIds = (appeals ?? []).map((r) => r.id as string);
  if (appealIds.length === 0) {
    return NextResponse.json({ error: "No appeals for this session" }, { status: 400 });
  }

  const { data: pendingItems } = await sb
    .from("attendance_appeal_items")
    .select("id, appeal_id, member_id")
    .in("appeal_id", appealIds)
    .eq("status", "pending");

  const items = pendingItems ?? [];
  if (items.length === 0) {
    return NextResponse.json({ error: "No pending appeal items" }, { status: 400 });
  }

  const uniqueMembers = [...new Set(items.map((i) => i.member_id as string))];

  const { error: upErr } = await sb.from("attendance_records").upsert(
    uniqueMembers.map((memberId) => ({ session_id: sessionId, member_id: memberId })),
    { onConflict: "session_id,member_id", ignoreDuplicates: true }
  );

  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  const itemIds = items.map((i) => i.id as string);
  const parentAppealIds = items.map((i) => i.appeal_id as string);

  const { error: dErr } = await sb.from("attendance_appeal_items").delete().in("id", itemIds);
  if (dErr) return NextResponse.json({ error: dErr.message }, { status: 500 });

  const uniqueAppealIds = [...new Set(parentAppealIds)];
  for (const aid of uniqueAppealIds) {
    const { count } = await sb
      .from("attendance_appeal_items")
      .select("id", { count: "exact", head: true })
      .eq("appeal_id", aid);
    if ((count ?? 0) === 0) {
      await sb.from("attendance_appeals").delete().eq("id", aid);
    }
  }

  void notifyAttendanceSessionUpdated(sessionId);

  return NextResponse.json({ ok: true, approved_count: uniqueMembers.length });
}