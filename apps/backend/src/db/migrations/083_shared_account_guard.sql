-- Phase 3 independent audit fix (docs/scorecard/audit-phase-3.md, F1).
--
-- An account is one row in `users`, shared by every tenant it belongs to: a
-- parent with children at two schools, a lecturer who teaches at two. Its
-- role, active flag, name, email and phone are the account's, not one
-- tenant's. A school's administrator could change them, and so make a parent
-- of school B a lecturer, or switch them off, in B as well as in A.
--
-- The routes now refuse such an edit, or change only the membership in their
-- own tenant. The checks they had ("belongs to another organisation") read
-- user_tenant_memberships, a security_invoker view under row-level security,
-- so they never saw another tenant's membership and never fired.
--
-- This trigger is the backstop: outside the system pool, an account-wide
-- field of an account that also belongs to another tenant cannot be changed,
-- except by the person themselves for their own name, email and phone.

-- Whether an account the caller can see also belongs to a tenant other than
-- `here`. SECURITY DEFINER (owned by the migration owner, a member of
-- jjelotech_system) so that it sees every tenant's memberships; it answers
-- only for accounts already visible to the caller, so it is no oracle.
CREATE OR REPLACE FUNCTION app_member_elsewhere(uid uuid, here uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$
  SELECT app_user_visible(uid) AND EXISTS (
    SELECT 1 FROM user_tenant_memberships m
     WHERE m.user_id = uid AND m.tenant_id IS DISTINCT FROM here AND m.status <> 'removed')
$$;
REVOKE ALL ON FUNCTION app_member_elsewhere(uuid, uuid) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jjelotech_app') THEN
    GRANT EXECUTE ON FUNCTION app_member_elsewhere(uuid, uuid) TO jjelotech_app;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION guard_shared_account() RETURNS trigger
  LANGUAGE plpgsql AS
$$
BEGIN
  IF app_is_system() THEN RETURN NEW; END IF;
  IF NEW.role_id IS NOT DISTINCT FROM OLD.role_id
     AND NEW.is_active IS NOT DISTINCT FROM OLD.is_active
     AND NEW.platform_id IS NOT DISTINCT FROM OLD.platform_id
     AND NEW.full_name IS NOT DISTINCT FROM OLD.full_name
     AND NEW.email IS NOT DISTINCT FROM OLD.email
     AND NEW.phone IS NOT DISTINCT FROM OLD.phone THEN
    RETURN NEW;
  END IF;
  -- Your own details are yours to change; your own role and status are not.
  IF NEW.id = app_current_user()
     AND NEW.role_id IS NOT DISTINCT FROM OLD.role_id
     AND NEW.is_active IS NOT DISTINCT FROM OLD.is_active
     AND NEW.platform_id IS NOT DISTINCT FROM OLD.platform_id THEN
    RETURN NEW;
  END IF;
  IF app_member_elsewhere(NEW.id, app_current_tenant()) THEN
    RAISE EXCEPTION 'That account also belongs to another organisation'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_guard_shared_account ON users;
CREATE TRIGGER trg_guard_shared_account
  BEFORE UPDATE OF role_id, is_active, platform_id, full_name, email, phone ON users
  FOR EACH ROW EXECUTE FUNCTION guard_shared_account();
