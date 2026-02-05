-- PHASE 6, STEP 6.2: Immutable Correction History
-- Description: Non-destructive attendance corrections with complete audit trail
-- Key Principle: Silent corrections are prohibited - all must be logged with visible reasons

-- ===========================
-- ATTENDANCE CORRECTIONS TABLE
-- ===========================

-- Create the validation functions BEFORE using them in triggers
CREATE OR REPLACE FUNCTION prevent_table_deletion()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Attendance corrections cannot be deleted. Corrections are immutable. Use revert operation instead.';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION allow_revert_only_updates()
RETURNS TRIGGER AS $$
BEGIN
  -- Only allow updating revert-related fields
  IF (OLD.is_reverted IS DISTINCT FROM NEW.is_reverted OR
      OLD.reverted_by_user_id IS DISTINCT FROM NEW.reverted_by_user_id OR
      OLD.revert_reason IS DISTINCT FROM NEW.revert_reason) THEN
    -- Only allow transition from false to true
    IF NEW.is_reverted = true AND OLD.is_reverted = false THEN
      RETURN NEW;
    ELSE
      RAISE EXCEPTION 'Invalid revert operation. Can only mark as reverted, not un-revert.';
    END IF;
  ELSE
    RAISE EXCEPTION 'Corrections are immutable. Cannot modify original correction data.';
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Now create the table
CREATE TABLE IF NOT EXISTS attendance_corrections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  attendance_record_id UUID NOT NULL,
  record_type VARCHAR(50) NOT NULL,  -- 'school_attendance' or 'corporate_checkins'
  
  -- Original values (immutable reference)
  original_status VARCHAR(50),
  original_attendance_state VARCHAR(50),
  original_face_verified BOOLEAN,
  
  -- Corrected values
  corrected_status VARCHAR(50),
  corrected_attendance_state VARCHAR(50),
  corrected_face_verified BOOLEAN,
  
  -- Correction metadata (mandatory)
  correction_reason TEXT NOT NULL,  -- WHY the correction was made
  correction_type VARCHAR(100) NOT NULL,  -- e.g., 'data_entry_error', 'biometric_revalidation', 'system_override', 'policy_exception'
  
  -- Audit trail (immutable)
  corrected_by_user_id UUID NOT NULL REFERENCES users(id),
  correction_timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  -- Optional supporting documentation
  supporting_evidence_url TEXT,  -- URL to proof/evidence of correction
  approval_notes TEXT,  -- Additional context for reviewers
  
  -- Status tracking
  is_reverted BOOLEAN DEFAULT false,
  reverted_at TIMESTAMP,
  reverted_by_user_id UUID REFERENCES users(id),
  revert_reason TEXT
);

-- IMMUTABILITY: Prevent deletion of corrections
CREATE TRIGGER prevent_correction_deletion
BEFORE DELETE ON attendance_corrections
FOR EACH ROW
EXECUTE FUNCTION prevent_table_deletion();

-- IMMUTABILITY: Allow only specific fields to be updated (revert_only)
CREATE TRIGGER allow_only_revert_updates
BEFORE UPDATE ON attendance_corrections
FOR EACH ROW
EXECUTE FUNCTION allow_revert_only_updates();

-- ===========================
-- INDEXES FOR PERFORMANCE
-- ===========================

CREATE INDEX IF NOT EXISTS idx_corrections_record ON attendance_corrections(attendance_record_id, record_type);
CREATE INDEX IF NOT EXISTS idx_corrections_timestamp ON attendance_corrections(correction_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_corrections_reason ON attendance_corrections(correction_reason);
CREATE INDEX IF NOT EXISTS idx_corrections_type ON attendance_corrections(correction_type);
CREATE INDEX IF NOT EXISTS idx_corrections_user ON attendance_corrections(corrected_by_user_id);
CREATE INDEX IF NOT EXISTS idx_corrections_reverted ON attendance_corrections(is_reverted) WHERE is_reverted = true;

-- ===========================
-- CORRECTION TYPES ENUM (for consistency)
-- ===========================

CREATE TYPE correction_type_enum AS ENUM (
  'data_entry_error',           -- Manual data entry mistake
  'biometric_revalidation',     -- Re-verified biometric authenticity
  'system_override',            -- System administrator manual override
  'policy_exception',           -- Legitimate policy exception
  'duplicate_entry_removal',    -- Removed duplicate record
  'time_synchronization_fix',   -- Fixed time zone or sync issue
  'device_malfunction_correction', -- Corrected for device failure
  'attendance_appeal_approved'  -- Student/employee appeal approved
);

-- ===========================
-- CORRECTION AUDIT TABLE (meta-audit)
-- ===========================

CREATE TABLE IF NOT EXISTS correction_audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  correction_id UUID NOT NULL REFERENCES attendance_corrections(id) ON DELETE CASCADE,
  action VARCHAR(100) NOT NULL,  -- 'created', 'reverted', 'approved', 'rejected'
  actor_user_id UUID NOT NULL REFERENCES users(id),
  action_timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  action_notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_correction_audit_correction ON correction_audit_log(correction_id);
CREATE INDEX IF NOT EXISTS idx_correction_audit_action ON correction_audit_log(action);
CREATE INDEX IF NOT EXISTS idx_correction_audit_actor ON correction_audit_log(actor_user_id);

-- ===========================
-- CORRECTION STATISTICS VIEW
-- ===========================

CREATE OR REPLACE VIEW correction_statistics AS
SELECT 
  correction_type,
  COUNT(*) as total_corrections,
  COUNT(CASE WHEN is_reverted THEN 1 END) as reverted_count,
  COUNT(CASE WHEN is_reverted = false THEN 1 END) as active_count,
  DATE(correction_timestamp) as correction_date
FROM attendance_corrections
GROUP BY correction_type, DATE(correction_timestamp)
ORDER BY correction_date DESC, correction_type;

-- ===========================
-- CORRECTION TRAIL VIEW (for compliance reporting)
-- ===========================

CREATE OR REPLACE VIEW attendance_correction_trail AS
SELECT 
  ac.id as correction_id,
  ac.attendance_record_id,
  ac.record_type,
  ac.original_status,
  ac.corrected_status,
  ac.original_attendance_state,
  ac.corrected_attendance_state,
  ac.correction_reason,
  ac.correction_type,
  u.email as corrected_by,
  ac.correction_timestamp,
  ac.supporting_evidence_url,
  ac.is_reverted,
  ac.reverted_at,
  ur.email as reverted_by,
  ac.revert_reason,
  CASE 
    WHEN ac.is_reverted THEN 'REVERTED'
    ELSE 'ACTIVE'
  END as status
FROM attendance_corrections ac
LEFT JOIN users u ON ac.corrected_by_user_id = u.id
LEFT JOIN users ur ON ac.reverted_by_user_id = ur.id
ORDER BY ac.correction_timestamp DESC;
