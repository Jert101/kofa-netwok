-- ======================================================================================
-- 034 — System: a record of every cron run
-- ======================================================================================
--
-- Module 11 (SYS-4).
--
-- No ON COMMIT DROP anywhere in this file. The Supabase SQL editor commits between statements, so a
-- temp table would be dropped by the time the next statement ran. This migration creates none.

-- ======================================================================================
-- 1. cron_runs
-- ======================================================================================
--
-- The problem this solves: the crons run on Vercel with a secret header and nothing anywhere records
-- that they ran. A cron that silently stopped working -- a typo in a schedule, a Vercel plan change, a
-- deployment that dropped the vercel.json entry -- looks identical to a cron that ran and found nothing
-- to do. The parish finds out when a member's birthday goes unmentioned.
--
-- Every cron endpoint wraps its work in `recordCronRun(job, fn)` from src/lib/system/cron-run.ts, which
-- opens a row before the work and closes it after, so a job that throws leaves `ok = false` and whatever
-- detail was available rather than no row at all.
--
-- `ok` is nullable on purpose: NULL means the run started and we do not know how it ended, which is what
-- a process killed mid-job looks like. Treating that as a success would be a lie, and treating it as a
-- failure would page somebody about a two-second deploy.

CREATE TABLE IF NOT EXISTS cron_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz NULL,
  ok boolean NULL,
  detail text NULL,
  CONSTRAINT cron_runs_job_check CHECK (job IN (
    'birthday', 'sweep', 'sessions', 'maintenance', 'report-reminders', 'liturgy-reminders'
  ))
);

COMMENT ON TABLE cron_runs IS
  'One row per cron invocation. ok is NULL when a run started and we do not know how it ended.';

COMMENT ON COLUMN cron_runs.detail IS
  'What the job reported, or the error message when ok is false. Never contains secrets.';

ALTER TABLE cron_runs ENABLE ROW LEVEL SECURITY;

-- The health page asks "when did this job last succeed", for every job, on every visit. That is one
-- query per page load against the newest row per job, so the index is the whole feature.
CREATE INDEX IF NOT EXISTS cron_runs_job_started_idx
  ON cron_runs (job, started_at DESC);

-- Only successful runs matter for the overdue calculation, and there are very few of them, so this
-- partial index stays small no matter how many failed runs accumulate.
CREATE INDEX IF NOT EXISTS cron_runs_job_ok_idx
  ON cron_runs (job, started_at DESC)
  WHERE ok = true;

-- ======================================================================================
-- 2. Retention
-- ======================================================================================
--
-- SYS-4 says rows older than 90 days are removed by the sweep. That is done in the sweep route rather
-- than here, because a migration cannot run on a schedule and because the sweep already has the secret
-- header and the audit trail.

-- ======================================================================================
-- 3. archive_on_generate
-- ======================================================================================
--
-- SYS-2 introduces this setting, and it needs a seed row because `getSetting` falls back to the
-- registry default when a row is missing. Seeding it anyway means an operator can see it exists, and
-- means the health page's "is this set" check has something to read.

INSERT INTO system_settings (key, value)
VALUES ('archive_on_generate', 'true')
ON CONFLICT (key) DO NOTHING;

-- The timezone is the setting whose invalid value breaks the most date rules at once, so it is seeded
-- too rather than left to a missing row.

INSERT INTO system_settings (key, value)
VALUES ('report_timezone', 'Asia/Manila')
ON CONFLICT (key) DO NOTHING;

-- require_actor_name_* are seeded so the Security page shows a definite answer for each role rather
-- than falling back to a default that nobody wrote down.

INSERT INTO system_settings (key, value)
VALUES
  ('require_actor_name_admin', 'true'),
  ('require_actor_name_secretary', 'true'),
  ('require_actor_name_officer', 'true'),
  ('require_actor_name_treasurer', 'true'),
  ('require_actor_name_super_admin', 'true'),
  ('require_actor_name_member', 'false')
ON CONFLICT (key) DO NOTHING;

-- ======================================================================================
-- 4. Note on the applied-migration policy
-- ======================================================================================
--
-- RLS is enabled with no policies, matching every other table in this schema: the API reaches
-- `cron_runs` with the service-role key and nothing grants a client access.