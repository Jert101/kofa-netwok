-- Link auto-generated “server assignment” posts to a date + mass (one announcement per pair)
ALTER TABLE announcements
  ADD COLUMN IF NOT EXISTS liturgy_session_date date,
  ADD COLUMN IF NOT EXISTS liturgy_mass_id uuid REFERENCES masses (id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_announcements_liturgy_date_mass
  ON announcements (liturgy_session_date, liturgy_mass_id)
  WHERE liturgy_session_date IS NOT NULL AND liturgy_mass_id IS NOT NULL;
