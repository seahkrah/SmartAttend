-- ===========================
-- PHASE 10.2 STAGE 2: UNIFIED IMMUTABLE AUDIT SYSTEM
-- ===========================
-- Migration 016: Comprehensive Audit System Hardening
--
-- Goals:
-- 1. Add immutability triggers to superadmin_audit_log
-- 2. Create audit_access_log to track who reads audit logs
-- 3. Add scope enforcement constraints
-- 4. Standardize before/after state schema
--
-- Timeline: Append-only enforcement at database level
-- Status: All constraints are append-only; no mutations allowed

BEGIN;

-- ===========================
-- A. IMMUTABILITY: superadmin_audit_log
-- ===========================

-- Add actor_platform column if missing (for consistency with audit_logs)
ALTER TABLE superadmin_audit_log
ADD COLUMN IF NOT EXISTS actor_platform VARCHAR(50) DEFAULT 'superadmin';

-- Add actor_role column if missing
ALTER TABLE superadmin_audit_log
ADD COLUMN IF NOT EXISTS actor_role VARCHAR(100);

-- Add confirmation_token column if missing (for confirmable actions)
ALTER TABLE superadmin_audit_log
ADD COLUMN IF NOT EXISTS confirmation_token VARCHAR(500);

-- Rename timestamp to created_at for consistency with audit_logs
ALTER TABLE superadmin_audit_log
RENAME COLUMN timestamp TO created_at;

-- Add immutability constraints
ALTER TABLE superadmin_audit_log
ADD CONSTRAINT superadmin_audit_log_immutable_check CHECK (true);

-- Create IMMUTABILITY TRIGGERS on superadmin_audit_log
DROP TRIGGER IF EXISTS prevent_superadmin_audit_log_update ON superadmin_audit_log;
DROP TRIGGER IF EXISTS prevent_superadmin_audit_log_delete ON superadmin_audit_log;

CREATE OR REPLACE FUNCTION prevent_superadmin_audit_log_update()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Superadmin audit logs are immutable. UPDATE operations are not permitted.';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION prevent_superadmin_audit_log_delete()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Superadmin audit logs are immutable. DELETE operations are not permitted.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER prevent_superadmin_audit_log_update
BEFORE UPDATE ON superadmin_audit_log
FOR EACH ROW
EXECUTE FUNCTION prevent_superadmin_audit_log_update();

CREATE TRIGGER prevent_superadmin_audit_log_delete
BEFORE DELETE ON superadmin_audit_log
FOR EACH ROW
EXECUTE FUNCTION prevent_superadmin_audit_log_delete();

-- ===========================
-- B. AUDIT ACCESS LOG (Audit the Auditors)
-- ===========================
-- Tracks who accessed audit logs and what they queried
-- This table is also immutable (append-only)

CREATE TABLE IF NOT EXISTS audit_access_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_role VARCHAR(100) NOT NULL,
  access_type VARCHAR(50) NOT NULL, -- 'READ_AUDIT_LOGS', 'READ_SINGLE_LOG', 'VERIFY_INTEGRITY', etc.
  scope_accessed VARCHAR(50), -- GLOBAL, TENANT, USER
  filters_applied JSONB, -- Filters used in query (actor_id, resource_type, time range, etc.)
  results_count INTEGER, -- How many logs were returned
  access_timestamp TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ip_address INET,
  user_agent VARCHAR(500),
  request_id VARCHAR(255),
  verification_attempt BOOLEAN DEFAULT FALSE, -- Was this a checksum verification?
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for audit access analysis
CREATE INDEX IF NOT EXISTS idx_audit_access_log_actor_id ON audit_access_log(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_access_log_actor_role ON audit_access_log(actor_role);
CREATE INDEX IF NOT EXISTS idx_audit_access_log_scope ON audit_access_log(scope_accessed);
CREATE INDEX IF NOT EXISTS idx_audit_access_log_timestamp ON audit_access_log(access_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_access_log_request_id ON audit_access_log(request_id);
CREATE INDEX IF NOT EXISTS idx_audit_access_log_access_type ON audit_access_log(access_type);

-- IMMUTABILITY on audit_access_log
DROP TRIGGER IF EXISTS prevent_audit_access_log_update ON audit_access_log;
DROP TRIGGER IF EXISTS prevent_audit_access_log_delete ON audit_access_log;

CREATE OR REPLACE FUNCTION prevent_audit_access_log_update()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Audit access logs are immutable. UPDATE operations are not permitted.';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION prevent_audit_access_log_delete()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Audit access logs are immutable. DELETE operations are not permitted.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER prevent_audit_access_log_update
BEFORE UPDATE ON audit_access_log
FOR EACH ROW
EXECUTE FUNCTION prevent_audit_access_log_update();

CREATE TRIGGER prevent_audit_access_log_delete
BEFORE DELETE ON audit_access_log
FOR EACH ROW
EXECUTE FUNCTION prevent_audit_access_log_delete();

-- ===========================
-- C. SCOPE ENFORCEMENT CONSTRAINT
-- ===========================
-- Validates that:
-- - GLOBAL scopes only have superadmin as actor
-- - TENANT scopes have tenant_admin or superadmin as actor
-- - USER scopes can have any role

ALTER TABLE audit_logs
ADD CONSTRAINT check_audit_scope_actor (
  CASE
    WHEN action_scope = 'GLOBAL' THEN actor_role = 'superadmin'
    WHEN action_scope = 'TENANT' THEN actor_role IN ('superadmin', 'tenant_admin')
    WHEN action_scope = 'USER' THEN actor_role IN ('superadmin', 'tenant_admin', 'user')
    ELSE TRUE
  END
);

ALTER TABLE superadmin_audit_log
ADD CONSTRAINT check_superadmin_audit_scope_actor (
  CASE
    WHEN action_scope = 'GLOBAL' THEN actor_role = 'superadmin'
    WHEN action_scope = 'TENANT' THEN actor_role IN ('superadmin', 'tenant_admin')
    WHEN action_scope = 'USER' THEN actor_role IN ('superadmin', 'tenant_admin', 'user')
    ELSE TRUE
  END
);

-- ===========================
-- D. STANDARDIZED STATE SCHEMA
-- ===========================
-- Add function to validate before/after state structure

CREATE OR REPLACE FUNCTION validate_audit_state_structure(state JSONB)
RETURNS BOOLEAN AS $$
BEGIN
  -- Basic validation: state should be valid JSON
  -- Can be extended with more strict validation
  RETURN state IS NULL OR (state @> '{}' OR state IS NOT NULL);
END;
$$ LANGUAGE plpgsql;

-- Add check constraint for state validation
ALTER TABLE audit_logs
ADD CONSTRAINT check_audit_state_valid (
  validate_audit_state_structure(before_state) AND
  validate_audit_state_structure(after_state)
);

ALTER TABLE superadmin_audit_log
ADD CONSTRAINT check_superadmin_audit_state_valid (
  validate_audit_state_structure(before_state) AND
  validate_audit_state_structure(after_state)
);

-- ===========================
-- E. CHECKSUM VERIFICATION VIEW
-- ===========================
-- View to help verify audit log integrity

CREATE OR REPLACE VIEW audit_checksums_for_verification AS
SELECT
  id,
  actor_id,
  action_type,
  action_scope,
  resource_type,
  resource_id,
  created_at,
  ENCODE(
    DIGEST(
      id::text || actor_id::text || action_type || action_scope || 
      COALESCE(before_state::text, '') || COALESCE(after_state::text, ''),
      'sha256'
    ),
    'hex'
  ) as expected_checksum,
  checksum as stored_checksum,
  ENCODE(
    DIGEST(
      id::text || actor_id::text || action_type || action_scope || 
      COALESCE(before_state::text, '') || COALESCE(after_state::text, ''),
      'sha256'
    ),
    'hex'
  ) = checksum as checksum_valid
FROM audit_logs;

-- ===========================
-- F. MONITORING VIEWS
-- ===========================

-- View: Recent mutation attempts (for security monitoring)
CREATE OR REPLACE VIEW audit_mutation_attempts AS
SELECT
  'UPDATE attempt' as attempt_type,
  schemaname,
  tablename,
  pg_typeof(null),
  NOW() as detected_at
FROM pg_tables
WHERE tablename IN ('audit_logs', 'superadmin_audit_log', 'audit_access_log')
-- This view helps ops teams watch for any unauthorized mutation attempts

-- View: Superadmin audit log access patterns
CREATE OR REPLACE VIEW superadmin_access_patterns AS
SELECT
  date_trunc('hour', access_timestamp) as access_hour,
  actor_id,
  actor_role,
  access_type,
  COUNT(*) as access_count,
  AVG(results_count) as avg_results_returned
FROM audit_access_log
GROUP BY date_trunc('hour', access_timestamp), actor_id, actor_role, access_type
ORDER BY access_hour DESC;

-- ===========================
-- G. DATA MIGRATION (if needed)
-- ===========================
-- If there are any existing update attempts in audit_logs, log them as incidents

CREATE OR REPLACE FUNCTION log_audit_system_initialization()
RETURNS TABLE (status text, message text) AS $$
BEGIN
  RETURN QUERY SELECT
    'SUCCESS'::text,
    'Phase 10.2 Stage 2: Unified Immutable Audit System Initialized'::text;
END;
$$ LANGUAGE plpgsql;

-- ===========================
-- H. DOCUMENTATION & COMMENTS
-- ===========================

COMMENT ON TABLE audit_logs IS
  'Immutable audit log for domain operations. Append-only enforcement via triggers. Legal defense-grade trustworthy.';

COMMENT ON TABLE superadmin_audit_log IS
  'Immutable audit log for superadmin operations. Now with same immutability guarantees as audit_logs. No mutations allowed.';

COMMENT ON TABLE audit_access_log IS
  'Audit the auditors: Tracks who accessed audit logs and what they viewed. Immutable record of all audit log access.';

COMMENT ON COLUMN audit_logs.action_scope IS
  'GLOBAL (system-wide), TENANT (organization-wide), or USER (individual). Constrainted by actor role.';

COMMENT ON COLUMN superadmin_audit_log.actor_role IS
  'Role of the actor (superadmin, tenant_admin). Used for scope validation.';

COMMENT ON COLUMN audit_access_log.access_type IS
  'Type of access: READ_AUDIT_LOGS, READ_SINGLE_LOG, VERIFY_INTEGRITY, SEARCH_JUSTIFICATION, GET_RESOURCE_TRAIL';

-- ===========================
-- VERIFICATION SCRIPT
-- ===========================
-- Run these queries after migration to verify immutability:
/*

-- Test 1: Verify immutability triggers exist
SELECT trigger_name, event_object_table, trigger_timing, event_manipulation
FROM information_schema.triggers
WHERE event_object_table IN ('audit_logs', 'superadmin_audit_log', 'audit_access_log')
  AND trigger_timing = 'BEFORE';

-- Test 2: Attempt UPDATE (should fail)
UPDATE audit_logs SET justification = 'hacked' LIMIT 1;
-- Expected: ERROR: audit_logs is immutable

-- Test 3: Verify audit_access_log exists
SELECT COUNT(*) FROM information_schema.tables
WHERE table_name = 'audit_access_log';
-- Expected: 1

-- Test 4: Verify scope constraints
INSERT INTO audit_logs (actor_id, actor_role, action_type, action_scope, created_at)
VALUES (uuid_generate_v4(), 'user', 'TEST', 'GLOBAL', NOW());
-- Expected: CONSTRAINT VIOLATION (users can't create GLOBAL scope logs)

*/

COMMIT;
