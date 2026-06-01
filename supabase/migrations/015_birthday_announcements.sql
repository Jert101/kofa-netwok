-- Allow system-generated birthday announcements
ALTER TABLE announcements DROP CONSTRAINT IF EXISTS announcements_created_by_check;
ALTER TABLE announcements ADD CONSTRAINT announcements_created_by_check
  CHECK (created_by IN ('admin', 'secretary', 'officer', 'system'));
