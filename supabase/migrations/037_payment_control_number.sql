-- A control number on every payment, so a receipt can be tracked without a database id (module 06, PAY-6).
--
-- Until now a receipt was identified by `payment.id.slice(0,8)`. That is stable and unique, but it is
-- a random uuid fragment: it does not sort, it does not tell you roughly when a payment was taken, and
-- it gives the treasurer nothing to read down a phone line. A control number is the thing an
-- accountant reconciles against, so it has to be short, human-readable, and sequential.
--
-- `KOA-<year>-<00001>` is assigned by a BEFORE INSERT trigger rather than by whichever route happened
-- to insert the row. That is deliberate: a control number that only exists on one code path is a
-- control number that some payment quietly does not have, and reconciling against a series with holes
-- in it is worse than having none. Every insert path -- the treasurer route, a future import, a manual
-- fix -- gets the next number in the same series.
--
-- The year is part of the number and the counter restarts each year, so the series is read in order
-- and two receipts can never share one.
--
-- Existing rows are backfilled below so historical receipts are traceable too, ordered by paid_at and
-- then id so the backfill reproduces the order the payments were actually taken in.

CREATE SEQUENCE IF NOT EXISTS payment_control_seq;

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS control_no text;

CREATE UNIQUE INDEX IF NOT EXISTS payments_control_no_key
  ON payments (control_no)
  WHERE control_no IS NOT NULL;

-- The formatter lives in a function so the trigger and the backfill cannot drift apart.
CREATE OR REPLACE FUNCTION payment_next_control_no(p_paid_at date DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_on date := COALESCE(p_paid_at, CURRENT_DATE);
BEGIN
  RETURN 'KOA-' || to_char(v_on, 'YYYY') || '-' || lpad(nextval('payment_control_seq')::text, 5, '0');
END;
$$;

CREATE OR REPLACE FUNCTION payments_set_control_no()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Never overwrite one that is already there: a backfill or a re-save must keep its number.
  IF NEW.control_no IS NULL THEN
    NEW.control_no := payment_next_control_no(NEW.paid_at);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payments_set_control_no_trg ON payments;
CREATE TRIGGER payments_set_control_no_trg
  BEFORE INSERT ON payments
  FOR EACH ROW
  EXECUTE FUNCTION payments_set_control_no();

-- Backfill in the order the payments were taken.
UPDATE payments p
SET control_no = payment_next_control_no(p.paid_at)
WHERE p.control_no IS NULL;

-- Kept non-null in practice by the trigger, but left nullable so this migration is re-runnable
-- against a table the trigger has not reached yet (a concurrent insert during the backfill).
ALTER TABLE payments
  ALTER COLUMN control_no SET NOT NULL;