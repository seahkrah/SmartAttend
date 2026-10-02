-- Phase 2: accounts, memberships and credentials under row-level security
-- (findings #17; docs/security/threat-models/phase-2-identity-and-sessions.md).
--
-- Migration 069 put every table with a tenant_id under RLS. Accounts have no
-- tenant_id: a person can belong to several schools or companies. So the
-- runtime role could read every account on the platform, password hashes
-- included, from any tenant's context. Here:
--
--   * Membership, approval and entity tables, whose tenant column has another
--     name, get the tenant policy on that column.
--   * An account is visible to the runtime role when it is the caller's own,
--     belongs to a member of the tenant in force, or was created in it.
--   * Credential tables keyed by account (sessions, links, two-factor) follow
--     the account: visible only for accounts the caller may see.
--   * The runtime role cannot read password_hash at all. Passwords are
--     checked by the sign-in code on the system pool.
--   * Failed sign-ins, keyed by address rather than account, are system-only.
--
-- Sign-in, refresh and the other steps before a tenant is known run on the
-- system pool (src/auth/*), which these policies do not filter.

CREATE OR REPLACE FUNCTION app_current_user() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE AS
$$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;

-- ── Tenant policy on tables whose tenant column is not called tenant_id ─────
CREATE OR REPLACE FUNCTION app_apply_scoped_rls(tbl regclass, using_expr text) RETURNS void
  LANGUAGE plpgsql AS
$$
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', tbl);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', tbl);
  EXECUTE format('DROP POLICY IF EXISTS identity_scope ON %s', tbl);
  EXECUTE format('CREATE POLICY identity_scope ON %s USING (%s) WITH CHECK (%s)', tbl, using_expr, using_expr);
END
$$;

SELECT app_apply_scoped_rls('school_user_associations',
  '(SELECT app_is_system()) OR school_entity_id = (SELECT app_current_tenant()) OR user_id = (SELECT app_current_user())');
SELECT app_apply_scoped_rls('corporate_user_associations',
  '(SELECT app_is_system()) OR corporate_entity_id = (SELECT app_current_tenant()) OR user_id = (SELECT app_current_user())');
SELECT app_apply_scoped_rls('school_user_approvals',
  '(SELECT app_is_system()) OR school_entity_id = (SELECT app_current_tenant())');
SELECT app_apply_scoped_rls('corporate_user_approvals',
  '(SELECT app_is_system()) OR corporate_entity_id = (SELECT app_current_tenant())');
SELECT app_apply_scoped_rls('user_registration_requests',
  '(SELECT app_is_system()) OR entity_id = (SELECT app_current_tenant())');
SELECT app_apply_scoped_rls('school_entities',
  '(SELECT app_is_system()) OR id = (SELECT app_current_tenant())');
SELECT app_apply_scoped_rls('corporate_entities',
  '(SELECT app_is_system()) OR id = (SELECT app_current_tenant())');

-- ── Accounts ────────────────────────────────────────────────────────────────
-- The tenant an account was created in. It stays visible there, so a new
-- account is readable (INSERT … RETURNING) before its membership row exists.
ALTER TABLE users ADD COLUMN IF NOT EXISTS created_tenant_id uuid;
ALTER TABLE users ALTER COLUMN created_tenant_id SET DEFAULT app_current_tenant();

-- Whether the runtime role may see this account in the context in force.
-- SECURITY INVOKER (the default): the membership tables it reads are
-- themselves under the tenant policy above.
CREATE OR REPLACE FUNCTION app_user_visible(uid uuid) RETURNS boolean
  LANGUAGE sql STABLE AS
$$
  SELECT uid IS NOT NULL AND (
       uid = app_current_user()
    OR EXISTS (SELECT 1 FROM school_user_associations a
                WHERE a.user_id = uid AND a.school_entity_id = app_current_tenant())
    OR EXISTS (SELECT 1 FROM corporate_user_associations a
                WHERE a.user_id = uid AND a.corporate_entity_id = app_current_tenant())
    OR EXISTS (SELECT 1 FROM school_entities e WHERE e.id = app_current_tenant() AND e.admin_user_id = uid)
    OR EXISTS (SELECT 1 FROM corporate_entities e WHERE e.id = app_current_tenant() AND e.admin_user_id = uid)
    -- Someone who asked to join, so the administrators deciding can see them.
    OR EXISTS (SELECT 1 FROM school_user_approvals a
                WHERE a.user_id = uid AND a.school_entity_id = app_current_tenant())
    OR EXISTS (SELECT 1 FROM corporate_user_approvals a
                WHERE a.user_id = uid AND a.corporate_entity_id = app_current_tenant()))
$$;

SELECT app_apply_scoped_rls('users',
  '(SELECT app_is_system()) OR created_tenant_id = (SELECT app_current_tenant()) OR app_user_visible(id)');

-- ── Credentials and per-account state follow the account ───────────────────
SELECT app_apply_scoped_rls(t::regclass, '(SELECT app_is_system()) OR app_user_visible(user_id)')
  FROM unnest(ARRAY[
    'auth_sessions', 'auth_tokens', 'user_mfa', 'user_mfa_recovery_codes',
    'mfa_login_challenges', 'mfa_challenges', 'ip_allowlist', 'session_security_flags'
  ]) AS t;

-- ── Who opened a break-glass grant, as the tenant sees it ───────────────────
-- A superadmin's account is not a member of the tenant, so the tenant can no
-- longer read it. The grant keeps the name and email it was opened under;
-- the grant is immutable, so the record stays what the tenant was shown.
ALTER TABLE break_glass_grants ADD COLUMN IF NOT EXISTS superadmin_name text;
ALTER TABLE break_glass_grants ADD COLUMN IF NOT EXISTS superadmin_email text;
CREATE OR REPLACE FUNCTION break_glass_grant_immutable() RETURNS TRIGGER AS $bg$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.superadmin_id IS DISTINCT FROM OLD.superadmin_id
     OR NEW.superadmin_name IS DISTINCT FROM OLD.superadmin_name
     OR NEW.superadmin_email IS DISTINCT FROM OLD.superadmin_email
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

-- ── Privileges ──────────────────────────────────────────────────────────────
DO $$
DECLARE
  cols text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jjelotech_app') THEN
    -- Every column of users but the password hash. A new column added later
    -- is not readable until a migration grants it.
    SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) INTO cols
      FROM pg_attribute
     WHERE attrelid = 'users'::regclass AND attnum > 0 AND NOT attisdropped AND attname <> 'password_hash';
    REVOKE SELECT ON users FROM jjelotech_app;
    EXECUTE format('GRANT SELECT (%s) ON users TO jjelotech_app', cols);

    -- Keyed by address, consulted only by sign-in on the system pool.
    REVOKE ALL ON auth_failed_logins FROM jjelotech_app;
  END IF;
END
$$;
