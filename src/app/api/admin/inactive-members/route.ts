import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api/guard";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { formatNameLastFirst } from "@/lib/members/name-format";

export async function GET(req: NextRequest) {
  const g = await requireRole(req.headers.get("cookie"), ["admin"]);
  if (!g.ok) return g.response;

  const sb = getSupabaseAdmin();

  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();

  const endDate = new Date(y, m, 0);
  const startDate = new Date(y, m - 2, 1);

  const startStr = startDate.toISOString().slice(0, 10);
  const endStr = endDate.toISOString().slice(0, 10);

  const [liveSessions, archiveSessions] = await Promise.all([
    sb.from("attendance_sessions").select("id").gte("session_date", startStr).lte("session_date", endStr),
    sb.from("attendance_sessions_archive").select("id").gte("session_date", startStr).lte("session_date", endStr),
  ]);

  const liveIds = (liveSessions.data ?? []).map((s) => s.id as string);
  const archiveIds = (archiveSessions.data ?? []).map((s) => s.id as string);

  const [liveRecords, archiveRecords] = await Promise.all([
    liveIds.length > 0
      ? sb.from("attendance_records").select("member_id").in("session_id", liveIds)
      : { data: [] as { member_id: string }[] },
    archiveIds.length > 0
      ? sb.from("attendance_records_archive").select("member_id").in("session_id", archiveIds)
      : { data: [] as { member_id: string }[] },
  ]);

  const served = new Set<string>();
  for (const r of (liveRecords as { data?: { member_id: string }[] }).data ?? []) served.add(r.member_id);
  for (const r of (archiveRecords as { data?: { member_id: string }[] }).data ?? []) served.add(r.member_id);

  const { data: members } = await sb
    .from("members")
    .select("id, full_name")
    .eq("is_active", true)
    .order("full_name", { ascending: true });

  const inactive = (members ?? [])
    .filter((m) => !served.has(m.id as string))
    .map((m) => ({
      member_id: m.id as string,
      full_name: formatNameLastFirst(m.full_name as string),
    }))
    .sort((a, b) => a.full_name.localeCompare(b.full_name));

  return NextResponse.json({
    period: { start: startStr, end: endStr },
    count: inactive.length,
    members: inactive,
  });
}
