-- ===========================
-- PHASE 11 STAGE 2: TIME AUTHORITY & CLOCK DRIFT TRACKING
-- ===========================
-- Migration 017: Time Authority Foundation
--
-- Goals:
-- 1. Create immutable drift audit table
-- 2. Add time tracking to attendance records
-- 3. Establish drift threshold configuration
-- 4. Create drift analysis views
-- 5. Enforce server time authority

BEGIN;

-- ===========================
-- A. DRIFT AUDIT LOG (Immutable)
-- ===========================
-- Tracks all client-server time discrepancies
-- Critical for dispute resolution

CREATE TABLE IF NOT EXISTS drift_audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- User & Device Info
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  device_id VARCHAR(255),
  device_model VARCHAR(255),
  app_version VARCHAR(50),
  os_version VARCHAR(50),
  
  -- Time Data (Root of Truth)
  client_time TIMESTAMPTZ NOT NULL,
  server_time TIMESTAMPTZ NOT NULL,
  request_received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  -- Drift Calculation
  drift_ms INTEGER NOT NULL,
  drift_seconds DECIMAL(10, 2) NOT NULL,
  drift_direction VARCHAR(20) NOT NULL, -- 'AHEAD', 'BEHIND'
  
  -- Classification
  drift_category VARCHAR(50) NOT NULL, -- 'ACCEPTABLE', 'WARNING', 'BLOCKED', 'CRITICAL'
  action_taken VARCHAR(100) NOT NULL, -- 'PROCEED_SILENT', 'PROCEED_WITH_WARNING', 'BLOCKED', 'ESCALATED'
  
  -- Context
  action_type VARCHAR(100) NOT NULL, -- 'ATTENDANCE_MARK', 'CHECKIN', 'CHECKOUT', etc.
  action_location POINT,
  resource_type VARCHAR(100),
  resource_id UUID,
  
  -- Request Info
  ip_address INET,
  user_agent VARCHAR(500),
  network_type VARCHAR(50), -- 'wi-fi', '4g', '5g', 'cellular'
  request_id VARCHAR(255),
  
  -- Status
  http_status INTEGER,
  was_accepted BOOLEAN NOT NULL DEFAULT FALSE,
  
  -- Forensics
  forensic_flags TEXT[], -- Array of flags: 'clock_ahead', 'replay_pattern', 'spoofing_suspected', etc.
  related_anomalies TEXT[], -- Links to detected patterns
  
  -- Timezone info (for audit purposes)
  timezone VARCHAR(50),
  
  -- Immutability
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_immutable BOOLEAN DEFAULT TRUE,
  checksum VARCHAR(64)
);

-- Indexes for drift analysis
CREATE INDEX IF NOT EXISTS idx_drift_audit_user_id ON drift_audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_drift_audit_device_id ON drift_audit_log(device_id);
CREATE INDEX IF NOT EXISTS idx_drift_audit_category ON drift_audit_log(drift_category);
CREATE INDEX IF NOT EXISTS idx_drift_audit_timestamp ON drift_audit_log(server_time DESC);
CREATE INDEX IF NOT EXISTS idx_drift_audit_action ON drift_audit_log(action_type);
CREATE INDEX IF NOT EXISTS idx_drift_audit_drift_seconds ON drift_audit_log(drift_seconds DESC);
CREATE INDEX IF NOT EXISTS idx_drift_audit_created_at ON drift_audit_log(created_at DESC);

-- IMMUTABILITY TRIGGERS on drift_audit_log
DROP TRIGGER IF EXISTS prevent_drift_audit_log_update ON drift_audit_log;
DROP TRIGGER IF EXISTS prevent_drift_audit_log_delete ON drift_audit_log;

CREATE OR REPLACE FUNCTION prevent_drift_audit_log_update()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Drift audit logs are immutable. UPDATE operations are not permitted.';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION prevent_drift_audit_log_delete()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Drift audit logs are immutable. DELETE operations are not permitted.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER prevent_drift_audit_log_update
BEFORE UPDATE ON drift_audit_log
FOR EACH ROW
EXECUTE FUNCTION prevent_drift_audit_log_update();

CREATE TRIGGER prevent_drift_audit_log_delete
BEFORE DELETE ON drift_audit_log
FOR EACH ROW
EXECUTE FUNCTION prevent_drift_audit_log_delete();

-- ===========================
-- B. TIME THRESHOLDS CONFIGURATION
-- ===========================
-- Per-device-type thresholds for drift acceptance

CREATE TABLE IF NOT EXISTS time_drift_thresholds (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  device_type VARCHAR(100) NOT NULL UNIQUE, -- 'MOBILE_IOS', 'MOBILE_ANDROID', 'WEB', 'KIOSK'
  
  -- Thresholds in seconds
  acceptable_drift_seconds INTEGER NOT NULL, -- ±seconds where we don't log
  warning_drift_seconds INTEGER NOT NULL,    -- ±seconds where we warn but allow
  blocked_drift_seconds INTEGER NOT NULL,    -- ±seconds where we reject
  critical_drift_seconds INTEGER NOT NULL,   -- ±seconds for security escalation
  
  -- Behavior
  should_proceed_on_warning BOOLEAN DEFAULT TRUE,
  should_block_on_critical BOOLEAN DEFAULT TRUE,
  should_escalate_on_critical BOOLEAN DEFAULT TRUE,
  
  -- Configuration
  enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Insert default thresholds
INSERT INTO time_drift_thresholds 
  (device_type, acceptable_drift_seconds, warning_drift_seconds, blocked_drift_seconds, critical_drift_seconds)
VALUES
  ('MOBILE_IOS', 5, 300, 600, 3600),
  ('MOBILE_ANDROID', 7, 300, 600, 3600),
  ('WEB_BROWSER', 2, 120, 300, 900),
  ('KIOSK_DEVICE', 3, 60, 180, 900)
ON CONFLICT (device_type) DO NOTHING;

-- ===========================
-- C. TIME ENFORCEMENT INCIDENTS
-- ===========================
-- Tracks acceptance/rejection decisions by time authority

CREATE TABLE IF NOT EXISTS time_authority_incidents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  drift_audit_id UUID NOT NULL REFERENCES drift_audit_log(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  
  -- Incident classification
  incident_type VARCHAR(100) NOT NULL, -- 'WARNING', 'BLOCKED', 'CRITICAL'
  severity VARCHAR(50) NOT NULL,       -- 'WARNING', 'URGENT', 'CRITICAL'
  
  -- Details
  drift_seconds DECIMAL(10, 2) NOT NULL,
  threshold_exceeded_by DECIMAL(10, 2),
  
  -- Resolution
  status VARCHAR(50) DEFAULT 'OPEN', -- 'OPEN', 'INVESTIGATING', 'RESOLVED_LEGITIMATE', 'RESOLVED_FRAUD'
  resolution_notes TEXT,
  resolved_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  
  -- Immutability
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_time_incidents_user ON time_authority_incidents(user_id);
CREATE INDEX IF NOT EXISTS idx_time_incidents_severity ON time_authority_incidents(severity);
CREATE INDEX IF NOT EXISTS idx_time_incidents_status ON time_authority_incidents(status);
CREATE INDEX IF NOT EXISTS idx_time_incidents_created ON time_authority_incidents(created_at DESC);

-- ===========================
-- D. ATTENDANCE RECORD UPDATES
-- ===========================
-- Add time authority columns to attendance records

ALTER TABLE school_attendance
ADD COLUMN IF NOT EXISTS client_provided_time TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS server_recorded_time TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN IF NOT EXISTS drift_seconds DECIMAL(10, 2),
ADD COLUMN IF NOT EXISTS drift_category VARCHAR(50),
ADD COLUMN IF NOT EXISTS time_authority_validated BOOLEAN DEFAULT FALSE;

ALTER TABLE corporate_checkin
ADD COLUMN IF NOT EXISTS client_provided_time TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS server_recorded_time TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN IF NOT EXISTS drift_seconds DECIMAL(10, 2),
ADD COLUMN IF NOT EXISTS drift_category VARCHAR(50),
ADD COLUMN IF NOT EXISTS time_authority_validated BOOLEAN DEFAULT FALSE;

-- Indexes for time authority analysis
CREATE INDEX IF NOT EXISTS idx_school_attendance_drift ON school_attendance(drift_category) 
  WHERE drift_category IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_corporate_checkin_drift ON corporate_checkin(drift_category) 
  WHERE drift_category IS NOT NULL;

-- ===========================
-- E. ANALYSIS VIEWS
-- ===========================

-- View: Per-user drift statistics
CREATE OR REPLACE VIEW user_drift_statistics AS
SELECT
  user_id,
  COUNT(*) as total_events,
  COUNT(*) FILTER (WHERE drift_category = 'ACCEPTABLE') as acceptable_count,
  COUNT(*) FILTER (WHERE drift_category = 'WARNING') as warning_count,
  COUNT(*) FILTER (WHERE drift_category = 'BLOCKED') as blocked_count,
  COUNT(*) FILTER (WHERE drift_category = 'CRITICAL') as critical_count,
  AVG(drift_seconds) as avg_drift_seconds,
  MAX(drift_seconds) as max_drift_seconds,
  MIN(drift_seconds) as min_drift_seconds,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY drift_seconds) as p95_drift_seconds,
  COUNT(*) FILTER (WHERE was_accepted = FALSE) as rejected_count,
  date_trunc('day', MAX(server_time)) as last_event,
  date_trunc('day', MIN(server_time)) as first_event
FROM drift_audit_log
GROUP BY user_id;

-- View: Per-device drift statistics
CREATE OR REPLACE VIEW device_drift_statistics AS
SELECT
  device_id,
  device_model,
  COUNT(*) as total_events,
  COUNT(DISTINCT user_id) as unique_users,
  AVG(drift_seconds) as avg_drift_seconds,
  MAX(drift_seconds) as max_drift_seconds,
  STDDEV(drift_seconds) as stddev_drift_seconds,
  COUNT(*) FILTER (WHERE drift_category = 'CRITICAL') as critical_events,
  COUNT(*) FILTER (WHERE was_accepted = FALSE) as rejected_events,
  COUNT(*) FILTER (WHERE forensic_flags && ARRAY['spoofing_suspected'::text]) as spoofing_flags,
  date_trunc('day', MAX(server_time)) as last_seen
FROM drift_audit_log
GROUP BY device_id, device_model;

-- View: Drift pattern anomalies (potential fraud)
CREATE OR REPLACE VIEW drift_anomalies_potential_fraud AS
SELECT
  user_id,
  device_id,
  COUNT(*) as event_count,
  AVG(drift_seconds) as avg_drift_seconds,
  STDDEV(drift_seconds) as stddev_drift_seconds,
  COUNT(*) FILTER (WHERE drift_seconds > 300) as high_drift_count,
  COUNT(*) FILTER (WHERE drift_direction = 'AHEAD') as ahead_count,
  COUNT(*) FILTER (WHERE action_taken IN ('BLOCKED', 'ESCALATED')) as rejection_count,
  SUM(CASE WHEN forensic_flags @> ARRAY['replay_pattern'::text] THEN 1 ELSE 0 END) as replay_events,
  SUM(CASE WHEN forensic_flags @> ARRAY['spoofing_suspected'::text] THEN 1 ELSE 0 END) as spoofing_events,
  date_trunc('day', MAX(server_time)) as most_recent
FROM drift_audit_log
WHERE Created_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'
GROUP BY user_id, device_id
HAVING 
  COUNT(*) >= 5 -- At least 5 events
  AND (
    STDDEV(drift_seconds) > 100 -- High variance (inconsistent device clock)
    OR MAX(CASE WHEN forensic_flags IS NOT NULL THEN 1 ELSE 0 END) > 0 -- Forensic flags
    OR COUNT(*) FILTER (WHERE action_taken IN ('BLOCKED', 'ESCALATED')) > 0 -- Rejections
  );

-- View: Time authority incident summary
CREATE OR REPLACE VIEW time_authority_open_incidents AS
SELECT
  id,
  incident_type,
  severity,
  user_id,
  drift_seconds,
  status,
  created_at,
  (CURRENT_TIMESTAMP - created_at) as age_in_hours,
  CASE 
    WHEN severity = 'CRITICAL' AND status = 'OPEN' THEN 'URGENT_REVIEW'
    WHEN severity = 'URGENT' AND status = 'OPEN' THEN 'PRIORITY_REVIEW'
    WHEN severity = 'WARNING' AND status = 'INVESTIGATING' THEN 'PENDING_DECISION'
    ELSE 'ROUTINE'
  END as priority_bucket
FROM time_authority_incidents
WHERE status IN ('OPEN', 'INVESTIGATING')
ORDER BY severity DESC, created_at DESC;

-- ===========================
-- F. CONSTRAINTS & DOCUMENTATION
-- ===========================

COMMENT ON TABLE drift_audit_log IS
  'Immutable log of all client-server time discrepancies. Legal defense for time-based disputes.';

COMMENT ON COLUMN drift_audit_log.client_time IS
  'Time provided by client device.';

COMMENT ON COLUMN drift_audit_log.server_time IS
  'Server time when drift was calculated. Server time is the ground truth.';

COMMENT ON COLUMN drift_audit_log.drift_category IS
  'Classification: ACCEPTABLE, WARNING, BLOCKED, CRITICAL. Determines enforcement action.';

COMMENT ON TABLE time_drift_thresholds IS
  'Device-specific thresholds for acceptable clock drift. Configurable by institution.';

COMMENT ON TABLE time_authority_incidents IS
  'Incidents generated when drift exceeds thresholds. Tracked for investigation and resolution.';

-- ===========================
-- VERIFICATION SCRIPT
-- ===========================
/*

-- Test 1: Verify drift_audit_log immutability triggers exist
SELECT trigger_name, event_object_table, trigger_timing
FROM information_schema.triggers
WHERE event_object_table = 'drift_audit_log'
  AND trigger_timing = 'BEFORE';
-- Expected: 2 rows (update + delete triggers)

-- Test 2: Verify default thresholds inserted
SELECT device_type, acceptable_drift_seconds, warning_drift_seconds, blocked_drift_seconds
FROM time_drift_thresholds;
-- Expected: 4 rows with MOBILE_IOS, MOBILE_ANDROID, WEB_BROWSER, KIOSK_DEVICE

-- Test 3: Verify immutability (attempt UPDATE)
UPDATE drift_audit_log SET is_immutable = FALSE LIMIT 1;
-- Expected: ERROR: Drift audit logs are immutable

-- Test 4: Test user_drift_statistics view
SELECT * FROM user_drift_statistics LIMIT 1;
-- Expected: User drift aggregations

*/

COMMIT;
