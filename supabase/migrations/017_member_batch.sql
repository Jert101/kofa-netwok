CREATE TABLE member_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  year TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE members ADD COLUMN batch TEXT REFERENCES member_batches(year) ON DELETE SET NULL;

CREATE INDEX idx_members_batch ON members(batch);
