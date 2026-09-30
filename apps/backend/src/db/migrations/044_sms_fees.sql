-- 044: SMS fees, invoices and payments.
--
-- Money is the part of a school system that people check. A mark can be
-- argued about; a balance is either right or it is not, and a student turned
-- away from an examination hall over a fee they paid is a problem no amount
-- of caveats fixes. So the shape here is chosen for auditability first:
--
--   1. An invoice line is a COPY of a fee item, not a reference to one.
--      Raising next year's tuition must not silently rewrite last year's
--      invoices. The fee structure is a template; the invoice is the
--      contract, and the contract is frozen at issue.
--
--   2. Nothing derived is stored. The invoice holds the amounts it committed
--      to — subtotal, discount, total — because those ARE the commitment.
--      Amount paid and balance are computed from the payments, every time.
--      A stored balance is a balance that drifts.
--
--   3. Payments are facts. A payment is never deleted and its amount is
--      never edited; a mistake is corrected by reversing it, which leaves
--      both the error and the correction on the record.
--
--   4. Status is only what cannot be derived: draft, issued, void. Whether
--      something is paid, part paid, overpaid or overdue follows from the
--      payments and the due date, so it is a view, not a column somebody has
--      to remember to update.
--
-- Every amount is NUMERIC(12,2). Floating point has no place here.

-- ---------------------------------------------------------------------------
-- Fee structures — the template
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS fee_structures (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  code              VARCHAR(50) NOT NULL,
  name              VARCHAR(255) NOT NULL,
  description       TEXT,
  academic_year_id  UUID REFERENCES academic_years(id) ON DELETE RESTRICT,
  -- Narrowed to a programme and/or a year of study, or left open to apply to
  -- anyone the registry chooses to invoice from it.
  programme_id      UUID REFERENCES programmes(id) ON DELETE RESTRICT,
  study_year        INTEGER,
  currency          CHAR(3) NOT NULL DEFAULT 'USD',
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fee_structures_study_year
    CHECK (study_year IS NULL OR (study_year >= 1 AND study_year <= 10))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_fee_structures_tenant_code
  ON fee_structures (tenant_id, UPPER(code));

CREATE INDEX IF NOT EXISTS idx_fee_structures_tenant
  ON fee_structures (tenant_id, is_active);

-- ---------------------------------------------------------------------------
-- Fee items — the lines of the template
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS fee_items (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  structure_id  UUID NOT NULL REFERENCES fee_structures(id) ON DELETE CASCADE,
  code          VARCHAR(50) NOT NULL,
  name          VARCHAR(255) NOT NULL,
  category      VARCHAR(50) NOT NULL DEFAULT 'tuition',
  amount        NUMERIC(12,2) NOT NULL,
  -- An optional item is offered but not automatically charged: a hostel
  -- place, a field trip, a lab kit the student may already own.
  is_mandatory  BOOLEAN NOT NULL DEFAULT TRUE,
  sequence      INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fee_items_amount CHECK (amount >= 0),
  CONSTRAINT fee_items_category CHECK (category IN (
    'tuition', 'accommodation', 'examination', 'library', 'technology',
    'laboratory', 'registration', 'transport', 'insurance', 'other'
  ))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_fee_items_structure_code
  ON fee_items (structure_id, UPPER(code));

CREATE INDEX IF NOT EXISTS idx_fee_items_tenant ON fee_items (tenant_id);
CREATE INDEX IF NOT EXISTS idx_fee_items_structure ON fee_items (structure_id, sequence);

-- ---------------------------------------------------------------------------
-- Invoices — the contract
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS invoices (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  student_id        UUID NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  -- Kept for provenance: which template this was raised from. Not read when
  -- computing anything, because the lines are the invoice.
  structure_id      UUID REFERENCES fee_structures(id) ON DELETE SET NULL,
  academic_year_id  UUID REFERENCES academic_years(id) ON DELETE RESTRICT,
  semester_id       UUID REFERENCES semesters(id) ON DELETE RESTRICT,
  number            VARCHAR(30) NOT NULL,
  status            VARCHAR(20) NOT NULL DEFAULT 'draft',
  currency          CHAR(3) NOT NULL DEFAULT 'USD',
  -- Frozen at issue. These are what the school committed to charging.
  subtotal          NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount_total    NUMERIC(12,2) NOT NULL DEFAULT 0,
  total             NUMERIC(12,2) NOT NULL DEFAULT 0,
  due_date          DATE,
  note              TEXT,
  issued_at         TIMESTAMPTZ,
  issued_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  voided_at         TIMESTAMPTZ,
  voided_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  void_reason       TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT invoices_status CHECK (status IN ('draft', 'issued', 'void')),
  CONSTRAINT invoices_amounts CHECK (subtotal >= 0 AND discount_total >= 0 AND total >= 0),
  -- The total is the arithmetic, not a free-standing number somebody typed.
  CONSTRAINT invoices_total_is_arithmetic CHECK (total = subtotal - discount_total),
  -- A discount cannot exceed what is being discounted.
  CONSTRAINT invoices_discount_bound CHECK (discount_total <= subtotal),
  -- An issued invoice records when it was issued; a draft has not been.
  CONSTRAINT invoices_issued_has_time
    CHECK (status = 'draft' OR issued_at IS NOT NULL),
  CONSTRAINT invoices_void_has_reason
    CHECK (status <> 'void' OR (voided_at IS NOT NULL AND void_reason IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_tenant_number
  ON invoices (tenant_id, UPPER(number));

CREATE INDEX IF NOT EXISTS idx_invoices_tenant ON invoices (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_invoices_student ON invoices (student_id, status);
CREATE INDEX IF NOT EXISTS idx_invoices_due ON invoices (tenant_id, due_date)
  WHERE status = 'issued';

-- ---------------------------------------------------------------------------
-- Invoice lines — copies, not references
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS invoice_lines (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  invoice_id   UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  -- Provenance only. The fee item may be renamed, repriced or deleted; the
  -- line keeps its own code, description and amount, which is the point.
  fee_item_id  UUID REFERENCES fee_items(id) ON DELETE SET NULL,
  line_type    VARCHAR(10) NOT NULL DEFAULT 'charge',
  code         VARCHAR(50) NOT NULL,
  description  VARCHAR(255) NOT NULL,
  category     VARCHAR(50) NOT NULL DEFAULT 'tuition',
  quantity     NUMERIC(10,2) NOT NULL DEFAULT 1,
  unit_amount  NUMERIC(12,2) NOT NULL,
  amount       NUMERIC(12,2) NOT NULL,
  sequence     INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT invoice_lines_type CHECK (line_type IN ('charge', 'discount')),
  -- Amounts stay positive; the sign is carried by the line type, so nobody
  -- has to remember whether a negative discount is a discount or a charge.
  CONSTRAINT invoice_lines_positive
    CHECK (quantity > 0 AND unit_amount >= 0 AND amount >= 0),
  CONSTRAINT invoice_lines_amount_is_arithmetic
    CHECK (amount = ROUND(quantity * unit_amount, 2))
);

CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice ON invoice_lines (invoice_id, sequence);
CREATE INDEX IF NOT EXISTS idx_invoice_lines_tenant ON invoice_lines (tenant_id);

-- An issued invoice is a contract. Its lines stop being editable the moment
-- it is issued; a correction is a credit note or a void and re-issue, not a
-- quiet edit to what the student was told they owed.
CREATE OR REPLACE FUNCTION guard_invoice_line_change() RETURNS TRIGGER AS $invline$
DECLARE
  parent_status TEXT;
  target UUID;
BEGIN
  target := COALESCE(NEW.invoice_id, OLD.invoice_id);
  SELECT status INTO parent_status FROM invoices WHERE id = target;

  -- A cascade from deleting the invoice itself is how a tenant's own data is
  -- removed, and must still work.
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;

  IF parent_status IS NOT NULL AND parent_status <> 'draft' THEN
    RAISE EXCEPTION 'Invoice is % and its lines can no longer be changed', parent_status
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$invline$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_invoice_lines_guard ON invoice_lines;
CREATE TRIGGER trg_invoice_lines_guard
  BEFORE INSERT OR UPDATE OR DELETE ON invoice_lines
  FOR EACH ROW EXECUTE FUNCTION guard_invoice_line_change();

-- The invoice's own committed amounts are equally frozen. Status, due date,
-- note and the void fields may still move; the money may not.
CREATE OR REPLACE FUNCTION guard_invoice_amounts() RETURNS TRIGGER AS $invamt$
BEGIN
  IF OLD.status <> 'draft' AND (
       NEW.subtotal IS DISTINCT FROM OLD.subtotal
    OR NEW.discount_total IS DISTINCT FROM OLD.discount_total
    OR NEW.total IS DISTINCT FROM OLD.total
    OR NEW.student_id IS DISTINCT FROM OLD.student_id
    OR NEW.currency IS DISTINCT FROM OLD.currency
  ) THEN
    RAISE EXCEPTION 'Invoice % is %; its amounts and student cannot be changed',
      OLD.number, OLD.status
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- Tenant ownership is established once, by the server, at creation.
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'An invoice cannot be moved between tenants'
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$invamt$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_invoices_guard_amounts ON invoices;
CREATE TRIGGER trg_invoices_guard_amounts
  BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION guard_invoice_amounts();

-- ---------------------------------------------------------------------------
-- Payments — facts
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS payments (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  invoice_id       UUID NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  student_id       UUID NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  amount           NUMERIC(12,2) NOT NULL,
  currency         CHAR(3) NOT NULL DEFAULT 'USD',
  method           VARCHAR(30) NOT NULL DEFAULT 'cash',
  -- The bank or gateway's own reference. Unique per tenant where present, so
  -- the same deposit slip cannot be posted twice.
  reference        VARCHAR(100),
  paid_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  recorded_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  note             TEXT,
  reversed_at      TIMESTAMPTZ,
  reversed_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  reversal_reason  TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT payments_amount CHECK (amount > 0),
  CONSTRAINT payments_method CHECK (method IN (
    'cash', 'bank_transfer', 'cheque', 'card', 'mobile_money', 'scholarship', 'other'
  )),
  CONSTRAINT payments_reversal_has_reason
    CHECK (reversed_at IS NULL OR reversal_reason IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_tenant_reference
  ON payments (tenant_id, UPPER(reference))
  WHERE reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments (invoice_id)
  WHERE reversed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_payments_student ON payments (student_id, paid_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_tenant ON payments (tenant_id, paid_at DESC);

-- A payment is never edited or deleted. Reversal is an update that fills the
-- reversal fields and touches nothing else; everything else is refused.
CREATE OR REPLACE FUNCTION guard_payment_change() RETURNS TRIGGER AS $paychg$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Deleting the tenant's own data cascades from above; a direct delete of
    -- a payment is refused.
    IF pg_trigger_depth() > 1 THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'Payments are not deleted. Reverse the payment instead.'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW.amount IS DISTINCT FROM OLD.amount
     OR NEW.invoice_id IS DISTINCT FROM OLD.invoice_id
     OR NEW.student_id IS DISTINCT FROM OLD.student_id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.paid_at IS DISTINCT FROM OLD.paid_at THEN
    RAISE EXCEPTION 'A recorded payment cannot be edited. Reverse it and record a correct one.'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF OLD.reversed_at IS NOT NULL AND NEW.reversed_at IS DISTINCT FROM OLD.reversed_at THEN
    RAISE EXCEPTION 'This payment is already reversed'
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$paychg$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payments_guard ON payments;
CREATE TRIGGER trg_payments_guard
  BEFORE UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION guard_payment_change();

-- Money may only be taken against an invoice that is actually owed, in the
-- currency it was raised in, and for the student it was raised for.
CREATE OR REPLACE FUNCTION check_payment_target() RETURNS TRIGGER AS $paytgt$
DECLARE
  inv RECORD;
BEGIN
  SELECT status, currency, student_id, tenant_id INTO inv
    FROM invoices WHERE id = NEW.invoice_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found' USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF inv.tenant_id <> NEW.tenant_id THEN
    RAISE EXCEPTION 'Invoice belongs to another tenant' USING ERRCODE = 'restrict_violation';
  END IF;
  IF inv.status <> 'issued' THEN
    RAISE EXCEPTION 'Invoice is %; payment can only be taken against an issued invoice', inv.status
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF inv.student_id <> NEW.student_id THEN
    RAISE EXCEPTION 'That payment names a different student from the invoice'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF inv.currency <> NEW.currency THEN
    RAISE EXCEPTION 'Payment currency % does not match the invoice currency %',
      NEW.currency, inv.currency
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$paytgt$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payments_check_target ON payments;
CREATE TRIGGER trg_payments_check_target
  BEFORE INSERT ON payments
  FOR EACH ROW EXECUTE FUNCTION check_payment_target();

-- ---------------------------------------------------------------------------
-- Derived views — nothing here is stored
-- ---------------------------------------------------------------------------

DROP VIEW IF EXISTS student_fee_summary;
DROP VIEW IF EXISTS invoice_balances;

CREATE VIEW invoice_balances AS
SELECT
  i.id                AS invoice_id,
  i.tenant_id,
  i.student_id,
  i.number,
  i.status,
  i.currency,
  i.total,
  i.due_date,
  i.issued_at,
  COALESCE(p.paid, 0)                 AS amount_paid,
  i.total - COALESCE(p.paid, 0)       AS balance,
  CASE
    WHEN i.status = 'void'                        THEN 'void'
    WHEN i.status = 'draft'                       THEN 'draft'
    WHEN COALESCE(p.paid, 0) = 0                  THEN 'unpaid'
    WHEN COALESCE(p.paid, 0) < i.total            THEN 'part_paid'
    WHEN COALESCE(p.paid, 0) = i.total            THEN 'paid'
    ELSE 'overpaid'
  END AS settlement,
  -- Overdue is a fact about today, so it is computed on read rather than
  -- stored by a nightly job that may not have run.
  (i.status = 'issued'
     AND i.due_date IS NOT NULL
     AND i.due_date < CURRENT_DATE
     AND COALESCE(p.paid, 0) < i.total) AS is_overdue
FROM invoices i
LEFT JOIN (
  SELECT invoice_id, SUM(amount) AS paid
    FROM payments
   WHERE reversed_at IS NULL
   GROUP BY invoice_id
) p ON p.invoice_id = i.id;

CREATE VIEW student_fee_summary AS
SELECT
  b.tenant_id,
  b.student_id,
  b.currency,
  COUNT(*) FILTER (WHERE b.status = 'issued')::int          AS invoice_count,
  COALESCE(SUM(b.total) FILTER (WHERE b.status = 'issued'), 0)       AS billed,
  COALESCE(SUM(b.amount_paid) FILTER (WHERE b.status = 'issued'), 0) AS paid,
  COALESCE(SUM(b.balance) FILTER (WHERE b.status = 'issued'), 0)     AS balance,
  COUNT(*) FILTER (WHERE b.is_overdue)::int                 AS overdue_count,
  -- What a bursar means by "cleared": nothing issued is still outstanding.
  (COALESCE(SUM(b.balance) FILTER (WHERE b.status = 'issued'), 0) <= 0) AS is_cleared
FROM invoice_balances b
GROUP BY b.tenant_id, b.student_id, b.currency;
