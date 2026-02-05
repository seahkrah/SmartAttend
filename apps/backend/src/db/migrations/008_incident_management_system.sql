-- ===========================
-- PHASE 5, STEP 5.1: INCIDENT MANAGEMENT SYSTEM
-- ===========================

-- Error Classifications
CREATE TABLE IF NOT EXISTS error_classifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  error_code VARCHAR(50) NOT NULL UNIQUE,
  error_category VARCHAR(100) NOT NULL, -- 'security', 'integrity', 'system', 'business', 'user'
  severity VARCHAR(20) NOT NULL, -- 'critical', 'high', 'medium', 'low', 'info'
  description TEXT,
  auto_create_incident BOOLEAN DEFAULT false, -- Should this error automatically create an incident?
  require_escalation BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Error Fingerprints
-- Used to deduplicate and group similar errors
CREATE TABLE IF NOT EXISTS error_fingerprints (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  fingerprint_hash VARCHAR(255) NOT NULL UNIQUE,
  error_code VARCHAR(50) REFERENCES error_classifications(error_code),
  error_message TEXT,
  stack_trace_pattern TEXT, -- First N lines of stack trace for pattern matching
  occurrence_count INT DEFAULT 1,
  first_occurrence TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_occurrence TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  is_active BOOLEAN DEFAULT true
);

-- Incidents
-- Represents actionable issues that need investigation
CREATE TABLE IF NOT EXISTS incidents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  platform_id UUID NOT NULL REFERENCES platforms(id),
  incident_type VARCHAR(100) NOT NULL, -- 'error', 'security_breach', 'data_integrity', 'performance_degradation', 'service_unavailable'
  title VARCHAR(255) NOT NULL,
  description TEXT,
  severity VARCHAR(20) NOT NULL, -- 'critical', 'high', 'medium', 'low'
  status VARCHAR(50) DEFAULT 'open', -- 'open', 'investigating', 'mitigating', 'resolved', 'closed', 'escalated'
  category VARCHAR(100), -- 'security', 'integrity', 'system', 'business', 'user'
  
  -- Error relationship
  error_fingerprint_id UUID REFERENCES error_fingerprints(id),
  error_count INT DEFAULT 1,
  
  -- Detection info
  detected_by_user_id UUID REFERENCES users(id), -- NULL if detected by system
  detection_method VARCHAR(100), -- 'automated', 'user_report', 'monitoring'
  detection_source VARCHAR(255), -- Service/component that detected the incident
  
  -- Timeline
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  first_error_at TIMESTAMP,
  last_error_at TIMESTAMP,
  acknowledged_at TIMESTAMP,
  acknowledged_by_user_id UUID REFERENCES users(id),
  resolved_at TIMESTAMP,
  resolved_by_user_id UUID REFERENCES users(id),
  
  -- Impact assessment
  affected_users INT DEFAULT 0,
  affected_systems TEXT, -- JSON array of system names
  business_impact VARCHAR(255),
  estimated_loss DECIMAL(15, 2),
  
  -- Resolution
  root_cause TEXT,
  remediation_steps TEXT,
  prevention_measures TEXT,
  post_mortem_url TEXT
);

-- Indices for incident queries
CREATE INDEX idx_incidents_platform_id ON incidents(platform_id);
CREATE INDEX idx_incidents_status ON incidents(status);
CREATE INDEX idx_incidents_severity ON incidents(severity);
CREATE INDEX idx_incidents_created_at ON incidents(created_at DESC);
CREATE INDEX idx_incidents_error_fingerprint ON incidents(error_fingerprint_id);
CREATE INDEX idx_incidents_open_critical ON incidents(platform_id, status) WHERE status IN ('open', 'investigating') AND severity = 'critical';

-- Error Logs
-- Detailed error records linked to incidents
CREATE TABLE IF NOT EXISTS error_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  platform_id UUID NOT NULL REFERENCES platforms(id),
  incident_id UUID REFERENCES incidents(id),
  error_fingerprint_id UUID NOT NULL REFERENCES error_fingerprints(id),
  
  -- Error details
  error_code VARCHAR(50),
  error_message TEXT NOT NULL,
  error_type VARCHAR(100), -- 'TypeError', 'ValidationError', 'DatabaseError', etc.
  stack_trace TEXT,
  
  -- Context
  service_name VARCHAR(100),
  operation_name VARCHAR(100),
  request_id VARCHAR(255),
  user_id UUID REFERENCES users(id),
  ip_address VARCHAR(45),
  user_agent TEXT,
  
  -- Environment
  environment VARCHAR(50), -- 'development', 'staging', 'production'
  node_version VARCHAR(50),
  database_version VARCHAR(50),
  
  -- Severity and classification
  severity VARCHAR(20),
  category VARCHAR(100),
  is_recoverable BOOLEAN DEFAULT true,
  
  -- Metadata
  metadata JSONB DEFAULT '{}'::jsonb, -- Additional context like request params, database state
  resolved BOOLEAN DEFAULT false,
  resolved_at TIMESTAMP,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indices for error log queries
CREATE INDEX idx_error_logs_platform_id ON error_logs(platform_id);
CREATE INDEX idx_error_logs_incident_id ON error_logs(incident_id);
CREATE INDEX idx_error_logs_fingerprint ON error_logs(error_fingerprint_id);
CREATE INDEX idx_error_logs_severity ON error_logs(severity);
CREATE INDEX idx_error_logs_created_at ON error_logs(created_at DESC);
CREATE INDEX idx_error_logs_unresolved ON error_logs(platform_id, resolved) WHERE resolved = false;

-- Incident Notifications
-- Track who should be notified about incidents
CREATE TABLE IF NOT EXISTS incident_notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  incident_id UUID NOT NULL REFERENCES incidents(id),
  user_id UUID NOT NULL REFERENCES users(id),
  notification_type VARCHAR(50), -- 'email', 'slack', 'sms', 'in_app'
  sent_at TIMESTAMP,
  read_at TIMESTAMP,
  acknowledged_at TIMESTAMP,
  action_taken VARCHAR(255), -- What action did the user take after notification?
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indices for notification queries
CREATE INDEX idx_notifications_incident ON incident_notifications(incident_id);
CREATE INDEX idx_notifications_user ON incident_notifications(user_id);
CREATE INDEX idx_notifications_sent ON incident_notifications(sent_at) WHERE sent_at IS NOT NULL;

-- Incident Timeline
-- Detailed audit trail of incident lifecycle
CREATE TABLE IF NOT EXISTS incident_timeline_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  incident_id UUID NOT NULL REFERENCES incidents(id),
  event_type VARCHAR(100), -- 'created', 'status_changed', 'severity_updated', 'acknowledged', 'commented', 'resolved', 'escalated'
  old_value TEXT,
  new_value TEXT,
  description TEXT,
  performed_by_user_id UUID REFERENCES users(id),
  performed_by_system VARCHAR(100), -- If performed by automated system
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indices for timeline queries
CREATE INDEX idx_timeline_incident ON incident_timeline_events(incident_id);
CREATE INDEX idx_timeline_created_at ON incident_timeline_events(created_at DESC);

-- Incident Statistics
-- Aggregated metrics for dashboarding
CREATE TABLE IF NOT EXISTS incident_statistics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  platform_id UUID NOT NULL REFERENCES platforms(id),
  date DATE NOT NULL,
  
  -- Counts
  total_incidents INT DEFAULT 0,
  critical_incidents INT DEFAULT 0,
  high_incidents INT DEFAULT 0,
  medium_incidents INT DEFAULT 0,
  low_incidents INT DEFAULT 0,
  
  -- Status breakdown
  open_incidents INT DEFAULT 0,
  resolved_incidents INT DEFAULT 0,
  escalated_incidents INT DEFAULT 0,
  
  -- Error counts
  total_errors INT DEFAULT 0,
  unique_error_fingerprints INT DEFAULT 0,
  recurring_errors INT DEFAULT 0, -- Errors that occurred > 5 times
  
  -- Performance
  mttr INT, -- Mean time to resolution (minutes)
  mttd INT, -- Mean time to detection (minutes)
  avg_errors_per_incident INT,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(platform_id, date)
);

-- Indices for statistics queries
CREATE INDEX idx_statistics_platform ON incident_statistics(platform_id, date DESC);

-- Trigger: Update error fingerprint on new error log
CREATE OR REPLACE FUNCTION update_error_fingerprint_on_log()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE error_fingerprints
  SET 
    occurrence_count = occurrence_count + 1,
    last_occurrence = CURRENT_TIMESTAMP
  WHERE id = NEW.error_fingerprint_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER error_log_fingerprint_update
AFTER INSERT ON error_logs
FOR EACH ROW
EXECUTE FUNCTION update_error_fingerprint_on_log();

-- Trigger: Update incident error count
CREATE OR REPLACE FUNCTION update_incident_error_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE incidents
  SET 
    error_count = error_count + 1,
    last_error_at = CURRENT_TIMESTAMP
  WHERE id = NEW.incident_id AND NEW.incident_id IS NOT NULL;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER error_log_incident_count_update
AFTER INSERT ON error_logs
FOR EACH ROW
WHEN (NEW.incident_id IS NOT NULL)
EXECUTE FUNCTION update_incident_error_count();
