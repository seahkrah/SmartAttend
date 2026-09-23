-- 047: tenant lifecycle states for the control plane.
--
-- tenants.status was free text with no constraint, and school_entities
-- carried a lifecycle_state that nothing set. The control plane needs one
-- answer to "is this tenant live", so this pins the vocabulary and makes the
-- two agree.
--
-- The states, and what each one means operationally:
--
--   active      normal. Its users can sign in and its data is reachable.
--   suspended   temporarily stopped — unpaid invoice, a security incident,
--               an investigation. Data is intact and it can be reactivated.
--   archived    finished. Kept for the record and for whatever retention
--               obligation applies; not expected to come back.
--
-- Deliberately no 'deleted'. A tenant with data in it is never removed by a
-- status change; see the delete route, which refuses.

-- Existing rows predate the vocabulary, so anything unrecognised becomes
-- active if the tenant is flagged active and suspended otherwise. Done before
-- the constraint so the constraint can be trusted afterwards.
UPDATE tenants
   SET status = CASE WHEN is_active THEN 'active' ELSE 'suspended' END
 WHERE status IS NULL OR status NOT IN ('active', 'suspended', 'archived');

ALTER TABLE tenants ALTER COLUMN status SET DEFAULT 'active';
ALTER TABLE tenants ALTER COLUMN status SET NOT NULL;

ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_status_check;
ALTER TABLE tenants ADD CONSTRAINT tenants_status_check
  CHECK (status IN ('active', 'suspended', 'archived'));

-- is_active and status said the same thing in two places and could disagree.
-- One is now derived from the other, so they cannot.
CREATE OR REPLACE FUNCTION sync_tenant_active_flag() RETURNS TRIGGER AS $tenantactive$
BEGIN
  NEW.is_active := (NEW.status = 'active');
  NEW.updated_at := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$tenantactive$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tenants_sync_active ON tenants;
CREATE TRIGGER trg_tenants_sync_active
  BEFORE INSERT OR UPDATE OF status ON tenants
  FOR EACH ROW EXECUTE FUNCTION sync_tenant_active_flag();

UPDATE tenants SET status = status;

-- The same vocabulary on the school side, which had lifecycle_state as free
-- text that nothing ever wrote.
UPDATE school_entities
   SET lifecycle_state = CASE WHEN is_active THEN 'active' ELSE 'suspended' END
 WHERE lifecycle_state IS NULL
    OR lifecycle_state NOT IN ('active', 'suspended', 'archived');

ALTER TABLE school_entities ALTER COLUMN lifecycle_state SET DEFAULT 'active';
ALTER TABLE school_entities DROP CONSTRAINT IF EXISTS school_entities_lifecycle_check;
ALTER TABLE school_entities ADD CONSTRAINT school_entities_lifecycle_check
  CHECK (lifecycle_state IS NULL OR lifecycle_state IN ('active', 'suspended', 'archived'));

-- tenant_lifecycle_audit records who moved a tenant and why. It had no index
-- for the only question anyone asks of it.
CREATE INDEX IF NOT EXISTS idx_tenant_lifecycle_audit_tenant
  ON tenant_lifecycle_audit (tenant_id, timestamp DESC);

-- The control plane's own action log, read on every superadmin page.
CREATE INDEX IF NOT EXISTS idx_superadmin_action_logs_recent
  ON superadmin_action_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_superadmin_audit_log_recent
  ON superadmin_audit_log (created_at DESC);
