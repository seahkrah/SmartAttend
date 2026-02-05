-- ===========================
-- PHASE 4: INFRASTRUCTURE CONTROL PLANE (SIMPLIFIED)
-- ===========================

-- ===========================
-- A. TENANT LIFECYCLE MANAGEMENT
-- ===========================

ALTER TABLE school_entities ADD COLUMN IF NOT EXISTS lifecycle_state VARCHAR(20) DEFAULT 'ACTIVE';
ALTER TABLE school_entities ADD COLUMN IF NOT EXISTS system_version INTEGER DEFAULT 1;

-- Tenant Lifecycle Audit Trail
CREATE TABLE IF NOT EXISTS tenant_lifecycle_audit (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES school_entities(id) ON DELETE CASCADE,
  previous_state VARCHAR(20),
  new_state VARCHAR(20),
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action_type VARCHAR(50),
  justification TEXT,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tenant_lifecycle_tenant ON tenant_lifecycle_audit(tenant_id);

-- ===========================
-- B. TIME INTEGRITY TRACKING
-- ===========================

CREATE TABLE IF NOT EXISTS clock_drift_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES school_entities(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  client_timestamp TIMESTAMPTZ,
  server_timestamp TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  drift_seconds INTEGER,
  severity VARCHAR(20),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_clock_drift_tenant ON clock_drift_log(tenant_id);

-- ===========================
-- C. ATTENDANCE INTEGRITY FLAGS
-- ===========================

CREATE TABLE IF NOT EXISTS attendance_integrity_flags (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES school_entities(id) ON DELETE CASCADE,
  attendance_record_id UUID,
  flag_type VARCHAR(50),
  severity VARCHAR(20),
  state VARCHAR(30) DEFAULT 'FLAGGED',
  flagged_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  flag_reason TEXT,
  flag_timestamp TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_attendance_integrity_tenant ON attendance_integrity_flags(tenant_id);

-- ===========================
-- D. PRIVILEGE ESCALATION DETECTION
-- ===========================

CREATE TABLE IF NOT EXISTS privilege_escalation_audit (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES school_entities(id) ON DELETE CASCADE,
  previous_role VARCHAR(100),
  new_role VARCHAR(100),
  escalation_severity VARCHAR(20),
  escalation_reason TEXT,
  granted_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  flagged_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  investigation_status VARCHAR(20) DEFAULT 'OPEN',
  investigation_notes TEXT,
  investigated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_privilege_escalation_user ON privilege_escalation_audit(user_id);
CREATE INDEX IF NOT EXISTS idx_privilege_escalation_tenant ON privilege_escalation_audit(tenant_id);

-- ===========================
-- E. AUDIT LOGGING
-- ===========================

CREATE TABLE IF NOT EXISTS superadmin_audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action_type VARCHAR(100),
  action_scope VARCHAR(50),
  target_entity_type VARCHAR(50),
  target_entity_id UUID,
  before_state JSONB,
  after_state JSONB,
  justification TEXT,
  ip_address INET,
  user_agent VARCHAR(500),
  request_id VARCHAR(255),
  result VARCHAR(20),
  error_message TEXT,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON superadmin_audit_log(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON superadmin_audit_log(action_type);
CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON superadmin_audit_log(timestamp DESC);

-- ===========================
-- F. SESSION MANAGEMENT
-- ===========================

CREATE TABLE IF NOT EXISTS superadmin_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  superadmin_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  access_token VARCHAR(500),
  refresh_token VARCHAR(500),
  ip_address INET,
  user_agent VARCHAR(500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMPTZ NOT NULL,
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_active BOOLEAN DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_superadmin_sessions_user ON superadmin_sessions(superadmin_user_id);
CREATE INDEX IF NOT EXISTS idx_superadmin_sessions_active ON superadmin_sessions(is_active);

-- ===========================
-- G. SERVICE HEALTH
-- ===========================

CREATE TABLE IF NOT EXISTS service_health_checks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  service_name VARCHAR(100),
  status VARCHAR(20),
  response_time_ms INTEGER,
  error_rate_percent DECIMAL(5, 2),
  last_error_message TEXT,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_service_health_service ON service_health_checks(service_name);
CREATE INDEX IF NOT EXISTS idx_service_health_timestamp ON service_health_checks(checked_at DESC);

-- ===========================
-- H. INCIDENTS
-- ===========================

CREATE TABLE IF NOT EXISTS infrastructure_incidents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  incident_number SERIAL NOT NULL UNIQUE,
  incident_type VARCHAR(50),
  severity VARCHAR(20),
  title VARCHAR(255),
  description TEXT,
  status VARCHAR(30) DEFAULT 'OPEN',
  escalation_level INTEGER DEFAULT 0,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  assigned_to_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  affected_tenant_id UUID REFERENCES school_entities(id) ON DELETE SET NULL,
  affected_entity_count INTEGER DEFAULT 0,
  affected_user_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  acknowledged_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_incident_status ON infrastructure_incidents(status);
CREATE INDEX IF NOT EXISTS idx_incident_severity ON infrastructure_incidents(severity);
CREATE INDEX IF NOT EXISTS idx_incident_created ON infrastructure_incidents(created_at DESC);

-- ===========================
-- I. INCIDENT ACTIVITY LOG
-- ===========================

CREATE TABLE IF NOT EXISTS incident_activity_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  incident_id UUID NOT NULL REFERENCES infrastructure_incidents(id) ON DELETE CASCADE,
  activity_type VARCHAR(50),
  activity_description TEXT,
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_role VARCHAR(50),
  state_change_from VARCHAR(30),
  state_change_to VARCHAR(30),
  timestamp TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_incident_activity_incident ON incident_activity_log(incident_id);
CREATE INDEX IF NOT EXISTS idx_incident_activity_timestamp ON incident_activity_log(timestamp DESC);

COMMIT;
