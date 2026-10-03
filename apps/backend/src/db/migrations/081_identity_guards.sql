-- Phase 2 independent audit fixes (docs/scorecard/audit-phase-2.md, F1, F2).
--
-- F1. Who a tenant can see (app_user_visible, 074) follows its memberships,
-- approvals and entity administrator, and the runtime role may write those
-- rows for its own tenant. So SQL running as the runtime role in tenant B
-- could insert a membership for any account on the platform and then read
-- that account and its sessions and passkeys. A membership, approval or
-- administrator now has to name an account the tenant can already see (one
-- created in it, a member, an applicant). Making another tenant's account a
-- member, which the platform does for a guardian already signing in at
-- another school, is identity code on the system pool
-- (authService.linkExistingAccountToSchool), with the caller deciding who.
CREATE OR REPLACE FUNCTION guard_membership_account() RETURNS trigger
  LANGUAGE plpgsql AS
$$
DECLARE
  uid uuid;
BEGIN
  IF app_is_system() THEN RETURN NEW; END IF;
  -- Separate branches: plpgsql resolves every NEW.field an expression names,
  -- so one CASE over both columns fails on the table that lacks one.
  IF TG_TABLE_NAME IN ('school_entities', 'corporate_entities') THEN
    uid := NEW.admin_user_id;
    IF TG_OP = 'UPDATE' AND NEW.admin_user_id IS NOT DISTINCT FROM OLD.admin_user_id THEN RETURN NEW; END IF;
  ELSE
    uid := NEW.user_id;
    IF TG_OP = 'UPDATE' AND NEW.user_id IS NOT DISTINCT FROM OLD.user_id THEN RETURN NEW; END IF;
  END IF;
  IF uid IS NULL THEN RETURN NEW; END IF;
  -- Read under the runtime role's own row-level security: the account must
  -- already be visible here, before this row exists.
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = uid) THEN
    RAISE EXCEPTION 'That account is not one this organisation can add'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['school_user_associations', 'corporate_user_associations',
                           'school_user_approvals', 'corporate_user_approvals'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_guard_membership_account ON %I', t);
    EXECUTE format('CREATE TRIGGER trg_guard_membership_account BEFORE INSERT OR UPDATE OF user_id ON %I
                    FOR EACH ROW EXECUTE FUNCTION guard_membership_account()', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['school_entities', 'corporate_entities'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_guard_membership_account ON %I', t);
    EXECUTE format('CREATE TRIGGER trg_guard_membership_account BEFORE INSERT OR UPDATE OF admin_user_id ON %I
                    FOR EACH ROW EXECUTE FUNCTION guard_membership_account()', t);
  END LOOP;
END
$$;

-- F2. Sessions are created, rotated and ended only by src/auth/sessions.ts on
-- the system pool. The runtime role reads its tenant's (the device list is
-- also system-pool now) but can no longer write one: before, injected SQL in
-- tenant B could end or alter sessions of anyone B could see.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jjelotech_app') THEN
    REVOKE INSERT, UPDATE, DELETE ON auth_sessions FROM jjelotech_app;
  END IF;
END
$$;
