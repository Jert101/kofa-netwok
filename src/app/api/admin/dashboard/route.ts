import { NextRequest, NextResponse } from "next/server";
import { format } from "date-fns";
import { requireRole } from "@/lib/api/guard";
import { selectSessionsResilient, sessionLabel } from "@/lib/attendance/guard-session-write";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export async function GET(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["admin"]);
  if (!g.ok) return g.response;

  const today = format(new Date(), "yyyy-MM-dd");
  const sb = getSupabaseAdmin();

  const { data: sessions, error: sErr } = await selectSessionsResilient<Record<string, unknown>[]>(
    (columns) =>
      sb
        .from("attendance_sessions")
        .select(columns)
        .eq("session_date", today)
        .order("created_at", { ascending: true }),
    "id, session_date, mass_id, title, masses(name)",
    "id, session_date, mass_id, masses(name)",
  );

  if (sErr) {
    return NextResponse.json({ error: sErr.message }, { status: 500 });
  }

  const ids = (sessions ?? []).map((s) => s.id);
  let total = 0;
  if (ids.length) {
    const { count, error: cErr } = await sb
      .from("attendance_records")
      .select("id", { count: "exact", head: true })
      .in("session_id", ids);
    if (cErr) {
      return NextResponse.json({ error: cErr.message }, { status: 500 });
    }
    total = count ?? 0;
  }

  return NextResponse.json({
    today,
    sessions: (sessions ?? []).map((s) => ({
      id: s.id,
      // A meeting today belongs on today's board as much as a Mass does. It arrives under its own name
      // so the admin is not told there is a Mass when there is a meeting.
      mass_name: sessionLabel({
        mass_id: s.mass_id as string | null,
        title: s.title as string | null,
        massName: (s.masses as { name?: string } | null)?.name,
      }),
    })),
    attendance_count: total,
  });
}
