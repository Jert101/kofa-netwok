import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api/guard";
import { getAllSettings } from "@/lib/settings/store";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { monthBoundsFromStart, reportMonthStartForNow } from "@/lib/reports/rules";
import { format, parseISO } from "date-fns";

const monthRe = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["admin", "secretary"]);
  if (!g.ok) return g.response;

  const settings = await getAllSettings();
  const tz = settings.report_timezone || "UTC";
  const url = new URL(req.url);
  const raw = url.searchParams.get("month_start");
  const monthStart =
    raw && monthRe.test(raw) ? raw : reportMonthStartForNow(new Date(), tz);

  const { start, end } = monthBoundsFromStart(monthStart);

  const sb = getSupabaseAdmin();
  const { data: sessions, error } = await sb
    .from("attendance_sessions")
    .select("id, session_date, created_at, masses(name)")
    .gte("session_date", start)
    .lte("session_date", end)
    .order("session_date", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rawList = sessions ?? [];
  const sessionIds = rawList.map((s) => s.id as string);
  const withAttendance = new Set<string>();
  if (sessionIds.length > 0) {
    const { data: recRows, error: recErr } = await sb
      .from("attendance_records")
      .select("session_id")
      .in("session_id", sessionIds);
    if (recErr) {
      return NextResponse.json({ error: recErr.message }, { status: 500 });
    }
    for (const r of recRows ?? []) {
      withAttendance.add(r.session_id as string);
    }
  }

  const filtered = rawList.filter((s) => withAttendance.has(s.id as string));

  const list = filtered.map((s) => {
    const ymd = s.session_date as string;
    let weekday = "";
    try {
      weekday = format(parseISO(ymd), "EEEE");
    } catch {
      weekday = "";
    }
    const masses = s.masses as unknown;
    let massName = "Mass";
    if (Array.isArray(masses) && masses[0]) massName = (masses[0] as { name?: string }).name ?? "Mass";
    else if (masses && typeof masses === "object" && "name" in (masses as object))
      massName = (masses as { name?: string }).name ?? "Mass";

    return {
      id: s.id as string,
      session_date: ymd,
      weekday_label: weekday,
      mass_name: massName,
    };
  });

  return NextResponse.json({
    month_start: monthStart,
    range: { start, end },
    sessions: list,
  });
}
