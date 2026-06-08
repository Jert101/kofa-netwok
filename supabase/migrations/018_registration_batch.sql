ALTER TABLE registration_requests ADD COLUMN batch TEXT REFERENCES member_batches(year) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_registration_requests_batch ON registration_requests(batch);
