-- Advance liturgy assignments by calendar date + mass (before attendance_sessions exists)
CREATE TABLE IF NOT EXISTS liturgy_planned (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_date date NOT NULL,
  mass_id uuid NOT NULL REFERENCES masses (id) ON DELETE CASCADE,
  position_label text NOT NULL,
  member_id uuid REFERENCES members (id) ON DELETE SET NULL,
  free_text text,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_liturgy_planned_date_mass ON liturgy_planned (session_date, mass_id, sort_order);

ALTER TABLE liturgy_planned ENABLE ROW LEVEL SECURITY;
