import { NextRequest, NextResponse } from "next/server";
import { endOfMonth, format as formatDate } from "date-fns";
import { z } from "zod";
import { requireRole } from "@/lib/api/guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

const qSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
});

export async function GET(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["secretary", "admin"]);
  if (!g.ok) return g.response;

  const url = new URL(req.url);
  const parsed = qSchema.safeParse({ month: url.searchParams.get("month") });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid month" }, { status: 400 });
  }

  const month = parsed.data.month;
  const start = `${month}-01`;
  const end = formatDate(endOfMonth(new Date(`${month}-01T12:00:00`)), "yyyy-MM-dd");

  const sb = getSupabaseAdmin();
  const { data: items, error: iErr } = await sb
    .from("attendance_appeal_items")
    .select("appeal_id")
    .eq("status", "pending");
  if (iErr) return NextResponse.json({ error: iErr.message }, { status: 500 });

  const appealIds = [...new Set((items ?? []).map((r) => String(r.appeal_id)))];
  if (appealIds.length === 0) return NextResponse.json({ dates: [] });

  const { data: appeals, error: aErr } = await sb
    .from("attendance_appeals")
    .select("id, session_id")
    .in("id", appealIds);
  if (aErr) return NextResponse.json({ error: aErr.message }, { status: 500 });

  const sessionIds = [...new Set((appeals ?? []).map((r) => String(r.session_id)))];
  if (sessionIds.length === 0) return NextResponse.json({ dates: [] });

  const { data: sessions, error: sErr } = await sb
    .from("attendance_sessions")
    .select("id, session_date")
    .in("id", sessionIds)
    .gte("session_date", start)
    .lte("session_date", end);
  if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 });

  const dates = [...new Set((sessions ?? []).map((r) => String(r.session_date)))].sort();
  return NextResponse.json({ dates });
}
