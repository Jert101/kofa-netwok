ALTER TABLE payments
ADD COLUMN voided boolean NOT NULL DEFAULT false;

CREATE INDEX idx_payments_voided ON payments(voided);
