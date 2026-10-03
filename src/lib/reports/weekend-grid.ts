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

// ======================================================================================
// summary_json v5 grid snapshot (RPT-7)
// ======================================================================================

/**
 * A stored cell, one per included session column, in column order.
 *
 * RPT-2 asks for a third "not scheduled" mark (a dash). There is no data source for it:
 * the schema has no per-session roster or assignment table — `loadRoster` defines the
 * roster as every *active* member, the same list for every session — and `pdf.ts` can
 * only draw served/absent. So the snapshot has two states and RPT-2's dash is not
 * implemented. Recorded in new md/06-reports.md as a deliberate deviation. Adding it later
 * means adding a roster table first, not changing this format.
 */
export type GridCellMark = "S" | "A";

export type ReportGridColumn = {
  /** YYYY-MM-DD. Several columns can share a date when a day had more than one Mass. */
  date: string;
  massName: string;
  sessionId: string;
};

export type ReportGridRow = {
  memberId: string;
  /** Already formatted for display (last name first), as the PDF and exports both use. */
  name: string;
  cells: GridCellMark[];
  /** Masses served within the report's included sessions. */
  served: number;
  /**
   * Masses served anywhere in the month, including sessions left out of the report.
   *
   * Deliberately different from `served`. `pdf.ts` tints the Remarks column by this, and
   * the old code passed the included-sessions count under the name `servedInMonth`, so a
   * member who served twice on days the report omitted was tinted as having not served.
   */
  servedInMonth: number;
  remarks: string;
};

export type ReportGridSnapshot = {
  columns: ReportGridColumn[];
  rows: ReportGridRow[];
};

/** Served/absent for every member against every column, in the report's own order. */
export function cellMarks(
  sessionOrder: string[],
  memberId: string,
  attended: Set<string>,
): GridCellMark[] {
  return sessionOrder.map((sessionId) =>
    cellKindForSession(sessionId, memberId, attended) === "served" ? "S" : "A",
  );
}

/**
 * Build the v5 grid snapshot.
 *
 * Both the on-screen preview and the stored `summary_json` come from here, which is what
 * makes the RPT-2 acceptance criterion ("the preview matches the PDF cell for cell")
 * structural rather than a promise: there is one function, and the PDF is rendered from
 * the same marks.
 */
export function buildReportGridSnapshot(input: {
  columnGroups: ReportDateGroup[];
  /** Every member to appear as a row, with the display name already formatted. */
  members: Array<{ id: string; name: string }>;
  /** `"${memberId}:${sessionId}"` for every attendance record in the month. */
  attended: Set<string>;
  records: Array<{ member_id: string; session_id: string }>;
  /** Ids of the sessions included in the report, for the served counts. */
  includedSessionIds: Set<string>;
  /** Ids of every session in the month, for servedInMonth. */
  monthSessionIds: Set<string>;
}): ReportGridSnapshot {
  const { columnGroups, members, attended, records, includedSessionIds, monthSessionIds } = input;
  const sessionOrder = flattenSessionOrder(columnGroups);

  const columns: ReportGridColumn[] = [];
  for (const group of columnGroups) {
    for (const session of group.sessions) {
      columns.push({
        date: group.dateYmd,
        massName: session.massName,
        sessionId: session.id,
      });
    }
  }

  const rows: ReportGridRow[] = members
    .map((m) => {
      const cells = cellMarks(sessionOrder, m.id, attended);
      const served = servedCountForSessions(m.id, records, includedSessionIds);
      const servedInMonth = servedCountForSessions(m.id, records, monthSessionIds);
      return {
        memberId: m.id,
        name: m.name,
        cells,
        served,
        servedInMonth,
        remarks: remarksForServedCount(served),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return { columns, rows };
}

