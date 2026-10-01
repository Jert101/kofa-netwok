import type { SupabaseClient } from "@supabase/supabase-js";
import { countRecentServers, RECENT_SERVERS_WEEKS } from "@/lib/attendance/roster-sort";
import { todayInTimeZone } from "@/lib/attendance/metrics";

/**
 * The full roster for one session: every active member, with whether they are marked
 * present.
 *
 * The old screen listed only the people already marked present, which is why there
 * was no way to see who was missing. Encoding means tapping people *into* the list, so
 * the screen has to start from everyone and show the state, not from the state and
 * hide everyone else.
 *
 * Only active members appear. Someone deactivated after an earlier Mass keeps the
 * record they were marked in, but does not reappear on new rosters — the session's
 * own records are returned separately for that reason.
 *
 * `serverCount` is for the "recent servers first" sort, and counts live plus archived
 * records so a member whose attendance was archived still sorts near the top.
 */
export type RosterEntry = {
  member_id: string;
  full_name: string;
  present: boolean;
  server_count: number;
};

export async function loadRoster(
  sb: SupabaseClient,
  sessionId: string,
  timeZone: string | null | undefined,
): Promise<{ roster: RosterEntry[]; today: string }> {
  const today = todayInTimeZone(new Date(), timeZone);

  const [membersResult, presentResult] = await Promise.all([
    sb
      .from("members")
      .select("id, full_name")
      .eq("is_active", true)
      .order("full_name", { ascending: true }),
    sb.from("attendance_records").select("member_id").eq("session_id", sessionId),
  ]);

  if (membersResult.error) throw new Error(membersResult.error.message);
  if (presentResult.error) throw new Error(presentResult.error.message);

  const members = (membersResult.data ?? []) as { id: string; full_name: string }[];
  const presentIds = new Set((presentResult.data ?? []).map((r) => r.member_id as string));

  const serverCounts = await recentServerCounts(sb, members.map((m) => m.id), today);

  return {
    today,
    roster: members.map((m) => ({
      member_id: m.id,
      full_name: m.full_name,
      present: presentIds.has(m.id),
      server_count: serverCounts.get(m.id) ?? 0,
    })),
  };
}

/**
 * Counts recent service per member across live and archived records.
 *
 * Both sources are needed because generating a report moves rows into the archive
 * tables. Reading only the live table makes every member look like a non-server in
 * the months after their month was reported, which is the opposite of what the sort
 * is for.
 */
async function recentServerCounts(
  sb: SupabaseClient,
  memberIds: string[],
  today: string,
): Promise<Map<string, number>> {
  if (!memberIds.length) return new Map();

  const weeks = RECENT_SERVERS_WEEKS;
  const cutoff = new Date(
    new Date(`${today}T00:00:00Z`).getTime() - weeks * 7 * 86_400_000,
  )
    .toISOString()
    .slice(0, 10);

  const [live, archived] = await Promise.all([
    sb
      .from("attendance_records")
      .select("member_id, attendance_sessions!inner(session_date)")
      .in("member_id", memberIds)
      // gte, not eq: eq would match only the cutoff day itself and silently drop the
      // other seven weeks of the window.
      .gte("attendance_sessions.session_date", cutoff)
      .limit(20_000),
    sb
      .from("attendance_records_archive")
      .select("member_id, attendance_sessions_archive!inner(session_date)")
      .in("member_id", memberIds)
      .gte("attendance_sessions_archive.session_date", cutoff)
      .limit(20_000),
  ]);

  if (live.error) throw new Error(live.error.message);
  if (archived.error) throw new Error(archived.error.message);

  const rows: { memberId: string; servedAt: string }[] = [];

  for (const row of live.data ?? []) {
    const nested = (row as { attendance_sessions?: { session_date?: string } | { session_date?: string }[] })
      .attendance_sessions;
    const sessionDate = Array.isArray(nested) ? nested[0]?.session_date : nested?.session_date;
    if (sessionDate) rows.push({ memberId: row.member_id as string, servedAt: sessionDate });
  }

  for (const row of archived.data ?? []) {
    const nested = (row as { attendance_sessions_archive?: { session_date?: string } | { session_date?: string }[] })
      .attendance_sessions_archive;
    const sessionDate = Array.isArray(nested) ? nested[0]?.session_date : nested?.session_date;
    if (sessionDate) rows.push({ memberId: row.member_id as string, servedAt: sessionDate });
  }

  return countRecentServers(rows, today);
}
