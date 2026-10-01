-- Atomic CSV import for members (module 03, MEM-5).
--
-- The spec asks for the valid rows of an import to be inserted "in one
-- transaction". The JavaScript client cannot hold a transaction open across
-- several inserts, so this does the work inside a function instead: a function
-- body runs as a single transaction, so either every row that should be imported
-- lands or none of them do. A failure halfway cannot leave half a parish on the
-- roll, which is the whole point of doing it server side rather than looping
-- from the browser.
--
-- Duplicate rows are reported back rather than raising, because a file with one
-- duplicate should still import the rest. members_unique_active_name is what
-- actually guarantees no double insert; the checks below exist to report the
-- conflict rather than to raise it.

-- 1. RLS on the payments tables.
--
-- Every other table in this schema has RLS enabled with no policies, which
-- denies anon and authenticated outright and relies on the service-role key
-- bypassing. payments and payment_structures were created in 016 without it, so
-- they were the only two left open to any future direct client. The same gap was
-- closed for member_batches in 025.
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_structures ENABLE ROW LEVEL SECURITY;

-- 2. Indexes the member profile and the import need.
--
-- attendance_records has an index on session_id but never on member_id, so
-- "every session this member served" was a sequential scan. The profile reads
-- that twice per view, plus the archive.
CREATE INDEX IF NOT EXISTS idx_attendance_records_member
  ON attendance_records (member_id);

CREATE INDEX IF NOT EXISTS idx_attendance_records_archive_member
  ON attendance_records_archive (member_id);

CREATE INDEX IF NOT EXISTS idx_attendance_sessions_archive_date
  ON attendance_sessions_archive (session_date);

-- 3. The import.
--
-- p_rows is a JSON array of objects with the same keys as the CSV template, minus
-- the name parts, which arrive already composed by the server:
--   { "full_name": "...", "date_of_birth": "YYYY-MM-DD", "gender": "male",
--     "contact_number": "...", "batch": "2025" }
--
-- One row is returned per submitted row, in order, so the client can zip the
-- outcome back onto its preview table. status is 'imported', 'duplicate' or
-- 'invalid'.
--
-- The index column is `row_position` rather than `position` because POSITION is a
-- reserved SQL word, and Postgres rejects it bare in a RETURNS TABLE list.
CREATE OR REPLACE FUNCTION kofa_import_members(
  p_rows jsonb,
  p_create_missing_batches boolean DEFAULT false
)
RETURNS TABLE (row_position int, full_name text, member_id uuid, status text)
LANGUAGE plpgsql
AS $$
DECLARE
  rec record;
  v_batch text;
  v_status text;
  v_member_id uuid;
  v_inserted_names text[] := ARRAY[]::text[];
  v_out_pos int[] := ARRAY[]::int[];
  v_out_name text[] := ARRAY[]::text[];
  v_out_id uuid[] := ARRAY[]::uuid[];
  v_out_status text[] := ARRAY[]::text[];
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'p_rows must be a JSON array';
  END IF;

  -- Batches first, so a row naming a new year can be inserted below. Only years
  -- the admin explicitly asked for are created, and only ones shaped like a year.
  IF p_create_missing_batches THEN
    FOR v_batch IN
      SELECT DISTINCT btrim(e.elem ->> 'batch')
      FROM jsonb_array_elements(p_rows) AS e(elem)
      WHERE nullif(btrim(coalesce(e.elem ->> 'batch', '')), '') IS NOT NULL
        AND btrim(e.elem ->> 'batch') ~ '^[0-9]{4}$'
    LOOP
      INSERT INTO member_batches (year)
      VALUES (v_batch)
      ON CONFLICT (year) DO NOTHING;
    END LOOP;
  END IF;

  FOR rec IN
    SELECT
      (e.ord - 1)::int AS pos,
      btrim(coalesce(e.elem ->> 'full_name', '')) AS full_name,
      nullif(btrim(coalesce(e.elem ->> 'date_of_birth', '')), '')::date AS date_of_birth,
      nullif(btrim(coalesce(e.elem ->> 'gender', '')), '') AS gender,
      nullif(btrim(coalesce(e.elem ->> 'contact_number', '')), '') AS contact_number,
      nullif(btrim(coalesce(e.elem ->> 'batch', '')), '') AS batch
    FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS e(elem, ord)
    ORDER BY e.ord
  LOOP
    v_member_id := NULL;

    IF rec.full_name = '' THEN
      v_status := 'invalid';
    ELSIF EXISTS (
      SELECT 1 FROM members m
      WHERE m.is_active
        AND lower(btrim(m.full_name)) = lower(rec.full_name)
    ) THEN
      v_status := 'duplicate';
    ELSIF rec.full_name = ANY (v_inserted_names) THEN
      -- A name repeated inside this same file. Reported, not inserted twice.
      v_status := 'duplicate';
    ELSE
      INSERT INTO members (full_name, date_of_birth, gender, contact_number, batch)
      VALUES (rec.full_name, rec.date_of_birth, rec.gender, rec.contact_number, rec.batch)
      RETURNING id INTO v_member_id;

      v_inserted_names := array_append(v_inserted_names, lower(rec.full_name));
      v_status := 'imported';
    END IF;

    v_out_pos := array_append(v_out_pos, rec.pos);
    v_out_name := array_append(v_out_name, rec.full_name);
    v_out_id := array_append(v_out_id, v_member_id);
    v_out_status := array_append(v_out_status, v_status);
  END LOOP;

  RETURN QUERY
  SELECT * FROM unnest(v_out_pos, v_out_name, v_out_id, v_out_status);
END;
$$;
