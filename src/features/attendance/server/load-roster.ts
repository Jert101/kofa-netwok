import type { SupabaseClient } from "@supabase/supabase-js";
import { countRecentServers, RECENT_SERVERS_WEEKS, type ServerCountInput } from "@/lib/attendance/roster-sort";
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

  // One query against the view, not two embeds.
  //
  // The archive half of this used to ask PostgREST to embed
  // `attendance_sessions_archive!inner(session_date)`, which cannot work: `attendance_records_archive`
  // stores a bare `session_id` with no foreign key, because the archive keys on `(id, archived_at)`
  // and `id` alone is not unique there. PostgREST answered PGRST200 "no foreign key relationship",
  // this function threw, and because the session GET route has no try/catch the whole screen 500'd
  // with an empty body -- every session, every role, so attendance could not be recorded at all.
  //
  // `v_attendance_all` (migration 033) already performs that join correctly in SQL and reports
  // `session_date` for both live and archived rows, so the count comes from one place.
  const { data, error } = await sb
    .from("v_attendance_all")
    .select("member_id, session_date")
    .in("member_id", memberIds)
    // gte, not eq: eq would match only the cutoff day itself and silently drop the
    // other seven weeks of the window.
    .gte("session_date", cutoff)
    .limit(20_000);

  if (error) throw new Error(error.message);

  const rows: ServerCountInput[] = [];
  for (const row of data ?? []) {
    const sessionDate = row.session_date as string | null;
    if (sessionDate) rows.push({ memberId: row.member_id as string, servedAt: sessionDate });
  }

  return countRecentServers(rows, today);
}
