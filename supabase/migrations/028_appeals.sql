-- 028 — Appeals (module 05): keep resolved appeals as history, add reject reasons,
-- and approve a whole selection in one transaction.
--
-- Two decisions in here are worth reading before the SQL.
--
-- First, this stops deleting appeal items. Every version so far resolved an appeal by
-- DELETEing the item rows and then deleting the parent appeals that had been emptied.
-- That meant the answer to "was Maria in the 8am Mass on the 3rd?" was unrecoverable
-- once resolved: approved, rejected, or never asked, all left the same absence. Worse,
-- the module 05 spec wants the member to see their own outcome, which is impossible
-- when resolving the appeal is what deletes it. Items now carry a status and stay.
--
-- Second, approval moves into Postgres. Approving used to be four or six separate calls
-- — read the item, upsert the attendance record, find the sibling items, delete them,
-- delete the empty parent. A failure after the record insert left attendance written
-- and the appeal still pending, which is exactly the state a retry cannot tell apart
-- from a fresh appeal. One function does it all or none of it, and the route calls it
-- once. The (session_id, member_id) unique key already in place means re-running is
-- harmless.

-- 1. Appeal window and retention settings
-- ================================

-- 14 days: long enough that someone who was on the lector's list finds out before it
-- closes, short enough that the secretary is not answering appeals about last year.
-- 0 means no limit, for a parish that wants to stay open.
INSERT INTO system_settings (key, value)
VALUES ('appeal_window_days', '14')
ON CONFLICT (key) DO NOTHING;

-- Resolved items older than this are swept. Pending items are never swept, whatever the
-- setting, because a pending appeal is a person waiting for an answer.
INSERT INTO system_settings (key, value)
VALUES ('appeal_retention_months', '12')
ON CONFLICT (key) DO NOTHING;

-- 2. Appeal columns
-- ======================================================

-- The member's own words, e.g. "I served as thurifer". Optional: plenty of members
-- have nothing to add, and requiring a note would only discourage appealing at all.
ALTER TABLE attendance_appeals
  ADD COLUMN IF NOT EXISTS note text NULL;

-- Why it was turned down. Separate from resolution because resolution says what
-- happened and this says why, and a reason is what the member needs to read.
ALTER TABLE attendance_appeal_items
  ADD COLUMN IF NOT EXISTS reject_reason text NULL;

-- How the item was resolved, which is not quite the status. A member can be approved by
-- their own appeal or by someone else's in the same session, and those two look
-- identical from the outside but mean very different things to a reviewer.
ALTER TABLE attendance_appeal_items
  ADD COLUMN IF NOT EXISTS resolution text NULL;

-- 3. Allow 'expired' as a status
-- =========================================

-- A pending appeal left over when the report locks its month can never be resolved,
-- because resolving needs the lock guard and the guard blocks it. Expiring them at
-- generation time keeps that from happening.
ALTER TABLE attendance_appeal_items
  DROP CONSTRAINT IF EXISTS attendance_appeal_items_status_check;

ALTER TABLE attendance_appeal_items
  ADD CONSTRAINT attendance_appeal_items_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'expired'));

ALTER TABLE attendance_appeal_items
  DROP CONSTRAINT IF EXISTS attendance_appeal_items_resolution_check;

ALTER TABLE attendance_appeal_items
  ADD CONSTRAINT attendance_appeal_items_resolution_check
  CHECK (
    resolution IS NULL OR resolution IN (
      'approved', 'merged_duplicate', 'rejected', 'expired'
    )
  );

-- 4. Indexes
-- =============================================================

-- The central queue (APL-2) asks for pending items newest first, optionally narrowed to
-- a month. idx_attendance_appeal_items_status from 004 already covers status alone.
CREATE INDEX IF NOT EXISTS idx_attendance_appeal_items_pending_created
  ON attendance_appeal_items (status, created_at DESC);

-- Retention sweep: which resolved items are old enough to delete.
CREATE INDEX IF NOT EXISTS idx_attendance_appeal_items_resolved_at
  ON attendance_appeal_items (reviewed_at)
  WHERE status <> 'pending';

-- The member's own view of their appeals (APL-4) looks up by member across sessions.
CREATE INDEX IF NOT EXISTS idx_attendance_appeal_items_member_created
  ON attendance_appeal_items (member_id, created_at DESC);

-- 5. Approve a selection atomically (APL-7)
-- ==============================

-- Returns the counts the route reports back:
--   approved           items this call moved from pending to approved
--   merged_duplicates  items closed because the same member had another pending item
--                      in the same session, which is now covered by this approval
--   attendance_added   attendance records actually inserted (excludes ones already there)
--   already_resolved   items in the request that were not pending when it ran
--
-- The function checks the report lock itself rather than trusting the route. The route
-- checks first as a courtesy, but between that check and this call a report can be
-- generated — a secretary and a super-admin at the same time is exactly the case where
-- an approved appeal would be written into a month that is already closed.
CREATE OR REPLACE FUNCTION approve_appeal_items(
  p_session_id uuid,
  p_item_ids uuid[],
  p_reviewer_role text
)
RETURNS TABLE (
  approved integer,
  merged_duplicates integer,
  attendance_added integer,
  already_resolved integer
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_session_date date;
  v_month_start date;
  v_report_status text;
  v_pending uuid[];
  v_approved_count integer := 0;
  v_merged_count integer := 0;
  v_added_count integer := 0;
BEGIN
  IF p_item_ids IS NULL OR array_length(p_item_ids, 1) IS NULL THEN
    RETURN QUERY SELECT 0, 0, 0, 0;
    RETURN;
  END IF;

  SELECT s.session_date INTO v_session_date
  FROM attendance_sessions s
  WHERE s.id = p_session_id;

  IF v_session_date IS NULL THEN
    RAISE EXCEPTION 'session not found'
      USING ERRCODE = 'no_data_found';
  END IF;

  v_month_start := date_trunc('month', v_session_date)::date;

  SELECT r.status INTO v_report_status
  FROM reports r
  WHERE r.report_month = v_month_start;

  IF v_report_status IS NOT NULL AND v_report_status <> 'rejected' THEN
    RAISE EXCEPTION 'month is locked: %', v_report_status
      USING ERRCODE = 'check_violation';
  END IF;

  -- Lock the selected rows before deciding anything. Two reviewers pressing Approve at
  -- the same instant both reach this point, and without the lock both would read
  -- "pending" and both would proceed.
  --
  -- The locking SELECT and the aggregating SELECT are two statements because Postgres
  -- refuses FOR UPDATE on a query with an aggregate: "FOR UPDATE is not allowed with
  -- aggregate functions". Doing the locking inside a CTE and collecting the ids outside
  -- it gets both.
  WITH locked AS (
    SELECT i.id
    FROM attendance_appeal_items i
    JOIN attendance_appeals a ON a.id = i.appeal_id
    WHERE a.session_id = p_session_id
      AND i.id = ANY(p_item_ids)
      AND i.status = 'pending'
    FOR UPDATE OF i
  )
  SELECT array_agg(locked.id) INTO v_pending FROM locked;

  IF v_pending IS NULL THEN
    RETURN QUERY SELECT 0, 0, 0, array_length(p_item_ids, 1);
    RETURN;
  END IF;

  -- Attendance records for exactly the selected, still-pending items.
  -- ON CONFLICT DO NOTHING rather than upsert: the record may already exist because the
  -- secretary encoded the roster by hand, and that must not overwrite a recorded_by_role
  -- or recorded_at with a value implying the appeal caused it.
  INSERT INTO attendance_records (session_id, member_id, source, recorded_at, recorded_by_role)
  SELECT p_session_id, i.member_id, 'appeal', now(), p_reviewer_role
  FROM attendance_appeal_items i
  WHERE i.id = ANY(v_pending)
  ON CONFLICT (session_id, member_id) DO NOTHING;

  GET DIAGNOSTICS v_added_count = ROW_COUNT;

  UPDATE attendance_appeal_items
  SET status = 'approved',
      resolution = 'approved',
      reviewed_by_role = p_reviewer_role,
      reviewed_at = now()
  WHERE id = ANY(v_pending);

  GET DIAGNOSTICS v_approved_count = ROW_COUNT;

  -- Same member, same session, a different appeal, still pending. Those are now
  -- covered by the record just written, so leaving them pending would show the reviewer
  -- the same name twice and let one of them be rejected after the member was approved.
  WITH approved_members AS (
    SELECT DISTINCT member_id
    FROM attendance_appeal_items
    WHERE id = ANY(v_pending)
  ),
  dupes AS (
    UPDATE attendance_appeal_items
    SET status = 'approved',
        resolution = 'merged_duplicate',
        reviewed_by_role = p_reviewer_role,
        reviewed_at = now()
    WHERE id IN (
      SELECT i.id
      FROM attendance_appeal_items i
      JOIN attendance_appeals a ON a.id = i.appeal_id
      WHERE a.session_id = p_session_id
        AND i.status = 'pending'
        AND i.member_id IN (SELECT member_id FROM approved_members)
        AND NOT (i.id = ANY(v_pending))
    )
    RETURNING id
  )
  SELECT count(*) INTO v_merged_count FROM dupes;

  RETURN QUERY SELECT v_approved_count, v_merged_count, v_added_count,
    array_length(p_item_ids, 1) - v_approved_count;
END;
$$;

-- 6. Expire what the lock would otherwise strand (APL-8)
-- =================

-- Called by report generation just before the month closes. A pending appeal at that moment
-- could never be resolved afterwards, since resolving needs the lock guard and the guard
-- blocks it, so leaving it "pending" forever would show it as unfinished work to every
-- future review queue. It runs twice in practice:
--
--   p_only_past_window = true   first attempt. Only appeals whose own window has already
--                               closed are expired, and anything still inside its window
--                               is counted and reported back so the secretary is warned
--                               before the month freezes.
--   p_only_past_window = false  the retry, after the secretary has been warned and chosen
--                               to close anyway. Everything still pending expires, because
--                               after this point none of it can be resolved into a record.
--
-- Approving those appeals instead would be the wrong default: the secretary has just been
-- told there is unreviewed work, and silently writing those names into attendance would be a
-- larger change than the one they agreed to. Expired is also what the member sees, and "the
-- month closed before this was reviewed" is true.
CREATE OR REPLACE FUNCTION expire_pending_appeals_for_month(
  p_month_start date,
  p_month_end date DEFAULT NULL,
  p_only_past_window boolean DEFAULT true
)
RETURNS TABLE (expired_count integer, still_open_count integer)
LANGUAGE plpgsql
AS $$
DECLARE
  v_window integer;
  v_month_end date := COALESCE(p_month_end, (p_month_start + interval '1 month')::date);
BEGIN
  SELECT COALESCE(NULLIF(btrim(value), ''), '14')::integer
  INTO v_window
  FROM system_settings
  WHERE key = 'appeal_window_days';

  v_window := COALESCE(v_window, 14);

  WITH expired AS (
    UPDATE attendance_appeal_items i
    SET status = 'expired',
        resolution = 'expired',
        reviewed_at = now()
    FROM attendance_appeals a, attendance_sessions s
    WHERE i.appeal_id = a.id
      AND a.session_id = s.id
      AND s.session_date >= p_month_start
      AND s.session_date <= v_month_end
      AND i.status = 'pending'
      -- Only stale ones on the first pass. 0 means "no limit", in which case nothing is
      -- stale and the warning path is what closes them.
      AND (NOT p_only_past_window
           OR v_window = 0
           OR s.session_date + v_window < (now() AT TIME ZONE 'UTC')::date)
    RETURNING i.id
  )
  SELECT count(*) INTO expired_count FROM expired;

  SELECT count(*) INTO still_open_count
  FROM attendance_appeal_items i
  JOIN attendance_appeals a ON a.id = i.appeal_id
  JOIN attendance_sessions s ON s.id = a.session_id
  WHERE s.session_date >= p_month_start
    AND s.session_date <= v_month_end
    AND i.status = 'pending';

  RETURN NEXT;
END;
$$;

-- 7. Retention sweep (APL-3)
-- =============================================

-- Pending items are excluded by the WHERE, not by the caller: this is a destructive
-- function and the one thing it must never do is delete a question nobody has answered
-- yet. Parents with no items left are removed, since they have nothing to show.
CREATE OR REPLACE FUNCTION purge_resolved_appeal_items(p_before timestamptz)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_count integer;
BEGIN
  DELETE FROM attendance_appeal_items i
  USING attendance_appeals a
  WHERE i.appeal_id = a.id
    AND i.status <> 'pending'
    AND i.reviewed_at IS NOT NULL
    AND i.reviewed_at < p_before;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  DELETE FROM attendance_appeals a
  WHERE NOT EXISTS (
    SELECT 1 FROM attendance_appeal_items i WHERE i.appeal_id = a.id
  );

  RETURN v_count;
END;
$$;
