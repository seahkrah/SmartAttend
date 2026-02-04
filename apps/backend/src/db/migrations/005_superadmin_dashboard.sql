-- ===========================
-- SUPERADMIN DASHBOARD SCHEMA
-- Migration: 005_superadmin_dashboard.sql
-- ===========================
-- This migration implements the complete superadmin dashboard schema
-- for tenant management, incidents, health monitoring, and audit trails

-- ===========================
-- A. TENANT MANAGEMENT
-- ===========================

-- Tenant Lock Events: Incident response tracking
CREATE TABLE IF NOT EXISTS tenant_lock_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES school_entities(id) ON DELETE CASCADE,
  
  action VARCHAR(20) NOT NULL CHECK (action IN ('LOCKED', 'UNLOCKED')),
  reason TEXT NOT NULL,
  locked_by_superadmin_id UUID NOT NULL REFERENCES users(id),
  
  locked_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  unlocked_at TIMESTAMPTZ
);

-- Tenant Configuration: Audit trail for tenant settings
CREATE TABLE IF NOT EXISTS tenant_configurations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES school_entities(id) ON DELETE CASCADE,
  
  config_key VARCHAR(100) NOT NULL,
  config_value JSONB NOT NULL,
  
  set_by_user_id UUID NOT NULL REFERENCES users(id),
  set_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  ip_address INET,
  change_reason TEXT,
  
  CONSTRAINT tenant_config_unique UNIQUE (tenant_id, config_key)
);

-- ===========================
-- B. PRIVILEGE ESCALATION DETECTION
-- ===========================

-- Privilege Escalation Events: Security flag detection
CREATE TABLE IF NOT EXISTS privilege_escalation_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id),
  
  old_role_id UUID REFERENCES roles(id),
  new_role_id UUID NOT NULL REFERENCES roles(id),
  
  escalation_type VARCHAR(50) NOT NULL,
  severity VARCHAR(20) NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  
  detected_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  investigation_status VARCHAR(20) DEFAULT 'OPEN',
  
  flagged_by_superadmin_id UUID,
  investigation_notes TEXT
);

-- ===========================
-- C. SYSTEM HEALTH & OBSERVABILITY
-- ===========================

-- System Health Status
CREATE TABLE IF NOT EXISTS system_health (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  service_name VARCHAR(100) NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('HEALTHY', 'DEGRADED', 'DOWN')),
  
  response_time_ms INTEGER,
  error_rate_percent DECIMAL(5,2),
  cpu_percent DECIMAL(5,2),
  memory_percent DECIMAL(5,2),
  
  last_checked_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  checked_by VARCHAR(50)
);

-- System Metrics: Time series data for monitoring
CREATE TABLE IF NOT EXISTS system_metrics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  metric_name VARCHAR(100) NOT NULL,
  metric_value DECIMAL(10,4) NOT NULL,
  metric_unit VARCHAR(20),
  
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  service_name VARCHAR(100),
  
  is_archived BOOLEAN DEFAULT FALSE
);

-- Alert Rules: Thresholds for system monitoring
CREATE TABLE IF NOT EXISTS alert_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  rule_name VARCHAR(100) NOT NULL UNIQUE,
  metric_name VARCHAR(100) NOT NULL,
  
  threshold_value DECIMAL(10,4) NOT NULL,
  operator VARCHAR(20) NOT NULL CHECK (operator IN ('>', '<', '>=', '<=', '=')),
  
  is_enabled BOOLEAN DEFAULT TRUE,
  notification_channels VARCHAR(255),
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by_superadmin_id UUID
);

-- ===========================
-- D. INCIDENT MANAGEMENT
-- ===========================

-- Incidents: Security or operational incidents (IMMUTABLE)
CREATE TABLE IF NOT EXISTS incidents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  incident_number SERIAL NOT NULL UNIQUE,
  title VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  
  incident_type VARCHAR(50) NOT NULL,
  severity VARCHAR(20) NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  status VARCHAR(30) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'INVESTIGATING', 'CONTAINED', 'RESOLVED', 'CLOSED')),
  
  assigned_superadmin_id UUID NOT NULL REFERENCES users(id),
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  first_detected_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  contained_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  
  affected_tenant_id UUID REFERENCES school_entities(id),
  root_cause TEXT,
  resolution_notes TEXT,
  
  is_immutable BOOLEAN DEFAULT TRUE
);

-- Incident Timeline: Immutable append-only log of incident events
CREATE TABLE IF NOT EXISTS incident_timeline (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  incident_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  
  event_type VARCHAR(50) NOT NULL,
  event_description TEXT NOT NULL,
  
  actor_user_id UUID REFERENCES users(id),
  actor_superadmin_id UUID REFERENCES users(id),
  
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  evidence JSONB,
  attachment_urls TEXT[],
  
  ip_address INET,
  user_agent TEXT
);

-- Incident Affected Entities: Organizations impacted by incidents
CREATE TABLE IF NOT EXISTS incident_affected_entities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  incident_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES school_entities(id) ON DELETE CASCADE,
  
  impact_level VARCHAR(20) NOT NULL CHECK (impact_level IN ('NONE', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  users_affected INTEGER,
  
  evidence JSONB,
  
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ===========================
-- E. EXTENDED AUDIT LOGGING
-- ===========================

-- Role Change Audit: Every role assignment change
CREATE TABLE IF NOT EXISTS role_change_audit (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  user_id UUID NOT NULL REFERENCES users(id),
  
  old_role_id UUID REFERENCES roles(id),
  new_role_id UUID REFERENCES roles(id),
  
  changed_by_superadmin_id UUID NOT NULL REFERENCES users(id),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  reason TEXT NOT NULL,
  ip_address INET,
  user_agent TEXT
);

-- Tenant Change Audit: Every tenant configuration change
CREATE TABLE IF NOT EXISTS tenant_change_audit (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  tenant_id UUID NOT NULL REFERENCES school_entities(id) ON DELETE CASCADE,
  
  change_type VARCHAR(100) NOT NULL,
  old_value JSONB,
  new_value JSONB,
  
  changed_by_superadmin_id UUID NOT NULL REFERENCES users(id),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  reason TEXT,
  ip_address INET
);

-- Session Invalidation Log: Track forced logouts
CREATE TABLE IF NOT EXISTS session_invalidation_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  user_id UUID NOT NULL REFERENCES users(id),
  tenant_id UUID REFERENCES school_entities(id),
  
  invalidation_reason VARCHAR(100) NOT NULL,
  invalidated_by_superadmin_id UUID,
  invalidated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  ip_address INET
);

-- ===========================
-- F. CONVENIENCE VIEWS
-- ===========================

-- View: All pending incident approvals
CREATE OR REPLACE VIEW superadmin_all_pending_approvals AS
SELECT 
  i.id,
  i.incident_number,
  i.title,
  i.severity,
  i.status,
  i.assigned_superadmin_id,
  COUNT(iae.id) as affected_entities_count
FROM incidents i
LEFT JOIN incident_affected_entities iae ON i.id = iae.incident_id
WHERE i.status IN ('OPEN', 'INVESTIGATING')
GROUP BY i.id, i.incident_number, i.title, i.severity, i.status, i.assigned_superadmin_id;

-- View: User statistics for dashboard
CREATE OR REPLACE VIEW superadmin_user_statistics AS
SELECT 
  'system' as platform,
  COUNT(DISTINCT u.id) as total_users,
  COUNT(DISTINCT CASE WHEN u.is_active THEN u.id END) as active_users,
  COUNT(DISTINCT CASE WHEN u.created_at > NOW() - INTERVAL '7 days' THEN u.id END) as new_users_7d
FROM users u;

-- ===========================
-- G. PERFORMANCE INDEXES
-- ===========================

CREATE INDEX IF NOT EXISTS idx_tenant_lock_tenant_id ON tenant_lock_events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_lock_action ON tenant_lock_events(action);
CREATE INDEX IF NOT EXISTS idx_tenant_lock_created ON tenant_lock_events(locked_at DESC);

CREATE INDEX IF NOT EXISTS idx_tenant_config_tenant_id ON tenant_configurations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_config_key ON tenant_configurations(config_key);

CREATE INDEX IF NOT EXISTS idx_escalation_user_id ON privilege_escalation_events(user_id);
CREATE INDEX IF NOT EXISTS idx_escalation_severity ON privilege_escalation_events(severity);
CREATE INDEX IF NOT EXISTS idx_escalation_created ON privilege_escalation_events(detected_at DESC);

CREATE INDEX IF NOT EXISTS idx_system_health_service ON system_health(service_name);
CREATE INDEX IF NOT EXISTS idx_system_health_status ON system_health(status);
CREATE INDEX IF NOT EXISTS idx_system_health_checked ON system_health(last_checked_at DESC);

CREATE INDEX IF NOT EXISTS idx_metrics_name ON system_metrics(metric_name);
CREATE INDEX IF NOT EXISTS idx_metrics_recorded ON system_metrics(recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_incidents_number ON incidents(incident_number);
CREATE INDEX IF NOT EXISTS idx_incidents_severity ON incidents(severity);
CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status);
CREATE INDEX IF NOT EXISTS idx_incidents_tenant ON incidents(affected_tenant_id);
CREATE INDEX IF NOT EXISTS idx_incidents_created ON incidents(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_incident_timeline_incident_id ON incident_timeline(incident_id);
CREATE INDEX IF NOT EXISTS idx_incident_timeline_event_type ON incident_timeline(event_type);
CREATE INDEX IF NOT EXISTS idx_incident_timeline_occurred ON incident_timeline(occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_affected_entities_incident ON incident_affected_entities(incident_id);
CREATE INDEX IF NOT EXISTS idx_affected_entities_tenant ON incident_affected_entities(tenant_id);
CREATE INDEX IF NOT EXISTS idx_affected_entities_impact ON incident_affected_entities(impact_level);

CREATE INDEX IF NOT EXISTS idx_role_change_user_id ON role_change_audit(user_id);
CREATE INDEX IF NOT EXISTS idx_role_change_created ON role_change_audit(changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_role_change_admin ON role_change_audit(changed_by_superadmin_id);

CREATE INDEX IF NOT EXISTS idx_tenant_change_tenant_id ON tenant_change_audit(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_change_created ON tenant_change_audit(changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_session_invalid_user ON session_invalidation_log(user_id);
CREATE INDEX IF NOT EXISTS idx_session_invalid_created ON session_invalidation_log(invalidated_at DESC);

-- ===========================
-- MIGRATION COMPLETE
-- ===========================
