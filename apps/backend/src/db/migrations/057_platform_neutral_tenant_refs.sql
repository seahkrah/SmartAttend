-- 057: tables that serve both platforms reference tenants, not schools.
--
-- Thirteen tables record things that happen to any tenant (metrics, clock
-- drift, incidents, lock events, configuration, audit of tenant changes) but
-- their tenant_id pointed at school_entities. Every row about an employer
-- therefore failed its foreign key: API latency for corporate requests was
-- never recorded, an incident could not name the employer it affected, and
-- an employer could not be locked or configured through these tables.
--
-- Each constraint is recreated against tenants(id) with the delete behaviour
-- it had. School tenants' ids are their school_entities ids (025), so every
-- existing value already names a tenant; the check below refuses to run if
-- one does not, rather than dropping rows.

DO $$
DECLARE
  spec TEXT[];
  n BIGINT;
  bad TEXT := '';
BEGIN
  FOREACH spec SLICE 1 IN ARRAY ARRAY[
    ['attendance_integrity_flags', 'tenant_id'],
    ['clock_drift_log', 'tenant_id'],
    ['incident_affected_entities', 'tenant_id'],
    ['incidents', 'affected_tenant_id'],
    ['infrastructure_incidents', 'affected_tenant_id'],
    ['metrics_daily_summary', 'tenant_id'],
    ['metrics_hourly_aggregate', 'tenant_id'],
    ['platform_health_status', 'tenant_id'],
    ['platform_metrics', 'tenant_id'],
    ['privilege_escalation_audit', 'tenant_id'],
    ['tenant_change_audit', 'tenant_id'],
    ['tenant_configurations', 'tenant_id'],
    ['tenant_lock_events', 'tenant_id']
  ] LOOP
    IF to_regclass('public.' || spec[1]) IS NULL THEN CONTINUE; END IF;
    EXECUTE format(
      'SELECT COUNT(*) FROM %I x WHERE x.%I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tenants t WHERE t.id = x.%I)',
      spec[1], spec[2], spec[2]) INTO n;
    IF n > 0 THEN bad := bad || format(' %s.%s (%s)', spec[1], spec[2], n); END IF;
  END LOOP;
  IF bad <> '' THEN
    RAISE EXCEPTION 'Migration 057: rows that name no tenant:%', bad;
  END IF;
END $$;

ALTER TABLE attendance_integrity_flags DROP CONSTRAINT IF EXISTS attendance_integrity_flags_tenant_id_fkey;
ALTER TABLE attendance_integrity_flags ADD CONSTRAINT attendance_integrity_flags_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE clock_drift_log DROP CONSTRAINT IF EXISTS clock_drift_log_tenant_id_fkey;
ALTER TABLE clock_drift_log ADD CONSTRAINT clock_drift_log_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE incident_affected_entities DROP CONSTRAINT IF EXISTS incident_affected_entities_tenant_id_fkey;
ALTER TABLE incident_affected_entities ADD CONSTRAINT incident_affected_entities_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE incidents DROP CONSTRAINT IF EXISTS incidents_affected_tenant_id_fkey;
ALTER TABLE incidents ADD CONSTRAINT incidents_affected_tenant_id_fkey
  FOREIGN KEY (affected_tenant_id) REFERENCES tenants(id);

ALTER TABLE infrastructure_incidents DROP CONSTRAINT IF EXISTS infrastructure_incidents_affected_tenant_id_fkey;
ALTER TABLE infrastructure_incidents ADD CONSTRAINT infrastructure_incidents_affected_tenant_id_fkey
  FOREIGN KEY (affected_tenant_id) REFERENCES tenants(id) ON DELETE SET NULL;

ALTER TABLE metrics_daily_summary DROP CONSTRAINT IF EXISTS metrics_daily_summary_tenant_id_fkey;
ALTER TABLE metrics_daily_summary ADD CONSTRAINT metrics_daily_summary_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE metrics_hourly_aggregate DROP CONSTRAINT IF EXISTS metrics_hourly_aggregate_tenant_id_fkey;
ALTER TABLE metrics_hourly_aggregate ADD CONSTRAINT metrics_hourly_aggregate_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE platform_health_status DROP CONSTRAINT IF EXISTS platform_health_status_tenant_id_fkey;
ALTER TABLE platform_health_status ADD CONSTRAINT platform_health_status_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE platform_metrics DROP CONSTRAINT IF EXISTS platform_metrics_tenant_id_fkey;
ALTER TABLE platform_metrics ADD CONSTRAINT platform_metrics_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE privilege_escalation_audit DROP CONSTRAINT IF EXISTS privilege_escalation_audit_tenant_id_fkey;
ALTER TABLE privilege_escalation_audit ADD CONSTRAINT privilege_escalation_audit_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE tenant_change_audit DROP CONSTRAINT IF EXISTS tenant_change_audit_tenant_id_fkey;
ALTER TABLE tenant_change_audit ADD CONSTRAINT tenant_change_audit_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE tenant_configurations DROP CONSTRAINT IF EXISTS tenant_configurations_tenant_id_fkey;
ALTER TABLE tenant_configurations ADD CONSTRAINT tenant_configurations_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE tenant_lock_events DROP CONSTRAINT IF EXISTS tenant_lock_events_tenant_id_fkey;
ALTER TABLE tenant_lock_events ADD CONSTRAINT tenant_lock_events_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
