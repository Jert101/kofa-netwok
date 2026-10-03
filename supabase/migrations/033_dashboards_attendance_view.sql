-- ======================================================================================
-- 033 — Dashboards: one view of attendance, live and archived
-- ======================================================================================
--
-- Module 10 (DSH-1..DSH-7).
--
-- No ON COMMIT DROP anywhere in this file. The Supabase SQL editor commits between statements, so a
-- temp table would be dropped by the time the next statement ran. This migration creates none.

-- ======================================================================================
-- 1. v_attendance_all: live records and archived records, as one thing
-- ======================================================================================
--
-- Every metric in the app needs "was this member there", spanning all history. Before this, each
-- caller read the two tables separately and unioned them in JavaScript: the member profile, the
-- inactive-members route, top servers, and module 09's dashboards were four implementations of the same
-- query, and they had already drifted apart.
--
-- ## Why a view and not a function
--
-- A view is inlined by the planner, so `WHERE session_date >= ...` on the view pushes down into both
-- branches and the index on each table still does its job. A SQL function would need
-- `STABLE` plus careful `search_path` to avoid the same thing, and would hide the query plan.
--
-- ## The archive key problem, and how this view handles it
--
-- `attendance_sessions_archive` has PRIMARY KEY (id, archived_at). The same session id can therefore
-- appear in the live table AND in two separate archive snapshots -- archiving the same month twice
-- would raise a primary key violation on insert, but `archive-month.ts` relies on a `report_id` probe
-- rather than that constraint, so the duplicate is a bug waiting for an operator to trigger it.
--
-- This view does not try to pick "the right" archived session row. It reports what is there and lets
-- `dedupeSessions()` in src/lib/insights/metrics.ts collapse the ids, because that function already has
-- to handle it for the JS-side union and putting the rule in two places is how it drifts. The view
-- carries `source_table` and `archived_at` so a caller that cares can see the difference, and
-- `attendance_count` is what makes the deduplication pick the informative row.
--
-- `mass_name` comes from the session's own denormalised copy on the archive side, because the Mass it
-- referred to may have since been deleted and `mass_id` there has no foreign key by design.

CREATE OR REPLACE VIEW v_attendance_all AS
SELECT
  r.id                AS record_id,
  r.session_id        AS session_id,
  s.session_date      AS session_date,
  s.mass_id           AS mass_id,
  m.name              AS mass_name,
  r.member_id         AS member_id,
  r.recorded_at       AS recorded_at,
  r.source            AS source,
  r.recorded_by_role  AS recorded_by_role,
  'live'::text        AS source_table,
  NULL::timestamptz   AS archived_at
FROM attendance_records r
JOIN attendance_sessions s ON s.id = r.session_id
LEFT JOIN masses m ON m.id = s.mass_id

UNION ALL

SELECT
  r.id                AS record_id,
  r.session_id        AS session_id,
  s.session_date      AS session_date,
  s.mass_id           AS mass_id,
  s.mass_name         AS mass_name,
  r.member_id         AS member_id,
  r.recorded_at       AS recorded_at,
  r.source            AS source,
  r.recorded_by_role  AS recorded_by_role,
  'archive'::text     AS source_table,
  r.archived_at       AS archived_at
FROM attendance_records_archive r
JOIN attendance_sessions_archive s
  ON s.id = r.session_id
  AND s.archived_at = r.archived_at;

COMMENT ON VIEW v_attendance_all IS
  'Live and archived attendance joined to their sessions. Duplicated session ids are possible when a month was archived twice; collapse them in application code with dedupeSessions().';

-- ======================================================================================
-- 2. Indexes for the windowed scans the dashboards do
-- ======================================================================================
--
-- All of these are conditional. Every index on a table somebody appends to forever is a tax paid on
-- every insert for the rest of the time's life, so each one below is only worth its keep if the
-- dashboard's access pattern actually needs it -- and they are created only when missing, so this
-- migration is safe to run against a database that already has some of them.

-- "Sessions held between two dates", which every dashboard starts from. The existing index is on
-- (session_date) ascending; this is the same data and the planner can walk it backwards, so it is
-- deliberately not duplicated. Left here as a comment so nobody adds a second copy.

-- The trend chart: last N weeks of attendance, grouped by member. (member_id, session_id) serves both
-- "everything this member did" and "which sessions were they in".
CREATE INDEX IF NOT EXISTS attendance_records_member_session_idx
  ON attendance_records (member_id, session_id);

-- The same for the archive, so an archived month costs the same to read as a live one. Without this the
-- dashboard gets slower every time a month is archived, which is the opposite of what archiving is for.
CREATE INDEX IF NOT EXISTS attendance_records_archive_member_session_idx
  ON attendance_records_archive (member_id, session_id);

-- Nothing extra is needed here, and adding it is actively harmful.
--
-- The view's archive branch joins `attendance_sessions_archive` on `(id, archived_at)`, and that pair is
-- already the table's PRIMARY KEY -- so an index on those two columns would be a duplicate that Postgres
-- would happily create and never use. An earlier draft of this file indexed `(session_id, archived_at)`
-- instead, which does not merely duplicate the primary key: `attendance_sessions_archive` has no
-- `session_id` column at all (it keys on `id`, and the *records* table is what carries `session_id`), so
-- the whole migration failed with
--
--     ERROR: 42703: column "session_id" does not exist
--
-- which pointed at the view above it rather than at the index causing it. The view was correct
-- throughout.

-- "Sessions in this month" is asked by the admin dashboard, the secretary's report-readiness check and
-- module 09's collected-this-month figure.
CREATE INDEX IF NOT EXISTS attendance_sessions_date_mass_idx
  ON attendance_sessions (session_date, mass_id);

-- ======================================================================================
-- 3. A read-only view needs no grants and no policies
-- ======================================================================================
--
-- Views run with the privileges of the querying role by default in Postgres, and this app reaches the
-- database through the service-role key with RLS bypassed. Nothing here grants a role access to
-- anything new, and the underlying tables all have RLS enabled with no policies (module 04 closed the
-- gap on the attendance tables), so an accidental direct-client read through this view gets nothing.