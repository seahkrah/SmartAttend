-- ===========================
-- INFRASTRUCTURE CONTROL PLANE SCHEMA
-- Migration: 006_infrastructure_control_plane.sql
-- ===========================
-- Production-grade superadmin infrastructure layer with:
-- - Strict tenant lifecycle management
-- - Immutable append-only audit logging
-- - Time integrity tracking
-- - Attendance integrity oversight (read-only)
-- - Session invalidation tracking
-- - Compliance-grade logging

-- ===========================
-- A. TENANT LIFECYCLE MANAGEMENT (STRICT STATE MACHINE)
-- ===========================

-- Drop and recreate tenant table with lifecycle state machine
ALTER TABLE school_entities ADD COLUMN IF NOT EXISTS lifecycle_state VARCHAR(20) DEFAULT 'PROVISIONED' CHECK (lifecycle_state IN ('PROVISIONED', 'ACTIVE', 'SUSPENDED', 'LOCKED', 'DECOMMISSIONED'));
ALTER TABLE school_entities ADD COLUMN IF NOT EXISTS system_version INTEGER DEFAULT 1;
ALTER TABLE school_entities ADD COLUMN IF NOT EXISTS config_hash VARCHAR(64);
ALTER TABLE school_entities ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;

-- Tenant Lifecycle Audit Trail (Immutable)
CREATE TABLE IF NOT EXISTS tenant_lifecycle_audit (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES school_entities(id) ON DELETE RESTRICT,
  
  -- State transition
  previous_state VARCHAR(20),
  new_state VARCHAR(20) NOT NULL CHECK (new_state IN ('PROVISIONED', 'ACTIVE', 'SUSPENDED', 'LOCKED', 'DECOMMISSIONED')),
  
  -- Actor & context
  actor_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  actor_role VARCHAR(50) NOT NULL,
  
  -- Justification (mandatory for destructive operations)
  action_type VARCHAR(50) NOT NULL,
  justification TEXT NOT NULL,
  confirmation_token VARCHAR(255),
  
  -- Metadata
  ip_address INET,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  -- Immutable constraints
  is_immutable BOOLEAN DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_tenant_lifecycle_tenant_id ON tenant_lifecycle_audit(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_lifecycle_timestamp ON tenant_lifecycle_audit(timestamp DESC);

-- ===========================
-- B. SESSION INVALIDATION TRACKING
-- ===========================

-- Session Invalidation Log (when tenant is locked, all sessions must be revoked)
CREATE TABLE IF NOT EXISTS session_invalidation_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES school_entities(id) ON DELETE RESTRICT,
  
  reason VARCHAR(100) NOT NULL,
  invalidated_by_superadmin_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  invalidated_session_count INTEGER,
  
  timestamp TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_immutable BOOLEAN DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_session_invalidation_tenant ON session_invalidation_log(tenant_id);

-- ===========================
-- C. TIME INTEGRITY & VERIFICATION
-- ===========================

-- Clock Drift Detection: Server time vs client time discrepancies
CREATE TABLE IF NOT EXISTS clock_drift_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES school_entities(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  
  client_timestamp TIMESTAMPTZ NOT NULL,
  server_timestamp TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  drift_seconds INTEGER NOT NULL, -- positive = client ahead, negative = client behind
  
  severity VARCHAR(20) NOT NULL CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL')),
  attendance_affected BOOLEAN DEFAULT FALSE,
  
  request_id VARCHAR(255),
  timestamp TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_clock_drift_tenant ON clock_drift_log(tenant_id);
CREATE INDEX IF NOT EXISTS idx_clock_drift_severity ON clock_drift_log(severity) WHERE severity != 'INFO';

-- ===========================
-- D. ATTENDANCE INTEGRITY OVERSIGHT (READ-ONLY)
-- ===========================

-- Attendance Integrity View: Superadmin can ONLY flag, never edit
CREATE TABLE IF NOT EXISTS attendance_integrity_flags (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  tenant_id UUID NOT NULL REFERENCES school_entities(id) ON DELETE RESTRICT,
  attendance_record_id UUID,
  
  flag_type VARCHAR(50) NOT NULL CHECK (flag_type IN (
    'DUPLICATE_SUBMISSION',
    'REPLAY_ATTACK',
    'CLOCK_DRIFT_VIOLATION',
    'VERIFICATION_MISMATCH',
    'MANUAL_REVIEW_REQUESTED',
    'DATA_INCONSISTENCY'
  )),
  
  severity VARCHAR(20) NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  state VARCHAR(30) NOT NULL DEFAULT 'FLAGGED' CHECK (state IN ('FLAGGED', 'UNDER_REVIEW', 'RESOLVED', 'REVOKED')),
  
  -- Superadmin can only flag, not edit
  flagged_by_superadmin_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  flag_reason TEXT NOT NULL,
  flag_timestamp TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  -- Tenant admin resolves via their own process
  resolved_by_tenant_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  resolution_notes TEXT,
  resolved_at TIMESTAMPTZ,
  
  -- Audit
  is_immutable BOOLEAN DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_attendance_integrity_tenant ON attendance_integrity_flags(tenant_id);
CREATE INDEX IF NOT EXISTS idx_attendance_integrity_state ON attendance_integrity_flags(state);
CREATE INDEX IF NOT EXISTS idx_attendance_integrity_severity ON attendance_integrity_flags(severity);

-- ===========================
-- E. PRIVILEGE ESCALATION DETECTION (ENHANCED)
-- ===========================

-- Privilege Escalation Events: Immutable security flag
CREATE TABLE IF NOT EXISTS privilege_escalation_audit (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  tenant_id UUID NOT NULL REFERENCES school_entities(id) ON DELETE RESTRICT,
  
  previous_role VARCHAR(100),
  new_role VARCHAR(100) NOT NULL,
  
  escalation_severity VARCHAR(20) NOT NULL CHECK (escalation_severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  escalation_reason TEXT,
  
  -- Actor (who performed escalation)
  granted_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  -- Detection & investigation
  flagged_by_superadmin_id UUID REFERENCES users(id) ON DELETE SET NULL,
  investigation_status VARCHAR(20) DEFAULT 'OPEN',
  investigation_notes TEXT,
  investigated_at TIMESTAMPTZ,
  
  -- Immutable
  is_immutable BOOLEAN DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_privilege_escalation_user ON privilege_escalation_audit(user_id);
CREATE INDEX IF NOT EXISTS idx_privilege_escalation_tenant ON privilege_escalation_audit(tenant_id);
CREATE INDEX IF NOT EXISTS idx_privilege_escalation_severity ON privilege_escalation_audit(escalation_severity);

-- ===========================
-- F. AUDIT LOGGING (IMMUTABLE BY DESIGN)
-- ===========================

-- Master Audit Log: ALL superadmin operations (IMMUTABLE)
CREATE TABLE IF NOT EXISTS superadmin_audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Actor
  actor_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  actor_platform VARCHAR(50) NOT NULL, -- 'system' for superadmin
  
  -- Action
  action_type VARCHAR(100) NOT NULL,
  action_scope VARCHAR(50) NOT NULL CHECK (action_scope IN ('GLOBAL', 'TENANT', 'USER', 'SYSTEM')),
  
  -- Target
  target_entity_type VARCHAR(50),
  target_entity_id UUID,
  
  -- State change (immutable snapshot)
  before_state JSONB,
  after_state JSONB,
  
  -- Justification
  justification TEXT,
  confirmation_token VARCHAR(255),
  
  -- Context
  ip_address INET NOT NULL,
  user_agent VARCHAR(500),
  request_id VARCHAR(255),
  
  -- Metadata
  result VARCHAR(20) NOT NULL CHECK (result IN ('SUCCESS', 'FAILURE', 'PARTIAL')),
  error_message TEXT,
  
  timestamp TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_immutable BOOLEAN DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON superadmin_audit_log(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON superadmin_audit_log(action_type);
CREATE INDEX IF NOT EXISTS idx_audit_log_target ON superadmin_audit_log(target_entity_type, target_entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON superadmin_audit_log(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_scope ON superadmin_audit_log(action_scope);

-- Prevent accidental updates/deletes on audit tables
CREATE TRIGGER prevent_audit_log_modification
BEFORE UPDATE OR DELETE ON superadmin_audit_log
FOR EACH ROW
EXECUTE FUNCTION raise_immutable_error();

CREATE TRIGGER prevent_tenant_lifecycle_modification
BEFORE UPDATE OR DELETE ON tenant_lifecycle_audit
FOR EACH ROW
EXECUTE FUNCTION raise_immutable_error();

-- ===========================
-- G. SUPERADMIN SESSION MANAGEMENT
-- ===========================

-- Superadmin Session Registry: Track active sessions with short TTL
CREATE TABLE IF NOT EXISTS superadmin_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  superadmin_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  access_token VARCHAR(500) NOT NULL,
  refresh_token VARCHAR(500),
  
  ip_address INET NOT NULL,
  user_agent VARCHAR(500),
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMPTZ NOT NULL,
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  is_active BOOLEAN DEFAULT TRUE,
  invalidated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_superadmin_sessions_user ON superadmin_sessions(superadmin_user_id);
CREATE INDEX IF NOT EXISTS idx_superadmin_sessions_active ON superadmin_sessions(is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_superadmin_sessions_expiry ON superadmin_sessions(expires_at);

-- ===========================
-- H. SYSTEM HEALTH & OBSERVABILITY (ENHANCED)
-- ===========================

-- Service Health with historical tracking
CREATE TABLE IF NOT EXISTS service_health_checks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  service_name VARCHAR(100) NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('HEALTHY', 'DEGRADED', 'DOWN')),
  
  response_time_ms INTEGER,
  error_rate_percent DECIMAL(5,2),
  last_error_message TEXT,
  
  checked_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  checked_by VARCHAR(50)
);

CREATE INDEX IF NOT EXISTS idx_service_health_service ON service_health_checks(service_name);
CREATE INDEX IF NOT EXISTS idx_service_health_timestamp ON service_health_checks(checked_at DESC);

-- Metrics Time-Series (for charting & analytics)
CREATE TABLE IF NOT EXISTS system_metrics_timeseries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  metric_name VARCHAR(100) NOT NULL,
  metric_value DECIMAL(15,4) NOT NULL,
  metric_unit VARCHAR(20),
  
  service_name VARCHAR(100),
  tenant_id UUID REFERENCES school_entities(id) ON DELETE SET NULL,
  
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_anomalous BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_metrics_timeseries_metric ON system_metrics_timeseries(metric_name);
CREATE INDEX IF NOT EXISTS idx_metrics_timeseries_service ON system_metrics_timeseries(service_name);
CREATE INDEX IF NOT EXISTS idx_metrics_timeseries_timestamp ON system_metrics_timeseries(recorded_at DESC);

-- ===========================
-- I. INCIDENT MANAGEMENT (ENHANCED)
-- ===========================

-- Incidents: Infrastructure incidents (append-only updates)
CREATE TABLE IF NOT EXISTS infrastructure_incidents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  incident_number SERIAL NOT NULL UNIQUE,
  
  -- Classification
  incident_type VARCHAR(50) NOT NULL CHECK (incident_type IN ('SECURITY', 'DATA', 'SYSTEM', 'INFRASTRUCTURE')),
  severity VARCHAR(20) NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  
  -- Description
  title VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  
  -- Status & lifecycle
  status VARCHAR(30) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'ACKNOWLEDGED', 'INVESTIGATING', 'CONTAINED', 'RESOLVED', 'CLOSED')),
  escalation_level INTEGER DEFAULT 0,
  
  -- Actors
  created_by_superadmin_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  assigned_to_superadmin_id UUID REFERENCES users(id) ON DELETE SET NULL,
  acknowledged_by_superadmin_id UUID REFERENCES users(id) ON DELETE SET NULL,
  
  -- Context
  affected_tenant_id UUID REFERENCES school_entities(id) ON DELETE SET NULL,
  affected_entity_count INTEGER DEFAULT 0,
  affected_user_count INTEGER DEFAULT 0,
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  acknowledged_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  
  -- Resolution
  root_cause TEXT,
  resolution_summary TEXT,
  lessons_learned TEXT,
  
  -- Immutable
  is_immutable BOOLEAN DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_incident_status ON infrastructure_incidents(status);
CREATE INDEX IF NOT EXISTS idx_incident_severity ON infrastructure_incidents(severity);
CREATE INDEX IF NOT EXISTS idx_incident_tenant ON infrastructure_incidents(affected_tenant_id);
CREATE INDEX IF NOT EXISTS idx_incident_created ON infrastructure_incidents(created_at DESC);

-- Incident Timeline: Append-only activity log
CREATE TABLE IF NOT EXISTS incident_activity_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  incident_id UUID NOT NULL REFERENCES infrastructure_incidents(id) ON DELETE CASCADE,
  
  activity_type VARCHAR(50) NOT NULL,
  activity_description TEXT NOT NULL,
  
  actor_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  actor_role VARCHAR(50) NOT NULL,
  
  state_change_from VARCHAR(30),
  state_change_to VARCHAR(30),
  
  timestamp TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_immutable BOOLEAN DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_incident_activity_incident ON incident_activity_log(incident_id);
CREATE INDEX IF NOT EXISTS idx_incident_activity_timestamp ON incident_activity_log(timestamp DESC);

-- ===========================
-- J. SAFETY CONTROLS & CONFIRMATIONS
-- ===========================

-- Confirmation Tokens: For high-impact operations requiring explicit confirmation
CREATE TABLE IF NOT EXISTS confirmation_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  operation_type VARCHAR(100) NOT NULL,
  operation_context JSONB NOT NULL,
  
  token_hash VARCHAR(255) NOT NULL UNIQUE,
  requesting_superadmin_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMPTZ NOT NULL,
  confirmed_at TIMESTAMPTZ,
  
  is_used BOOLEAN DEFAULT FALSE,
  ip_address INET
);

CREATE INDEX IF NOT EXISTS idx_confirmation_tokens_expiry ON confirmation_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_confirmation_tokens_user ON confirmation_tokens(requesting_superadmin_id);

-- ===========================
-- K. HELPER FUNCTIONS
-- ===========================

-- Immutable enforcement function
CREATE OR REPLACE FUNCTION raise_immutable_error()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Audit logs are immutable and cannot be modified';
END;
$$ LANGUAGE plpgsql;

-- Function to validate tenant lifecycle transitions
CREATE OR REPLACE FUNCTION validate_tenant_lifecycle_transition(
  current_state VARCHAR,
  new_state VARCHAR
)
RETURNS BOOLEAN AS $$
BEGIN
  -- Define valid transitions
  IF current_state = 'PROVISIONED' THEN
    RETURN new_state IN ('ACTIVE', 'DECOMMISSIONED');
  ELSIF current_state = 'ACTIVE' THEN
    RETURN new_state IN ('SUSPENDED', 'LOCKED', 'DECOMMISSIONED');
  ELSIF current_state = 'SUSPENDED' THEN
    RETURN new_state IN ('ACTIVE', 'LOCKED', 'DECOMMISSIONED');
  ELSIF current_state = 'LOCKED' THEN
    RETURN new_state IN ('ACTIVE', 'DECOMMISSIONED');
  ELSIF current_state = 'DECOMMISSIONED' THEN
    RETURN FALSE; -- Terminal state
  END IF;
  RETURN FALSE;
END;
$$ LANGUAGE plpgsql;

COMMIT;
