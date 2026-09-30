-- 045: two corrections to the fee guards from 044, both found by the tests.
--
-- 1. A draft invoice could not be voided.
--
--    invoices_issued_has_time read "status = 'draft' OR issued_at IS NOT NULL",
--    which is right about an issued invoice and wrong about a voided draft.
--    A draft raised in error and voided before it was ever sent has no
--    issued_at, and should not be made to invent one. The rule that was
--    actually meant is about the issued status specifically.
--
-- 2. Deleting a fee item was refused once it had appeared on an issued
--    invoice.
--
--    invoice_lines.fee_item_id is ON DELETE SET NULL, so the delete fires an
--    UPDATE on the line, and the guard — which exists to stop anyone editing
--    what a student was billed — blocked it. But fee_item_id is provenance,
--    not money: nulling it is the decoupling that makes an invoice line a
--    copy rather than a reference, and it changes nothing about the amount.
--    The guard now lets a cascade clear that one column and refuses
--    everything else exactly as before.

ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_issued_has_time;
ALTER TABLE invoices ADD CONSTRAINT invoices_issued_has_time
  CHECK (status <> 'issued' OR issued_at IS NOT NULL);

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

  -- A cascade clearing the fee item this line was copied from. The amount,
  -- description and everything else the student was billed stay untouched;
  -- only the pointer back to the template goes. Anything else in the same
  -- update falls through to the check below and is refused.
  IF TG_OP = 'UPDATE'
     AND pg_trigger_depth() > 1
     AND NEW.fee_item_id IS NULL
     AND OLD.fee_item_id IS NOT NULL
     AND NEW.invoice_id IS NOT DISTINCT FROM OLD.invoice_id
     AND NEW.tenant_id IS NOT DISTINCT FROM OLD.tenant_id
     AND NEW.line_type IS NOT DISTINCT FROM OLD.line_type
     AND NEW.code IS NOT DISTINCT FROM OLD.code
     AND NEW.description IS NOT DISTINCT FROM OLD.description
     AND NEW.category IS NOT DISTINCT FROM OLD.category
     AND NEW.quantity IS NOT DISTINCT FROM OLD.quantity
     AND NEW.unit_amount IS NOT DISTINCT FROM OLD.unit_amount
     AND NEW.amount IS NOT DISTINCT FROM OLD.amount THEN
    RETURN NEW;
  END IF;

  IF parent_status IS NOT NULL AND parent_status <> 'draft' THEN
    RAISE EXCEPTION 'Invoice is % and its lines can no longer be changed', parent_status
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$invline$ LANGUAGE plpgsql;
