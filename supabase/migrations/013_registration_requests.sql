CREATE TABLE IF NOT EXISTS registration_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name text NOT NULL,
  last_name text NOT NULL,
  middle_initial text,
  date_of_birth date NOT NULL,
  gender text NOT NULL CHECK (gender IN ('male', 'female')),
  contact_number text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_registration_requests_status
  ON registration_requests (status, created_at DESC);

ALTER TABLE registration_requests ENABLE ROW LEVEL SECURITY;
