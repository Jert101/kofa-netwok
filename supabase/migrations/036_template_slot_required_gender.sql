-- A gender requirement per template position (module 08, LIT-4).
--
-- The random assigner needs to know what a position demands of the server put in it -- a thurifer
-- that must be a woman, say. That requirement belongs to the template rather than to any one Mass,
-- because the template is what the officer reuses every week: if the rule lived on the plan, it
-- would have to be retyped every Sunday instead of travelling with the template it came from.
--
-- Default 'any' so every existing template slot is valid without a backfill, and so a template
-- written before this column existed loads as "no preference" rather than failing.
--
-- Left unconstrained on text beyond the CHECK so a new option is a migration edit rather than a
-- data repair; the API and the UI only ever send the three values below.

ALTER TABLE liturgy_template_slots
  ADD COLUMN IF NOT EXISTS required_gender text NOT NULL DEFAULT 'any';

ALTER TABLE liturgy_template_slots
  DROP CONSTRAINT IF EXISTS liturgy_template_slots_required_gender_check;

ALTER TABLE liturgy_template_slots
  ADD CONSTRAINT liturgy_template_slots_required_gender_check
  CHECK (required_gender IN ('male', 'female', 'any'));