/**
 * SYS-4: wrapping every cron so its runs are recorded.
 *
 * Before this, a cron that stopped running and a cron that ran and found nothing to do were the same
 * thing from the outside. The parish found out when a birthday went unmentioned, which is too late and
 * very hard to diagnose.
 *
 * `recordCronRun` opens a row before the work and closes it after. That ordering is deliberate: a job
 * that throws still leaves a row, with `ok = false` and the error, instead of no evidence at all.
 */

import { getSupabaseAdmin } from "@/lib/supabase/admin";

/** Must match `cron_runs_job_check` in migration 034. */
export const CRON_JOBS = [
  "birthday",
  "sweep",
  "sessions",
  "maintenance",
  "report-reminders",
  "liturgy-reminders",
] as const;

export type CronJob = (typeof CRON_JOBS)[number];

/** How often each job is meant to run, which is what makes "overdue" answerable. */
export const CRON_INTERVAL_HOURS: Record<CronJob, number> = {
  birthday: 24,
  sweep: 24,
  sessions: 24 * 7,
  maintenance: 24,
  "report-reminders": 24,
  "liturgy-reminders": 24,
};

export type CronRunRecord = {
  job: CronJob;
  started_at: string;
  finished_at: string | null;
  ok: boolean | null;
  detail: string | null;
};

/**
 * Run `work` and record how it went.
 *
 * Never rethrows. A cron's contract is to answer with a status, and a wrapper that turns a handled
 * failure into an unhandled rejection would make the record the only trace of it -- and would take the
 * process down on Node's default unhandled-rejection behaviour. The caller gets the value or the error
 * and decides what to return.
 *
 * `describe` extracts the `detail` string from whatever `work` returns. Cron handlers answer with a
 * `NextResponse`, whose body cannot be read synchronously, so without this the log would record `{}` for
 * every successful run and the health page could not answer "did it actually do anything" -- only "did it
 * not crash".
 *
 * `detail` is truncated because it goes into a text column that the health page renders, and a
 * PostgREST error can be long.
 */
export async function recordCronRun<T>(
  job: CronJob,
  work: () => Promise<T>,
  describe?: (result: T) => string,
): Promise<T> {
  const sb = getSupabaseAdmin();
  const startedAt = new Date().toISOString();
  let runId: string | null = null;

  try {
    const { data, error } = await sb
      .from("cron_runs")
      .insert({ job, started_at: startedAt, ok: null, detail: null })
      .select("id")
      .maybeSingle();

    if (error) {
      // The table may not be migrated yet. Not fatal: the cron still has to run, and a missing log is
      // better than a skipped job.
      console.error(`[cron-run] could not open a run for "${job}":`, error.message);
    } else if (data) {
      runId = String(data.id);
    }
  } catch (e) {
    console.error(`[cron-run] could not open a run for "${job}":`, e instanceof Error ? e.message : e);
  }

  try {
    const result = await work();
    const detail = describe ? describe(result) : summarise(result);
    await closeRun(runId, true, detail);
    return result;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[cron-run] "${job}" failed:`, message);
    await closeRun(runId, false, message);
    throw e;
  }
}

async function closeRun(id: string | null, ok: boolean, detail: string): Promise<void> {
  if (!id) return;
  try {
    await getSupabaseAdmin()
      .from("cron_runs")
      .update({ ok, finished_at: new Date().toISOString(), detail: detail.slice(0, 1000) })
      .eq("id", id);
  } catch (e) {
    console.error("[cron-run] could not close a run:", e instanceof Error ? e.message : e);
  }
}

/**
 * What to store in `detail`.
 *
 * Objects are JSON-stringified so the health page can show the job's own numbers, which is what makes the
 * row useful for answering "did it actually do anything" as opposed to merely "did it not crash".
 */
function summarise(result: unknown): string {
  if (result === undefined || result === null) return "";
  if (typeof result === "string") return result;
  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}

/** The newest row for each job, for the health page. */
export async function latestCronRuns(): Promise<Partial<Record<CronJob, CronRunRecord>>> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("cron_runs")
    .select("job, started_at, finished_at, ok, detail")
    .order("started_at", { ascending: false })
    .limit(200);

  if (error) {
    console.error("[cron-run] latest runs failed:", error.message);
    return {};
  }

  const out: Partial<Record<CronJob, CronRunRecord>> = {};
  for (const row of data ?? []) {
    const job = String(row.job) as CronJob;
    // The query is newest-first, so the first row seen for a job is its latest.
    if (out[job]) continue;
    out[job] = {
      job,
      started_at: String(row.started_at),
      finished_at: (row.finished_at as string | null) ?? null,
      ok: (row.ok as boolean | null) ?? null,
      detail: (row.detail as string | null) ?? null,
    };
  }
  return out;
}

/**
 * Whether a job is overdue.
 *
 * SYS-4: "A job is overdue when its last success is older than twice its interval."
 *
 * Twice, not once: a scheduler retry or a redeploy routinely costs a day, and a health page that paints
 * itself red every Monday morning stops being read. Twice the interval is the point at which "has this
 * stopped" is more plausible than "was this delayed".
 *
 * A job that has never succeeded is overdue only if it has also never been seen, which is a different
 * problem -- reported separately so the fix hint can say so.
 */
export function cronOverdueState(
  job: CronJob,
  last: CronRunRecord | undefined,
  nowMs: number = Date.now(),
): { overdue: boolean; reason: string; lastSuccessAt: string | null } {
  const intervalMs = CRON_INTERVAL_HOURS[job] * 60 * 60 * 1000;

  if (!last) {
    return {
      overdue: true,
      reason: "This job has never been recorded as running.",
      lastSuccessAt: null,
    };
  }

  if (last.ok === false) {
    return {
      overdue: false,
      reason: "The last run failed.",
      lastSuccessAt: null,
    };
  }

  if (last.ok === null) {
    return {
      overdue: true,
      reason: "The last run started and we do not know how it ended.",
      lastSuccessAt: null,
    };
  }

  const finishedMs = Date.parse(last.finished_at ?? last.started_at);
  if (!Number.isFinite(finishedMs)) {
    return {
      overdue: true,
      reason: "The last run has an unreadable timestamp.",
      lastSuccessAt: null,
    };
  }

  const ageMs = nowMs - finishedMs;
  if (ageMs > intervalMs * 2) {
    return {
      overdue: true,
      reason: `Last successful run was ${describeAge(ageMs)} ago; it runs about every ${CRON_INTERVAL_HOURS[job]} hours.`,
      lastSuccessAt: last.finished_at ?? last.started_at,
    };
  }

  return { overdue: false, reason: "", lastSuccessAt: last.finished_at ?? last.started_at };
}

function describeAge(ms: number): string {
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

/** SYS-4: rows older than 90 days are removed by the sweep. */
export const CRON_RUN_RETENTION_DAYS = 90;

/** Delete old rows. Called from the sweep cron, which is the only job allowed to delete things. */
export async function pruneCronRuns(nowMs: number = Date.now()): Promise<number> {
  const cutoff = new Date(nowMs - CRON_RUN_RETENTION_DAYS * 86_400_000).toISOString();
  const { error, count } = await getSupabaseAdmin()
    .from("cron_runs")
    .delete({ count: "exact" })
    .lt("started_at", cutoff);
  if (error) throw new Error(`prune cron_runs: ${error.message}`);
  return count ?? 0;
}