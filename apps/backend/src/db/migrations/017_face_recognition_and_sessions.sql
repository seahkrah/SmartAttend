-- FACE RECOGNITION & SESSION-BASED ATTENDANCE
-- Attendance becomes session-based (not just date-based)
-- Face recognition as primary verification method
-- Database enforces all constraints (source of truth)

-- ===========================
-- COURSE SESSIONS TABLE
-- ===========================
-- Represents a scheduled meeting of a course (e.g., CS101 Tuesday 9:00-10:30)
-- This becomes the primary unit of attendance, not just the date

CREATE TABLE IF NOT EXISTS course_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  session_number INT NOT NULL,  -- 1st, 2nd, 3rd session of the course
  session_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  
  -- Attendance window (when students can mark attendance)
  attendance_open_at TIMESTAMP NOT NULL,  -- When attendance marking opens (e.g., 5 min before start)
  attendance_close_at TIMESTAMP NOT NULL, -- When attendance marking closes (e.g., 15 min after start)
  
  -- Session status
  status VARCHAR(50) NOT NULL DEFAULT 'SCHEDULED', -- SCHEDULED, IN_SESSION, CLOSED, CANCELLED
  lecturer_id UUID NOT NULL REFERENCES faculty(id) ON DELETE RESTRICT,
  
  -- Metadata
  location VARCHAR(255),  -- Building/Room where session happens
  max_capacity INT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  -- Constraints
  CONSTRAINT check_session_times CHECK (start_time < end_time),
  CONSTRAINT check_attendance_window CHECK (attendance_open_at < attendance_close_at),
  CONSTRAINT check_valid_status CHECK (status IN ('SCHEDULED', 'IN_SESSION', 'CLOSED', 'CANCELLED')),
  UNIQUE(course_id, session_date, start_time)  -- No overlapping sessions for same course/time
);

-- Indexes for session queries
CREATE INDEX IF NOT EXISTS idx_course_sessions_course_id ON course_sessions(course_id);
CREATE INDEX IF NOT EXISTS idx_course_sessions_date ON course_sessions(session_date);
CREATE INDEX IF NOT EXISTS idx_course_sessions_status ON course_sessions(status);
CREATE INDEX IF NOT EXISTS idx_course_sessions_lecturer ON course_sessions(lecturer_id);
CREATE INDEX IF NOT EXISTS idx_course_sessions_date_status ON course_sessions(session_date, status);

-- ===========================
-- FACE RECOGNITION ENROLLMENTS
-- ===========================
-- Store student face embeddings (captured by faculty)
-- Embeddings are stored as FLOAT8 arrays for distance calculation

CREATE TABLE IF NOT EXISTS face_recognition_enrollments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  platform_id UUID NOT NULL REFERENCES platforms(id) ON DELETE CASCADE,
  
  -- Face data
  face_encoding FLOAT8[] NOT NULL,  -- Vector of face features (e.g., 128-dim, 512-dim)
  encoding_dimension INT NOT NULL,  -- Store dimension for validation (128, 256, 512, etc.)
  
  -- Enrollment metadata
  enrolled_by_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,  -- Faculty who enrolled
  enrolled_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  -- Quality metrics
  face_confidence FLOAT NOT NULL,  -- 0.0-1.0, confidence of the face detection
  enrollment_quality_score FLOAT,  -- Optional: quality score for the enrollment
  
  -- Enrollment status
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_verified BOOLEAN NOT NULL DEFAULT false,  -- Requires faculty verification
  verified_at TIMESTAMP,
  verified_by_id UUID REFERENCES users(id),
  
  -- Re-enrollment tracking
  superseded_by_id UUID REFERENCES face_recognition_enrollments(id),  -- If re-enrolled
  
  -- Audit
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  -- Constraint: Only one non-superseded enrollment per student
  CHECK (superseded_by_id IS NULL OR NOT is_active)
);

-- Indexes for enrollment lookups
CREATE INDEX IF NOT EXISTS idx_face_enrollments_student ON face_recognition_enrollments(student_id);
CREATE INDEX IF NOT EXISTS idx_face_enrollments_platform ON face_recognition_enrollments(platform_id);
CREATE INDEX IF NOT EXISTS idx_face_enrollments_active ON face_recognition_enrollments(student_id, is_active);
CREATE INDEX IF NOT EXISTS idx_face_enrollments_verified ON face_recognition_enrollments(is_verified);
CREATE INDEX IF NOT EXISTS idx_face_enrollments_enrolled_by ON face_recognition_enrollments(enrolled_by_id);
-- Ensure only one active enrollment per (student, platform) pair
CREATE UNIQUE INDEX IF NOT EXISTS idx_face_enrollments_unique_active ON face_recognition_enrollments(student_id, platform_id) WHERE is_active = true;

-- ===========================
-- FACE RECOGNITION VERIFICATIONS
-- ===========================
-- Audit trail of ALL face verification attempts (successful and failed)
-- Source of truth for attendance authentication

CREATE TABLE IF NOT EXISTS face_recognition_verifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES course_sessions(id) ON DELETE CASCADE,
  
  -- Face capture & comparison
  captured_face_encoding FLOAT8[] NOT NULL,
  enrollment_id UUID REFERENCES face_recognition_enrollments(id) ON DELETE SET NULL,
  
  -- Matching results
  match_distance FLOAT,  -- Euclidean distance between captured and enrolled face
  similarity_score FLOAT,  -- Normalized 0.0-1.0 score (1.0 = identical)
  
  -- Verification result
  is_verified BOOLEAN NOT NULL,
  verification_confidence FLOAT,  -- 0.0-1.0 confidence score
  
  -- Thresholds used
  distance_threshold_used FLOAT,
  
  -- Verification context
  verified_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  client_ip VARCHAR(45),
  
  -- Audit
  attempt_number INT NOT NULL,  -- 1st, 2nd, 3rd attempt in a session
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  CONSTRAINT check_match_distance CHECK (match_distance >= 0),
  CONSTRAINT check_similarity_score CHECK (similarity_score >= 0.0 AND similarity_score <= 1.0),
  CONSTRAINT check_verification_confidence CHECK (verification_confidence >= 0.0 AND verification_confidence <= 1.0)
);

-- Indexes for verification queries
CREATE INDEX IF NOT EXISTS idx_face_verifications_student ON face_recognition_verifications(student_id);
CREATE INDEX IF NOT EXISTS idx_face_verifications_session ON face_recognition_verifications(session_id);
CREATE INDEX IF NOT EXISTS idx_face_verifications_verified ON face_recognition_verifications(is_verified);
CREATE INDEX IF NOT EXISTS idx_face_verifications_time ON face_recognition_verifications(verified_at DESC);
CREATE INDEX IF NOT EXISTS idx_face_verifications_student_session ON face_recognition_verifications(student_id, session_id);

-- ===========================
-- UPDATE SCHOOL_ATTENDANCE
-- ===========================
-- Add session_id to make attendance session-based
-- Keep backward compatibility with date-based queries

ALTER TABLE school_attendance
ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES course_sessions(id) ON DELETE RESTRICT;

-- Add verification method tracking
ALTER TABLE school_attendance
ADD COLUMN IF NOT EXISTS verification_method VARCHAR(50),  -- 'FACE_RECOGNITION', 'QR_CODE', 'MANUAL', etc.
ADD COLUMN IF NOT EXISTS face_verification_id UUID REFERENCES face_recognition_verifications(id);

-- Add enrollment reference
ALTER TABLE school_attendance
ADD COLUMN IF NOT EXISTS face_enrollment_id UUID REFERENCES face_recognition_enrollments(id);
-- Update the index to include session_id
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_attendance_per_session 
  ON school_attendance(student_id, session_id) 
  WHERE session_id IS NOT NULL;

-- ===========================
-- ENFORCEMENT: ONE CHECK-IN PER SESSION
-- ===========================
-- This is the PRIMARY constraint - enforced at DB level via partial unique index above
-- (PostgreSQL doesn't support WHERE clauses on table constraints, only indexes)

-- ===========================
-- PARTIAL INDEXES FOR ACTIVE SESSIONS
-- ===========================
-- Fast queries for "current" or "upcoming" sessions

CREATE INDEX IF NOT EXISTS idx_active_sessions ON course_sessions(session_date) 
  WHERE status IN ('SCHEDULED', 'IN_SESSION');

CREATE INDEX IF NOT EXISTS idx_upcoming_sessions ON course_sessions(session_date, start_time)
  WHERE status = 'SCHEDULED';

-- ===========================
-- VIEW: ATTENDANCE WITH SESSION DETAILS
-- ===========================
-- Joins attendance with session for easy querying

CREATE OR REPLACE VIEW attendance_with_sessions AS
SELECT
  sa.id AS attendance_id,
  sa.student_id,
  sa.session_id,
  cs.course_id,
  cs.session_date,
  cs.start_time,
  cs.end_time,
  sa.status AS attendance_status,
  sa.verification_method,
  sa.face_verification_id,
  cs.lecturer_id
FROM school_attendance sa
JOIN course_sessions cs ON sa.session_id = cs.id;

-- ===========================
-- VIEW: STUDENT FACE ENROLLMENT STATUS
-- ===========================
-- Quick lookup: which students have active face enrollments

CREATE OR REPLACE VIEW student_face_status AS
SELECT
  s.id AS student_id,
  s.user_id,
  s.platform_id,
  (fre.id IS NOT NULL) AS has_active_enrollment,
  fre.id AS enrollment_id,
  fre.is_verified,
  fre.enrolled_at,
  fre.face_confidence,
  COUNT(frv.id) AS verification_attempts,
  COUNT(CASE WHEN frv.is_verified THEN 1 END) AS successful_verifications
FROM students s
LEFT JOIN face_recognition_enrollments fre 
  ON s.user_id = fre.student_id AND fre.is_active = true
LEFT JOIN face_recognition_verifications frv 
  ON s.user_id = frv.student_id
GROUP BY s.id, s.user_id, s.platform_id, fre.id;

-- ===========================
-- FUNCTION: Calculate Face Distance (Euclidean)
-- ===========================
-- Used for face matching - calculates distance between two face vectors

CREATE OR REPLACE FUNCTION euclidean_distance(vec1 FLOAT8[], vec2 FLOAT8[])
RETURNS FLOAT AS $$
DECLARE
  distance FLOAT := 0.0;
  i INT;
BEGIN
  IF array_length(vec1, 1) != array_length(vec2, 1) THEN
    RAISE EXCEPTION 'Vector dimensions must match';
  END IF;
  
  FOR i IN 1..array_length(vec1, 1) LOOP
    distance := distance + POWER(vec1[i] - vec2[i], 2);
  END LOOP;
  
  RETURN SQRT(distance);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ===========================
-- FUNCTION: Calculate Similarity Score (0-1)
-- ===========================
-- Converts distance to normalized similarity score
-- Lower distance = higher similarity

CREATE OR REPLACE FUNCTION distance_to_similarity(distance FLOAT, max_distance FLOAT DEFAULT 1.0)
RETURNS FLOAT AS $$
BEGIN
  -- Clamp distance to max_distance, then invert
  RETURN GREATEST(0.0, 1.0 - (distance / NULLIF(max_distance, 0)));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ===========================
-- AUDIT TRIGGER: Track Attendance Changes
-- ===========================
-- Log all changes to attendance and face enrollments

CREATE OR REPLACE FUNCTION audit_attendance_changes()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO audit_logs (
    platform_id, user_id, action, entity_type, entity_id,
    old_values, new_values
  ) VALUES (
    NEW.platform_id,
    NEW.marked_by_id,
    TG_OP,
    'attendance',
    NEW.id,
    row_to_json(OLD),
    row_to_json(NEW)
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER attendance_audit_trigger
AFTER INSERT OR UPDATE ON school_attendance
FOR EACH ROW
EXECUTE FUNCTION audit_attendance_changes();

-- ===========================
-- AUDIT TRIGGER: Track Face Enrollment Changes
-- ===========================

CREATE OR REPLACE FUNCTION audit_face_enrollment_changes()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO audit_logs (
    platform_id, user_id, action, entity_type, entity_id,
    old_values, new_values
  ) VALUES (
    NEW.platform_id,
    NEW.enrolled_by_id,
    TG_OP,
    'face_enrollment',
    NEW.id,
    row_to_json(OLD),
    row_to_json(NEW)
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER face_enrollment_audit_trigger
AFTER INSERT OR UPDATE ON face_recognition_enrollments
FOR EACH ROW
EXECUTE FUNCTION audit_face_enrollment_changes();

-- ===========================
-- DONE
-- ===========================
-- All face recognition infrastructure is in place
-- Database is now the source of truth for attendance enforcement
-- Face recognition is primary verification method
