CREATE TABLE IF NOT EXISTS attendance_appeals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES attendance_sessions (id) ON DELETE CASCADE,
  submitted_by_role text NOT NULL CHECK (submitted_by_role IN ('member')),
  submitted_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS attendance_appeal_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appeal_id uuid NOT NULL REFERENCES attendance_appeals (id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES members (id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by_role text CHECK (reviewed_by_role IN ('admin', 'secretary')),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (appeal_id, member_id)
);

CREATE INDEX IF NOT EXISTS idx_attendance_appeals_session
ON attendance_appeals (session_id, submitted_at DESC);

CREATE INDEX IF NOT EXISTS idx_attendance_appeal_items_status
ON attendance_appeal_items (status, created_at DESC);

ALTER TABLE attendance_appeals ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_appeal_items ENABLE ROW LEVEL SECURITY;
