export type SessionForGrid = {
  id: string;
  session_date: string;
  created_at: string;
  massName: string;
};

/** One calendar day in the report with selected sessions as columns. */
export type ReportDateGroup = {
  dateYmd: string;
  sessions: { id: string; massName: string }[];
};

function massNameFromJoin(masses: unknown): string {
  if (masses == null) return "Mass";
  if (Array.isArray(masses)) {
    const m = masses[0] as { name?: string } | undefined;
    return m?.name?.trim() || "Mass";
  }
  return (masses as { name?: string }).name?.trim() || "Mass";
}

/**
 * Build PDF column groups from sessions the user selected (any weekday).
 * Grouped by date, masses ordered by created_at then id.
 */
export function buildReportColumnGroups(
  monthSessions: Array<{
    id: string;
    session_date: string;
    created_at: string;
    masses: unknown;
  }>,
  includedSessionIds: Set<string>
): ReportDateGroup[] {
  const filtered = monthSessions.filter((s) => includedSessionIds.has(s.id as string));
  const byDate = new Map<string, SessionForGrid[]>();

  for (const s of filtered) {
    const date = s.session_date as string;
    const list = byDate.get(date) ?? [];
    list.push({
      id: s.id as string,
      session_date: date,
      created_at: (s.created_at as string) ?? "",
      massName: massNameFromJoin(s.masses),
    });
    byDate.set(date, list);
  }

  const dates = [...byDate.keys()].sort((a, b) => a.localeCompare(b));
  const groups: ReportDateGroup[] = [];

  for (const dateYmd of dates) {
    const list = byDate.get(dateYmd)!;
    list.sort((a, b) => {
      const t = a.created_at.localeCompare(b.created_at);
      return t !== 0 ? t : a.id.localeCompare(b.id);
    });
    groups.push({
      dateYmd,
      sessions: list.map((x) => ({ id: x.id, massName: x.massName })),
    });
  }

  return groups;
}

export function flattenSessionOrder(groups: ReportDateGroup[]): string[] {
  const ids: string[] = [];
  for (const g of groups) {
    for (const s of g.sessions) ids.push(s.id);
  }
  return ids;
}

export type CellKind = "served" | "absent";

export function cellKindForSession(sessionId: string, memberId: string, attended: Set<string>): CellKind {
  const key = `${memberId}:${sessionId}`;
  return attended.has(key) ? "served" : "absent";
}

export function servedCountForSessions(
  memberId: string,
  records: { member_id: string; session_id: string }[],
  sessionIds: Set<string>
): number {
  let n = 0;
  for (const r of records) {
    if (r.member_id === memberId && sessionIds.has(r.session_id)) n++;
  }
  return n;
}

/** @deprecated use servedCountForSessions with full month set for “all masses” counts */
export function servedCountInMonth(memberId: string, records: { member_id: string }[]): number {
  let n = 0;
  for (const r of records) {
    if (r.member_id === memberId) n++;
  }
  return n;
}

export function remarksForServedCount(n: number): string {
  if (n <= 0) return "Didn't serve";
  if (n === 1) return "Served 1 mass";
  return `Served ${n} masses`;
}
