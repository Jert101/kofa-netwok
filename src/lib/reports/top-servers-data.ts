import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { formatNameLastFirst } from "@/lib/members/name-format";

export type TopServerCount = {
  member_id: string;
  full_name: string;
  total_served: number;
};

export async function fetchTopServersData(): Promise<TopServerCount[]> {
  const sb = getSupabaseAdmin();

  // Both reads are whole tables on purpose -- the ranking is all-time -- so both have to be paged.
  // A single unpaged select stops at 1000 rows and quietly returns a partial ranking.
  const [liveRows, archiveRows] = await Promise.all([
    fetchAllRows((from, to) =>
      sb
        .from("attendance_records")
        .select("member_id, members!left(full_name)")
        .order("id", { ascending: true })
        .range(from, to),
    ),
    fetchAllRows((from, to) =>
      sb
        .from("attendance_records_archive")
        .select("member_id, member_name")
        .order("id", { ascending: true })
        .range(from, to),
    ),
  ]);

  const countMap = new Map<string, { name: string; count: number }>();

  for (const row of liveRows) {
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

  for (const row of archiveRows) {
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
    .sort((a, b) => b[1].count - a[1].count || a[1].name.localeCompare(b[1].name))
    .slice(0, 20)
    .map(([memberId, { name, count }]) => ({
      member_id: memberId,
      full_name: name,
      total_served: count,
    }));
}
