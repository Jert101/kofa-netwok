-- Audit log: one row for every action that changes data (module 02, AUTH-5)
--
-- actor_name is a snapshot taken at the time of the action, so the trail
-- survives the member being deleted or renamed later. Never store PINs,
-- hashes or raw IPs here: see src/lib/audit/sanitize.ts.
CREATE TABLE IF NOT EXISTS audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  at timestamptz NOT NULL DEFAULT now(),
  actor_role text,
  actor_member_id uuid REFERENCES members (id) ON DELETE SET NULL,
  actor_name text,
  action text NOT NULL,
  entity_type text,
  entity_id text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_hash text
);

CREATE INDEX IF NOT EXISTS idx_audit_log_at ON audit_log (at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_action_at ON audit_log (action, at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log (entity_type, entity_id);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
