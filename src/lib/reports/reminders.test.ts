import { describe, expect, it } from "vitest";
import {
  REMINDER_MIN_AGE_HOURS,
  buildReminderNotification,
  selectPendingReminders,
  type PendingReportRow,
  type PriorReminder,
} from "@/lib/reports/reminders";

const NOW = new Date("2026-10-05T12:00:00.000Z");

function report(over: Partial<PendingReportRow> = {}): PendingReportRow {
  return {
    id: "rep-1",
    report_month: "2026-09-01",
    title: "Attendance Report — September 2026",
    status: "pending",
    created_at: "2026-10-01T00:00:00.000Z",
    ...over,
  };
}

function hoursAgo(h: number, from: Date = NOW): string {
  return new Date(from.getTime() - h * 3_600_000).toISOString();
}

describe("selectPendingReminders", () => {
  it("stays silent before the 48 hour threshold", () => {
    const plans = selectPendingReminders({
      now: NOW,
      reports: [report({ created_at: hoursAgo(REMINDER_MIN_AGE_HOURS - 1) })],
      priorReminders: [],
    });
    expect(plans).toHaveLength(0);
  });

  it("reminds exactly at the 48 hour threshold", () => {
    const plans = selectPendingReminders({
      now: NOW,
      reports: [report({ created_at: hoursAgo(REMINDER_MIN_AGE_HOURS) })],
      priorReminders: [],
    });
    expect(plans).toHaveLength(1);
  });

  it("ignores reports that are no longer pending", () => {
    for (const status of ["approved", "rejected"]) {
      const plans = selectPendingReminders({
        now: NOW,
        reports: [report({ status, created_at: hoursAgo(500) })],
        priorReminders: [],
      });
      expect(plans, status).toHaveLength(0);
    }
  });

  it("targets both the super admin and the admin", () => {
    const [plan] = selectPendingReminders({
      now: NOW,
      reports: [report({ created_at: hoursAgo(100) })],
      priorReminders: [],
    });
    expect(plan.recipients).toEqual(["super_admin", "admin"]);
  });

  describe("one reminder per day", () => {
    it("stays quiet when one already went out today", () => {
      const plans = selectPendingReminders({
        now: NOW,
        reports: [report({ created_at: hoursAgo(100) })],
        priorReminders: [{ reportId: "rep-1", sentAt: "2026-10-05T00:00:00.000Z" }],
      });
      expect(plans).toHaveLength(0);
    });

    it("sends again the next day", () => {
      const plans = selectPendingReminders({
        now: NOW,
        reports: [report({ created_at: hoursAgo(100) })],
        priorReminders: [{ reportId: "rep-1", sentAt: "2026-10-04T00:00:00.000Z" }],
      });
      expect(plans).toHaveLength(1);
      expect(plans[0].reminderNumber).toBe(2);
    });

    it("treats a reminder sent hours earlier today as covering the whole day", () => {
      // The cron runs at 00:00 UTC; a manual re-run later the same day must not double up.
      const plans = selectPendingReminders({
        now: NOW,
        reports: [report({ created_at: hoursAgo(100) })],
        priorReminders: [{ reportId: "rep-1", sentAt: "2026-10-05T23:59:59.000Z" }],
      });
      expect(plans).toHaveLength(0);
    });

    it("does not let one report's reminders suppress another's", () => {
      const plans = selectPendingReminders({
        now: NOW,
        reports: [
          report({ id: "rep-1", created_at: hoursAgo(100) }),
          report({ id: "rep-2", report_month: "2026-08-01", created_at: hoursAgo(200) }),
        ],
        priorReminders: [{ reportId: "rep-1", sentAt: "2026-10-05T00:00:00.000Z" }],
      });
      expect(plans.map((p) => p.reportId)).toEqual(["rep-2"]);
    });
  });

  describe("at most three reminders", () => {
    it("sends the first three and then stops", () => {
      const noneYet = selectPendingReminders({
        now: NOW,
        reports: [report({ created_at: hoursAgo(500) })],
        priorReminders: [],
      });
      expect(noneYet[0].reminderNumber).toBe(1);

      const three: PriorReminder[] = [
        { reportId: "rep-1", sentAt: "2026-10-02T00:00:00.000Z" },
        { reportId: "rep-1", sentAt: "2026-10-03T00:00:00.000Z" },
        { reportId: "rep-1", sentAt: "2026-10-04T00:00:00.000Z" },
      ];
      const after = selectPendingReminders({
        now: NOW,
        reports: [report({ created_at: hoursAgo(500) })],
        priorReminders: three,
      });
      expect(after).toHaveLength(0);
    });

    it("never exceeds the cap even if extra rows exist", () => {
      const tooMany = Array.from({ length: 5 }, (_, i) => ({
        reportId: "rep-1",
        sentAt: `2026-09-${String(i + 20).padStart(2, "0")}T00:00:00.000Z`,
      }));
      expect(
        selectPendingReminders({
          now: NOW,
          reports: [report({ created_at: hoursAgo(500) })],
          priorReminders: tooMany,
        }),
      ).toHaveLength(0);
    });
  });

  it("counts reminders per report, not globally", () => {
    const plans = selectPendingReminders({
      now: NOW,
      reports: [
        report({ id: "rep-1", created_at: hoursAgo(500) }),
        report({ id: "rep-2", report_month: "2026-08-01", created_at: hoursAgo(400) }),
      ],
      priorReminders: [
        { reportId: "rep-1", sentAt: "2026-10-01T00:00:00.000Z" },
        { reportId: "rep-1", sentAt: "2026-10-02T00:00:00.000Z" },
        { reportId: "rep-1", sentAt: "2026-10-03T00:00:00.000Z" },
      ],
    });
    // rep-1 is capped, rep-2 is untouched by rep-1's history.
    expect(plans.map((p) => p.reportId)).toEqual(["rep-2"]);
    expect(plans[0].reminderNumber).toBe(1);
  });

  it("orders the oldest report first", () => {
    const plans = selectPendingReminders({
      now: NOW,
      reports: [
        report({ id: "newer", report_month: "2026-09-01", created_at: hoursAgo(50) }),
        report({ id: "older", report_month: "2026-07-01", created_at: hoursAgo(300) }),
      ],
      priorReminders: [],
    });
    expect(plans.map((p) => p.reportId)).toEqual(["older", "newer"]);
  });

  it("ignores a report whose timestamp cannot be read", () => {
    // Staying quiet for a day is recoverable; a reminder built on a guess is not.
    expect(
      selectPendingReminders({
        now: NOW,
        reports: [report({ created_at: "not-a-date" })],
        priorReminders: [],
      }),
    ).toHaveLength(0);
  });

  it("falls back to a generic title", () => {
    const [plan] = selectPendingReminders({
      now: NOW,
      reports: [report({ title: null, created_at: hoursAgo(100) })],
      priorReminders: [],
    });
    expect(plan.title).toBe("Monthly report");
    expect(plan.reportMonth).toBe("2026-09");
  });

  it("reports whole waiting hours", () => {
    const [plan] = selectPendingReminders({
      now: NOW,
      reports: [report({ created_at: hoursAgo(50.5) })],
      priorReminders: [],
    });
    expect(plan.waitingHours).toBe(50);
  });
});

describe("buildReminderNotification", () => {
  const base = {
    reportId: "rep-1",
    reportMonth: "2026-09",
    title: "Attendance Report — September 2026",
    waitingHours: 72,
    reminderNumber: 1,
    recipients: ["super_admin", "admin"] as const,
  };

  it("names the month, the wait and the reminder number", () => {
    const n = buildReminderNotification(base);
    expect(n.title).toBe("Report still awaiting review");
    expect(n.body).toContain("2026-09");
    expect(n.body).toContain("3 days");
    expect(n.body).toContain("reminder 1st of 3");
  });

  it("uses singular for a single day", () => {
    expect(buildReminderNotification({ ...base, waitingHours: 24 }).body).toContain("1 day");
  });

  it("never reports zero days", () => {
    // waitingHours is floored at 48 before planning, but the copy must not read "0 days"
    // if the floor ever changes underneath it.
    expect(buildReminderNotification({ ...base, waitingHours: 1 }).body).toContain("1 day");
  });

  it("numbers the second and third reminders", () => {
    expect(buildReminderNotification({ ...base, reminderNumber: 2 }).body).toContain("2nd of 3");
    expect(buildReminderNotification({ ...base, reminderNumber: 3 }).body).toContain("3rd of 3");
  });
});