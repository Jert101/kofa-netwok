-- 041_gathering_sessions.sql
--
-- Attendance for something that is not a Mass.
--
-- A parish's altar servers gather for more than the liturgy: a monthly meeting, a formation seminar, a
-- training day before a big occasion. Those need attendance recorded too, and until now there was
-- nowhere to put it -- `attendance_sessions.mass_id` was `NOT NULL REFERENCES masses(id)`, so every
-- session in the system was by construction a Mass.
--
-- --------------------------------------------------------------------------------------
-- What a gathering is, and is not
-- --------------------------------------------------------------------------------------
-- A gathering is a session with **no Mass**: `mass_id IS NULL` and a `title` naming what it was. There is
-- deliberately no `kind` column. `mass_id IS NULL` is the discriminator, and a second column saying the
-- same thing would be a second answer to "what is this" that can disagree with the first the first time
-- somebody edits a row by hand.
--
-- It is recorded, and it is kept out of the parish's Mass record:
--
--   - It does not appear in the monthly attendance report. That report is the parish's official record
--     of who served, and a column headed "Monthly Meeting" beside the Masses would change what it means.
--     `build-grid.ts` and the other report readers now filter on `mass_id is not null`.
--   - It does not count toward a member's serving total, attendance rate, or streak. "Served" keeps
--     meaning served at Mass. `insights/server/history.ts` and the member stats route filter the same way.
--   - It does not make an inactive member active. Attending a meeting is not serving.
--
-- It *is* kept: the secretary sees it on the day, it can be marked and appealed exactly like any other
-- session, and it stays in the database and in backups.
--
-- --------------------------------------------------------------------------------------
-- Why `mass_id` is dropped from the archive too
-- --------------------------------------------------------------------------------------
-- `attendance_sessions_archive` had the same `NOT NULL`. Left as it is, archiving a month containing a
-- meeting would fail the whole report on a row that is not even part of that report. The column there
-- never had a foreign key -- the Mass may legitimately be deleted after the fact -- so dropping the
-- constraint is not losing referential integrity, only a guarantee that was never true of gatherings
-- because gatherings did not exist.
--
-- `title` is added alongside it rather than folded into `mass_name`, so the two meanings stay separate
-- through the archive: `mass_name` is the denormalised Mass for display, `title` is what the gathering
-- was.

ALTER TABLE attendance_sessions ALTER COLUMN mass_id DROP NOT NULL;
ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS title text;

ALTER TABLE attendance_sessions_archive ALTER COLUMN mass_id DROP NOT NULL;
ALTER TABLE attendance_sessions_archive ADD COLUMN IF NOT EXISTS title text;

-- --------------------------------------------------------------------------------------
-- The shape rule
-- --------------------------------------------------------------------------------------
-- A session is a Mass or a gathering, and the database says which rather than leaving it to every
-- reader to infer:
--
--   - a Mass has a Mass and no title, because a title would be a second name for the same thing;
--   - a gathering has no Mass and a title, because an untitled gathering is a blank row in the day's
--     list with nothing to tell the secretary what they just created.
--
-- This is also what makes the exclusion filters safe. `where mass_id is not null` is only correct if a
-- row cannot have a Mass and a title at once, and that is now guaranteed rather than assumed.
ALTER TABLE attendance_sessions
  DROP CONSTRAINT IF EXISTS attendance_sessions_mass_or_gathering;
ALTER TABLE attendance_sessions
  ADD CONSTRAINT attendance_sessions_mass_or_gathering CHECK (
    (mass_id IS NOT NULL AND title IS NULL) OR
    (mass_id IS NULL AND title IS NOT NULL AND btrim(title) <> '')
  );

-- --------------------------------------------------------------------------------------
-- One gathering per date
-- --------------------------------------------------------------------------------------
-- The existing `UNIQUE(session_date, mass_id)` cannot police this. Postgres treats NULLs as distinct,
-- so two gatherings on one date would both satisfy it, while `createSessionAtDate`'s upsert on that same
-- conflict target would never match a NULL and so would insert a duplicate on every press. A partial
-- unique index is the right tool and says exactly the rule:
--
--   one gathering per date, any number of Masses per date.
--
-- The Mass index is left completely alone. It is the load-bearing idempotency mechanism for the weekend
-- cron (migration 027 calls it "the important part of this file"), and nothing here weakens it.
CREATE UNIQUE INDEX IF NOT EXISTS attendance_sessions_one_gathering_per_date
  ON attendance_sessions (session_date)
  WHERE mass_id IS NULL;

-- Partial, so the Masses' own index is untouched and the planner only considers this for the rows it
-- can apply to.
CREATE INDEX IF NOT EXISTS attendance_sessions_gathering_date
  ON attendance_sessions (session_date, title)
  WHERE mass_id IS NULL;

COMMENT ON COLUMN attendance_sessions.title IS
  'What a non-Mass gathering was -- "Monthly Meeting", "Formation Seminar". NULL for a Mass session; the constraint attendance_sessions_mass_or_gathering enforces that the two never overlap.';
COMMENT ON TABLE attendance_sessions IS
  'One session per (date, Mass) for a Mass, and at most one per date for a non-Mass gathering (mass_id NULL, title set). Gatherings are recorded but excluded from the monthly report and from member attendance totals.';

-- The dashboards view unions live and archive. It gains only `title`: every existing column stays
-- exactly as migration 033 defined it, because `load-roster.ts` reads this view by column name and a
-- renamed or dropped column would break the roster rather than the migration.
--
-- `DROP VIEW ... CASCADE` is required because CREATE OR REPLACE cannot change a view's column list.
-- Nothing else in the database depends on this view -- the only readers are `load-roster.ts` and the
-- health probe, both runtime SELECTs -- so CASCADE drops the view and nothing else.
DROP VIEW IF EXISTS v_attendance_all CASCADE;

CREATE VIEW v_attendance_all AS
SELECT
  r.id                AS record_id,
  r.session_id        AS session_id,
  s.session_date      AS session_date,
  s.mass_id           AS mass_id,
  s.title             AS title,
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
  s.title             AS title,
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
  'Live and archived attendance records in one shape. Filter on mass_id IS NOT NULL for anything that counts as serving: a gathering has no Mass and is not part of the parish''s Mass record.';

-- `attendance_sessions_archive` gets a matching shape rule. It has no constraint of its own because it
-- is a historical table, but a check costs nothing and catches a bad archive write at the point it
-- happens rather than in a report six weeks later.
ALTER TABLE attendance_sessions_archive
  DROP CONSTRAINT IF EXISTS attendance_sessions_archive_mass_or_gathering;
ALTER TABLE attendance_sessions_archive
  ADD CONSTRAINT attendance_sessions_archive_mass_or_gathering CHECK (
    (mass_id IS NOT NULL AND title IS NULL) OR
    (mass_id IS NULL AND title IS NOT NULL AND btrim(title) <> '')
  );
