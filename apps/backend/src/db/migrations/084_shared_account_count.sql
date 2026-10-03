-- Replaces 083's backstop, which needed a SECURITY DEFINER function to see
-- other tenants' memberships. The platform has none on purpose (rlsNoContext
-- refuses any): a definer function reads around row-level security for
-- whoever can call it.
--
-- Instead every account counts its live memberships (school and corporate,
-- any status but 'removed') in users.membership_count. Triggers on the
-- membership tables keep the count. They run BEFORE the change, while the
-- membership row exists, so the tenant making it can see the account, and
-- they need no view of any other tenant. Only those triggers may change the
-- count. An account counting more than one is shared, and outside the system
-- pool its role, status and details cannot be changed, except by the person
-- themselves for their own details (audit phase 3, F1).

DROP TRIGGER IF EXISTS trg_guard_shared_account ON users;
DROP FUNCTION IF EXISTS guard_shared_account();
DROP FUNCTION IF EXISTS app_member_elsewhere(uuid, uuid);

ALTER TABLE users ADD COLUMN IF NOT EXISTS membership_count integer NOT NULL DEFAULT 0;

UPDATE users u
   SET membership_count =
         (SELECT count(*) FROM school_user_associations a WHERE a.user_id = u.id AND a.status <> 'removed')
       + (SELECT count(*) FROM corporate_user_associations a WHERE a.user_id = u.id AND a.status <> 'removed');

CREATE OR REPLACE FUNCTION count_membership() RETURNS trigger
  LANGUAGE plpgsql AS
$$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.status <> 'removed' THEN
    UPDATE users SET membership_count = membership_count - 1 WHERE id = OLD.user_id;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.status <> 'removed' THEN
    UPDATE users SET membership_count = membership_count + 1 WHERE id = NEW.user_id;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['school_user_associations', 'corporate_user_associations'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_count_membership ON %I', t);
    EXECUTE format('CREATE TRIGGER trg_count_membership BEFORE INSERT OR DELETE OR UPDATE OF status, user_id ON %I
                    FOR EACH ROW EXECUTE FUNCTION count_membership()', t);
  END LOOP;
END
$$;

CREATE OR REPLACE FUNCTION guard_shared_account() RETURNS trigger
  LANGUAGE plpgsql AS
$$
BEGIN
  IF app_is_system() THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    -- A new account belongs nowhere until a membership says so.
    NEW.membership_count := 0;
    RETURN NEW;
  END IF;
  -- The count is kept by count_membership alone (a trigger, so depth > 1).
  IF NEW.membership_count IS DISTINCT FROM OLD.membership_count AND pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'membership_count is kept by the database'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
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
  IF OLD.membership_count > 1 THEN
    RAISE EXCEPTION 'That account also belongs to another organisation'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_guard_shared_account ON users;
CREATE TRIGGER trg_guard_shared_account
  BEFORE INSERT OR UPDATE OF role_id, is_active, platform_id, full_name, email, phone, membership_count ON users
  FOR EACH ROW EXECUTE FUNCTION guard_shared_account();

-- The runtime role's privileges on users are per column (074 keeps it from
-- password_hash). count_membership runs as it, so it needs this column; the
-- guard above keeps it from writing the count directly.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jjelotech_app') THEN
    GRANT SELECT (membership_count), UPDATE (membership_count) ON users TO jjelotech_app;
  END IF;
END
$$;
