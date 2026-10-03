-- Correction to 084's guard, found by identityIsolation in the full run.
--
-- 084 treated an account as shared when it counted more than one live
-- membership. That misses an account whose membership in this tenant was
-- removed while it is live in another: the count is one (the other tenant),
-- this tenant can still see the account through its removed membership, and
-- so could still change an account that now lives only elsewhere.
--
-- The rule is now: outside the system pool, an account's role, status and
-- details can be changed only if every live membership it has is in the
-- tenant making the change (live memberships minus this tenant's, if live,
-- must be zero). The person's own details stay theirs to change.
CREATE OR REPLACE FUNCTION guard_shared_account() RETURNS trigger
  LANGUAGE plpgsql AS
$$
DECLARE
  here integer;
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
  -- This tenant's own live membership, read under its row-level security.
  SELECT count(*) INTO here FROM (
    SELECT 1 FROM school_user_associations
     WHERE user_id = OLD.id AND school_entity_id = app_current_tenant() AND status <> 'removed'
    UNION ALL
    SELECT 1 FROM corporate_user_associations
     WHERE user_id = OLD.id AND corporate_entity_id = app_current_tenant() AND status <> 'removed'
  ) live_here;
  IF OLD.membership_count - here > 0 THEN
    RAISE EXCEPTION 'That account also belongs to another organisation'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;
