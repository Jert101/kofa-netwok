import { describe, it, expect } from "vitest";
import {
  buildReportColumnGroups,
  buildReportGridSnapshot,
  cellMarks,
  flattenSessionOrder,
  remarksForServedCount,
  servedCountForSessions,
  type ReportDateGroup,
} from "./weekend-grid";

const mass = (name: string) => ({ name });

const session = (id: string, date: string, createdAt: string, massName: string) => ({
  id,
  session_date: date,
  created_at: createdAt,
  masses: mass(massName),
});

describe("buildReportColumnGroups", () => {
  it("groups a multi-Mass day under one date", () => {
    const groups = buildReportColumnGroups(
      [
        session("s1", "2026-05-03", "2026-05-01T01:00:00Z", "First Mass Servers"),
        session("s2", "2026-05-03", "2026-05-01T02:00:00Z", "Second Mass Servers"),
      ],
      new Set(["s1", "s2"]),
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].dateYmd).toBe("2026-05-03");
    expect(groups[0].sessions.map((s) => s.id)).toEqual(["s1", "s2"]);
  });

  it("orders masses within a day by created_at, then id", () => {
    const groups = buildReportColumnGroups(
      [
        session("b", "2026-05-03", "2026-05-01T02:00:00Z", "Second"),
        session("a", "2026-05-03", "2026-05-01T01:00:00Z", "First"),
        // Same created_at as `a`, so the id breaks the tie.
        session("c", "2026-05-03", "2026-05-01T01:00:00Z", "Tiebreak"),
      ],
      new Set(["a", "b", "c"]),
    );
    expect(groups[0].sessions.map((s) => s.id)).toEqual(["a", "c", "b"]);
  });

  it("sorts dates ascending", () => {
    const groups = buildReportColumnGroups(
      [
        session("s3", "2026-05-24", "2026-05-01T03:00:00Z", "Third"),
        session("s1", "2026-05-03", "2026-05-01T01:00:00Z", "First"),
        session("s2", "2026-05-17", "2026-05-01T02:00:00Z", "Second"),
      ],
      new Set(["s1", "s2", "s3"]),
    );
    expect(groups.map((g) => g.dateYmd)).toEqual(["2026-05-03", "2026-05-17", "2026-05-24"]);
  });

  it("drops sessions that were not selected", () => {
    const groups = buildReportColumnGroups(
      [
        session("keep", "2026-05-03", "2026-05-01T01:00:00Z", "Keep"),
        session("drop", "2026-05-03", "2026-05-01T02:00:00Z", "Drop"),
      ],
      new Set(["keep"]),
    );
    expect(flattenSessionOrder(groups)).toEqual(["keep"]);
  });

  it("ignores an unknown selected id rather than inventing a column", () => {
    const groups = buildReportColumnGroups(
      [session("real", "2026-05-03", "2026-05-01T01:00:00Z", "Real")],
      new Set(["real", "ghost"]),
    );
    expect(flattenSessionOrder(groups)).toEqual(["real"]);
  });

  it("falls back to a generic name when the Mass join is missing", () => {
    const groups = buildReportColumnGroups(
      [{ id: "s1", session_date: "2026-05-03", created_at: "x", masses: null }],
      new Set(["s1"]),
    );
    expect(groups[0].sessions[0].massName).toBe("Mass");
  });

  it("returns nothing when no session is selected", () => {
    const groups = buildReportColumnGroups(
      [session("s1", "2026-05-03", "2026-05-01T01:00:00Z", "First")],
      new Set(),
    );
    expect(groups).toEqual([]);
    expect(flattenSessionOrder(groups)).toEqual([]);
  });
});

describe("remarksForServedCount", () => {
  it("handles the zero, one and many cases", () => {
    expect(remarksForServedCount(0)).toBe("Didn't serve");
    expect(remarksForServedCount(1)).toBe("Served 1 mass");
    expect(remarksForServedCount(4)).toBe("Served 4 masses");
  });
});

describe("servedCountForSessions", () => {
  const records = [
    { member_id: "m1", session_id: "s1" },
    { member_id: "m1", session_id: "s2" },
    { member_id: "m2", session_id: "s1" },
  ];

  it("counts only the named sessions", () => {
    expect(servedCountForSessions("m1", records, new Set(["s1"]))).toBe(1);
    expect(servedCountForSessions("m1", records, new Set(["s1", "s2"]))).toBe(2);
    expect(servedCountForSessions("m2", records, new Set(["s1", "s2"]))).toBe(1);
    expect(servedCountForSessions("nobody", records, new Set(["s1", "s2"]))).toBe(0);
  });

  it("counts nothing against an empty session set", () => {
    expect(servedCountForSessions("m1", records, new Set())).toBe(0);
  });
});

describe("cellMarks", () => {
  it("marks S for served and A for absent", () => {
    const attended = new Set(["m1:s1"]);
    expect(cellMarks(["s1", "s2"], "m1", attended)).toEqual(["S", "A"]);
    expect(cellMarks(["s1"], "m2", attended)).toEqual(["A"]);
  });

  it("returns no marks for no columns", () => {
    expect(cellMarks([], "m1", new Set())).toEqual([]);
  });
});

describe("buildReportGridSnapshot", () => {
  const columnGroups: ReportDateGroup[] = [
    {
      dateYmd: "2026-05-03",
      sessions: [
        { id: "s1", massName: "First Mass Servers" },
        { id: "s2", massName: "Second Mass Servers" },
      ],
    },
    { dateYmd: "2026-05-10", sessions: [{ id: "s3", massName: "First Mass Servers" }] },
  ];

  const records = [
    { member_id: "m1", session_id: "s1" },
    { member_id: "m1", session_id: "s3" },
    // s4 belongs to the month but is not one of the report's columns. This is the case
    // that separates `served` from `servedInMonth`.
    { member_id: "m1", session_id: "s4" },
    { member_id: "m2", session_id: "s1" },
    { member_id: "m3", session_id: "s2" },
  ];
  const attended = new Set(records.map((r) => `${r.member_id}:${r.session_id}`));

  const snapshot = () =>
    buildReportGridSnapshot({
      columnGroups,
      members: [
        { id: "m1", name: "Dela Cruz, Juan" },
        { id: "m2", name: "Reyes, Ana" },
        { id: "m3", name: "Santos, Pedro" },
      ],
      attended,
      records,
      includedSessionIds: new Set(["s1", "s2", "s3"]),
      monthSessionIds: new Set(["s1", "s2", "s3", "s4"]),
    });

  it("flattens groups into one column per session, keeping the date on each", () => {
    expect(snapshot().columns).toEqual([
      { date: "2026-05-03", massName: "First Mass Servers", sessionId: "s1" },
      { date: "2026-05-03", massName: "Second Mass Servers", sessionId: "s2" },
      { date: "2026-05-10", massName: "First Mass Servers", sessionId: "s3" },
    ]);
  });

  it("emits one cell per column, in column order", () => {
    for (const row of snapshot().rows) {
      expect(row.cells).toHaveLength(snapshot().columns.length);
    }
  });

  it("marks served and absent correctly", () => {
    const rows = snapshot().rows;
    const m1 = rows.find((r) => r.memberId === "m1")!;
    // s1 served, s2 not, s3 served. The s4 record has no column and so produces no cell.
    expect(m1.cells).toEqual(["S", "A", "S"]);
    const m3 = rows.find((r) => r.memberId === "m3")!;
    expect(m3.cells).toEqual(["A", "S", "A"]);
  });

  it("separates served-within-report from served-in-month", () => {
    const m1 = snapshot().rows.find((r) => r.memberId === "m1")!;
    // s1 and s3 are in the report; s4 is a month session left out of it.
    expect(m1.served).toBe(2);
    expect(m1.servedInMonth).toBe(3);
    expect(m1.remarks).toBe("Served 2 masses");
  });

  it("builds remarks from the report-scoped count", () => {
    const m3 = snapshot().rows.find((r) => r.memberId === "m3")!;
    // m3 served s2, which is an included column, so the two counts agree here.
    expect(m3.served).toBe(1);
    expect(m3.servedInMonth).toBe(1);
    expect(m3.remarks).toBe("Served 1 mass");
  });

  it("counts remarks from the report columns even when the month total differs", () => {
    // The regression this guards: remarks once reported the month-wide count, so a member
    // whose only serving was on an omitted day read "Served 1 mass" instead of
    // "Didn't serve" for the report as printed.
    const grid = buildReportGridSnapshot({
      columnGroups: [{ dateYmd: "2026-05-10", sessions: [{ id: "s3", massName: "First" }] }],
      members: [{ id: "m1", name: "Dela Cruz, Juan" }],
      attended: new Set(["m1:s1"]),
      records: [{ member_id: "m1", session_id: "s1" }],
      includedSessionIds: new Set(["s3"]),
      monthSessionIds: new Set(["s1", "s3"]),
    });
    expect(grid.rows[0].served).toBe(0);
    expect(grid.rows[0].servedInMonth).toBe(1);
    expect(grid.rows[0].remarks).toBe("Didn't serve");
    expect(grid.rows[0].cells).toEqual(["A"]);
  });

  it("sorts rows by display name", () => {
    expect(snapshot().rows.map((r) => r.name)).toEqual([
      "Dela Cruz, Juan",
      "Reyes, Ana",
      "Santos, Pedro",
    ]);
  });

  it("keeps members with no records at all, as all-absent", () => {
    const grid = buildReportGridSnapshot({
      columnGroups,
      members: [{ id: "ghost", name: "Ghost, Member" }],
      attended,
      records,
      includedSessionIds: new Set(["s1", "s3"]),
      monthSessionIds: new Set(["s1", "s2", "s3"]),
    });
    expect(grid.rows[0].cells).toEqual(["A", "A", "A"]);
    expect(grid.rows[0].remarks).toBe("Didn't serve");
  });

  it("produces columns but no rows when no sessions are selected", () => {
    const grid = buildReportGridSnapshot({
      columnGroups: [],
      members: [{ id: "m1", name: "Dela Cruz, Juan" }],
      attended,
      records,
      includedSessionIds: new Set(),
      monthSessionIds: new Set(["s1", "s2", "s3"]),
    });
    expect(grid.columns).toEqual([]);
    expect(grid.rows[0].cells).toEqual([]);
  });

  it("produces no rows for no members", () => {
    const grid = buildReportGridSnapshot({
      columnGroups,
      members: [],
      attended,
      records,
      includedSessionIds: new Set(["s1", "s3"]),
      monthSessionIds: new Set(["s1", "s2", "s3"]),
    });
    expect(grid.rows).toEqual([]);
    expect(grid.columns).toHaveLength(3);
  });
});
