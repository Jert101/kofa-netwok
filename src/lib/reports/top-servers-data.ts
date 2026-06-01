import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { formatNameLastFirst } from "@/lib/members/name-format";

export type TopServerCount = {
  member_id: string;
  full_name: string;
  total_served: number;
};

export async function fetchTopServersData(): Promise<TopServerCount[]> {
  const sb = getSupabaseAdmin();

  const [liveResult, archiveResult] = await Promise.all([
    sb.from("attendance_records").select("member_id, members!inner(full_name)"),
    sb.from("attendance_records_archive").select("member_id, member_name"),
  ]);

  if (liveResult.error) throw liveResult.error;
  if (archiveResult.error) throw archiveResult.error;

  const countMap = new Map<string, { name: string; count: number }>();

  for (const row of liveResult.data ?? []) {
    const mid = row.member_id as string;
    const m = row.members as { full_name?: string } | null;
    const name = formatNameLastFirst(m?.full_name ?? "Unknown");
    const entry = countMap.get(mid);
    if (entry) {
      entry.count++;
    } else {
      countMap.set(mid, { name, count: 1 });
    }
  }

  for (const row of archiveResult.data ?? []) {
    const mid = row.member_id as string;
    const name = formatNameLastFirst((row.member_name as string) || "Unknown");
    const entry = countMap.get(mid);
    if (entry) {
      entry.count++;
    } else {
      countMap.set(mid, { name, count: 1 });
    }
  }

  return [...countMap.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 20)
    .map(([memberId, { name, count }]) => ({
      member_id: memberId,
      full_name: name,
      total_served: count,
    }))
    .sort((a, b) => a.full_name.localeCompare(b.full_name));
}
