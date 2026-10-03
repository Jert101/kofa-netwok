import { describe, expect, it } from "vitest";
import {
  AT_RISK,
  attendanceRate,
  attendanceTrend,
  averageAttendance,
  birthdaysWithin,
  atRiskMembers,
  daysBetween,
  dedupeSessions,
  describeTrend,
  describeTurnout,
  inactiveMembers,
  isSessionHeld,
  isSunday,
  isWeekend,
  recentWeekendKeys,
  sessionsHeld,
  totalAttendance,
  turnoutByMass,
  weekendStreak,
  weekStart,
  type AttendanceMark,
  type MemberRow,
  type Session,
} from "./metrics";

// --------------------------------------------------------------------------------------
// Fixtures
// --------------------------------------------------------------------------------------

/** A Sunday, the parish's main day. */
const SUN = "2026-10-04";
/** The Saturday before it: same weekend, because weekStart is Monday-anchored. */
const SAT = "2026-10-03";
const LAST_SUN = "2026-09-27";

function session(id: string, date: string, attendanceCount: number, massName: string | null = "5:30 AM"): Session {
  return { id, date, massId: `m-${massName}`, massName, attendanceCount };
}

function mark(memberId: string, sessionId: string, date: string): AttendanceMark {
  return { memberId, sessionId, date };
}

function member(id: string, over: Partial<MemberRow> = {}): MemberRow {
  return {
    id,
    fullName: `Member ${id}`,
    batch: "2024",
    isActive: true,
    dateOfBirth: null,
    ...over,
  };
}

// --------------------------------------------------------------------------------------
// Calendar helpers
// --------------------------------------------------------------------------------------

describe("weekStart", () => {
  it("gives the Monday of a Sunday's week", () => {
    expect(weekStart(SUN)).toBe("2026-09-28");
  });

  it("gives the same week for the Saturday before", () => {
    // A vigil Mass on Saturday evening and the Mass on Sunday are one weekend, not two.
    expect(weekStart(SAT)).toBe(weekStart(SUN));
  });

  it("is already the Monday when given a Monday", () => {
    expect(weekStart("2026-09-28")).toBe("2026-09-28");
  });
});

describe("isSunday and isWeekend", () => {
  it("identifies Sunday", () => {
    expect(isSunday(SUN)).toBe(true);
    expect(isSunday(SAT)).toBe(false);
  });

  it("counts Saturday as a weekend", () => {
    expect(isWeekend(SAT)).toBe(true);
    expect(isWeekend(SUN)).toBe(true);
    expect(isWeekend("2026-10-05")).toBe(false);
  });
});

describe("recentWeekendKeys", () => {
  it("counts back a week at a time, newest first", () => {
    expect(recentWeekendKeys(SUN, 3)).toEqual(["2026-09-28", "2026-09-21", "2026-09-14"]);
  });

  it("is zero-length for zero", () => {
    expect(recentWeekendKeys(SUN, 0)).toEqual([]);
  });
});

describe("daysBetween", () => {
  it("counts whole days", () => {
    expect(daysBetween("2026-10-01", "2026-10-04")).toBe(3);
  });

  it("is negative going backwards", () => {
    expect(daysBetween("2026-10-04", "2026-10-01")).toBe(-3);
  });
});

// --------------------------------------------------------------------------------------
// Session held
// --------------------------------------------------------------------------------------

describe("isSessionHeld", () => {
  it("is a session with at least one record", () => {
    expect(isSessionHeld({ attendanceCount: 1 })).toBe(true);
  });

  it("is not a session nobody attended", () => {
    // This is the denominator of every rate. A Mass with nobody in it was not held.
    expect(isSessionHeld({ attendanceCount: 0 })).toBe(false);
  });
});

describe("sessionsHeld", () => {
  it("filters out the empty ones", () => {
    const held = sessionsHeld([session("a", SUN, 5), session("b", SUN, 0), session("c", SUN, 2)]);
    expect(held.map((s) => s.id)).toEqual(["a", "c"]);
  });
});

describe("dedupeSessions", () => {
  it("collapses the same session seen live and archived", () => {
    // attendance_sessions_archive has a composite (id, archived_at) key, so this genuinely happens.
    const rows = [
      session("a", SUN, 0, null),
      { ...session("a", SUN, 5, "5:30 AM"), attendanceCount: 5 },
    ];
    const out = dedupeSessions(rows);
    expect(out).toHaveLength(1);
    expect(out[0].attendanceCount).toBe(5);
    expect(out[0].massName).toBe("5:30 AM");
  });

  it("keeps two genuinely different sessions", () => {
    expect(dedupeSessions([session("a", SUN, 5), session("b", SUN, 3)])).toHaveLength(2);
  });
});

// --------------------------------------------------------------------------------------
// Rate and average
// --------------------------------------------------------------------------------------

describe("attendanceRate", () => {
  it("is distinct sessions attended over sessions held", () => {
    const sessions = [session("a", SUN, 40), session("b", SUN, 10)];
    const rate = attendanceRate(sessions, new Set(["a"]));
    expect(rate).toBe(50);
  });

  it("counts one Mass, not forty people", () => {
    // Attending both Masses is still two sessions held, not 50 attended out of 50.
    const rate = attendanceRate([session("a", SUN, 40), session("b", SAT, 10)], new Set(["a", "b"]));
    expect(rate).toBe(100);
  });

  it("is null when nothing was held", () => {
    // Spec §DSH-8: a new installation is not a parish with 0% attendance, and "0%" to somebody on
    // their first Sunday reads as an accusation.
    expect(attendanceRate([], new Set())).toBeNull();
    expect(attendanceRate([session("a", SUN, 0)], new Set())).toBeNull();
  });

  it("ignores a session nobody attended", () => {
    expect(attendanceRate([session("a", SUN, 5), session("b", SUN, 0)], new Set(["a"]))).toBe(100);
  });

  it("can exclude Saturdays", () => {
    const sessions = [session("sun", SUN, 10), session("sat", SAT, 10)];
    expect(attendanceRate(sessions, new Set(["sun"]))).toBe(50);
    expect(attendanceRate(sessions, new Set(["sun"]), { sundaysOnly: true })).toBe(100);
  });

  it("rounds to one decimal", () => {
    const sessions = [session("a", SUN, 1), session("b", SUN, 1), session("c", SUN, 1)];
    expect(attendanceRate(sessions, new Set(["a"]))).toBe(33.3);
  });
});

describe("averageAttendance", () => {
  it("is total records over sessions held", () => {
    expect(averageAttendance([session("a", SUN, 40), session("b", SAT, 20)])).toBe(30);
  });

  it("is null when nothing was held", () => {
    expect(averageAttendance([])).toBeNull();
    expect(averageAttendance([session("a", SUN, 0)])).toBeNull();
  });

  it("weights a big Mass the same as a small one", () => {
    // Averaging members would let the High Mass speak for the whole parish.
    expect(averageAttendance([session("a", SUN, 100), session("b", SUN, 4)])).toBe(52);
  });
});

describe("totalAttendance", () => {
  it("sums the sessions that were held", () => {
    expect(totalAttendance([session("a", SUN, 40), session("b", SUN, 0), session("c", SUN, 10)])).toBe(50);
  });
});

// --------------------------------------------------------------------------------------
// Streak
// --------------------------------------------------------------------------------------

describe("weekendStreak", () => {
  it("counts consecutive weekends attended, newest first", () => {
    // 2026-09-13, 09-20 and 09-27 are Sundays; 09-14 and 09-21 would be Mondays and not weekends at
    // all, which is exactly the trap this fixture set out.
    const sessions = [
      session("w1", "2026-09-13", 5),
      session("w2", "2026-09-20", 5),
      session("w3", "2026-09-27", 5),
    ];
    expect(weekendStreak(sessions, new Set(["w1", "w2", "w3"]))).toBe(3);
  });

  it("stops at the first missed weekend", () => {
    const sessions = [
      session("w1", "2026-09-13", 5),
      session("w2", "2026-09-20", 5),
      session("w3", "2026-09-27", 5),
    ];
    expect(weekendStreak(sessions, new Set(["w1", "w3"]))).toBe(1);
  });

  it("counts a Saturday-evening Mass towards that weekend", () => {
    const sessions = [session("sat", SAT, 5), session("sun", SUN, 5)];
    expect(weekendStreak(sessions, new Set(["sat"]))).toBe(1);
  });

  it("ignores weekday sessions", () => {
    expect(weekendStreak([session("mon", "2026-09-28", 5)], new Set(["mon"]))).toBe(0);
  });

  it("is zero with no weekends at all", () => {
    expect(weekendStreak([], new Set())).toBe(0);
  });

  it("counts back from the latest weekend with a session, not from today", () => {
    // A parish that has not reached this weekend yet must not zero somebody's streak.
    const sessions = [session("old", "2026-08-30", 5)];
    expect(weekendStreak(sessions, new Set(["old"]))).toBe(1);
  });
});

// --------------------------------------------------------------------------------------
// Inactive
// --------------------------------------------------------------------------------------

describe("inactiveMembers", () => {
  const members = [member("m1"), member("m2"), member("m3"), member("m4")];
  /** m1's last service, shared by every test so it is always "has history". */
  const m1Old = mark("m1", "old", "2026-07-12");

  it("flags an active member with no attendance in two complete months", () => {
    const out = inactiveMembers(members, [m1Old], SUN);
    expect(out.map((m) => m.id)).toEqual(["m1"]);
  });

  it("does not flag somebody who served last month", () => {
    const out = inactiveMembers(members, [m1Old, mark("m2", "recent", "2026-09-20")], SUN);
    expect(out.map((m) => m.id)).toEqual(["m1"]);
  });

  it("does not flag somebody who served this month", () => {
    // The old rule used August and September exactly, which flagged somebody who served on Sunday. The
    // window now runs through today, because "has drifted away" is not a description of last night.
    const out = inactiveMembers(members, [m1Old, mark("m3", "now", "2026-10-03")], SUN);
    expect(out.map((m) => m.id)).toEqual(["m1"]);
  });

  it("excludes a member who has never served at all", () => {
    // Same rule as today: somebody who joined last week has no two-month silence to report.
    expect(inactiveMembers([member("m4")], [m1Old], SUN)).toEqual([]);
  });

  it("excludes an inactive member", () => {
    expect(inactiveMembers([member("m1", { isActive: false })], [m1Old], SUN)).toEqual([]);
  });

  it("is empty when nobody has ever served", () => {
    expect(inactiveMembers(members, [], SUN)).toEqual([]);
  });
});

// --------------------------------------------------------------------------------------
// At risk
// --------------------------------------------------------------------------------------

describe("atRiskMembers", () => {
  // Thirteen consecutive Sundays, newest last, so the twelve-week rule-2 window is fully populated.
  const dates = [
    "2026-07-19",
    "2026-07-26",
    "2026-08-02",
    "2026-08-09",
    "2026-08-16",
    "2026-08-23",
    "2026-08-30",
    "2026-09-06",
    "2026-09-13",
    "2026-09-20",
    "2026-09-27",
    "2026-10-04",
  ];
  const sessions = dates.map((d, i) => session(`w${i}`, d, 20));
  const ids = sessions.map((s) => s.id);

  function marksFor(memberId: string, indices: number[]): AttendanceMark[] {
    return indices.map((i) => mark(memberId, ids[i], dates[i]));
  }

  it("flags somebody who attended three or more of the last eight and none of the last three", () => {
    // Weeks 4..8 of the twelve (indices 4..8) are inside the 8-week window and outside the last 3.
    const out = atRiskMembers([member("m1")], sessions, marksFor("m1", [4, 5, 6, 7, 8]), SUN);
    expect(out.map((r) => r.memberId)).toEqual(["m1"]);
    expect(out[0].reasons).toContain("stopped");
  });

  it("does not flag somebody who served last weekend", () => {
    const out = atRiskMembers([member("m1")], sessions, marksFor("m1", [4, 5, 6, 7, 8, 11]), SUN);
    expect(out).toEqual([]);
  });

  it("does not flag somebody who never attended, because that is not drifting", () => {
    expect(atRiskMembers([member("m1")], sessions, [], SUN)).toEqual([]);
  });

  it("does not flag a member who only ever attended twice", () => {
    // Below the floor of three: not enough history to say they have slipped.
    expect(atRiskMembers([member("m1")], sessions, marksFor("m1", [0, 1]), SUN)).toEqual([]);
  });

  it("flags a drop without a complete stop", () => {
    // Rule 2's baseline is the 8 weekends behind the last 4. Attending indices 0..7 fills that window
    // completely (100%), and attending index 9 of the recent four is 1/4 = 25% -- a 75 point drop while
    // the member is still turning up, which is the case rule 1 cannot see. Index 9 is deliberately not
    // in rule 1's "last three", so "stopped" stays quiet.
    const out = atRiskMembers(
      [member("m1")],
      sessions,
      marksFor("m1", [0, 1, 2, 3, 4, 5, 6, 7, 9]),
      SUN,
    );
    expect(out.map((r) => r.memberId)).toEqual(["m1"]);
    expect(out[0].reasons).toContain("dropped");
    expect(out[0].reasons).not.toContain("stopped");
    expect(out[0].baselineRate).toBe(100);
    expect(out[0].recentRate).toBe(25);
  });

  it("does not fire the drop rule below the floor", () => {
    // 2 of 8 in the baseline: the drop is large but the history is too thin to mean anything.
    expect(atRiskMembers([member("m1")], sessions, marksFor("m1", [0, 1]), SUN)).toEqual([]);
  });

  it("reports both the recent and the baseline rate", () => {
    const out = atRiskMembers([member("m1")], sessions, marksFor("m1", [4, 5, 6, 7, 8]), SUN);
    expect(out[0].baselineRate).toBeGreaterThan(out[0].recentRate);
  });

  it("excludes an inactive member", () => {
    expect(
      atRiskMembers([member("m1", { isActive: false })], sessions, marksFor("m1", [4, 5, 6, 7, 8]), SUN),
    ).toEqual([]);
  });

  it("is empty when the parish has held no weekend", () => {
    expect(atRiskMembers([member("m1")], [], [], SUN)).toEqual([]);
  });

  it("ignores attendance marks whose session is not in the set", () => {
    // A stale mark, or one from a month already archived out of the query.
    expect(atRiskMembers([member("m1")], sessions, [mark("m1", "ghost", SUN)], SUN)).toEqual([]);
  });

  it("publishes its thresholds as constants so they can be tuned", () => {
    expect(AT_RISK.baselineFloor).toBe(3);
    expect(AT_RISK.stoppedBaselineWeekends).toBe(8);
    expect(AT_RISK.stoppedRecentWeekends).toBe(3);
    expect(AT_RISK.dropRecentWeekends).toBe(4);
    expect(AT_RISK.dropThreshold).toBe(50);
  });
});

// --------------------------------------------------------------------------------------
// Birthdays
// --------------------------------------------------------------------------------------

describe("birthdaysWithin", () => {
  it("includes today and the next N days", () => {
    const members = [
      member("today", { dateOfBirth: "1990-10-04" }),
      member("soon", { dateOfBirth: "1990-10-07" }),
      member("edge", { dateOfBirth: "1990-10-11" }),
      member("far", { dateOfBirth: "1990-11-01" }),
    ];
    const out = birthdaysWithin(members, SUN, 7);
    expect(out.map((b) => b.memberId)).toEqual(["today", "soon", "edge"]);
  });

  it("marks which one is today", () => {
    const out = birthdaysWithin([member("a", { dateOfBirth: "1990-10-04" })], SUN, 7);
    expect(out[0].isToday).toBe(true);
  });

  it("shows a 29 February birthday on 28 February in a non-leap year", () => {
    // Somebody born on the 29th still has a birthday, and the parish still wants to say so.
    const out = birthdaysWithin([member("leap", { dateOfBirth: "2000-02-29" })], "2026-02-27", 3);
    expect(out.map((b) => b.date)).toEqual(["2026-02-28"]);
    expect(out[0].leapDay).toBe(true);
  });

  it("shows a 29 February birthday on the 29th in a leap year", () => {
    const out = birthdaysWithin([member("leap", { dateOfBirth: "2000-02-29" })], "2028-02-27", 3);
    expect(out.map((b) => b.date)).toEqual(["2028-02-29"]);
  });

  it("spans the year end", () => {
    const out = birthdaysWithin(
      [member("a", { dateOfBirth: "1990-12-28" })],
      "2026-12-27",
      7,
    );
    expect(out.map((b) => b.date)).toEqual(["2026-12-28"]);
  });

  it("excludes an inactive member and one with no date of birth", () => {
    const out = birthdaysWithin(
      [
        member("inactive", { dateOfBirth: "1990-10-04", isActive: false }),
        member("nodob", { dateOfBirth: null }),
      ],
      SUN,
      7,
    );
    expect(out).toEqual([]);
  });

  it("is empty with a window of zero", () => {
    expect(birthdaysWithin([member("a", { dateOfBirth: "1990-10-04" })], SUN, 0)).toHaveLength(1);
  });
});

// --------------------------------------------------------------------------------------
// Trend and turnout
// --------------------------------------------------------------------------------------

describe("attendanceTrend", () => {
  it("emits one point per weekend, oldest first", () => {
    const sessions = [session("w0", LAST_SUN, 10), session("w1", SUN, 20)];
    const points = attendanceTrend(sessions, SUN, 2);
    expect(points).toHaveLength(2);
    expect(points[0].weekStart < points[1].weekStart).toBe(true);
    expect(points[1].attendance).toBe(20);
  });

  it("emits a zero point for a weekend with no session", () => {
    // A gap in the line is a gap in the data; hiding it makes a decline look flat.
    const points = attendanceTrend([session("w1", SUN, 20)], SUN, 3);
    expect(points).toHaveLength(3);
    expect(points[0].attendance).toBe(0);
    expect(points[0].sessionsHeld).toBe(0);
  });

  it("ignores weekday sessions", () => {
    const points = attendanceTrend([session("mon", "2026-09-28", 99)], SUN, 2);
    expect(points.every((p) => p.attendance === 0)).toBe(true);
  });

  it("counts both Masses of a weekend together", () => {
    const points = attendanceTrend([session("sat", SAT, 10), session("sun", SUN, 20)], SUN, 1);
    expect(points[0].attendance).toBe(30);
    expect(points[0].sessionsHeld).toBe(2);
  });
});

describe("turnoutByMass", () => {
  it("averages per Mass type, busiest first", () => {
    const sessions = [
      session("a", SUN, 40, "5:30 AM"),
      session("b", SUN, 20, "7:00 AM"),
      session("c", LAST_SUN, 40, "5:30 AM"),
    ];
    const out = turnoutByMass(sessions, SUN, 8);
    expect(out[0].massName).toBe("5:30 AM");
    expect(out[0].average).toBe(40);
    expect(out[1].average).toBe(20);
  });

  it("is empty with no sessions", () => {
    expect(turnoutByMass([], SUN, 8)).toEqual([]);
  });

  it("names a Mass with no name rather than dropping it", () => {
    const out = turnoutByMass([session("a", SUN, 10, null)], SUN, 8);
    expect(out[0].massName).toBe("Unnamed Mass");
  });
});

describe("describeTrend", () => {
  it("says so when there is no data", () => {
    expect(describeTrend([])).toMatch(/No weekend attendance/);
  });

  it("says the direction and the endpoints", () => {
    const summary = describeTrend([
      { weekStart: "2026-09-21", attendance: 30, sessionsHeld: 2 },
      { weekStart: "2026-09-28", attendance: 40, sessionsHeld: 2 },
    ]);
    expect(summary).toContain("up");
    expect(summary).toContain("30");
    expect(summary).toContain("40");
  });

  it("uses the singular for one session", () => {
    const summary = describeTrend([
      { weekStart: "2026-09-21", attendance: 10, sessionsHeld: 2 },
      { weekStart: "2026-09-28", attendance: 10, sessionsHeld: 1 },
    ]);
    expect(summary).toContain("1 session");
  });

  it("says unchanged when the endpoints match", () => {
    const summary = describeTrend([
      { weekStart: "2026-09-21", attendance: 30, sessionsHeld: 1 },
      { weekStart: "2026-09-28", attendance: 30, sessionsHeld: 1 },
    ]);
    expect(summary).toContain("unchanged");
  });
});

describe("describeTurnout", () => {
  it("says so when there is no data", () => {
    expect(describeTurnout([])).toMatch(/No Masses/);
  });

  it("names the busiest Mass", () => {
    const summary = describeTurnout([
      { massName: "5:30 AM", average: 42, sessionsHeld: 8 },
      { massName: "7:00 AM", average: 20, sessionsHeld: 8 },
    ]);
    expect(summary).toContain("5:30 AM");
    expect(summary).toContain("42");
  });
});