-- 049: two columns for one fact, and an entity that could be deleted without
-- its tenant.
--
-- Both found by the control-plane suite, and both the same shape of problem:
-- a fact kept in two places with nothing keeping them in step.
--
-- 1. school_entities has BOTH status and lifecycle_state. The sync trigger
--    that maintains the tenants row reads status; the control plane wrote
--    lifecycle_state. So suspending a school updated lifecycle_state, the
--    trigger then copied the stale status back over tenants.status, and the
--    suspension silently undid itself. The endpoint returned 200 the whole
--    time.
--
--    Rather than pick one and rewrite every caller, a trigger now keeps them
--    equal whichever is written. Writing either is correct, which is the
--    only version of this that stays correct.
--
-- 2. Deleting an entity left its tenants row behind, because tenants.id has
--    no foreign key to the entity tables — the relationship is maintained by
--    the sync triggers in one direction only. A deleted school therefore
--    stayed visible in every tenant listing.

-- ---------------------------------------------------------------------------
-- 1. status and lifecycle_state cannot disagree
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION sync_school_entity_state() RETURNS TRIGGER AS $schoolstate$
BEGIN
  -- Whichever column the caller changed wins; when both changed, status does,
  -- because that is what the tenant sync trigger reads.
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.lifecycle_state := NEW.status;
  ELSIF TG_OP = 'UPDATE' AND NEW.lifecycle_state IS DISTINCT FROM OLD.lifecycle_state THEN
    NEW.status := NEW.lifecycle_state;
  ELSIF TG_OP = 'INSERT' THEN
    NEW.status := COALESCE(NEW.status, NEW.lifecycle_state, 'active');
    NEW.lifecycle_state := NEW.status;
  END IF;

  NEW.is_active := (NEW.status = 'active');
  RETURN NEW;
END;
$schoolstate$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_school_entity_state ON school_entities;
-- Ordered before the tenant sync trigger by name, so the tenant row is
-- written from values that already agree.
CREATE TRIGGER trg_school_entity_state
  BEFORE INSERT OR UPDATE ON school_entities
  FOR EACH ROW EXECUTE FUNCTION sync_school_entity_state();

UPDATE school_entities
   SET status = COALESCE(
         NULLIF(status, ''),
         NULLIF(lifecycle_state, ''),
         CASE WHEN is_active THEN 'active' ELSE 'suspended' END)
 WHERE status IS DISTINCT FROM lifecycle_state OR status IS NULL;

ALTER TABLE school_entities DROP CONSTRAINT IF EXISTS school_entities_status_check;
ALTER TABLE school_entities ADD CONSTRAINT school_entities_status_check
  CHECK (status IS NULL OR status IN ('active', 'suspended', 'archived'));

-- The corporate side has only status, so it needs the is_active half only.
CREATE OR REPLACE FUNCTION sync_corporate_entity_state() RETURNS TRIGGER AS $corpstate$
BEGIN
  NEW.status := COALESCE(NEW.status, 'active');
  NEW.is_active := (NEW.status = 'active');
  RETURN NEW;
END;
$corpstate$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_corporate_entity_state ON corporate_entities;
CREATE TRIGGER trg_corporate_entity_state
  BEFORE INSERT OR UPDATE ON corporate_entities
  FOR EACH ROW EXECUTE FUNCTION sync_corporate_entity_state();

UPDATE corporate_entities
   SET status = COALESCE(NULLIF(status, ''),
                         CASE WHEN is_active THEN 'active' ELSE 'suspended' END)
 WHERE status IS NULL OR status NOT IN ('active', 'suspended', 'archived');

ALTER TABLE corporate_entities DROP CONSTRAINT IF EXISTS corporate_entities_status_check;
ALTER TABLE corporate_entities ADD CONSTRAINT corporate_entities_status_check
  CHECK (status IS NULL OR status IN ('active', 'suspended', 'archived'));

-- ---------------------------------------------------------------------------
-- 2. deleting an entity removes its tenant
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION drop_tenant_with_entity() RETURNS TRIGGER AS $droptenant$
BEGIN
  DELETE FROM tenants WHERE id = OLD.id;
  RETURN OLD;
END;
$droptenant$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_school_entity_drop_tenant ON school_entities;
CREATE TRIGGER trg_school_entity_drop_tenant
  AFTER DELETE ON school_entities
  FOR EACH ROW EXECUTE FUNCTION drop_tenant_with_entity();

DROP TRIGGER IF EXISTS trg_corporate_entity_drop_tenant ON corporate_entities;
CREATE TRIGGER trg_corporate_entity_drop_tenant
  AFTER DELETE ON corporate_entities
  FOR EACH ROW EXECUTE FUNCTION drop_tenant_with_entity();

-- Tenants whose entity has already gone. Anything referencing them would
-- have blocked the original delete, so there is nothing to preserve.
DELETE FROM tenants t
 WHERE (t.kind = 'school'
        AND NOT EXISTS (SELECT 1 FROM school_entities e WHERE e.id = t.id))
    OR (t.kind = 'corporate'
        AND NOT EXISTS (SELECT 1 FROM corporate_entities e WHERE e.id = t.id));
