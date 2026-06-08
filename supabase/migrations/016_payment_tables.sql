CREATE TABLE payment_structures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  amount NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  deadline DATE,
  installment_months INTEGER CHECK (installment_months IS NULL OR installment_months > 0),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  payment_structure_id UUID NOT NULL REFERENCES payment_structures(id) ON DELETE RESTRICT,
  amount_paid NUMERIC(10,2) NOT NULL CHECK (amount_paid > 0),
  paid_at DATE DEFAULT CURRENT_DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by TEXT NOT NULL DEFAULT 'treasurer'
);

CREATE INDEX idx_payments_member_id ON payments(member_id);
CREATE INDEX idx_payments_structure_id ON payments(payment_structure_id);
