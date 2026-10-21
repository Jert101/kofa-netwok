-- 045_sms_queue.sql
--
-- Adds the SMS queue used to send text messages through textbee.dev using the
-- parish's own Android phone (DITO SIM). The free plan allows 50 messages per
-- day, so the queue tracks how many were sent today and sends the rest the
-- following day until everyone has received theirs.
--
-- Rows are created by:
--   * POST /api/announcements            (text blast to all active members)
--   * POST /api/officer/assign           (text to each assigned server)
--   * GET  /api/cron/sms                 (inactivity notice for members who
--                                        have not served in one month)
--
-- A cron runner sends up to the daily limit each time it runs, one message at a
-- time, oldest first by priority. The same person never receives the same
-- message twice because of the partial unique index on dedupe_key.

CREATE TABLE IF NOT EXISTS sms_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The recipient's phone number in +63 format.
  recipient text NOT NULL,

  -- The member who receives this message, when known.
  member_id uuid REFERENCES members (id) ON DELETE SET NULL,

  -- The body of the text message.
  message text NOT NULL,

  -- What kind of message this is, so the parish can tell them apart.
  type text NOT NULL CHECK (type IN ('assignment', 'announcement', 'birthday', 'individual', 'inactivity_notice')),

  -- Priority: 1 goes first (birthday, individual, assignment, inactivity), 2 last (announcement blast).
  priority int NOT NULL DEFAULT 2,

  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),

  retries int NOT NULL DEFAULT 0,
  max_retries int NOT NULL DEFAULT 3,

  -- A key that identifies this message for this person, so a rerun does not
  -- deliver it twice. Format: `type:member_id:reference` or `type:reference`.
  dedupe_key text NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  error text
);

CREATE INDEX IF NOT EXISTS idx_sms_queue_status_created ON sms_queue (status, created_at);
CREATE INDEX IF NOT EXISTS idx_sms_queue_dedupe ON sms_queue (dedupe_key);

-- Same person never receives the same message twice.
CREATE UNIQUE INDEX IF NOT EXISTS sms_queue_dedupe_sent_idx
  ON sms_queue (dedupe_key)
  WHERE status = 'sent';

-- RLS: block direct access; the server's service role bypasses it.
ALTER TABLE sms_queue ENABLE ROW LEVEL SECURITY;

-- Keep track of the daily limit and max retries as settings so they can be
-- changed without touching code.
INSERT INTO system_settings (key, value) VALUES
  ('sms_daily_limit', '50'),
  ('sms_max_retries', '3')
ON CONFLICT (key) DO NOTHING;

COMMENT ON TABLE sms_queue IS 'Queue of SMS messages to send through textbee.dev. One row per message per recipient.';
COMMENT ON COLUMN sms_queue.dedupe_key IS 'Identifies this message for this recipient so it is never delivered twice.';
COMMENT ON COLUMN sms_queue.type IS 'assignment, announcement, birthday, individual, or inactivity_notice.';
