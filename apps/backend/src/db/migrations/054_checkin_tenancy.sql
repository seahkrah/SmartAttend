-- 054: every check-in belongs to a tenant, and to the right one.
--
-- corporate_checkins.tenant_id was nullable, and the only route that wrote
-- to the table — POST /api/corporate/checkins — never set it. That route also
-- took the employee id from the request body with no ownership check and let
-- the caller assert face verification, so any signed-in identity on either
-- platform could write a "face-verified" check-in against any employee of any
-- tenant. It has been removed; this migration makes the class of row it
-- produced impossible.
--
-- The timesheet engine was never fooled: it filters on tenant_id, so a row
-- without one was never counted. But it was also never SEEN — a legitimate
-- check-in made through that route would have vanished from its owner's
-- timesheet just as completely. A check-in with no tenant is outside
-- isolation in both directions, and the fix is to make one unrepresentable.

-- 1. Attribute the orphans, and do not trust them.
--
-- Each one names an employee, and every employee belongs to exactly one
-- tenant, so the attribution is certain. What is not certain is the row
-- itself: it came through a route that anyone could call for anyone, with a
-- face-verification flag the caller made up. So it is attributed, marked as
-- not face-verified, and FLAGGED — which the timesheet engine reports and does
-- not count. A human decides whether it was real. Silently backfilling it as
-- VERIFIED would turn every forged check-in into paid time.
UPDATE corporate_checkins c
   SET tenant_id = e.tenant_id,
       face_verified = FALSE,
       checkin_state = 'FLAGGED',
       state_reason = 'Recorded without a tenant by a route that did not check who was checking in',
       state_changed_at = CURRENT_TIMESTAMP,
       state_audit_notes = COALESCE(state_audit_notes || E'\n', '')
         || 'Migration 054: attributed to the employee''s tenant and flagged for review'
  FROM employees e
 WHERE c.employee_id = e.id
   AND c.tenant_id IS NULL;

-- 2. No check-in without a tenant, from here on.
ALTER TABLE corporate_checkins ALTER COLUMN tenant_id SET NOT NULL;

-- 3. And never with somebody else's tenant.
--
-- NOT NULL stops a check-in with no tenant; this stops one whose tenant is
-- not its employee's. A route that took the tenant from context and the
-- employee from a request body would pass the first check and fail this one,
-- which is the mistake the removed route made in a different shape.
CREATE OR REPLACE FUNCTION guard_checkin_tenant() RETURNS TRIGGER AS $ckt$
DECLARE
  owner_tenant UUID;
BEGIN
  SELECT tenant_id INTO owner_tenant FROM employees WHERE id = NEW.employee_id;
  IF owner_tenant IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'A check-in must belong to its employee''s tenant'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$ckt$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_corporate_checkins_tenant ON corporate_checkins;
CREATE TRIGGER trg_corporate_checkins_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, employee_id ON corporate_checkins
  FOR EACH ROW EXECUTE FUNCTION guard_checkin_tenant();

-- 4. The lookup the self-service routes make on every request: this
--    employee's check-ins, newest first.
CREATE INDEX IF NOT EXISTS idx_corporate_checkins_employee_time
  ON corporate_checkins (tenant_id, employee_id, check_in_time DESC);
