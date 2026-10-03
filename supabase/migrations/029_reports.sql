-- 029_reports.sql
-- Module 06 RPT-3 / RPT-8. Two changes with wide blast radius:
--   1. A month may now hold more than one report row, because rejected reports are
--      kept as history instead of being deleted at regenerate.
--   2. New PDFs live in Storage rather than as base64 in the reports table.
--
-- The uniqueness change is the dangerous one. Every "does this month already have a
-- report?" query in the app used .maybeSingle(), which returns an error rather than a
-- row when two match. So the application-side fixes for that are as much a part of this
-- migration as the DDL is; see src/lib/reports/check-report-lock.ts and the other
-- call sites.

-- --------------------------------------------------------------------------------------
-- RPT-8: PDF storage kind
-- --------------------------------------------------------------------------------------
-- 'inline' means pdf_storage_path holds base64 bytes (every row written before this
-- migration). 'object' means it holds an object path in the private `reports` bucket.
-- Existing rows keep 'inline' and must keep working: the download route branches on this
-- column rather than guessing.
ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS review_note text;

ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS pdf_storage_kind text NOT NULL DEFAULT 'inline';

ALTER TABLE reports
  DROP CONSTRAINT IF EXISTS reports_pdf_storage_kind_check;

ALTER TABLE reports
  ADD CONSTRAINT reports_pdf_storage_kind_check
  CHECK (pdf_storage_kind IN ('inline', 'object'));

-- --------------------------------------------------------------------------------------
-- RPT-3: keep rejected reports as history
-- --------------------------------------------------------------------------------------
-- The constraint was declared inline in 001_initial.sql (UNIQUE (report_month)), so it
-- carries Postgres' generated name. Dropping it outright would be simpler than converting
-- it, but ALTER TABLE ... DROP CONSTRAINT takes an ACCESS EXCLUSIVE lock anyway and the
-- table is a handful of rows per month, so this is cheap in practice.
ALTER TABLE reports
  DROP CONSTRAINT IF EXISTS reports_report_month_key;

-- Rejected rows no longer hold the month. Everything else still does, so two concurrent
-- generators of the same month collide here and the loser gets a unique violation, which
-- generate.ts maps to 409 (spec Â§8: "Two people press Generate at once").
CREATE UNIQUE INDEX IF NOT EXISTS reports_month_active
  ON reports (report_month)
  WHERE status <> 'rejected';

-- Lookups that answer "is this month locked?" now need to exclude rejected rows
-- explicitly, and the plain (unqualified) index on report_month no longer serves them.
CREATE INDEX IF NOT EXISTS reports_month_lookup
  ON reports (report_month, status);

-- --------------------------------------------------------------------------------------
-- RPT-8: private storage bucket
-- --------------------------------------------------------------------------------------
-- No public URLs. Every read goes through /api/reports/[id]/pdf with the service role,
-- so the bucket stays private and RLS policies are unnecessary (service role bypasses
-- them, and no user-facing client is ever handed a signed URL).
INSERT INTO storage.buckets (id, name, public)
VALUES ('reports', 'reports', false)
ON CONFLICT (id) DO NOTHING;

-- --------------------------------------------------------------------------------------
-- Forward fix: approve_appeal_items report lock read
-- --------------------------------------------------------------------------------------
-- This is the one place the database itself reads reports, and it becomes wrong the
-- moment a month holds a rejected row next to an active one.
--
-- A bare `SELECT r.status INTO v_report_status FROM reports r WHERE r.report_month = X`
-- over two matching rows does not error the way .maybeSingle() does -- Postgres takes an
-- arbitrary row. If that arbitrary row is the rejected one, the guard below reads
-- 'rejected', decides the month is open, and writes attendance records into a month whose
-- report is already approved. That is a silent data-integrity break, not a crash.
--
-- Filter to the row that actually holds the month, newest first, so the read matches the
-- same rule the application uses after the partial unique index above.
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

  -- 029 forward fix: filter to the row that actually holds the month, newest first.
  -- A bare SELECT INTO over two rows picks an arbitrary one, which after rejected reports
  -- are kept as history could read 'rejected' and let an approval write attendance into a
  -- closed month. See 029_reports.sql.
  SELECT r.status INTO v_report_status
  FROM reports r
  WHERE r.report_month = v_month_start
    AND r.status <> 'rejected'
  ORDER BY r.created_at DESC
  LIMIT 1;

  IF v_report_status IS NOT NULL THEN
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

-- --------------------------------------------------------------------------------------
-- RPT-7: summary_json v5 marker
-- --------------------------------------------------------------------------------------
-- No DDL. v5 adds grid.columns / grid.rows so the preview, exports and the super admin
-- review view can all be rebuilt after archiving removes the live attendance.
-- Rows written before this migration stay version 4 and show the PDF only.
