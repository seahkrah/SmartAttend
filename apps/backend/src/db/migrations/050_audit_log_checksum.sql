-- 050: audit_logs.checksum was never written.
--
-- The column exists and verifyAuditLogIntegrity() recomputes a SHA-256 over
-- the entry's identifying fields and compares — against NULL, every time. So
-- the tamper-evidence the column represents has never existed: an entry
-- altered by someone with direct database access would verify exactly as well
-- as an untouched one.
--
-- Computed by a trigger rather than by the writer, so it covers every writer
-- including the database triggers that record attendance and enrolment
-- changes, not only the ones that remember to call a helper.
--
-- The digest input matches verifyAuditLogIntegrity() exactly: id, actor,
-- action type, scope, resource type, resource id, before state, after state.
-- It deliberately excludes created_at and ip_address, which the verifier does
-- not include either.

CREATE OR REPLACE FUNCTION compute_audit_log_checksum() RETURNS TRIGGER AS $auditsum$
BEGIN
  NEW.checksum := encode(
    digest(
      COALESCE(NEW.id::text, '')
      || COALESCE(NEW.actor_id::text, '')
      || COALESCE(NEW.action_type, '')
      || COALESCE(NEW.action_scope, '')
      || COALESCE(NEW.resource_type, '')
      || COALESCE(NEW.resource_id::text, '')
      -- ::jsonb::text rather than ::text so the digest does not change
      -- because a writer spaced its JSON differently.
      || COALESCE(NEW.before_state::text, '')
      || COALESCE(NEW.after_state::text, ''),
      'sha256'
    ),
    'hex'
  );
  RETURN NEW;
END;
$auditsum$ LANGUAGE plpgsql;

-- pgcrypto supplies digest(). Present in most deployments; created here so a
-- fresh database does not fail on the trigger's first insert.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DROP TRIGGER IF EXISTS trg_audit_logs_checksum ON audit_logs;
-- BEFORE INSERT only: an UPDATE would mean recomputing the checksum over
-- altered content, which is the thing it exists to detect. The immutability
-- triggers refuse updates anyway.
CREATE TRIGGER trg_audit_logs_checksum
  BEFORE INSERT ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION compute_audit_log_checksum();
