-- Super admin role: approve/reject monthly reports

-- 1. Super admin PIN (bcrypt hash) stored in system_settings
INSERT INTO system_settings (key, value) VALUES ('pin_super_admin_hash', '')
ON CONFLICT (key) DO NOTHING;

-- 2. Add status column to reports (default 'approved' for existing reports)
ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'approved'
  CHECK (status IN ('pending', 'approved', 'rejected'));

ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS reviewed_by text CHECK (reviewed_by IN ('super_admin'));

ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;

-- 3. Broaden notifications CHECK constraints to include super_admin
ALTER TABLE notifications
  DROP CONSTRAINT IF EXISTS notifications_from_role_check;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_from_role_check
  CHECK (from_role IN ('admin', 'secretary', 'member', 'system', 'super_admin'));

ALTER TABLE notifications
  DROP CONSTRAINT IF EXISTS notifications_to_role_check;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_to_role_check
  CHECK (to_role IN ('admin', 'secretary', 'super_admin'));

-- 4. Index for listing pending reports
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports (status, created_at DESC);
