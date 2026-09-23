-- 048: the tenant lifecycle audit could only describe schools.
--
-- tenant_lifecycle_audit.tenant_id referenced school_entities, so suspending
-- a company threw a foreign key violation and the control plane could not
-- move a corporate tenant at all. The table is named for tenants and is used
-- by a control plane that is deliberately platform-agnostic, so it should
-- reference tenants — which both school_entities and corporate_entities sync
-- into through the existing triggers.
--
-- Found by the control-plane e2e suite, which is the first thing that has
-- ever tried to suspend a company.

ALTER TABLE tenant_lifecycle_audit
  DROP CONSTRAINT IF EXISTS tenant_lifecycle_audit_tenant_id_fkey;

-- Any row that no longer resolves to a tenant is from a school that was
-- removed; there is nothing to point it at.
DELETE FROM tenant_lifecycle_audit
 WHERE tenant_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM tenants t WHERE t.id = tenant_lifecycle_audit.tenant_id);

ALTER TABLE tenant_lifecycle_audit
  ADD CONSTRAINT tenant_lifecycle_audit_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- The same question for the session invalidation log, which records one row
-- per account whose sessions were dropped.
ALTER TABLE session_invalidation_log
  DROP CONSTRAINT IF EXISTS session_invalidation_log_tenant_id_fkey;

DELETE FROM session_invalidation_log
 WHERE tenant_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM tenants t WHERE t.id = session_invalidation_log.tenant_id);

ALTER TABLE session_invalidation_log
  ADD CONSTRAINT session_invalidation_log_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
