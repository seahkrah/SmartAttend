-- ATTENDANCE REASON CODES TAXONOMY
-- Insert into attendance_reason_codes table during database initialization

-- ===========================
-- INITIAL MARKING (When attendance is first marked)
-- ===========================

INSERT INTO attendance_reason_codes 
(code, category, description, valid_for_states, is_system_generated, requires_additional_justification, severity_level)
VALUES
('AUTO_MARKED', 'INITIAL_MARKING', 
 'Attendance marked automatically by biometric system (face recognition, badge, etc.)', 
 'VERIFIED', true, false, 'info'),

('MANUAL_VERIFIED', 'INITIAL_MARKING',
 'Faculty member manually marked attendance during or after class',
 'VERIFIED', false, false, 'info'),

('VISITOR_CHECKIN', 'INITIAL_MARKING',
 'Visitor or contractor checked in via badge reader or manual entry',
 'VERIFIED', false, false, 'info'),

('SYSTEM_IMPORTED', 'INITIAL_MARKING',
 'Attendance imported from external system or legacy database',
 'VERIFIED', true, true, 'warning');

-- ===========================
-- SECURITY REVIEW (Flagging for investigation)
-- ===========================

INSERT INTO attendance_reason_codes
(code, category, description, valid_for_states, is_system_generated, requires_additional_justification, severity_level)
VALUES
('FACE_MISMATCH', 'SECURITY_REVIEW',
 'Face recognition confidence score below security threshold (< 85%)',
 'FLAGGED', true, false, 'warning'),

('DUPLICATE_SAME_HOUR', 'SECURITY_REVIEW',
 'Same student marked present multiple times within 1 hour window',
 'FLAGGED', true, true, 'critical'),

('DUPLICATE_SAME_DAY', 'SECURITY_REVIEW',
 'Same student marked present multiple times on same day for different classes in impossible locations',
 'FLAGGED', true, true, 'critical'),

('TIME_ANOMALY', 'SECURITY_REVIEW',
 'Clock drift detected: device time differs from server time by more than 5 minutes',
 'FLAGGED', true, false, 'warning'),

('IP_MISMATCH', 'SECURITY_REVIEW',
 'Attendance marked from IP address different from student''s normal location or known network',
 'FLAGGED', true, false, 'warning'),

('DEVICE_SPOOFING', 'SECURITY_REVIEW',
 'Biometric device shows signs of spoofing attempt (liveness check failed, unusual recognition pattern)',
 'FLAGGED', true, true, 'critical'),

('USER_REPORTED_FRAUD', 'SECURITY_REVIEW',
 'Another user (instructor, admin) reported possible fraud or duplicate marking',
 'FLAGGED', false, true, 'warning');

-- ===========================
-- ADMIN DECISION (Administrator flagging for investigation)
-- ===========================

INSERT INTO attendance_reason_codes
(code, category, description, valid_for_states, is_system_generated, requires_additional_justification, severity_level)
VALUES
('ADMIN_REVIEW_REQUESTED', 'INVESTIGATION',
 'Administrator flagging record for manual review',
 'FLAGGED', false, true, 'info'),

('SECURITY_HOLD', 'INVESTIGATION',
 'Record placed on hold pending security investigation or verification',
 'FLAGGED', false, true, 'warning'),

('INSTRUCTOR_DISPUTE', 'INVESTIGATION',
 'Instructor disputes the attendance marking or requests investigation',
 'FLAGGED', false, true, 'warning');

-- ===========================
-- RESOLUTION (Investigation outcomes)
-- ===========================

INSERT INTO attendance_reason_codes
(code, category, description, valid_for_states, is_system_generated, requires_additional_justification, severity_level)
VALUES
('FALSE_POSITIVE', 'RESOLUTION',
 'Investigation completed: No fraud detected. Student was legitimately present.',
 'VERIFIED', false, false, 'info'),

('CONFIRMED_FRAUD', 'RESOLUTION',
 'Investigation completed: Fraud confirmed. Attendance record must be removed.',
 'REVOKED', false, true, 'critical'),

('CONFIRMED_FALSE_MARKING', 'RESOLUTION',
 'Investigation confirmed: Student was NOT present despite marking. Record revoked.',
 'REVOKED', false, true, 'critical'),

('TECHNICAL_ERROR', 'RESOLUTION',
 'Investigation found system or device error caused incorrect marking',
 'REVOKED', true, true, 'warning'),

('POLICY_EXCEPTION_GRANTED', 'RESOLUTION',
 'Manual override: Student legitimately absent but policy exception granted (medical, emergency, etc.)',
 'MANUAL_OVERRIDE', false, true, 'info'),

('COURSE_DROPPED', 'RESOLUTION',
 'Student dropped course after attendance was marked. Record voided.',
 'REVOKED', false, false, 'info'),

('ADMIN_CORRECTION', 'RESOLUTION',
 'Administrator corrected marking due to clerical error or system malfunction prior to any flag',
 'VERIFIED', false, true, 'info');

-- ===========================
-- APPEAL & RECONSIDERATION
-- ===========================

INSERT INTO attendance_reason_codes
(code, category, description, valid_for_states, is_system_generated, requires_additional_justification, severity_level)
VALUES
('STUDENT_APPEAL_GRANTED', 'RESOLUTION',
 'Student appealed flagged/revoked record. Appeal evidence reviewed and accepted.',
 'VERIFIED', false, true, 'info'),

('STUDENT_APPEAL_DENIED', 'RESOLUTION',
 'Student appealed but evidence did not support reversal. Decision stands.',
 'REVOKED', false, true, 'info');

-- ===========================
-- SYSTEM CORRECTIONS
-- ===========================

INSERT INTO attendance_reason_codes
(code, category, description, valid_for_states, is_system_generated, requires_additional_justification, severity_level)
VALUES
('SYSTEM_DUPLICATE_DETECTED', 'RESOLUTION',
 'System detected and removed duplicate marking via idempotency key',
 'REVOKED', true, false, 'info'),

('SYSTEM_CONFLICT_RESOLVED', 'RESOLUTION',
 'System resolved concurrent state change conflict by selecting most authoritative version',
 'VERIFIED', true, true, 'warning'),

('SYSTEM_RECOVERY', 'RESOLUTION',
 'Recovered attendance record from system failure or corruption detection',
 'VERIFIED', true, true, 'critical');

-- ===========================
-- COMPLIANCE & REPORTING
-- ===========================

INSERT INTO attendance_reason_codes
(code, category, description, valid_for_states, is_system_generated, requires_additional_justification, severity_level)
VALUES
('COMPLIANCE_AUDIT_CORRECTION', 'RESOLUTION',
 'Corrected per compliance audit or institutional policy enforcement',
 'VERIFIED', false, true, 'info'),

('DATA_QUALITY_FIX', 'RESOLUTION',
 'Corrected due to data quality initiative (normalization, deduplication, etc.)',
 'VERIFIED', true, true, 'info'),

('LEGACY_SYSTEM_CLEANUP', 'RESOLUTION',
 'Cleaned up or removed during legacy system decommissioning',
 'REVOKED', true, true, 'info');

-- ===========================
-- VERIFY INSERTION
-- ===========================

-- Log the insertion
DO $$
BEGIN
  RAISE NOTICE 'Attendance reason codes taxonomy loaded: % codes inserted',
    (SELECT COUNT(*) FROM attendance_reason_codes);
END $$;
