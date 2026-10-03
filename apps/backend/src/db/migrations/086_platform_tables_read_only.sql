-- Tenant isolation stall (docs/scorecard/stall-tenant-isolation.md).
--
-- Every tenant table is under forced row-level security, and the fuzz and
-- the RLS suites keep proving it. The platform's shared tables, which belong
-- to no tenant, were never decided the same way. The runtime role could
-- INSERT, UPDATE and DELETE fifteen of them, none under any policy: tenants,
-- roles, platforms, the role permission matrix, thresholds, health and
-- statistics tables. SQL injected in any tenant's request could rename
-- another school, change what a role may do in every tenant, or delete a
-- platform. The application writes these only on the system pool, or not at
-- all after the migrations that seed them.
DO $$
DECLARE
  t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jjelotech_app') THEN RETURN; END IF;
  FOREACH t IN ARRAY ARRAY[
    'alert_rules', 'attendance_idempotency_keys', 'attendance_reason_codes', 'error_classifications',
    'error_fingerprints', 'incident_statistics', 'platforms', 'role_permissions_matrix', 'roles',
    'service_health_checks', 'superadmin_statistics', 'system_audit_log', 'system_health',
    'system_metrics', 'time_drift_thresholds'] LOOP
    IF to_regclass(t) IS NOT NULL THEN
      EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON %I FROM jjelotech_app', t);
    END IF;
  END LOOP;
END
$$;

-- tenants is written by triggers on school_entities and corporate_entities,
-- which run as the caller: a school's administrator changing the school's
-- settings updates its tenants row. So the runtime role keeps the privilege,
-- under a policy: anyone may read the tenant list (names and codes); a
-- tenant may write only its own row; creating and deleting tenants is the
-- control plane's (the system pool). INSERT's check allows the tenant's own
-- id because the sync trigger writes through INSERT ... ON CONFLICT DO
-- UPDATE, which checks the INSERT policy too.
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenants_read ON tenants;
DROP POLICY IF EXISTS tenants_own_insert ON tenants;
DROP POLICY IF EXISTS tenants_own_update ON tenants;
DROP POLICY IF EXISTS tenants_system_delete ON tenants;
CREATE POLICY tenants_read ON tenants FOR SELECT USING (true);
CREATE POLICY tenants_own_insert ON tenants FOR INSERT
  WITH CHECK (app_is_system() OR id = app_current_tenant());
CREATE POLICY tenants_own_update ON tenants FOR UPDATE
  USING (app_is_system() OR id = app_current_tenant())
  WITH CHECK (app_is_system() OR id = app_current_tenant());
CREATE POLICY tenants_system_delete ON tenants FOR DELETE USING (app_is_system());
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jjelotech_app') THEN
    REVOKE TRUNCATE ON tenants FROM jjelotech_app;
  END IF;
END
$$;
