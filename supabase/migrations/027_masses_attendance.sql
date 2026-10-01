-- 027 — Masses & attendance (module 04): catalog order and usual time, per-record
-- provenance, and the unique key that makes automatic session creation safe.
--
-- The unique key is the important part of this file. The module 04 spec leans on
-- "the (date, mass) unique key" to make the weekend cron idempotent and to make
-- deleting an empty session safe, but no such key existed — attendance_sessions
-- only ever had a plain index on session_date. Without it, a cron that runs twice
-- creates two sessions for the same Mass on the same day, and the whole
-- idempotency story is just a hope. So it is added here, and the duplicates that
-- the missing key allowed are merged away first.
--
-- The dedupe repeats its ranking CTE in each statement instead of stashing the
-- duplicate list in a temp table. A temp table would read better, but the Supabase
-- SQL editor commits between statements when a query is pasted in, and ON COMMIT
-- DROP would take the list with it, leaving the later statements to merge nothing
-- and then fail on the unique index. Inlined, each statement stands on its own.

-- ─── 1. The unique key, with the duplicates it would otherwise reject ─────────

-- Keep the oldest session of each (date, mass) pair and fold the rest into it.
-- Oldest, not largest, so ids stay put and anything already pointing at a session
-- keeps pointing at a live row.
DO $$
DECLARE
  dupe_count int;
BEGIN
  SELECT count(*) INTO dupe_count
  FROM (
    SELECT id
    FROM (
      SELECT
        id,
        first_value(id) OVER (
          PARTITION BY session_date, mass_id
          ORDER BY created_at, id
        ) AS keeper_id
      FROM attendance_sessions
    ) ranked
    WHERE id <> keeper_id
  ) dupes;

  IF dupe_count = 0 THEN
    RAISE NOTICE 'attendance_sessions: no duplicate (date, mass) pairs found';
  ELSE
    RAISE NOTICE 'attendance_sessions: merging % duplicate session(s)', dupe_count;
  END IF;
END $$;

-- Attendance records: a member present in both sessions becomes present once.
WITH ranked AS (
  SELECT
    id,
    first_value(id) OVER (
      PARTITION BY session_date, mass_id
      ORDER BY created_at, id
    ) AS keeper_id
  FROM attendance_sessions
), dupes AS (
  SELECT id AS dupe_id, keeper_id FROM ranked WHERE id <> keeper_id
)
INSERT INTO attendance_records (session_id, member_id, created_at)
SELECT dupes.keeper_id, r.member_id, r.created_at
FROM attendance_records r
JOIN dupes ON dupes.dupe_id = r.session_id
ON CONFLICT (session_id, member_id) DO NOTHING;

-- Appeals move across with their id, so their items stay attached and the
-- UNIQUE (appeal_id, member_id) on the items cannot collide.
WITH ranked AS (
  SELECT
    id,
    first_value(id) OVER (
      PARTITION BY session_date, mass_id
      ORDER BY created_at, id
    ) AS keeper_id
  FROM attendance_sessions
), dupes AS (
  SELECT id AS dupe_id, keeper_id FROM ranked WHERE id <> keeper_id
)
INSERT INTO attendance_appeals (id, session_id, submitted_by_role, submitted_at)
SELECT a.id, dupes.keeper_id, a.submitted_by_role, a.submitted_at
FROM attendance_appeals a
JOIN dupes ON dupes.dupe_id = a.session_id
ON CONFLICT (id) DO NOTHING;

-- No unique constraint here, so every row carries over. Two position labels that
-- match are simply edited down afterwards, which is a smaller problem than losing
-- a server assignment.
WITH ranked AS (
  SELECT
    id,
    first_value(id) OVER (
      PARTITION BY session_date, mass_id
      ORDER BY created_at, id
    ) AS keeper_id
  FROM attendance_sessions
), dupes AS (
  SELECT id AS dupe_id, keeper_id FROM ranked WHERE id <> keeper_id
)
INSERT INTO session_liturgy_servers (id, session_id, position_label, member_id, free_text, sort_order, created_at, updated_at)
SELECT s.id, dupes.keeper_id, s.position_label, s.member_id, s.free_text, s.sort_order, s.created_at, s.updated_at
FROM session_liturgy_servers s
JOIN dupes ON dupes.dupe_id = s.session_id
ON CONFLICT (id) DO NOTHING;

-- A keeper with no notes inherits some from a duplicate that had them.
WITH ranked AS (
  SELECT
    id,
    first_value(id) OVER (
      PARTITION BY session_date, mass_id
      ORDER BY created_at, id
    ) AS keeper_id
  FROM attendance_sessions
), dupes AS (
  SELECT id AS dupe_id, keeper_id FROM ranked WHERE id <> keeper_id
), inherited AS (
  SELECT keeper_id, min(notes) AS notes
  FROM dupes
  JOIN attendance_sessions ON attendance_sessions.id = dupe_id
  WHERE notes IS NOT NULL AND notes <> ''
  GROUP BY keeper_id
)
UPDATE attendance_sessions k
SET notes = inherited.notes
FROM inherited
WHERE k.id = inherited.keeper_id AND (k.notes IS NULL OR k.notes = '');

-- Deleting the dupe takes its now-empty children with it (all three are ON DELETE
-- CASCADE), so nothing is orphaned.
WITH ranked AS (
  SELECT
    id,
    first_value(id) OVER (
      PARTITION BY session_date, mass_id
      ORDER BY created_at, id
    ) AS keeper_id
  FROM attendance_sessions
), dupes AS (
  SELECT id AS dupe_id, keeper_id FROM ranked WHERE id <> keeper_id
)
DELETE FROM attendance_sessions s
USING dupes
WHERE s.id = dupes.dupe_id;

-- Re-run safe: if a previous run already added the index, the dedupe above finds
-- nothing and this is a no-op.
CREATE UNIQUE INDEX IF NOT EXISTS attendance_sessions_date_mass_key
  ON attendance_sessions (session_date, mass_id);

-- ─── 2. Masses catalog: display order and usual time (ATT-1) ──────────────────

ALTER TABLE masses
  ADD COLUMN IF NOT EXISTS sort_order int NOT NULL DEFAULT 0;

ALTER TABLE masses
  ADD COLUMN IF NOT EXISTS default_time time NULL;

-- Backfill from the order the names already sort in, so the catalog looks the same
-- as it did when the order was implicit in the name. name is not unique, so
-- created_at breaks ties and two Masses sharing a name keep a stable order.
WITH ordered AS (
  SELECT id, row_number() OVER (ORDER BY lower(name), created_at, id) - 1 AS position
  FROM masses
  WHERE sort_order = 0
)
UPDATE masses m
SET sort_order = ordered.position
FROM ordered
WHERE m.id = ordered.id;

-- ─── 3. Where each attendance record came from ────────────────────────────────

-- source: 'encoded' (tapped on the roster), 'appeal' / 'appeal_auto' (module 05),
-- or 'import'. It is what lets a report show that a member was marked present by a
-- secretary rather than by their own appeal, which is a question reports get asked.
ALTER TABLE attendance_records
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'encoded';

ALTER TABLE attendance_records
  DROP CONSTRAINT IF EXISTS attendance_records_source_check;

ALTER TABLE attendance_records
  ADD CONSTRAINT attendance_records_source_check
  CHECK (source IN ('encoded', 'appeal', 'appeal_auto', 'import'));

-- recorded_at is when the mark was made, which created_at already was. It is kept
-- because a record imported from a paper sheet is created now but happened then,
-- and re-encoding a month must not rewrite when the secretary did the work.
ALTER TABLE attendance_records
  ADD COLUMN IF NOT EXISTS recorded_at timestamptz NOT NULL DEFAULT now();

-- Rows that existed before this migration were all stamped with this
-- transaction's now() by the DEFAULT above, which is not when they happened. That
-- makes recorded_at = the transaction timestamp an exact marker for "needs
-- backfilling" and nothing else, so a re-run cannot clobber the recorded_at of a
-- record imported after the first run.
DO $$
BEGIN
  UPDATE attendance_records
  SET recorded_at = created_at
  WHERE recorded_at = now();
END $$;

-- Left unconstrained on purpose: a new role should be able to encode without a
-- migration just to be spelled in this column.
ALTER TABLE attendance_records
  ADD COLUMN IF NOT EXISTS recorded_by_role text NULL;

-- The archive keeps the same provenance, so a report generated later can still
-- tell an imported mark from a typed one once the live rows are gone.
ALTER TABLE attendance_records_archive
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'encoded';

ALTER TABLE attendance_records_archive
  ADD COLUMN IF NOT EXISTS recorded_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE attendance_records_archive
  ADD COLUMN IF NOT EXISTS recorded_by_role text NULL;

-- ─── 4. Indexes ──────────────────────────────────────────────────────────────

-- idx_attendance_records_member already exists from 026 and
-- idx_attendance_sessions_date from 001, which is what the spec asks for here.
-- What is new is the lookup "recent servers first" runs on every session open: a
-- member's records, newest first.
CREATE INDEX IF NOT EXISTS idx_attendance_records_member_recorded
  ON attendance_records (member_id, recorded_at DESC);

-- ─── 5. Automatic weekend sessions (ATT-2) ───────────────────────────────────

-- On by default. The failure this guards against is a parish that quietly never
-- gets sessions because nobody noticed the cron was not firing, so the default is
-- the one that works without a click.
INSERT INTO system_settings (key, value)
VALUES ('auto_create_sunday_sessions', 'true')
ON CONFLICT (key) DO NOTHING;
