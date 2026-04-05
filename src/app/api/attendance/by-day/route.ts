import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/api/guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

const qSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function GET(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["member", "secretary", "admin", "officer"]);
  if (!g.ok) return g.response;

  const url = new URL(req.url);
  const parsed = qSchema.safeParse({ date: url.searchParams.get("date") });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  }
  const date = parsed.data.date;

  const sb = getSupabaseAdmin();
  const { data: sessions, error } = await sb
    .from("attendance_sessions")
    .select("id, session_date, mass_id, masses(name)")
    .eq("session_date", date)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const ids = (sessions ?? []).map((s) => s.id);
  const counts: Record<string, number> = {};
  if (ids.length) {
    const { data: recs, error: e2 } = await sb
      .from("attendance_records")
      .select("session_id, member_id")
      .in("session_id", ids);
    if (e2) {
      return NextResponse.json({ error: e2.message }, { status: 500 });
    }
    const uniquePerSession = new Map<string, Set<string>>();
    for (const r of recs ?? []) {
      const sid = r.session_id as string;
      const mid = r.member_id as string;
      if (!uniquePerSession.has(sid)) uniquePerSession.set(sid, new Set());
      uniquePerSession.get(sid)!.add(mid);
    }
    for (const sid of ids) {
      counts[sid] = uniquePerSession.get(sid)?.size ?? 0;
    }
  }

  const list = (sessions ?? []).map((s) => ({
    id: s.id,
    session_date: s.session_date,
    mass_id: s.mass_id as string,
    mass_name: (s.masses as { name?: string } | null)?.name ?? "Mass",
    server_count: counts[s.id] ?? 0,
  }));

  return NextResponse.json({ sessions: list });
}
