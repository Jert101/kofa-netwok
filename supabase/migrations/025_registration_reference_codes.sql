-- Registration reference codes, reject reasons, duplicate flagging and member
-- deactivation details (module 03, REG-3 / REG-5 / REG-6 / MEM-3)
--
-- A public applicant gets a short code so they can check the outcome themselves.
-- The alphabet omits 0/O/1/I so a code read off a screen or written down by hand
-- cannot be mistyped into a different valid code.
--
-- possible_duplicate_member_id records a name match found at submit time. The
-- applicant is never told: confirming that a name is a member would leak the
-- member list to the public. Only the admin review table sees it.

CREATE OR REPLACE FUNCTION kofa_reference_code(p_length int DEFAULT 8)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result text := '';
  idx int;
BEGIN
  FOR idx IN 1..GREATEST(1, LEAST(p_length, 16)) LOOP
    result := result || substr(alphabet, floor(random() * char_length(alphabet))::int + 1, 1);
  END LOOP;
  RETURN result;
END;
$$;

-- 1. registration_requests additions
ALTER TABLE registration_requests
  ADD COLUMN IF NOT EXISTS reference_code text,
  ADD COLUMN IF NOT EXISTS reject_reason text,
  ADD COLUMN IF NOT EXISTS possible_duplicate_member_id uuid
    REFERENCES members (id) ON DELETE SET NULL,
  -- The member row this approval created. Needed so that moving a request away
  -- from approved affects only that member, instead of hunting for one by name
  -- and risking deleting the wrong person. Set to NULL again on un-approval.
  ADD COLUMN IF NOT EXISTS approved_member_id uuid
    REFERENCES members (id) ON DELETE SET NULL,
  -- Whether approved_member_id points at a member this approval inserted, or at a
  -- member that already existed and the admin linked REG-6 to. Undoing a linked
  -- approval must not deactivate that person, so the two cases are told apart
  -- here rather than guessed from names or timestamps.
  ADD COLUMN IF NOT EXISTS approval_created_member boolean NOT NULL DEFAULT false;

-- Backfill existing rows. A unique index is added afterwards, so a clash here would
-- fail the migration; the loop retries until it finds a free code.
--
-- approved_member_id is deliberately left NULL for requests approved before this
-- migration: nothing is known about which member they created, and guessing would
-- risk removing the wrong person. Un-approving such a request clears its status and
-- leaves the member alone.
DO $$
DECLARE
  row_id uuid;
  code text;
BEGIN
  FOR row_id IN
    SELECT id FROM registration_requests WHERE reference_code IS NULL
  LOOP
    LOOP
      code := kofa_reference_code(8);
      EXIT WHEN NOT EXISTS (SELECT 1 FROM registration_requests WHERE reference_code = code);
    END LOOP;
    UPDATE registration_requests SET reference_code = code WHERE id = row_id;
  END LOOP;
END;
$$;

-- Unique index rather than a UNIQUE column constraint: Postgres has no
-- "ADD CONSTRAINT IF NOT EXISTS", and this file must be safe to re-run.
CREATE UNIQUE INDEX IF NOT EXISTS registration_requests_reference_code
  ON registration_requests (reference_code);

-- 2. members additions
--
-- Deactivation keeps the record and explains itself, instead of only flipping a flag.
ALTER TABLE members
  ADD COLUMN IF NOT EXISTS deactivated_at timestamptz,
  ADD COLUMN IF NOT EXISTS deactivation_reason text;

-- 3. Indexes
--
-- The review table lists one status newest-first and the duplicate flag is filtered on.
CREATE INDEX IF NOT EXISTS idx_registration_requests_status_created
  ON registration_requests (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_registration_requests_duplicate
  ON registration_requests (possible_duplicate_member_id)
  WHERE possible_duplicate_member_id IS NOT NULL;

-- 4. RLS
--
-- member_batches was created in 017 without it; the service-role key bypasses RLS
-- either way, so this only closes the gap for any future direct client.
ALTER TABLE member_batches ENABLE ROW LEVEL SECURITY;
