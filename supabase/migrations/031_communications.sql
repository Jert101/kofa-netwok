-- Module 08 — Announcements & notifications.
--
-- Migration 031. The module document says 030; 030 is the liturgy module and is already applied, so
-- this one is 031 and the earlier numbering in the doc is stale.
--
-- Everything here is additive. No existing row is rewritten and no existing endpoint is forced to
-- change shape: subscriptions written before this migration keep a null `role` and a null
-- `member_id`, which the targeting rules treat as "broadcast only, until the device resubscribes".

-- ======================================================================================
-- 1. Announcements: audience, pinning, editing, idempotency
-- ======================================================================================

ALTER TABLE announcements
  ADD COLUMN IF NOT EXISTS audience_roles text[] NULL,
  ADD COLUMN IF NOT EXISTS audience_batches text[] NULL,
  ADD COLUMN IF NOT EXISTS pinned boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS dedupe_key text NULL;

COMMENT ON COLUMN announcements.audience_roles IS
  'Roles this post is for. NULL or empty means everyone. Enforced on read, not only in the composer.';
COMMENT ON COLUMN announcements.audience_batches IS
  'Member batch years this post is for. Matched against members.batch, so only members with a declared identity can match.';
COMMENT ON COLUMN announcements.pinned IS
  'Pinned posts sort above everything else. At most three at a time, enforced in the API.';
COMMENT ON COLUMN announcements.updated_at IS
  'Set when a creator edits the post. NULL means never edited, which is what the feed reads to decide whether to show "Edited".';
COMMENT ON COLUMN announcements.dedupe_key IS
  'Idempotency key for generated posts, e.g. birthday:2026-10-02. Unique when present, so a cron rerun updates instead of duplicating.';

-- Partial unique index rather than a bare UNIQUE column: a unique constraint on a nullable column
-- allows many NULLs in Postgres anyway, but the partial index makes the intent explicit and keeps
-- the index small, since almost every row has no key.
CREATE UNIQUE INDEX IF NOT EXISTS announcements_dedupe_key_unique
  ON announcements (dedupe_key)
  WHERE dedupe_key IS NOT NULL;

-- The feed query is "not expired, pinned first, newest first". This index serves exactly that and
-- nothing else, which is why it is partial on the expiry predicate.
CREATE INDEX IF NOT EXISTS announcements_feed_idx
  ON announcements (pinned DESC, created_at DESC)
  WHERE delete_at IS NULL;

-- Audience membership is resolved in the query. This index is what keeps that from becoming a
-- sequential scan once the parish has a few thousand posts.
CREATE INDEX IF NOT EXISTS announcements_audience_roles_idx
  ON announcements (audience_roles)
  WHERE audience_roles IS NOT NULL;

-- ======================================================================================
-- 2. Notifications: deep links, every role as a recipient
-- ======================================================================================

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS link text NULL;

COMMENT ON COLUMN notifications.link IS
  'In-app path the item opens, e.g. /admin/reports/abc. NULL means the item is informational and opens nothing.';

-- Widened from (admin, secretary, super_admin) to every role, so officer and treasurer can receive
-- notifications later without another migration. Super_admin is kept because dropping a role that
-- existing rows use would fail the check.
ALTER TABLE notifications
  DROP CONSTRAINT IF EXISTS notifications_to_role_check;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_to_role_check
  CHECK (to_role IN ('admin', 'secretary', 'member', 'officer', 'treasurer', 'super_admin', 'system'));

-- The same widening for `from_role`, because the event dispatchers now stamp the row with the
-- caller's actual role, including officer, and a check constraint would turn that into a 500
-- only when the author happened to be an officer.
ALTER TABLE notifications
  DROP CONSTRAINT IF EXISTS notifications_from_role_check;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_from_role_check
  CHECK (from_role IN ('admin', 'secretary', 'member', 'officer', 'treasurer', 'super_admin', 'system'));

-- The unread badge asks "how many for my role that are unread" on every page load, on a 60 second
-- poll. The existing index starts at to_role and already orders by created_at DESC, which is close,
-- but it cannot filter on read_at without touching every row for a role that has any.
CREATE INDEX IF NOT EXISTS notifications_unread_idx
  ON notifications (to_role, created_at DESC)
  WHERE read_at IS NULL;

-- ======================================================================================
-- 3. Push subscriptions: who the device is, and what it wants
-- ======================================================================================

ALTER TABLE push_subscriptions
  ADD COLUMN IF NOT EXISTS role text NULL,
  ADD COLUMN IF NOT EXISTS member_id uuid NULL REFERENCES members (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS topics text[] NOT NULL DEFAULT '{attendance,announcements,reports,liturgy}';

COMMENT ON COLUMN push_subscriptions.role IS
  'Role of the signed-in user when the device subscribed. NULL for subscriptions predating module 08.';
COMMENT ON COLUMN push_subscriptions.member_id IS
  'Declared identity, so reminders and appeal results can reach a person and not a role. NULL when the device never declared one.';
COMMENT ON COLUMN push_subscriptions.topics IS
  'Topics this device accepts. A device receives only the topics it enabled.';

CREATE INDEX IF NOT EXISTS push_subscriptions_role_idx
  ON push_subscriptions (role);

-- The reminder job looks up "devices belonging to these members". Without this the job would scan
-- the whole table once per assignment.
CREATE INDEX IF NOT EXISTS push_subscriptions_member_idx
  ON push_subscriptions (member_id)
  WHERE member_id IS NOT NULL;

-- ======================================================================================
-- 4. Pin limit, in the database
-- ======================================================================================

-- The API refuses to pin a fourth post and asks which to unpin, but a check constraint cannot count
-- rows. This is a trigger instead: it logs and refuses anything that would leave more than three
-- pinned. The API check still runs first so the officer gets a question rather than an error.
CREATE OR REPLACE FUNCTION announcements_pin_limit() RETURNS trigger AS $$
DECLARE
  pinned_count integer;
BEGIN
  IF NEW.pinned AND (TG_OP = 'INSERT' OR NOT COALESCE(OLD.pinned, false)) THEN
    SELECT count(*) INTO pinned_count FROM announcements WHERE pinned = true;
    IF pinned_count >= 3 THEN
      RAISE EXCEPTION 'At most three announcements can be pinned at a time (trying to make % )', NEW.title
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS announcements_pin_limit_trg ON announcements;
CREATE TRIGGER announcements_pin_limit_trg
  BEFORE INSERT OR UPDATE OF pinned ON announcements
  FOR EACH ROW EXECUTE FUNCTION announcements_pin_limit();

-- ======================================================================================
-- 5. LIT-6: the reminder ledger
-- ======================================================================================

-- One row per (session, member, run date) says the reminder went out. The job is a cron, and crons
-- get retried: without this, a retry the next day or a double-fire the same morning would send
-- "You're serving tomorrow" twice for one assignment, which is exactly the kind of message people
-- turn off notifications over.
CREATE TABLE IF NOT EXISTS liturgy_reminders_sent (
  session_id uuid NOT NULL REFERENCES attendance_sessions (id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  sent_on date NOT NULL,
  PRIMARY KEY (session_id, member_id, sent_on)
);

ALTER TABLE liturgy_reminders_sent ENABLE ROW LEVEL SECURITY;

-- ======================================================================================
-- 6. Note on the applied-migration policy
-- ======================================================================================

-- No ON COMMIT DROP anywhere in this file. The Supabase SQL editor commits between statements, so a
-- temp table would be dropped by the time the next statement ran. This migration creates none.
