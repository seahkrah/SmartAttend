-- Row-level security for every table that carries tenant_id.
-- Decision: docs/decisions/2026-10-02-adopt-rls.md
-- Threat model: docs/security/threat-models/phase-1-tenant-isolation.md
--
-- The application sets app.tenant_id on each connection it hands out
-- (src/db/connection.ts). These policies make PostgreSQL enforce the same
-- boundary, so a query that forgets `WHERE tenant_id` sees nothing of
-- another tenant. Idempotent: safe to re-run, and re-running applies the
-- policy to any tenant table added since.

-- ── The tenant in force, and who is exempt ─────────────────────────────────

-- Empty or unset means "no tenant": tenant tables then return no rows.
CREATE OR REPLACE FUNCTION app_current_tenant() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE AS
$$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

-- Members of jjelotech_system (the migration owner and the API's system
-- pool) pass every policy. CASE, not AND, so pg_has_role is never asked
-- about a role that does not exist.
CREATE OR REPLACE FUNCTION app_is_system() RETURNS boolean
  LANGUAGE sql STABLE PARALLEL SAFE AS
$$ SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jjelotech_system')
               THEN pg_has_role(current_user, 'jjelotech_system', 'MEMBER')
               ELSE false END $$;

-- ── Roles ───────────────────────────────────────────────────────────────────
-- jjelotech_app: the API's runtime role. Owns nothing, cannot bypass RLS.
-- jjelotech_system: exempt from the tenant policy; never given to the API's
-- runtime login. A login for the runtime role is created outside migrations
-- (src/scripts/createRuntimeRole.ts), because its password is a secret.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jjelotech_app') THEN
    CREATE ROLE jjelotech_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jjelotech_system') THEN
    CREATE ROLE jjelotech_system NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
  -- The role running migrations owns the tables and acts as the system.
  IF NOT pg_has_role(current_user, 'jjelotech_system', 'MEMBER') THEN
    EXECUTE format('GRANT jjelotech_system TO %I', current_user);
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE WARNING 'Could not create roles jjelotech_app / jjelotech_system (%). RLS will be enabled but not forced. See docs/operations/deployment.md, "Database roles".', SQLERRM;
END
$$;

-- ── Privileges for the runtime role ─────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jjelotech_app') THEN
    GRANT USAGE ON SCHEMA public TO jjelotech_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO jjelotech_app;
    GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO jjelotech_app;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO jjelotech_app;
    -- The ledger is read by the readiness check, written only by migrate.ts.
    REVOKE INSERT, UPDATE, DELETE ON migrations FROM jjelotech_app;
    -- Tables, sequences and functions created by later migrations.
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO jjelotech_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO jjelotech_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO jjelotech_app;
  END IF;
END
$$;

-- ── The policy, on every tenant table ───────────────────────────────────────
-- The functions are wrapped in sub-selects so they are evaluated once per
-- statement (an InitPlan), not once per row, and tenant_id indexes still apply.
-- Rows with a NULL tenant_id (platform-level audit entries) are visible to
-- the system only.
DO $$
DECLARE
  t record;
  forced boolean := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jjelotech_system')
                    AND pg_has_role(current_user, 'jjelotech_system', 'MEMBER');
BEGIN
  FOR t IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
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
  END LOOP;
END
$$;

-- ── Views read with the caller's rights, not the owner's ────────────────────
-- Owned by the table owner, a view would read around RLS for the runtime
-- role. PostgreSQL 15+.
DO $$
DECLARE
  v record;
BEGIN
  FOR v IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'v'
  LOOP
    EXECUTE format('ALTER VIEW %I SET (security_invoker = true)', v.relname);
  END LOOP;
END
$$;

-- ── No SECURITY DEFINER functions over tenant data ──────────────────────────
-- These took a tenant id as an argument and ran as the owner, around RLS.
ALTER FUNCTION get_api_latency_percentiles(uuid, character varying, integer) SECURITY INVOKER;
ALTER FUNCTION get_clock_drift_statistics(uuid, integer) SECURITY INVOKER;
ALTER FUNCTION get_verification_mismatches(uuid, integer, integer) SECURITY INVOKER;
