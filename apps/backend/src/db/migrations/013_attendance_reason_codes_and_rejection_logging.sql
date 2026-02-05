-- PHASE 10, STAGE 1: Attendance Reason Codes & Rejection Logging
-- Description: Implement standardized reason codes and rejection event tracking

-- ===========================
-- ATTENDANCE REASON CODES TABLE
-- ===========================

CREATE TABLE IF NOT EXISTS attendance_reason_codes (
  code VARCHAR(50) PRIMARY KEY,
  category VARCHAR(50) NOT NULL,
  description TEXT NOT NULL,
  valid_for_states VARCHAR(500),  -- Comma-separated list of valid target states
  is_system_generated BOOLEAN DEFAULT FALSE,
  requires_additional_justification BOOLEAN DEFAULT FALSE,
  severity_level VARCHAR(20),  -- 'info', 'warning', 'critical'
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index for lookups
CREATE INDEX IF NOT EXISTS idx_reason_codes_category ON attendance_reason_codes(category);

-- Add sample reason codes (will be inserted via application)
-- This is the taxonomy referenced in the specification

-- ===========================
-- ATTENDANCE TRANSITION ATTEMPTS TABLE
-- Logs every attempted state transition (success AND failure)
-- ===========================

CREATE TABLE IF NOT EXISTS attendance_transition_attempts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  attendance_record_id UUID NOT NULL,
  record_type VARCHAR(50) NOT NULL,  -- 'school_attendance' or 'corporate_checkins'
  current_state VARCHAR(50) NOT NULL,
  requested_state VARCHAR(50) NOT NULL,
  reason_code VARCHAR(50) REFERENCES attendance_reason_codes(code),
  additional_justification TEXT,
  status VARCHAR(20) NOT NULL,  -- 'ACCEPTED' or 'REJECTED'
  rejection_reason VARCHAR(500),  -- WHY it was rejected if status = REJECTED
  requested_by_user_id UUID NOT NULL REFERENCES users(id),
  request_ip_address INET,
  request_user_agent TEXT,
  attempted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  -- Constraints
  CONSTRAINT valid_status CHECK (status IN ('ACCEPTED', 'REJECTED')),
  CONSTRAINT valid_states CHECK (current_state != requested_state OR status = 'REJECTED'),
  CONSTRAINT rejected_must_have_reason CHECK (status != 'REJECTED' OR rejection_reason IS NOT NULL)
);

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_attempts_record 
  ON attendance_transition_attempts(attendance_record_id, record_type);
CREATE INDEX IF NOT EXISTS idx_attempts_status 
  ON attendance_transition_attempts(status);
CREATE INDEX IF NOT EXISTS idx_attempts_timestamp 
  ON attendance_transition_attempts(attempted_at DESC);
CREATE INDEX IF NOT EXISTS idx_attempts_user 
  ON attendance_transition_attempts(requested_by_user_id);
CREATE INDEX IF NOT EXISTS idx_attempts_state_transition 
  ON attendance_transition_attempts(current_state, requested_state);
CREATE INDEX IF NOT EXISTS idx_attempts_rejection_pattern 
  ON attendance_transition_attempts(rejection_reason) 
  WHERE status = 'REJECTED';

-- ===========================
-- ATTENDANCE IDEMPOTENCY KEYS TABLE
-- Prevents duplicate attendance marking
-- ===========================

CREATE TABLE IF NOT EXISTS attendance_idempotency_keys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  attendance_record_id UUID NOT NULL REFERENCES school_attendance(id) ON DELETE CASCADE,
  idempotency_key VARCHAR(255) NOT NULL UNIQUE,
  source_system VARCHAR(50),  -- 'biometric', 'manual_faculty', 'visitor_badge', 'manual_admin'
  source_device_id VARCHAR(100),  -- Device that generated the mark
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  CONSTRAINT no_empty_key CHECK (LENGTH(idempotency_key) > 0)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_idempotency_key 
  ON attendance_idempotency_keys(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_idempotency_record 
  ON attendance_idempotency_keys(attendance_record_id);
CREATE INDEX IF NOT EXISTS idx_idempotency_source 
  ON attendance_idempotency_keys(source_system);

-- ===========================
-- ENHANCED CLOCK DRIFT LOGGING
-- ===========================

-- Note: clock_drift_log table likely exists. This adds additional columns if needed.
ALTER TABLE IF EXISTS clock_drift_log
ADD COLUMN IF NOT EXISTS client_device_id VARCHAR(100),
ADD COLUMN IF NOT EXISTS is_flagged_for_review BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS review_status VARCHAR(50) DEFAULT 'pending';

CREATE INDEX IF NOT EXISTS idx_drift_flagged 
  ON clock_drift_log(is_flagged_for_review) 
  WHERE is_flagged_for_review = TRUE;

-- ===========================
-- IMMUTABILITY TRIGGERS FOR NEW TABLES
-- ===========================

-- Function to prevent modifications to audit/history tables
CREATE OR REPLACE FUNCTION attendance_immutable_error()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Attendance reason codes, transition attempts, and idempotency keys are immutable. Cannot modify or delete records.'
      USING ERRCODE = '28000',
            HINT = 'These tables preserve the complete history of attendance decisions and must never be altered.';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Apply immutability to reason codes (should rarely change, but protect for compliance)
CREATE TRIGGER attendance_reason_codes_immutable_delete
BEFORE DELETE ON attendance_reason_codes
FOR EACH ROW
EXECUTE FUNCTION attendance_immutable_error();

-- Note: UPDATE on reason codes is allowed (you might rename a category)
-- Only DELETE is prevented

-- Apply immutability to transition attempts (never modify - core audit trail)
CREATE TRIGGER attendance_transition_attempts_immutable_update
BEFORE UPDATE ON attendance_transition_attempts
FOR EACH ROW
EXECUTE FUNCTION attendance_immutable_error();

CREATE TRIGGER attendance_transition_attempts_immutable_delete
BEFORE DELETE ON attendance_transition_attempts
FOR EACH ROW
EXECUTE FUNCTION attendance_immutable_error();

-- Apply immutability to idempotency keys (never modify - core deduplication)
CREATE TRIGGER attendance_idempotency_keys_immutable_update
BEFORE UPDATE ON attendance_idempotency_keys
FOR EACH ROW
EXECUTE FUNCTION attendance_immutable_error();

CREATE TRIGGER attendance_idempotency_keys_immutable_delete
BEFORE DELETE ON attendance_idempotency_keys
FOR EACH ROW
EXECUTE FUNCTION attendance_immutable_error();

-- ===========================
-- VALIDATION FUNCTIONS
-- ===========================

-- Function to check if a reason code is valid for a target state
CREATE OR REPLACE FUNCTION is_valid_reason_for_state(
  code VARCHAR(50),
  target_state VARCHAR(50)
)
RETURNS BOOLEAN AS $$
DECLARE
  valid_states VARCHAR(500);
BEGIN
  SELECT valid_for_states INTO valid_states 
  FROM attendance_reason_codes 
  WHERE code = $1;
  
  IF valid_states IS NULL THEN
    RETURN FALSE;
  END IF;
  
  -- Check if target_state is in the comma-separated list
  RETURN target_state = ANY(STRING_TO_ARRAY(valid_states, ','));
END;
$$ LANGUAGE plpgsql STABLE;

-- ===========================
-- VIEWS FOR ANALYSIS
-- ===========================

-- View: All rejected transitions with reasons
CREATE OR REPLACE VIEW attendance_rejected_transitions AS
SELECT
  ata.id,
  ata.attendance_record_id,
  ata.record_type,
  ata.current_state,
  ata.requested_state,
  ata.rejection_reason,
  ata.requested_by_user_id,
  u.email as requested_by_email,
  ata.attempted_at,
  COUNT(*) OVER (PARTITION BY ata.rejection_reason) as same_rejection_count
FROM attendance_transition_attempts ata
LEFT JOIN users u ON ata.requested_by_user_id = u.id
WHERE ata.status = 'REJECTED'
ORDER BY ata.attempted_at DESC;

-- View: Duplicate marking patterns
CREATE OR REPLACE VIEW attendance_duplicate_patterns AS
SELECT
  sa.student_id,
  sa.course_id,
  sa.attendance_date,
  COUNT(sa.id) as mark_count,
  STRING_AGG(sa.id::TEXT, ',') as record_ids,
  MIN(sa.created_at) as first_mark_time,
  MAX(sa.created_at) as last_mark_time,
  EXTRACT(EPOCH FROM (MAX(sa.created_at) - MIN(sa.created_at))) as seconds_between,
  CASE 
    WHEN EXTRACT(EPOCH FROM (MAX(sa.created_at) - MIN(sa.created_at))) <= 120 THEN 'critical'
    WHEN EXTRACT(EPOCH FROM (MAX(sa.created_at) - MIN(sa.created_at))) <= 600 THEN 'high'
    ELSE 'medium'
  END as severity
FROM school_attendance sa
GROUP BY sa.student_id, sa.course_id, sa.attendance_date
HAVING COUNT(sa.id) > 1
ORDER BY seconds_between ASC;

-- View: Clock drift incidents
CREATE OR REPLACE VIEW attendance_clock_drift_incidents AS
SELECT
  cdl.id,
  cdl.attendance_record_id,
  cdl.tenant_id,
  cdl.user_id,
  cdl.client_timestamp,
  cdl.server_timestamp,
  cdl.drift_seconds,
  cdl.severity,
  CASE 
    WHEN cdl.drift_seconds > 3600 THEN 'critical'
    WHEN cdl.drift_seconds > 600 THEN 'high'
    WHEN cdl.drift_seconds > 60 THEN 'medium'
    ELSE 'low'
  END as adjusted_severity,
  cdl.is_flagged_for_review
FROM clock_drift_log cdl
WHERE cdl.severity IN ('medium', 'high')
ORDER BY cdl.drift_seconds DESC;

-- ===========================
-- MIGRATION METADATA
-- ===========================

-- Add this migration to the migrations table
SELECT 1 WHERE NOT EXISTS (
  SELECT 1 FROM migrations 
  WHERE name = '013_attendance_reason_codes_and_rejection_logging.sql'
);
