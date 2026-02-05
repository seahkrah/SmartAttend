-- PHASE 6, STEP 6.1: Attendance State Machine
-- Description: Replace boolean attendance flags with explicit state machine
-- States: VERIFIED, FLAGGED, REVOKED, MANUAL_OVERRIDE

-- ===========================
-- SCHOOL ATTENDANCE STATES
-- ===========================

-- Add state machine columns to school_attendance
ALTER TABLE IF EXISTS school_attendance 
ADD COLUMN IF NOT EXISTS attendance_state VARCHAR(50) DEFAULT 'VERIFIED';

ALTER TABLE IF EXISTS school_attendance 
ADD COLUMN IF NOT EXISTS state_reason VARCHAR(255);

ALTER TABLE IF EXISTS school_attendance 
ADD COLUMN IF NOT EXISTS state_changed_by UUID REFERENCES users(id);

ALTER TABLE IF EXISTS school_attendance 
ADD COLUMN IF NOT EXISTS state_changed_at TIMESTAMP;

ALTER TABLE IF EXISTS school_attendance 
ADD COLUMN IF NOT EXISTS state_audit_notes TEXT;

-- Create index for state queries
CREATE INDEX IF NOT EXISTS idx_school_attendance_state ON school_attendance(attendance_state);
CREATE INDEX IF NOT EXISTS idx_school_attendance_date_state ON school_attendance(attendance_date, attendance_state);
CREATE INDEX IF NOT EXISTS idx_school_attendance_student_state ON school_attendance(student_id, attendance_state);

-- ===========================
-- CORPORATE CHECKIN STATES
-- ===========================

-- Add state machine columns to corporate_checkins
ALTER TABLE IF EXISTS corporate_checkins 
ADD COLUMN IF NOT EXISTS checkin_state VARCHAR(50) DEFAULT 'VERIFIED';

ALTER TABLE IF EXISTS corporate_checkins 
ADD COLUMN IF NOT EXISTS state_reason VARCHAR(255);

ALTER TABLE IF EXISTS corporate_checkins 
ADD COLUMN IF NOT EXISTS state_changed_by UUID REFERENCES users(id);

ALTER TABLE IF EXISTS corporate_checkins 
ADD COLUMN IF NOT EXISTS state_changed_at TIMESTAMP;

ALTER TABLE IF EXISTS corporate_checkins 
ADD COLUMN IF NOT EXISTS state_audit_notes TEXT;

-- Create indexes for corporate checkin states
CREATE INDEX IF NOT EXISTS idx_corporate_checkins_state ON corporate_checkins(checkin_state);
CREATE INDEX IF NOT EXISTS idx_corporate_checkins_time_state ON corporate_checkins(check_in_time, checkin_state);
CREATE INDEX IF NOT EXISTS idx_corporate_checkins_employee_state ON corporate_checkins(employee_id, checkin_state);

-- ===========================
-- ATTENDANCE STATE HISTORY TABLE
-- ===========================

-- Track all state transitions for audit trail
CREATE TABLE IF NOT EXISTS attendance_state_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  attendance_record_id UUID NOT NULL,  -- school_attendance or corporate_checkins  id
  record_type VARCHAR(50) NOT NULL,     -- 'school_attendance' or 'corporate_checkins'
  previous_state VARCHAR(50),
  new_state VARCHAR(50) NOT NULL,
  reason VARCHAR(255),
  changed_by_user_id UUID REFERENCES users(id),
  audit_notes TEXT,
  changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_state_history_record ON attendance_state_history(attendance_record_id, record_type);
CREATE INDEX IF NOT EXISTS idx_state_history_state ON attendance_state_history(new_state);
CREATE INDEX IF NOT EXISTS idx_state_history_timestamp ON attendance_state_history(changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_state_history_user ON attendance_state_history(changed_by_user_id);

-- ===========================
-- STATE VALIDATION CONSTRAINT
-- ===========================

-- Create function to validate state values
CREATE OR REPLACE FUNCTION validate_attendance_state(state VARCHAR)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN state IN ('VERIFIED', 'FLAGGED', 'REVOKED', 'MANUAL_OVERRIDE');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Add constraints using the validation function
ALTER TABLE IF EXISTS school_attendance
ADD CONSTRAINT check_school_attendance_state 
CHECK (validate_attendance_state(attendance_state));

ALTER TABLE IF EXISTS corporate_checkins
ADD CONSTRAINT check_corporate_checkins_state 
CHECK (validate_attendance_state(checkin_state));

-- ===========================
-- INTEGRITY FLAGS VIEW
-- ===========================

-- Create view for flagged attendance records
CREATE OR REPLACE VIEW flagged_attendance_records AS
SELECT 
  'school_attendance' as record_type,
  id,
  NULL::UUID as employee_id,
  student_id,
  attendance_date as event_date,
  NULL::TIMESTAMP as check_in_time,
  'FLAGGED'::VARCHAR(50) as state,
  state_reason as reason,
  state_changed_by as changed_by,
  state_changed_at as changed_at
FROM school_attendance
WHERE attendance_state = 'FLAGGED'

UNION ALL

SELECT 
  'corporate_checkins' as record_type,
  id,
  employee_id,
  NULL::UUID as student_id,
  check_in_time::DATE as event_date,
  check_in_time,
  'FLAGGED'::VARCHAR(50) as state,
  state_reason as reason,
  state_changed_by as changed_by,
  state_changed_at as changed_at
FROM corporate_checkins
WHERE checkin_state = 'FLAGGED'
ORDER BY changed_at DESC;

-- ===========================
-- VERIFIED ATTENDANCE VIEW
-- ===========================

CREATE OR REPLACE VIEW verified_attendance_records AS
SELECT 
  'school_attendance' as record_type,
  id,
  NULL::UUID as employee_id,
  student_id,
  attendance_date as event_date,
  NULL::TIMESTAMP as check_in_time,
  'VERIFIED'::VARCHAR(50) as state,
  state_reason as reason,
  state_changed_by as changed_by,
  state_changed_at as changed_at
FROM school_attendance
WHERE attendance_state = 'VERIFIED'

UNION ALL

SELECT 
  'corporate_checkins' as record_type,
  id,
  employee_id,
  NULL::UUID as student_id,
  check_in_time::DATE as event_date,
  check_in_time,
  'VERIFIED'::VARCHAR(50) as state,
  state_reason as reason,
  state_changed_by as changed_by,
  state_changed_at as changed_at
FROM corporate_checkins
WHERE checkin_state = 'VERIFIED'
ORDER BY changed_at DESC;
