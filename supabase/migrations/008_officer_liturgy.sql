-- Officer role PIN (default same bcrypt as other seeds = PIN 1234 until admin changes all PINs)
INSERT INTO system_settings (key, value, updated_at)
VALUES ('pin_officer_hash', '$2b$10$7yrGhMdqjtQKIOf08ElX.uZI0PWlqdPG7dmpoLNkU6QCVVEMPaqD.', now())
ON CONFLICT (key) DO NOTHING;

ALTER TABLE announcements DROP CONSTRAINT IF EXISTS announcements_created_by_check;
ALTER TABLE announcements ADD CONSTRAINT announcements_created_by_check
  CHECK (created_by IN ('admin', 'secretary', 'officer'));

CREATE TABLE IF NOT EXISTS session_liturgy_servers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES attendance_sessions (id) ON DELETE CASCADE,
  position_label text NOT NULL,
  member_id uuid REFERENCES members (id) ON DELETE SET NULL,
  free_text text,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_session_liturgy_servers_session ON session_liturgy_servers (session_id, sort_order);

ALTER TABLE session_liturgy_servers ENABLE ROW LEVEL SECURITY;
