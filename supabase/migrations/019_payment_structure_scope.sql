ALTER TABLE payment_structures
ADD COLUMN for_all boolean NOT NULL DEFAULT true,
ADD COLUMN batch text REFERENCES member_batches(year) ON DELETE SET NULL;
