import { describe, expect, it } from "vitest";
import {
  buildPreviewWarnings,
  canProceedFromSessions,
  computeSelection,
  medianAttendance,
  selectLowTurnout,
  summarizeConfirm,
  toggleId,
  type WizardSession,
} from "./wizard";

function s(id: string, attendance_count: number | null, date = "2026-09-06"): WizardSession {
  return { id, session_date: date, weekday_label: "Sunday", mass_name: "Mass", attendance_count };
}

describe("medianAttendance", () => {
  it("returns 0 when nothing is counted", () => {
    expect(medianAttendance([])).toBe(0);
    expect(medianAttendance([s("a", null), s("b", null)])).toBe(0);
  });

  it("ignores sessions with no count rather than treating them as zero attendance", () => {
    // A missing count is unknown, not zero. Counting it as zero would drag the median down
    // and flag well-attended sessions as "low turnout".
    expect(medianAttendance([s("a", null), s("b", 10), s("c", 12), s("d", 14)])).toBe(12);
  });

  it("takes the middle value of an odd count", () => {
    expect(medianAttendance([s("a", 5), s("b", 30), s("c", 12)])).toBe(12);
  });

  it("averages the two middle values of an even count", () => {
    expect(medianAttendance([s("a", 10), s("b", 20)])).toBe(15);
    expect(medianAttendance([s("a", 4), s("b", 6), s("c", 10), s("d", 20)])).toBe(8);
  });

  it("resists one unusually large day", () => {
    // A mean would be pulled far above the typical session by the 200-day outlier.
    const sessions = [s("a", 200), s("b", 10), s("c", 12), s("d", 11), s("e", 9)];
    expect(medianAttendance(sessions)).toBe(11);
  });
});

describe("selectLowTurnout", () => {
  it("flags nothing when the month has no attendance data", () => {
    expect(selectLowTurnout([s("a", null), s("b", null)]).size).toBe(0);
  });

  it("flags sessions at or below half the median", () => {
    // median 11, half is 5.5: 5 qualifies, 9 does not.
    const sessions = [s("a", 5), s("b", 9), s("c", 11), s("d", 12), s("e", 200)];
    expect([...selectLowTurnout(sessions)].sort()).toEqual(["a"]);
  });

  it("flags a session exactly at half the median", () => {
    // median 10, threshold 5. The session sitting exactly on 5 is tied for quietest, so the
    // inclusive boundary is what catches it.
    const sessions = [s("a", 5), s("b", 10), s("c", 15)];
    expect([...selectLowTurnout(sessions)].sort()).toEqual(["a"]);
  });

  it("does not flag everything when every session is equally quiet", () => {
    // Threshold at half the median of a flat month would clear the whole list and make the
    // warning meaningless.
    const sessions = [s("a", 4), s("b", 4), s("c", 4)];
    expect(selectLowTurnout(sessions).size).toBe(0);
  });

  it("skips sessions with no count", () => {
    const sessions = [s("a", null), s("b", 2), s("c", 20), s("d", 22)];
    expect(selectLowTurnout(sessions).has("a")).toBe(false);
  });
});

describe("canProceedFromSessions", () => {
  it("requires at least one session", () => {
    expect(canProceedFromSessions(0)).toBe(false);
    expect(canProceedFromSessions(1)).toBe(true);
  });
});

describe("computeSelection", () => {
  it("drops ids that are not in the month list", () => {
    // A stale selection from a previous month must not inflate the counts.
    const sessions = [s("a", 10), s("b", 20)];
    const sel = computeSelection(sessions, ["a", "ghost"]);
    expect(sel.selectedIds).toEqual(["a"]);
    expect(sel.totalAttendance).toBe(10);
  });

  it("sums attendance only for included sessions", () => {
    const sessions = [s("a", 10), s("b", 20), s("c", 30)];
    expect(computeSelection(sessions, ["a", "c"]).totalAttendance).toBe(40);
  });

  it("keeps the median over all sessions, not just included ones", () => {
    // The threshold describes the month, so narrowing the selection cannot change which
    // sessions look unusual and then include them by accident.
    const sessions = [s("a", 5), s("b", 10), s("c", 15)];
    const sel = computeSelection(sessions, ["a"]);
    expect(sel.medianAttendance).toBe(10);
    expect(sel.lowTurnoutIds.has("a")).toBe(true);
  });

  it("does not double count a repeated id", () => {
    const sessions = [s("a", 10), s("b", 20)];
    expect(computeSelection(sessions, ["a", "a"]).totalAttendance).toBe(10);
  });
});

describe("buildPreviewWarnings", () => {
  it("warns about pending appeals", () => {
    const w = buildPreviewWarnings({ pendingAppeals: 3, zeroAttendanceMembers: 0, selectedSessions: 4 });
    expect(w.messages.join(" ")).toMatch(/3 appeals are still pending/);
  });

  it("uses singular wording for one appeal", () => {
    const w = buildPreviewWarnings({ pendingAppeals: 1, zeroAttendanceMembers: 0, selectedSessions: 1 });
    expect(w.messages[0]).toMatch(/1 appeal is still pending/);
  });

  it("warns about active members who would drop off the report", () => {
    const w = buildPreviewWarnings({ pendingAppeals: 0, zeroAttendanceMembers: 5, selectedSessions: 4 });
    expect(w.messages.join(" ")).toMatch(/5 active members have no attendance/);
  });

  it("reports both warnings together", () => {
    const w = buildPreviewWarnings({ pendingAppeals: 1, zeroAttendanceMembers: 2, selectedSessions: 4 });
    expect(w.messages).toHaveLength(2);
  });

  it("stays silent when there is nothing to flag", () => {
    const w = buildPreviewWarnings({ pendingAppeals: 0, zeroAttendanceMembers: 0, selectedSessions: 4 });
    expect(w.messages).toEqual([]);
  });
});

describe("summarizeConfirm", () => {
  it("names the month and the column count", () => {
    const lines = summarizeConfirm({
      monthLabel: "September 2026",
      selectedCount: 4,
      totalSessionsInMonth: 6,
      archiveAfterGenerate: true,
    });
    expect(lines[0]).toBe("Month: September 2026");
    expect(lines[1]).toBe("4 of 6 Masses included as columns");
  });

  it("uses a singular noun for one session", () => {
    const lines = summarizeConfirm({
      monthLabel: "September 2026",
      selectedCount: 1,
      totalSessionsInMonth: 1,
      archiveAfterGenerate: false,
    });
    expect(lines[1]).toBe("1 of 1 Mass included as columns");
  });

  it("says attendance is archived when it will be", () => {
    const lines = summarizeConfirm({
      monthLabel: "September 2026",
      selectedCount: 2,
      totalSessionsInMonth: 2,
      archiveAfterGenerate: true,
    });
    expect(lines.join(" ")).toMatch(/moved to the archive/);
  });

  it("says attendance stays live when it will not", () => {
    const lines = summarizeConfirm({
      monthLabel: "September 2026",
      selectedCount: 2,
      totalSessionsInMonth: 2,
      archiveAfterGenerate: false,
    });
    expect(lines.join(" ")).toMatch(/stays in the app/);
  });
});

describe("toggleId", () => {
  it("adds an id that is not selected", () => {
    expect(toggleId(["a"], "b")).toEqual(["a", "b"]);
  });

  it("removes an id that is selected", () => {
    expect(toggleId(["a", "b"], "a")).toEqual(["b"]);
  });

  it("does not mutate the input", () => {
    const original = ["a"];
    toggleId(original, "b");
    expect(original).toEqual(["a"]);
  });
});