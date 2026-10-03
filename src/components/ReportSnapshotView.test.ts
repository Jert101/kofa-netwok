import { describe, expect, it } from "vitest";
import type { SnapshotPayload } from "@/components/ReportSnapshotView";
import { columnHeading, normaliseTotals } from "@/lib/reports/snapshot";
import type { ReportGridColumn, ReportGridRow } from "@/lib/reports/weekend-grid";

/**
 * Tests for the pieces of the snapshot view that carry meaning.
 *
 * The component's rendering is not tested here; what is tested is the interpretation of a
 * stored `summary_json`, because that mapping is where a v4 report can silently render as an
 * empty month instead of as "unavailable".
 */

function col(date: string, massName: string, sessionId: string): ReportGridColumn {
  return { date, massName, sessionId };
}

function row(partial: Partial<ReportGridRow> & { memberId: string; name: string }): ReportGridRow {
  return {
    cells: ["S", "A"],
    served: 1,
    servedInMonth: 1,
    remarks: "Served 1 mass",
    ...partial,
  };
}

describe("snapshot shape", () => {
  it("treats a missing grid as unavailable rather than empty", () => {
    // `null` grid is the v4 signal. An empty rows array would instead mean "no members", which
    // reads as a real report of zero attendance.
    const snapshot: SnapshotPayload = {
      grid: null,
      totals: { sessions_in_report: 4, attendance: 90, memberCount: 30 },
      monthLabel: "April 2026",
      version: 4,
    };
    expect(snapshot.grid).toBeNull();
    expect(snapshot.totals?.sessions_in_report).toBe(4);
    expect(snapshot.totals?.attendance).toBe(90);
  });

  it("keeps totals available even when the grid is present", () => {
    const snapshot: SnapshotPayload = {
      grid: { columns: [col("2026-09-06", "Morning", "s1")], rows: [] },
      totals: { sessions_in_report: 1, attendance: 0, memberCount: 0 },
      monthLabel: "September 2026",
      version: 5,
    };
    expect(snapshot.totals?.memberCount).toBe(0);
    expect(snapshot.grid?.columns).toHaveLength(1);
  });
});

describe("grid alignment", () => {
  it("keeps one cell per column", () => {
    const columns = [col("2026-09-06", "Morning", "s1"), col("2026-09-06", "Evening", "s2")];
    const rows = [row({ memberId: "m1", name: "Santos, Ana", cells: ["S", "A"] })];
    for (const r of rows) {
      expect(r.cells.length).toBe(columns.length);
    }
  });

  it("supports two Masses on the same date as separate columns", () => {
    const columns = [col("2026-09-06", "Morning", "s1"), col("2026-09-06", "Evening", "s2")];
    expect(columns[0].date).toBe(columns[1].date);
    expect(columns[0].sessionId).not.toBe(columns[1].sessionId);
  });

  it("carries only the two marks the grid defines", () => {
    const marks = new Set(["S", "A"]);
    const r = row({ memberId: "m1", name: "Dela Cruz, Juan", cells: ["S", "A"] });
    for (const c of r.cells) expect(marks.has(c)).toBe(true);
  });
});

describe("normaliseTotals", () => {
  it("reads the stored snake_case shape", () => {
    // This is what `summary_json` actually holds, and what the PDF renderer reads.
    const t = normaliseTotals({
      sessions_in_month: 6,
      sessions_in_report: 4,
      attendance: 90,
      memberCount: 30,
      zero_attendance_members: 3,
    });
    expect(t).toEqual({
      sessionsInMonth: 6,
      sessionsInReport: 4,
      attendance: 90,
      memberCount: 30,
      zeroAttendanceMembers: 3,
    });
  });

  it("reads the preview endpoint's camelCase shape identically", () => {
    // Same month, same numbers, different key casing. Before this existed the tiles rendered
    // "—" for a preview that had the data right there.
    const t = normaliseTotals({
      sessionsInMonth: 6,
      sessionsInReport: 4,
      attendance: 90,
      memberCount: 30,
      zeroAttendanceMembers: 3,
    });
    expect(t.sessionsInReport).toBe(4);
    expect(t.zeroAttendanceMembers).toBe(3);
  });

  it("yields nulls when totals are missing", () => {
    expect(normaliseTotals(null)).toEqual({
      sessionsInMonth: null,
      sessionsInReport: null,
      attendance: null,
      memberCount: null,
      zeroAttendanceMembers: null,
    });
  });

  it("keeps a zero rather than treating it as absent", () => {
    // Zero attendance is a real, important result. Reading it as missing would show "—",
    // which reads as "no data" instead of "nobody attended".
    const t = normaliseTotals({ attendance: 0, sessions_in_report: 0, memberCount: 0 });
    expect(t.attendance).toBe(0);
    expect(t.sessionsInReport).toBe(0);
    expect(t.memberCount).toBe(0);
  });

  it("rejects a non-numeric value instead of rendering it", () => {
    expect(normaliseTotals({ attendance: "90" }).attendance).toBeNull();
    expect(normaliseTotals({ attendance: Number.NaN }).attendance).toBeNull();
  });

  it("prefers the stored key when both are present", () => {
    const t = normaliseTotals({ sessions_in_report: 4, sessionsInReport: 99 });
    expect(t.sessionsInReport).toBe(4);
  });
});

describe("columnHeading", () => {
  it("shortens a date for a narrow column", () => {
    expect(columnHeading("2026-09-06")).toBe("6 Sep");
  });

  it("drops a leading zero", () => {
    expect(columnHeading("2026-09-06")).not.toContain("06 ");
  });

  it("returns an unparseable date unchanged rather than blanking the column", () => {
    expect(columnHeading("not-a-date")).toBe("not-a-date");
  });

  it("handles a single digit day", () => {
    expect(columnHeading("2026-12-01")).toBe("1 Dec");
  });
});

describe("served counts", () => {
  it("separates served-in-report from served-in-month", () => {
    // A member who served on a day the report left out is 1 in the report and 2 in the month.
    // Collapsing these would mislabel the report as missing attendance.
    const r = row({ memberId: "m1", name: "Reyes, Ana", served: 1, servedInMonth: 2 });
    expect(r.served).toBe(1);
    expect(r.servedInMonth).toBe(2);
  });

  it("reports zero served as zero, not as a dash state", () => {
    const r = row({ memberId: "m1", name: "Lim, Grace", cells: ["A", "A"], served: 0, remarks: "Didn't serve" });
    expect(r.served).toBe(0);
    expect(r.remarks).toBe("Didn't serve");
  });
});