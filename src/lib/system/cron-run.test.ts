import { describe, expect, it } from "vitest";
import {
  CRON_JOBS,
  CRON_INTERVAL_HOURS,
  cronOverdueState,
  type CronJob,
  type CronRunRecord,
} from "./cron-run";

function run(over: Partial<CronRunRecord> = {}): CronRunRecord {
  const now = new Date("2026-10-04T12:00:00Z");
  return {
    job: "birthday",
    started_at: now.toISOString(),
    finished_at: now.toISOString(),
    ok: true,
    detail: null,
    ...over,
  };
}

const NOW = Date.parse("2026-10-04T12:00:00Z");

describe("CRON_JOBS", () => {
  it("lists every job the migrations and routes record", () => {
    // The CHECK constraint in migration 034 has to contain exactly these, or an insert fails at runtime
    // and the job it was meant to record becomes invisible.
    expect([...CRON_JOBS].sort()).toEqual(
      ["birthday", "liturgy-reminders", "maintenance", "report-reminders", "sessions", "sweep"].sort(),
    );
  });

  it("has an interval for every job", () => {
    for (const job of CRON_JOBS) {
      expect(CRON_INTERVAL_HOURS[job], job).toBeGreaterThan(0);
    }
  });

  it("treats the weekly job as weekly", () => {
    expect(CRON_INTERVAL_HOURS.sessions).toBe(168);
  });
});

describe("cronOverdueState", () => {
  it("is not overdue for a job that just succeeded", () => {
    expect(cronOverdueState("birthday", run(), NOW).overdue).toBe(false);
  });

  it("is not overdue one interval late", () => {
    // A redeploy routinely costs a day. Painting the health page red every Monday trains people to
    // ignore it, and then it is red for a reason nobody reads.
    const oneDayLate = new Date(NOW - 25 * 3_600_000).toISOString();
    expect(cronOverdueState("birthday", run({ finished_at: oneDayLate }), NOW).overdue).toBe(false);
  });

  it("is overdue past twice the interval", () => {
    const threeDaysLate = new Date(NOW - 73 * 3_600_000).toISOString();
    const state = cronOverdueState("birthday", run({ finished_at: threeDaysLate }), NOW);
    expect(state.overdue).toBe(true);
    expect(state.reason).toMatch(/Last successful run/);
  });

  it("uses the job's own interval, so the weekly job gets a week's grace", () => {
    const twoDaysLate = new Date(NOW - 49 * 3_600_000).toISOString();
    // Overdue for a daily job, comfortably fine for a weekly one.
    expect(cronOverdueState("birthday", run({ finished_at: twoDaysLate }), NOW).overdue).toBe(true);
    expect(cronOverdueState("sessions", run({ finished_at: twoDaysLate }), NOW).overdue).toBe(false);
  });

  it("is not overdue when the last run failed", () => {
    // A failure is reported by its own check, with its own message. Saying "overdue" as well would be
    // two reds for one problem.
    const state = cronOverdueState("birthday", run({ ok: false, finished_at: null }), NOW);
    expect(state.overdue).toBe(false);
    expect(state.reason).toMatch(/failed/);
  });

  it("is overdue when a run started and never finished", () => {
    // NULL means the process died mid-job, which is not a success and not a clean failure.
    const state = cronOverdueState("birthday", run({ ok: null, finished_at: null }), NOW);
    expect(state.overdue).toBe(true);
    expect(state.reason).toMatch(/do not know how it ended/);
  });

  it("is overdue when the job has never run", () => {
    const state = cronOverdueState("birthday", undefined, NOW);
    expect(state.overdue).toBe(true);
    expect(state.reason).toMatch(/never been recorded/);
  });

  it("is overdue when the timestamp is unreadable", () => {
    const state = cronOverdueState("birthday", run({ finished_at: "not a date" }), NOW);
    expect(state.overdue).toBe(true);
    expect(state.reason).toMatch(/unreadable timestamp/);
  });

  it("falls back to started_at when finished_at is null but ok is true", () => {
    // Defensive: a row that somehow says "succeeded" with no finish time should still be judged on when
    // it began rather than producing NaN.
    const state = cronOverdueState(
      "birthday",
      run({ ok: true, finished_at: null, started_at: new Date(NOW).toISOString() }),
      NOW,
    );
    expect(state.overdue).toBe(false);
  });

  it("reports the last success time when it has one", () => {
    const at = new Date(NOW - 3_600_000).toISOString();
    expect(cronOverdueState("birthday", run({ finished_at: at }), NOW).lastSuccessAt).toBe(at);
  });

  it("has no last success when the run failed", () => {
    expect(cronOverdueState("birthday", run({ ok: false }), NOW).lastSuccessAt).toBeNull();
  });

  it("never treats a future timestamp as overdue", () => {
    // Clock skew between the app and the database must not paint the page red.
    const future = new Date(NOW + 3_600_000).toISOString();
    expect(cronOverdueState("birthday", run({ finished_at: future }), NOW).overdue).toBe(false);
  });
});

describe("every job can be judged", () => {
  it("returns a reason string for each job with no history", () => {
    for (const job of CRON_JOBS) {
      const state = cronOverdueState(job satisfies CronJob, undefined, NOW);
      expect(state.reason.length, job).toBeGreaterThan(0);
    }
  });
});