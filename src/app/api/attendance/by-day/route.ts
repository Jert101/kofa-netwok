import { NextRequest } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/api/guard";
import { internalError, jsonOk } from "@/lib/api/response";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

const qSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/**
 * ATT-3 day view: the sessions on one date, with how many were present.
 *
 * Counts live and archived attendance records together. A session from a closed month
 * has its records moved to the archive, so counting only the live table would show an
 * empty day for exactly the months a secretary most wants to look back at.
 */
export async function GET(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["member", "secretary", "admin", "officer"]);
  if (!g.ok) return g.response;

  const url = new URL(req.url);
  const parsed = qSchema.safeParse({ date: url.searchParams.get("date") });
  if (!parsed.success) {
    return internalError("Invalid date.");
  }
  const date = parsed.data.date;

  const sb = getSupabaseAdmin();

  try {
    const { data: sessions, error } = await sb
      .from("attendance_sessions")
      .select("id, session_date, mass_id, masses(name, sort_order)")
      .eq("session_date", date)
      .order("created_at", { ascending: true });

    if (error) throw new Error(error.message);

    const ids = (sessions ?? []).map((s) => s.id as string);
    const present = await presentCounts(sb, ids);

    const list = (sessions ?? []).map((s) => ({
      id: s.id,
      session_date: s.session_date,
      mass_id: s.mass_id as string,
      mass_name: (s.masses as { name?: string } | null)?.name ?? "Mass",
      mass_order: ((s.masses as { sort_order?: number } | null)?.sort_order ?? 0) as number,
      present_count: present.get(s.id as string) ?? 0,
    }));

    // Mass order, not creation order. Two Masses created on different days should still
    // appear on the day view the way the parish runs them.
    list.sort((a, b) => a.mass_order - b.mass_order || a.mass_name.localeCompare(b.mass_name));

    return jsonOk({ sessions: list });
  } catch (e) {
    console.error("[attendance/by-day] failed:", e instanceof Error ? e.message : e);
    return internalError();
  }
}

/** Distinct members present per session, merged across live and archived records. */
async function presentCounts(
  sb: ReturnType<typeof getSupabaseAdmin>,
  sessionIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, Set<string>>();
  if (!sessionIds.length) return new Map();

  const collect = (rows: { session_id: string; member_id: string }[] | null) => {
    for (const row of rows ?? []) {
      if (!counts.has(row.session_id)) counts.set(row.session_id, new Set());
      counts.get(row.session_id)!.add(row.member_id);
    }
  };

  const [live, archived] = await Promise.all([
    sb.from("attendance_records").select("session_id, member_id").in("session_id", sessionIds),
    sb.from("attendance_records_archive").select("session_id, member_id").in("session_id", sessionIds),
  ]);

  if (live.error) throw new Error(`attendance_records: ${live.error.message}`);
  // A missing archive table must not empty the screen, since the archive only exists
  // once a month has been closed.
  if (archived.error && archived.error.code !== "42P01") {
    throw new Error(`attendance_records_archive: ${archived.error.message}`);
  }

  collect(live.data);
  collect(archived.data);

  return new Map([...counts].map(([sessionId, members]) => [sessionId, members.size]));
}
