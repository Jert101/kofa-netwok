import { NextRequest, NextResponse } from "next/server";
import { format } from "date-fns";
import { requireRole } from "@/lib/api/guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export async function GET(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["admin"]);
  if (!g.ok) return g.response;

  const today = format(new Date(), "yyyy-MM-dd");
  const sb = getSupabaseAdmin();

  const { data: sessions, error: sErr } = await sb
    .from("attendance_sessions")
    .select("id, session_date, mass_id, masses(name)")
    .eq("session_date", today)
    .order("created_at", { ascending: true });

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
      mass_name: (s.masses as { name?: string } | null)?.name ?? "Mass",
    })),
    attendance_count: total,
  });
}
