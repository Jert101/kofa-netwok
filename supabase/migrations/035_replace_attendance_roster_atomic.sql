-- Atomic roster replacement (module 04, ATT-4).
--
-- `PATCH /api/attendance/session/[id]` with `member_ids` is the admin repair path: it
-- replaces a whole roster by hand, to fix a session that was encoded against a stale
-- member list. It was doing that as three separate round trips from JavaScript:
--
--   DELETE FROM attendance_records WHERE session_id = ...
--   INSERT INTO attendance_records ...      -- one row per member
--   UPDATE attendance_sessions SET notes = ...
--
-- A function body runs as a single transaction, so either the roster is replaced or
-- it is untouched. Two things went wrong with the loop, and both were silent:
--
--   1. The DELETE's error was never read. A failed delete left the old roster in
--      place, the INSERT then added the new members on top of it, and the route
--      answered 200. A member the admin had just removed stayed on the roster of a
--      Mass they did not attend, and the report counted them as present.
--   2. An INSERT that failed after a successful DELETE left the session with an
--      empty roster. The route reported the failure, but the attendance was already
--      gone -- the one operation on this route that can destroy data was the one
--      that could not be retried.
--
-- This is the same reasoning as 026 (kofa_import_members): the browser cannot hold a
-- transaction open across several statements, so the work moves into the database.
--
-- `p_member_ids` is deduped here rather than in the route. The UNIQUE
-- (session_id, member_id) constraint is what actually prevents a double row, and a
-- duplicate used to surface as a 409 from the driver after the delete had already
-- committed -- the same "empty roster, reported failure" outcome as case 2 above.

CREATE OR REPLACE FUNCTION kofa_replace_attendance_roster(
  p_session_id uuid,
  p_member_ids uuid[],
  p_notes text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_ids uuid[];
  v_count integer;
BEGIN
  IF p_session_id IS NULL THEN
    RAISE EXCEPTION 'p_session_id is required';
  END IF;

  -- An empty array is a legitimate request: it empties the roster. `coalesce` is only
  -- there so a NULL from a caller that did not send the key means the same thing.
  --
  -- Deduped so a repeated id cannot trip UNIQUE (session_id, member_id) and roll the
  -- whole replacement back. Order is not preserved and does not need to be: the roster
  -- has no order, only a membership.
  SELECT COALESCE(array_agg(DISTINCT u.id), ARRAY[]::uuid[])
    INTO v_ids
    FROM unnest(COALESCE(p_member_ids, ARRAY[]::uuid[])) AS u(id);

  IF NOT EXISTS (SELECT 1 FROM attendance_sessions WHERE id = p_session_id) THEN
    RAISE EXCEPTION 'session % does not exist', p_session_id;
  END IF;

  DELETE FROM attendance_records WHERE session_id = p_session_id;

  IF array_length(v_ids, 1) IS NOT NULL THEN
    INSERT INTO attendance_records (session_id, member_id, source)
    SELECT p_session_id, u.id, 'import'
    FROM unnest(v_ids) AS u(id);
  END IF;

  -- 'import' rather than 'encoded' above, and deliberately: this is the repair path, so
  -- the report can distinguish a roster an admin typed in by hand from one the
  -- secretary encoded during the Mass. It is in the CHECK constraint from 027.

  IF p_notes IS NOT NULL THEN
    UPDATE attendance_sessions SET notes = p_notes WHERE id = p_session_id;
  END IF;

  SELECT count(*) INTO v_count FROM attendance_records WHERE session_id = p_session_id;
  RETURN v_count;
END;
$$;
