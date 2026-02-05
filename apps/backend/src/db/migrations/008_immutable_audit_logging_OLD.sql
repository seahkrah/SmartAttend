-- ===========================
-- IMMUTABLE AUDIT LOGGING (PHASE 2, STEP 2.1)
-- Migration: 008_immutable_audit_logging.sql
-- ===========================
-- Comprehensive append-only audit log for all domain operations
-- Ensures complete auditability across all system changes

-- ===========================
-- A. IMMUTABLE AUDIT LOGS TABLE
-- ===========================

-- Domain Audit Log: All user-visible operations (IMMUTABLE, APPEND-ONLY)
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Actor performing the change
  actor_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  actor_role VARCHAR(100),
  
  -- Action metadata
  action_type VARCHAR(100) NOT NULL,
  action_scope VARCHAR(50) NOT NULL CHECK (action_scope IN ('GLOBAL', 'TENANT', 'USER')),
  
  -- Resource affected
  resource_type VARCHAR(100),
  resource_id UUID,
  
  -- State snapshots (immutable)
  before_state JSONB,
  after_state JSONB,
  
  -- Change justification
  justification TEXT,
  
  -- Request context
  request_id VARCHAR(255),
  ip_address INET NOT NULL,
  user_agent VARCHAR(500),
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  -- Integrity flags
  is_immutable BOOLEAN DEFAULT TRUE,
  checksum VARCHAR(64) -- SHA256 of content for integrity verification
);

-- Indexes for querying efficiency (read-heavy operations)
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_id ON audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action_type ON audit_logs(action_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action_scope ON audit_logs(action_scope);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_request_id ON audit_logs(request_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_timestamp ON audit_logs(actor_id, created_at DESC);

-- Full-text search index for justification/comments
CREATE INDEX IF NOT EXISTS idx_audit_logs_justification_fts ON audit_logs USING gin(to_tsvector('english', COALESCE(justification, '')));

-- ===========================
-- B. IMMUTABILITY TRIGGERS
-- ===========================

-- Prevent UPDATE on audit_logs (append-only constraint)
CREATE OR REPLACE FUNCTION prevent_audit_logs_update()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Audit logs are immutable. UPDATE operations are not permitted.';
END;
$$ LANGUAGE plpgsql;

-- Prevent DELETE on audit_logs (append-only constraint)
CREATE OR REPLACE FUNCTION prevent_audit_logs_delete()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Audit logs are immutable. DELETE operations are not permitted.';
END;
$$ LANGUAGE plpgsql;

-- Attach immutability triggers
DROP TRIGGER IF EXISTS prevent_audit_logs_update_trigger ON audit_logs;
CREATE TRIGGER prevent_audit_logs_update_trigger
BEFORE UPDATE ON audit_logs
FOR EACH ROW
EXECUTE FUNCTION prevent_audit_logs_update();

DROP TRIGGER IF EXISTS prevent_audit_logs_delete_trigger ON audit_logs;
CREATE TRIGGER prevent_audit_logs_delete_trigger
BEFORE DELETE ON audit_logs
FOR EACH ROW
EXECUTE FUNCTION prevent_audit_logs_delete();

-- ===========================
-- C. AUDIT LOG CHECKSUM FUNCTION
-- ===========================

-- Calculate checksum on INSERT for integrity verification
CREATE OR REPLACE FUNCTION calculate_audit_log_checksum()
RETURNS TRIGGER AS $$
BEGIN
  NEW.checksum := encode(
    digest(
      NEW.id::text || 
      NEW.actor_id::text || 
      NEW.action_type || 
      NEW.action_scope || 
      COALESCE(NEW.resource_type, '') || 
      COALESCE(NEW.resource_id::text, '') ||
      COALESCE(NEW.before_state::text, '') ||
      COALESCE(NEW.after_state::text, ''),
      'sha256'
    ),
    'hex'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_logs_checksum_trigger ON audit_logs;
CREATE TRIGGER audit_logs_checksum_trigger
BEFORE INSERT ON audit_logs
FOR EACH ROW
EXECUTE FUNCTION calculate_audit_log_checksum();

-- ===========================
-- D. AUDIT SUMMARY VIEW
-- ===========================

-- View for quick audit summary statistics (superadmin access only)
CREATE OR REPLACE VIEW v_audit_summary AS
SELECT
  DATE_TRUNC('hour', created_at) as period,
  action_type,
  action_scope,
  COUNT(*) as operation_count,
  COUNT(DISTINCT actor_id) as unique_actors,
  COUNT(DISTINCT resource_type) as unique_resource_types
FROM audit_logs
GROUP BY DATE_TRUNC('hour', created_at), action_type, action_scope
ORDER BY period DESC;

-- View for recent audit activity
CREATE OR REPLACE VIEW v_recent_audit_activity AS
SELECT
  al.id,
  al.actor_id,
  al.action_type,
  al.action_scope,
  al.resource_type,
  al.resource_id,
  al.created_at,
  al.ip_address,
  u.email as actor_email,
  u.first_name || ' ' || u.last_name as actor_name
FROM audit_logs al
LEFT JOIN users u ON al.actor_id = u.id
ORDER BY al.created_at DESC
LIMIT 1000;

-- ===========================
-- E. AUDIT LOG ARCHIVAL STRATEGY
-- ===========================

-- Table for archived audit logs (older than retention period)
CREATE TABLE IF NOT EXISTS audit_logs_archive (
  id UUID,
  actor_id UUID,
  actor_role VARCHAR(100),
  action_type VARCHAR(100),
  action_scope VARCHAR(50),
  resource_type VARCHAR(100),
  resource_id UUID,
  before_state JSONB,
  after_state JSONB,
  justification TEXT,
  request_id VARCHAR(255),
  ip_address INET,
  user_agent VARCHAR(500),
  created_at TIMESTAMPTZ,
  is_immutable BOOLEAN,
  checksum VARCHAR(64),
  archived_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_archive_created_at ON audit_logs_archive(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_archive_actor_id ON audit_logs_archive(actor_id);

-- Archive audit logs older than 90 days
-- Note: Run manually via maintenance task
-- INSERT INTO audit_logs_archive 
-- SELECT *, CURRENT_TIMESTAMP FROM audit_logs WHERE created_at < CURRENT_TIMESTAMP - INTERVAL '90 days'
-- AND id NOT IN (SELECT id FROM audit_logs_archive);

-- ===========================
-- F. AUDIT LOG PERMISSIONS
-- ===========================

-- Superadmin can query all audit logs (read-only)
GRANT SELECT ON audit_logs TO postgres;
GRANT SELECT ON v_audit_summary TO postgres;
GRANT SELECT ON v_recent_audit_activity TO postgres;

-- No grants for UPDATE/DELETE (enforced by triggers + role permissions)
-- Users can only view their own actions (via application-level filtering)

-- ===========================
-- G. CONSISTENCY CHECKS
-- ===========================

-- Verify no UPDATE/DELETE operations are possible (test)
-- SELECT * FROM pg_stat_user_tables WHERE relname = 'audit_logs';

-- Verify triggers are attached
-- SELECT * FROM pg_trigger WHERE tgrelid = 'audit_logs'::regclass;

-- ===========================
-- VERIFICATION QUERIES
-- ===========================

-- Check audit log structure
-- SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'audit_logs' ORDER BY ordinal_position;

-- Check immutability triggers
-- SELECT trigger_name FROM information_schema.triggers WHERE event_object_table = 'audit_logs' AND event_manipulation IN ('UPDATE', 'DELETE');

-- View audit log counts
-- SELECT action_type, action_scope, COUNT(*) FROM audit_logs GROUP BY action_type, action_scope;
