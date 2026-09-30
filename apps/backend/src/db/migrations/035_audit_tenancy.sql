-- 035: audit logs carry the tenant they describe.
--
-- audit_logs had platform_id and no tenant column. Every school's audit trail
-- therefore sat in one undivided pool, and the access-control layer that was
-- meant to keep a tenant administrator inside their own tenant emitted a
-- predicate on `tenant_id` — a column that did not exist. That query could
-- only fail, which is why the audit API answered 403 or 500 for anyone who was
-- not a superadmin.
--
-- Isolation has to reach the logs too: an audit trail that shows one school
-- what another school did is a leak in the place it is least excusable.
--
-- Backfilling means writing to an immutable table. The immutability triggers
-- are the point of audit_logs and stay; they are suspended for the length of
-- this one backfill and restored immediately, which is a schema migration
-- rather than a tampering path, and it runs inside the migration transaction.

ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE RESTRICT;

ALTER TABLE audit_access_log
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE RESTRICT;

-- Existing rows get the tenant of the user they name, where that user belongs
-- to exactly one. A row whose subject spans none or several is left NULL
-- rather than guessed at, and reads as a platform-level event.
DO $backfill$
BEGIN
  ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_immutable_prevent_updates;
  ALTER TABLE audit_logs DISABLE TRIGGER prevent_audit_logs_update_trigger;

  UPDATE audit_logs a
     SET tenant_id = m.tenant_id
    FROM (
      SELECT user_id, (ARRAY_AGG(DISTINCT tenant_id))[1] AS tenant_id
        FROM user_tenant_memberships
       GROUP BY user_id
      HAVING COUNT(DISTINCT tenant_id) = 1
    ) m
   WHERE a.tenant_id IS NULL
     AND m.user_id = COALESCE(a.user_id, a.actor_id);

  ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_immutable_prevent_updates;
  ALTER TABLE audit_logs ENABLE TRIGGER prevent_audit_logs_update_trigger;
END
$backfill$;

UPDATE audit_access_log a
   SET tenant_id = m.tenant_id
  FROM (
    SELECT user_id, (ARRAY_AGG(DISTINCT tenant_id))[1] AS tenant_id
      FROM user_tenant_memberships
     GROUP BY user_id
    HAVING COUNT(DISTINCT tenant_id) = 1
  ) m
 WHERE a.tenant_id IS NULL AND m.user_id = a.actor_id;

CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant ON audit_logs (tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_created ON audit_logs (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_access_log_tenant ON audit_access_log (tenant_id);
