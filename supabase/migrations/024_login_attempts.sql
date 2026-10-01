-- Throttling counters for login, register and appeals (module 02, AUTH-2)
--
-- Serverless functions share no memory, so the limits live in the database.
-- ip_hash is a salted hash of the client address, never the raw IP.
CREATE TABLE IF NOT EXISTS login_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_hash text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('login', 'register', 'appeal')),
  success boolean NOT NULL DEFAULT false,
  attempted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_window
  ON login_attempts (ip_hash, kind, attempted_at DESC);

CREATE INDEX IF NOT EXISTS idx_login_attempts_at
  ON login_attempts (attempted_at DESC);

ALTER TABLE login_attempts ENABLE ROW LEVEL SECURITY;
