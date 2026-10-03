-- ======================================================================================
-- 032 — Payments: void reasons, the ledger, and the keys the ledger needs
-- ======================================================================================
--
-- Module 09 (PAY-1..PAY-8).
--
-- No ON COMMIT DROP anywhere in this file. The Supabase SQL editor commits between statements, so a
-- temp table would be dropped by the time the next statement ran. This migration creates none.

-- ======================================================================================
-- 1. Voids stop being anonymous
-- ======================================================================================
--
-- `payments.voided` already existed, so a payment could be struck out with no record of who did it or
-- why. In a parish book that is the one thing nobody can reconstruct later: the treasurer who left,
-- the amount that vanished, the member who says they never paid. Spec §PAY-3 requires the reason, and
-- an audit trail alone is not enough because the reason itself lives here.
--
-- All three nullable, because existing voided rows predate them and a migration that refuses to apply
-- because of history is a migration that gets skipped.

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS void_reason text NULL;

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS voided_at timestamptz NULL;

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS voided_by_role text NULL;

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS voided_by_member_id uuid NULL REFERENCES members (id) ON DELETE SET NULL;

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS void_note text NULL;

COMMENT ON COLUMN payments.void_reason IS
  'Why the payment was voided: Entered by mistake, Duplicate, Wrong member, or Other.';

COMMENT ON COLUMN payments.void_note IS
  'Free text. Required when void_reason is ''Other'', which is the only reason that carries no meaning on its own.';

COMMENT ON COLUMN payments.voided_by_member_id IS
  'Who voided it, when an identity was declared. A treasurer signing in on a shared machine records a role and no name, which is the honest answer.';

-- ======================================================================================
-- 2. Indexes for the ledger and the overdue list
-- ======================================================================================
--
-- Every one of these exists to answer a question a treasurer asks per member rather than once for the
-- whole parish, so the cost per request matters more than the cost per row.

-- The two questions asked constantly: "what has this person paid for this structure?" and "what does
-- this structure look like across everybody?". Partial, because voided rows are excluded from every
-- total and filtering them out after the fact would scan them first.
CREATE INDEX IF NOT EXISTS payments_structure_member_live_idx
  ON payments (payment_structure_id, member_id)
  WHERE voided = false;

CREATE INDEX IF NOT EXISTS payments_member_live_idx
  ON payments (member_id)
  WHERE voided = false;

-- The payments list and the CSV export, both ordered by date. `paid_at` is nullable, so the nulls
-- ordering is stated rather than left to the planner: a NULL paid_at is a payment with no date, and
-- it belongs at the end of a dated list, not the beginning.
CREATE INDEX IF NOT EXISTS payments_paid_at_idx
  ON payments (paid_at DESC NULLS LAST, created_at DESC);

-- The duplicate guard asks "was this member paid this much for this structure in the last ten
-- minutes?", which reads by member and structure and then narrows by time. Without this the guard
-- loads every payment this member ever made on every attempt to save a payment.
CREATE INDEX IF NOT EXISTS payments_member_structure_recent_idx
  ON payments (member_id, payment_structure_id, created_at DESC)
  WHERE voided = false;

-- The "which structures have payments" check that locks PAY-1's money fields. Partial for the same
-- reason: a structure whose only payments are voided is unlocked.
CREATE INDEX IF NOT EXISTS payments_structure_live_idx
  ON payments (payment_structure_id)
  WHERE voided = false;

-- ======================================================================================
-- 3. Structure timestamps the ledger needs
-- ======================================================================================
--
-- `installment_months` alone is not enough to build a schedule. Installment 1 falls in the month the
-- structure was created, and `created_at` already exists -- but a structure that was created through a
-- data import may carry a created_at that predates the dues by years, and the officer who typed the
-- amount is the authority on when the parish agreed to start paying.
--
-- So the anchor is explicit and overridable, defaulting to created_at. `first_installment_month` is a
-- `YYYY-MM` string rather than a date because a schedule is anchored to a month, not a day: "March"
-- is what a treasurer says, and the first installment is charged on the last day of that month.
ALTER TABLE payment_structures
  ADD COLUMN IF NOT EXISTS first_installment_month text NULL;

COMMENT ON COLUMN payment_structures.first_installment_month IS
  'YYYY-MM that installment 1 falls in. NULL means use created_at. Set it when a structure is created after the dues were agreed.';

ALTER TABLE payment_structures
  DROP CONSTRAINT IF EXISTS payment_structures_first_installment_month_check;

ALTER TABLE payment_structures
  ADD CONSTRAINT payment_structures_first_installment_month_check
  CHECK (first_installment_month IS NULL OR first_installment_month ~ '^\d{4}-\d{2}$');

-- The ledger shows "is this structure still open?" and the treasurer's dashboard needs the same thing
-- per structure. Existing partial indexes cover active rows only; this one is on the name so the
-- structure picker and the ledger block are both a single ordered scan.
CREATE INDEX IF NOT EXISTS payment_structures_name_idx
  ON payment_structures (name);

CREATE INDEX IF NOT EXISTS payment_structures_active_idx
  ON payment_structures (is_active, name);

-- ======================================================================================
-- 4. Overdue needs to know who is in scope, per structure
-- ======================================================================================
--
-- The overdue list is "for this structure, everybody who should be paying it has not". That is a join
-- between a structure's scope and the member roll, repeated for every structure on the page. Without
-- the index below Postgres decides whether to scan members and filter by batch, or scan the structure
-- and filter by batch, once per structure.
CREATE INDEX IF NOT EXISTS members_batch_active_idx
  ON members (batch, is_active);

-- ======================================================================================
-- 5. Recording a payment: who did it
-- ======================================================================================
--
-- `created_by` defaults to the literal string 'treasurer' and has only ever held a role. The ledger
-- and the receipt both want the person when an identity was declared, for the same reason the liturgy
-- planner wants it: a parish where three people share the treasurer role still needs to know which of
-- them keyed it in.
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS recorded_by_member_id uuid NULL REFERENCES members (id) ON DELETE SET NULL;

-- ======================================================================================
-- 6. Note on the applied-migration policy
-- ======================================================================================
--
-- RLS stays on. payments and payment_structures already had it enabled in 026; nothing here opens a
-- policy, and the API reads and writes them with the service-role key the rest of the app uses.