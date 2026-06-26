-- Liturgy position templates (save/load role labels for reuse across masses)
CREATE TABLE IF NOT EXISTS liturgy_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS liturgy_template_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES liturgy_templates (id) ON DELETE CASCADE,
  position_label text NOT NULL,
  sort_order int NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_liturgy_template_slots_template ON liturgy_template_slots (template_id, sort_order);

ALTER TABLE liturgy_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE liturgy_template_slots ENABLE ROW LEVEL SECURITY;
