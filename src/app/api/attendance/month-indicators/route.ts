import { NextRequest, NextResponse } from "next/server";
import { endOfMonth, format as formatDate } from "date-fns";
import { z } from "zod";
import { requireRole } from "@/lib/api/guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

const qSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
});

export async function GET(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["member", "secretary", "admin", "officer"]);
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
  const { data, error } = await sb
    .from("attendance_sessions")
    .select("session_date")
    .gte("session_date", start)
    .lte("session_date", end);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const dates = [...new Set((data ?? []).map((r) => String(r.session_date)))].sort();
  return NextResponse.json({ dates });
}
