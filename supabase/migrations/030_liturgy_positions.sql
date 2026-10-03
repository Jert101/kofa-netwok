-- 030_liturgy_positions.sql
-- Module 07 LIT-4 / build task 1: a catalog of position labels.
--
-- The spec numbers this migration 029, which was already taken by Module 06's reports work.
-- The numbering drifted when 026/027/028 moved modules around (see new md/README.md), so this
-- is 030 and the spec's "migration 029" reference is stale.
--
-- LIT-1's problem P1: position labels are free text, so "Candle 1", "candle 1" and "Candle One"
-- all exist as separate strings in the same column and nothing suggests a spelling. This table
-- is a *suggestion source*, not a foreign key: existing tables keep `position_label` as text
-- and nothing is rewritten. Rewriting history would change what an old session's PDF says.

-- --------------------------------------------------------------------------------------
-- The catalog
-- --------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS liturgy_positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE liturgy_positions ENABLE ROW LEVEL SECURITY;

-- Case-insensitive uniqueness, so "candle 1" and "Candle 1" cannot both be added as separate
-- suggestions. This is the whole point: LIT-1's acceptance criterion is that spelling and
-- casing stay consistent after a week of use, and a plain UNIQUE(label) would permit
-- "Candle 1" and "candle 1" to coexist while looking like duplicates in the dropdown.
--
-- The stored casing is whichever was seen first (spec §7), approximated at seed time by an
-- alphabetical pick (below) so that re-running this migration is a no-op instead of flipping
-- casings on every deploy.
CREATE UNIQUE INDEX IF NOT EXISTS liturgy_positions_label_unique
  ON liturgy_positions (lower(btrim(label)));

CREATE INDEX IF NOT EXISTS idx_liturgy_positions_active_sort
  ON liturgy_positions (is_active, sort_order, lower(label));

-- --------------------------------------------------------------------------------------
-- Seed from what is already in use
-- --------------------------------------------------------------------------------------
-- Both existing tables are read and unioned, so the catalog starts as the labels this parish
-- actually uses rather than a guessed default list.
--
-- `lower(btrim())` groups the duplicates that the unique index above would otherwise reject,
-- and `min()` then picks one representative casing per group. Alphabetical rather than
-- "prettiest": it is the only choice that is stable across runs, which matters because this
-- migration is expected to be re-runnable. A deployment must never change which casing a
-- parish sees, so predictability is worth more than prettiness here.
INSERT INTO liturgy_positions (label, sort_order)
SELECT picked.label,
       row_number() OVER (ORDER BY picked.norm) - 1
FROM (
  SELECT
    lower(btrim(position_label)) AS norm,
    min(btrim(position_label))   AS label
  FROM (
    SELECT position_label FROM liturgy_planned
    UNION ALL
    SELECT position_label FROM session_liturgy_servers
  ) AS all_labels
  WHERE btrim(coalesce(position_label, '')) <> ''
  GROUP BY lower(btrim(position_label))
) AS picked
-- Re-runnable. The conflict target is the expression index above, not a column, so it has to be
-- spelled out; without this a second run dies on the uniqueness it just created.
ON CONFLICT (lower(btrim(label))) DO NOTHING;

-- --------------------------------------------------------------------------------------
-- LIT-4: templates need a rename, and a name that cannot collide
-- --------------------------------------------------------------------------------------
-- `liturgy_templates.name` has no uniqueness today, so two officers can create "Weekday" and
-- "Weekday" and the dropdown becomes ambiguous. Case-insensitive, matching the catalog rule,
-- because the same reasoning applies: the list is read by humans choosing between options.
--
-- This cannot be a bare CREATE UNIQUE INDEX: the duplicates it would reject are reachable on
-- the current schema, so they are merged first.
-- No ON COMMIT DROP: this file is run through the Supabase SQL editor and through ad-hoc psql,
-- which do not wrap a multi-statement paste in an explicit transaction. With ON COMMIT DROP
-- the table would vanish at the end of its own statement and every statement below it would
-- fail on a missing relation. The temp table lives and dies with the connection instead.
-- Dropped first because the table below lives for the whole connection: a second run of this
-- file inside the same session would otherwise fail with "relation already exists" before
-- reaching any of the merging statements. This makes re-running the file a no-op rather than a
-- claim in a comment.
DROP TABLE IF EXISTS pg_temp.liturgy_template_merge;

CREATE TEMP TABLE liturgy_template_merge AS
SELECT
  dup.id AS loser_id,
  keeper.id AS keeper_id
FROM liturgy_templates dup
JOIN LATERAL (
  SELECT t.id
  FROM liturgy_templates t
  WHERE lower(btrim(t.name)) = lower(btrim(dup.name))
    AND (t.created_at, t.id) < (dup.created_at, dup.id)
  ORDER BY t.created_at, t.id
  LIMIT 1
) keeper ON true;

-- Slots move to the surviving template so nobody loses a saved lineup, rather than being
-- deleted along with the duplicate.
UPDATE liturgy_template_slots slot
SET template_id = m.keeper_id
FROM liturgy_template_merge m
WHERE slot.template_id = m.loser_id;

-- The re-point can leave two slots with the same label on one template ("Crucifix" from each
-- original). Keep the earliest of each pair, so the saved lineup is unchanged in content.
--
-- Scoped to templates that actually absorbed a merge. A template that was never duplicated
-- might hold a repeated label that someone means, and spec LIT-4 only forbids duplicates in
-- templates *saved* from now on; rewriting those would be a change nobody asked for.
--
-- `first_value(id) OVER (...)` rather than `min(id)`: PostgreSQL has no min(uuid) aggregate,
-- so a GROUP BY / min(id) form fails at parse time. Same ranking-CTE shape 027 used for its
-- own duplicate merging.
DELETE FROM liturgy_template_slots slot
WHERE slot.id IN (
  SELECT ranked.id
  FROM (
    SELECT
      id,
      first_value(id) OVER (
        PARTITION BY template_id, lower(btrim(position_label))
        ORDER BY sort_order, id
      ) AS keeper_id
    FROM liturgy_template_slots
    WHERE template_id IN (SELECT keeper_id FROM liturgy_template_merge)
  ) AS ranked
  WHERE ranked.id <> ranked.keeper_id
);

DELETE FROM liturgy_templates
WHERE id IN (SELECT loser_id FROM liturgy_template_merge);

CREATE UNIQUE INDEX IF NOT EXISTS liturgy_templates_name_unique
  ON liturgy_templates (lower(btrim(name)));

-- --------------------------------------------------------------------------------------
-- LIT-4: templates record when they changed
-- --------------------------------------------------------------------------------------
-- Needed for the rename audit entry, and so a stale dropdown can tell the list has moved on.
ALTER TABLE liturgy_templates
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- --------------------------------------------------------------------------------------
-- Concurrency: "Updated by another device" (spec §8)
-- --------------------------------------------------------------------------------------
-- Two officers editing the same date currently have a silent last-save-wins: both read the
-- rows, both PUT, and the second erases the first's work with no signal to either.
--
-- Spec §8 keeps the last-save-wins outcome and asks for visibility on top of it: "The save
-- returns the saved rows; the last save wins. Show 'Updated by another device' if the version
-- changed under you." So the revision is *reported*, never used to refuse a write — an officer
-- who knowingly overwrites is doing the right thing, and a hard 409 here would have stranded
-- their work with no way to land it.
--
-- One counter per group, not per row. Both PUT paths delete and re-insert the whole group, so
-- row ids change on every save and a row-level counter could never be compared by two editors.
-- Max(revision) over the group is the only value both sides can agree on.
ALTER TABLE liturgy_planned
  ADD COLUMN IF NOT EXISTS revision int NOT NULL DEFAULT 0;

ALTER TABLE session_liturgy_servers
  ADD COLUMN IF NOT EXISTS revision int NOT NULL DEFAULT 0;

-- An empty group has no rows to hold a revision, so the token would otherwise always be
-- "r:0" and a save that follows another save on an empty list could not be detected as
-- overwriting anything. Holding the counter outside the rows is what makes "the list went from
-- 9 positions to none" a change another editor can see.
--
-- One row per (target), not per Mass: session rows are keyed by session_id and planned rows by
-- (session_date, mass_id), and the pair is the same identity the API uses to address a plan.
CREATE TABLE IF NOT EXISTS liturgy_revision_state (
  target_key text PRIMARY KEY,
  revision int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE liturgy_revision_state ENABLE ROW LEVEL SECURITY;

-- --------------------------------------------------------------------------------------
-- Saving a plan atomically
-- --------------------------------------------------------------------------------------
-- The API used to read the current rows, delete them, and insert the new ones as three separate
-- statements. That is not a save, it is a race with a comment on it:
--
--   Two officers both GET r:2. Officer A PUTs, deleting 9 rows and inserting 9 at r:3.
--   Officer B PUTs. Its version check compares r:2 against r:2 — the revision A wrote has not
--   been read yet, or worse, B's delete has already removed it. B is told "nobody else has
--   touched this" and its 9 rows silently replace A's, with no "Updated by another device".
--
-- The spec asks for last-save-wins *plus* a notice when the version moved. The notice is
-- impossible to make correct from the client side: the read that decides it and the write that
-- can be overtaken are not in the same transaction. So the whole replace happens inside one
-- function, and the version it saw is returned alongside the new one.
--
-- The function does NOT refuse a stale write. Spec §8 is explicit that the last save wins, and
-- an officer who has deliberately overwritten a colleague should have their work land.
-- `expected_revision` is read only to answer "did it move under you".
CREATE OR REPLACE FUNCTION liturgy_save_plan(
  p_planned boolean,
  p_session_date date,
  p_mass_id uuid,
  p_session_id uuid,
  p_rows jsonb,
  p_expected_revision int
)
RETURNS TABLE (revision int, updated_by_other_device boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text;
  v_table text;
  v_seen int;
  v_next int;
  v_stale boolean;
BEGIN
  -- One address for both modes, matching how the API names a target. The Mass is part of a
  -- planned key because a date carries several Masses, but redundant inside a session id.
  IF p_planned THEN
    v_key := 'planned:' || p_session_date::text || ':' || p_mass_id::text;
    v_table := 'liturgy_planned';
  ELSE
    v_key := 'session:' || p_session_id::text;
    v_table := 'session_liturgy_servers';
  END IF;

  -- Serialize saves to this one plan.
  --
  -- The read below is otherwise unprotected, and the window is not theoretical. Two officers can
  -- both open an empty list, both see "no rows, nothing saved yet", and both save. Without a lock
  -- both read v_seen = 0, both compute v_next = 1, and neither is told its save was overtaken:
  -- `liturgy_revision_state` ends up at 1 for what was two saves, so the *next* editor is told
  -- "updated by another device" about a change they never saw, and the second save's rows are
  -- indistinguishable from the first's. Locking the target means the second transaction waits,
  -- re-reads 1, and correctly reports itself as stale.
  --
  -- Transaction level, not session level: the lock is released by COMMIT whatever happens, so a
  -- save that fails halfway or a connection that drops mid-write cannot leave a plan uneditable
  -- until someone restarts the app. The hash is derived from the key rather than an enum, so
  -- adding a third kind of plan later needs no new constant here.
  PERFORM pg_advisory_xact_lock(('x' || substr(md5(v_key), 1, 16))::bit(64)::bigint);

  SELECT s.revision INTO v_seen FROM liturgy_revision_state s WHERE s.target_key = v_key;
  v_seen := coalesce(v_seen, 0);

  -- NULL means "first save by anyone", which is never stale.
  v_stale := p_expected_revision IS NOT NULL AND p_expected_revision <> v_seen;
  v_next := v_seen + 1;

  -- Stamp every incoming row in one pass, from the JSON, so the ordering the officer arranged
  -- on screen is the ordering stored. `sort_order` is written by the database rather than
  -- trusted from the payload: a client that sent 5, 9, 2 would otherwise store a list whose
  -- own spec ("contiguous from 0 after every save") it had just broken.
  IF p_planned THEN
    DELETE FROM liturgy_planned
      WHERE session_date = p_session_date AND mass_id = p_mass_id;

    INSERT INTO liturgy_planned (session_date, mass_id, position_label, member_id, free_text, sort_order, revision)
    SELECT
      p_session_date,
      p_mass_id,
      btrim(r ->> 'position_label'),
      nullif(r ->> 'member_id', '')::uuid,
      nullif(r ->> 'free_text', ''),
      (r.ord - 1)::int,
      v_next
    FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS t(r, ord)
    WHERE btrim(coalesce(r ->> 'position_label', '')) <> '';
  ELSE
    DELETE FROM session_liturgy_servers WHERE session_id = p_session_id;

    INSERT INTO session_liturgy_servers (session_id, position_label, member_id, free_text, sort_order, revision)
    SELECT
      p_session_id,
      btrim(r ->> 'position_label'),
      nullif(r ->> 'member_id', '')::uuid,
      nullif(r ->> 'free_text', ''),
      (r.ord - 1)::int,
      v_next
    FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS t(r, ord)
    WHERE btrim(coalesce(r ->> 'position_label', '')) <> '';
  END IF;

  INSERT INTO liturgy_revision_state (target_key, revision, updated_at)
  VALUES (v_key, v_next, now())
  ON CONFLICT (target_key) DO UPDATE
    SET revision = EXCLUDED.revision, updated_at = EXCLUDED.updated_at;

  RETURN QUERY SELECT v_next, v_stale;
END;
$$;

-- --------------------------------------------------------------------------------------
-- Reading the current version
-- --------------------------------------------------------------------------------------
-- The GET has to report the same revision the save will compare against. Reading max(revision)
-- from the rows works until the list is empty, which is exactly the case where "did anything
-- change" is hardest to answer; this reads the same counter the save writes.
CREATE OR REPLACE FUNCTION liturgy_current_revision(p_target_key text)
RETURNS int
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(max(revision), 0) FROM liturgy_revision_state WHERE target_key = p_target_key;
$$;

-- --------------------------------------------------------------------------------------
-- Grants
-- --------------------------------------------------------------------------------------
-- SECURITY DEFINER means these run as the migration's owner, so RLS on the tables underneath
-- is bypassed. That is correct here (the function's whole job is a compare-and-set that RLS
-- cannot express), but it means the *only* thing standing between an anonymous caller and a
-- rewrite of anyone's plan is these grants. service_role keeps its own access; anon is denied
-- explicitly rather than left to default privileges, because a SECURITY DEFINER function with
-- an authenticated grant is a hole that only shows up under attack.
GRANT EXECUTE ON FUNCTION liturgy_save_plan(boolean, date, uuid, uuid, jsonb, int) TO service_role;
GRANT EXECUTE ON FUNCTION liturgy_current_revision(text) TO service_role;

REVOKE ALL ON FUNCTION liturgy_save_plan(boolean, date, uuid, uuid, jsonb, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION liturgy_current_revision(text) FROM PUBLIC;