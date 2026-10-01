/**
 * ATT-5 sort: "Recent servers first" — the members who served most often in the
 * last eight weeks go to the top of the roster.
 *
 * Why it exists: a parish has a handful of people who are always at the altar or
 * singing, and a secretary who marks them first wants them near their thumb. Sorting
 * them first turns a 48-row scan into the first dozen rows.
 *
 * Both live and archived records count. Archiving moves rows out of
 * attendance_records when a month is reported, so a member who served eight weeks ago
 * and has since been archived has no live rows and would silently sort as a
 * non-server.
 *
 * Members with no history are not errors. They go last, keeping the incoming order,
 * because "never served" is not a ranking the secretary needs to act on.
 */

export const RECENT_SERVERS_WEEKS = 8;
const MS_PER_DAY = 86_400_000;
const MS_PER_WEEK = 7 * MS_PER_DAY;

export type ServerCountInput = { memberId: string; servedAt: string };

/** The cutoff for the recent-servers window, as an ISO date. */
export function recentServersSince(today: string, weeks = RECENT_SERVERS_WEEKS): string {
  const start = new Date(`${today}T00:00:00Z`).getTime() - weeks * MS_PER_WEEK;
  return new Date(start).toISOString().slice(0, 10);
}

/**
 * Counts appearances per member over the window.
 *
 * `servedAt` is the session date, which is why a plain string comparison against the
 * cutoff works: both are `YYYY-MM-DD`.
 */
export function countRecentServers(
  rows: Iterable<ServerCountInput>,
  today: string,
  weeks = RECENT_SERVERS_WEEKS,
): Map<string, number> {
  const cutoff = recentServersSince(today, weeks);
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.servedAt < cutoff) continue;
    if (row.servedAt > today) continue;
    counts.set(row.memberId, (counts.get(row.memberId) ?? 0) + 1);
  }
  return counts;
}

export type SortMode = "alphabetical" | "recent_servers";

export type RosterMember = {
  id: string;
  fullName: string;
  /** How many times this member served in the recent window. */
  serverCount?: number;
};

/**
 * Orders the roster.
 *
 * Alphabetical is the default and stays alphabetical, because that is how the
 * secretary reads a list of names they know. Recent-servers sorts by count
 * descending and breaks ties alphabetically, so two people who served equally often
 * do not swap places between refreshes — which would make the roster feel like it
 * is jittering while you try to tap a row.
 */
export function sortRoster(members: RosterMember[], mode: SortMode): RosterMember[] {
  const copy = [...members];

  if (mode === "alphabetical") {
    return copy.sort((a, b) => a.fullName.localeCompare(b.fullName, undefined, { sensitivity: "base" }));
  }

  return copy.sort((a, b) => {
    const diff = (b.serverCount ?? 0) - (a.serverCount ?? 0);
    if (diff !== 0) return diff;
    return a.fullName.localeCompare(b.fullName, undefined, { sensitivity: "base" });
  });
}
