import { describe, expect, it } from "vitest";
import {
  computeMemberMetrics,
  heldSessionIds,
  isSunday,
  isWeekend,
  monthsBefore,
  recentSessions,
  todayInTimeZone,
  weekendStreak,
  type AttendanceSession,
} from "@/lib/attendance/metrics";

const TODAY = "2026-09-30"; // a Wednesday

function session(
  id: string,
  sessionDate: string,
  massName: string | null = "Sunday Mass",
): AttendanceSession {
  return { id, sessionDate, massName };
}

describe("day helpers", () => {
  it("knows Sundays", () => {
    expect(isSunday("2026-09-27")).toBe(true);
    expect(isSunday("2026-09-30")).toBe(false);
  });

  it("treats Saturday and Sunday as the weekend", () => {
    expect(isWeekend("2026-09-26")).toBe(true);
    expect(isWeekend("2026-09-27")).toBe(true);
    expect(isWeekend("2026-09-28")).toBe(false);
  });

  it("does not shift the day across a timezone boundary", () => {
    // A Sunday evening in Manila is still the 27th locally; parsing must not slide
    // it to the 28th or the Sunday count is wrong by a day.
    expect(isSunday("2026-09-27")).toBe(true);
  });

  it("returns false for a date that does not exist", () => {
    expect(isSunday("2026-02-30")).toBe(false);
    expect(isWeekend("nonsense")).toBe(false);
  });
});

describe("monthsBefore", () => {
  it("steps back whole months", () => {
    expect(monthsBefore("2026-09-30", 3)).toBe("2026-06-30");
    expect(monthsBefore("2026-09-15", 3)).toBe("2026-06-15");
  });

  it("clamps to a shorter month instead of rolling into the next one", () => {
    // Three months before 31 May is 28/29 February, not 3 March.
    expect(monthsBefore("2026-05-31", 3)).toBe("2026-02-28");
    expect(monthsBefore("2024-05-31", 3)).toBe("2024-02-29");
    expect(monthsBefore("2026-03-31", 3)).toBe("2025-12-31");
  });
});

describe("heldSessionIds", () => {
  it("deduplicates the session ids that have any record", () => {
    expect(heldSessionIds(["s1", "s1", "s2"]).size).toBe(2);
  });
});

describe("computeMemberMetrics", () => {
  it("reports nothing rather than dividing by zero", () => {
    const m = computeMemberMetrics({
      sessions: [],
      memberSessionIds: [],
      anyRecordSessionIds: [],
      today: TODAY,
    });
    expect(m.attendanceRate).toBeNull();
    expect(m.sessionsHeld).toBe(0);
    expect(m.lifetimeServed).toBe(0);
    expect(m.weekendStreak).toBe(0);
    expect(m.lastServedDate).toBeNull();
  });

  it("divides the member's own attendance by the sessions held", () => {
    const sessions = [
      session("s1", "2026-09-06"),
      session("s2", "2026-08-30"),
      session("s3", "2026-08-23"),
      session("s4", "2026-08-16"),
    ];
    const m = computeMemberMetrics({
      sessions,
      memberSessionIds: ["s1", "s2", "s3"],
      // Somebody else served s4, so it was still held.
      anyRecordSessionIds: ["s1", "s2", "s3", "s4"],
      today: TODAY,
    });
    expect(m.sessionsHeld).toBe(4);
    expect(m.attendanceRate).toBe(75);
  });

  it("leaves a session nobody attended out of the denominator", () => {
    const m = computeMemberMetrics({
      sessions: [session("s1", "2026-09-06"), session("s2", "2026-09-20")],
      memberSessionIds: ["s1"],
      anyRecordSessionIds: ["s1"],
      today: TODAY,
    });
    expect(m.sessionsHeld).toBe(1);
    expect(m.attendanceRate).toBe(100);
  });

  it("keeps archived history in the lifetime count", () => {
    const sessions: AttendanceSession[] = [
      { id: "old", sessionDate: "2019-05-05", massName: "Sunday Mass", archived: true },
      session("new", "2026-09-27"),
    ];
    const m = computeMemberMetrics({
      sessions,
      memberSessionIds: ["old"],
      anyRecordSessionIds: ["old"],
      today: TODAY,
    });
    expect(m.lifetimeServed).toBe(1);
  });

  it("ignores sessions outside the three month window", () => {
    const m = computeMemberMetrics({
      sessions: [session("recent", "2026-09-06"), session("ancient", "2020-01-05")],
      memberSessionIds: ["recent", "ancient"],
      anyRecordSessionIds: ["recent", "ancient"],
      today: TODAY,
    });
    // Lifetime counts both, the rate window only the recent one.
    expect(m.lifetimeServed).toBe(2);
    expect(m.sessionsHeld).toBe(1);
  });

  it("does not count a session that has not happened yet", () => {
    const m = computeMemberMetrics({
      sessions: [session("past", "2026-09-06"), session("future", "2026-10-11")],
      memberSessionIds: ["past", "future"],
      anyRecordSessionIds: ["past", "future"],
      today: TODAY,
    });
    expect(m.sessionsHeld).toBe(1);
    // Lifetime is history and would include a wrongly dated future row.
    expect(m.lifetimeServed).toBe(2);
  });

  it("narrows the window to Sundays when asked", () => {
    const sessions = [
      session("sun", "2026-09-27"),
      session("sat", "2026-09-26"),
      session("wed", "2026-09-23"),
    ];
    const all = ["sun", "sat", "wed"];
    expect(
      computeMemberMetrics({
        sessions,
        memberSessionIds: all,
        anyRecordSessionIds: all,
        today: TODAY,
      }).sessionsHeld,
    ).toBe(3);
    expect(
      computeMemberMetrics({
        sessions,
        memberSessionIds: all,
        anyRecordSessionIds: all,
        today: TODAY,
        sundaysOnly: true,
      }).sessionsHeld,
    ).toBe(1);
  });

  it("does not count a member record whose session is missing", () => {
    const m = computeMemberMetrics({
      sessions: [session("s1", "2026-09-27")],
      memberSessionIds: ["s1", "ghost-session"],
      anyRecordSessionIds: ["s1"],
      today: TODAY,
    });
    expect(m.lifetimeServed).toBe(1);
  });

  it("finds the most recent session attended", () => {
    const m = computeMemberMetrics({
      sessions: [
        session("old", "2024-02-04"),
        session("mid", "2026-08-30"),
        session("missed", "2026-09-27"),
      ],
      memberSessionIds: ["old", "mid"],
      anyRecordSessionIds: ["old", "mid", "missed"],
      today: TODAY,
    });
    expect(m.lastServedDate).toBe("2026-08-30");
  });

  it("does not double count a session present in both live and archive", () => {
    const sessions: AttendanceSession[] = [
      session("s1", "2026-09-27", null),
      { id: "s1", sessionDate: "2026-09-27", massName: "Sunday Mass", archived: true },
    ];
    const m = computeMemberMetrics({
      sessions,
      memberSessionIds: ["s1"],
      anyRecordSessionIds: ["s1"],
      today: TODAY,
    });
    expect(m.sessionsHeld).toBe(1);
    expect(m.attendanceRate).toBe(100);
  });
});

describe("weekendStreak", () => {
  it("is zero with no sessions", () => {
    expect(weekendStreak([], new Set())).toBe(0);
  });

  it("counts consecutive weekends attended, newest first", () => {
    const sessions = [
      session("a", "2026-09-06"),
      session("b", "2026-09-13"),
      session("c", "2026-09-20"),
    ];
    expect(weekendStreak(sessions, new Set(["a", "b", "c"]))).toBe(3);
  });

  it("stops at the first weekend missed", () => {
    // Three consecutive weekends ran and 20 Sep is the latest, so it anchors.
    const sessions = [
      session("a", "2026-09-06"),
      session("b", "2026-09-13"),
      session("c", "2026-09-20"),
    ];
    expect(weekendStreak(sessions, new Set(["a", "b", "c"]))).toBe(3);
    expect(weekendStreak(sessions, new Set(["b", "c"]))).toBe(2);
    expect(weekendStreak(sessions, new Set(["c"]))).toBe(1);
    // Missing the anchoring weekend itself is a streak of nothing, however many
    // weekends before it they attended.
    expect(weekendStreak(sessions, new Set(["a", "b"]))).toBe(0);
  });

  it("counts a Saturday and the next Sunday as one weekend", () => {
    const sessions = [session("sat", "2026-09-19"), session("sun", "2026-09-20")];
    // Attending only the Saturday is still attending that weekend.
    expect(weekendStreak(sessions, new Set(["sat"]))).toBe(1);
  });

  it("is not extended by a weekday session", () => {
    const sessions = [session("wed", "2026-09-23"), session("sun", "2026-09-20")];
    expect(weekendStreak(sessions, new Set(["wed", "sun"]))).toBe(1);
  });

  it("breaks the streak on a weekend with no session at all", () => {
    // 13 and 27 Sep ran; 20 Sep did not. Attending both ends is a streak of 1.
    const sessions = [session("a", "2026-09-13"), session("c", "2026-09-27")];
    expect(weekendStreak(sessions, new Set(["a", "c"]))).toBe(1);
  });

  it("anchors on the latest weekend that ran, not on today", () => {
    // Nothing has run since 27 Sep, so a member last seen then keeps that streak;
    // it does not reset merely because time passed.
    const sessions = [session("a", "2026-09-20"), session("b", "2026-09-27")];
    expect(weekendStreak(sessions, new Set(["a", "b"]))).toBe(2);
  });
});

describe("recentSessions", () => {
  it("returns the newest sessions first with presence", () => {
    const sessions = [
      session("old", "2026-08-30"),
      session("new", "2026-09-27"),
      session("mid", "2026-09-20"),
    ];
    const rows = recentSessions(sessions, ["new"], 2);
    expect(rows.map((r) => r.id)).toEqual(["new", "mid"]);
    expect(rows[0].present).toBe(true);
    expect(rows[1].present).toBe(false);
    expect(rows[0].sunday).toBe(true);
  });

  it("keeps the archived flag so the UI can label old history", () => {
    const rows = recentSessions(
      [{ id: "a", sessionDate: "2026-09-27", massName: "Sunday Mass", archived: true }],
      ["a"],
    );
    expect(rows[0].archived).toBe(true);
  });

  it("caps the list at twenty by default", () => {
    const sessions = Array.from({ length: 30 }, (_, i) =>
      session(`s${i}`, `2026-01-${String((i % 28) + 1).padStart(2, "0")}`),
    );
    expect(recentSessions(sessions, []).length).toBeLessThanOrEqual(20);
  });
});

describe("todayInTimeZone", () => {
  // 2026-05-04T16:30:00Z is already the 5th in Manila (UTC+8) but still the 4th in
  // UTC. A parish a day ahead is the whole reason this exists.
  const evening = new Date("2026-05-04T16:30:00Z");

  it("uses the parish's date, not UTC's, when the two differ", () => {
    expect(todayInTimeZone(evening, "Asia/Manila")).toBe("2026-05-05");
    expect(todayInTimeZone(evening, "UTC")).toBe("2026-05-04");
  });

  it("handles a zone behind UTC as well", () => {
    const morning = new Date("2026-05-04T02:00:00Z");
    expect(todayInTimeZone(morning, "America/New_York")).toBe("2026-05-03");
  });

  it("stays on the same date when the parish is already on it", () => {
    expect(todayInTimeZone(new Date("2026-05-04T04:00:00Z"), "Asia/Manila")).toBe("2026-05-04");
  });

  it("crosses a month boundary in the parish's favour", () => {
    // 23:30 UTC on the 31st is already the 1st in Manila.
    expect(todayInTimeZone(new Date("2026-05-31T23:30:00Z"), "Asia/Manila")).toBe("2026-06-01");
  });

  it("crosses a year boundary too", () => {
    expect(todayInTimeZone(new Date("2025-12-31T16:30:00Z"), "Asia/Manila")).toBe("2026-01-01");
  });

  it("falls back to UTC when no timezone is configured", () => {
    expect(todayInTimeZone(evening, null)).toBe("2026-05-04");
    expect(todayInTimeZone(evening, "")).toBe("2026-05-04");
  });

  it("falls back to UTC on a timezone name it cannot read", () => {
    // Guessing a nearby zone would be worse than falling back to UTC.
    expect(todayInTimeZone(evening, "Not/AZone")).toBe("2026-05-04");
  });

  it("always returns a plain YYYY-MM-DD", () => {
    expect(todayInTimeZone(evening, "Asia/Manila")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
