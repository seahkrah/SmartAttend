-- Break-glass: a superadmin acting inside one tenant's data must say why,
-- for a bounded time, and the tenant can see it.
--
-- Before this, a superadmin's X-Tenant-Id was enough (docs/security/
-- findings.md, finding 12). Now requireTenant demands an open grant for that
-- superadmin and tenant, and records every request made under it.

-- ── Re-applying row-level security ──────────────────────────────────────────
-- Migration 069's loop, as a function, so that this and every later
-- migration adding a tenant table can bring it under the policy in one line.
-- Runs as the migrating role (SECURITY INVOKER).
CREATE OR REPLACE FUNCTION app_apply_tenant_rls() RETURNS integer
  LANGUAGE plpgsql AS
$$
DECLARE
  t record;
  n integer := 0;
  forced boolean := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jjelotech_system')
                    AND pg_has_role(current_user, 'jjelotech_system', 'MEMBER');
BEGIN
  FOR t IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'public' AND c.relkind IN ('r', 'p')
       AND EXISTS (SELECT 1 FROM pg_attribute a
                    WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped)
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t.relname);
    IF forced THEN
      EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t.relname);
    END IF;
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t.relname);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING (tenant_id = (SELECT app_current_tenant()) OR (SELECT app_is_system()))
         WITH CHECK (tenant_id = (SELECT app_current_tenant()) OR (SELECT app_is_system()))',
      t.relname);
    n := n + 1;
  END LOOP;
  RETURN n;
END
$$;

-- ── Grants ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS break_glass_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  superadmin_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMPTZ NOT NULL,
  closed_at TIMESTAMPTZ,
  CONSTRAINT break_glass_reason CHECK (char_length(btrim(reason)) BETWEEN 20 AND 1000),
  -- At most an hour: long enough to investigate, short enough to be an
  -- exception rather than standing access.
  CONSTRAINT break_glass_window CHECK (expires_at > opened_at AND expires_at <= opened_at + INTERVAL '60 minutes'),
  CONSTRAINT break_glass_closed CHECK (closed_at IS NULL OR closed_at >= opened_at)
);

CREATE INDEX IF NOT EXISTS idx_break_glass_active
  ON break_glass_grants (tenant_id, superadmin_id, expires_at) WHERE closed_at IS NULL;

-- A grant's terms never change after it is opened; it may only be closed,
-- once, and not reopened.
CREATE OR REPLACE FUNCTION break_glass_grant_immutable() RETURNS TRIGGER AS $bg$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.superadmin_id IS DISTINCT FROM OLD.superadmin_id
     OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.opened_at IS DISTINCT FROM OLD.opened_at
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
     OR (OLD.closed_at IS NOT NULL AND NEW.closed_at IS DISTINCT FROM OLD.closed_at) THEN
    RAISE EXCEPTION 'A break-glass grant can only be closed, once'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$bg$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_break_glass_grant_immutable ON break_glass_grants;
CREATE TRIGGER trg_break_glass_grant_immutable
  BEFORE UPDATE ON break_glass_grants
  FOR EACH ROW EXECUTE FUNCTION break_glass_grant_immutable();

-- ── What was done under a grant ─────────────────────────────────────────────
-- One row per request: method and path, never the query string or body.
CREATE TABLE IF NOT EXISTS break_glass_access_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  grant_id UUID NOT NULL REFERENCES break_glass_grants(id) ON DELETE CASCADE,
  method VARCHAR(10) NOT NULL,
  path VARCHAR(500) NOT NULL,
  at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_break_glass_access_grant ON break_glass_access_log (tenant_id, grant_id, at);

-- Append-only. Deletion stays possible so a tenant can still be deleted
-- (ON DELETE CASCADE); a rewrite of history is not.
CREATE OR REPLACE FUNCTION break_glass_access_append_only() RETURNS TRIGGER AS $bga$
BEGIN
  RAISE EXCEPTION 'The break-glass access log is append-only'
    USING ERRCODE = 'restrict_violation';
END;
$bga$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_break_glass_access_append_only ON break_glass_access_log;
CREATE TRIGGER trg_break_glass_access_append_only
  BEFORE UPDATE ON break_glass_access_log
  FOR EACH ROW EXECUTE FUNCTION break_glass_access_append_only();

-- The grant and the log belong to the same tenant.
DROP TRIGGER IF EXISTS trg_break_glass_access_same_tenant ON break_glass_access_log;
CREATE TRIGGER trg_break_glass_access_same_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, grant_id ON break_glass_access_log
  FOR EACH ROW EXECUTE FUNCTION guard_same_tenant('grant_id', 'break_glass_grants');

SELECT app_apply_tenant_rls();
