ALTER TABLE announcements
ADD COLUMN IF NOT EXISTS delete_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_announcements_delete_at
ON announcements (delete_at);
