-- 056: face matching that proves what it says, and the removal of what did not.
--
-- What was here before
-- --------------------
-- Every face path in the product — /api/attendance/face/*, /api/face/* and
-- /api/faculty/face-* — accepted a list of 128 numbers from the client and
-- called it a face embedding. The browser produced those numbers by averaging
-- the colour of 128 cells of the camera image. That is not a description of a
-- face: two photographs of the same person under different light differ more
-- than two different people under the same light, and a client could send any
-- numbers it liked. The "liveness" score was a brightness heuristic that
-- reported a live person whenever it was given nothing to look at.
--
-- So nothing recorded as face-verified was verified. This migration removes
-- the tables that held those numbers, and corrects the attendance and
-- check-in rows that claimed a verification that never happened.
--
-- What replaces it
-- ----------------
-- Face descriptors are computed on the server, from images, by a published
-- face-recognition network (dlib's ResNet-34, 128 dimensions). The client
-- never supplies a descriptor. A template is stored encrypted (AES-256-GCM,
-- key held outside the database) and only with recorded consent. Every
-- capture answers a server-issued, single-use, short-lived challenge: a random
-- sequence of head poses, checked from facial landmarks on the server.
--
-- What it does not do is stated in docs/features/face-matching.md: it is not
-- certified presentation-attack detection, and a prepared video of the person
-- or a synthetic camera feed can defeat a pose challenge.

-- ---------------------------------------------------------------------------
-- 1. Correct the record.
-- ---------------------------------------------------------------------------
-- The audit trigger on school_attendance records each correction.

UPDATE school_attendance
   SET face_verified = FALSE,
       verification_method = CASE WHEN verification_method = 'FACE_RECOGNITION'
                                  THEN 'LEGACY_UNVERIFIED_FACE' ELSE verification_method END,
       state_audit_notes = COALESCE(state_audit_notes || E'\n', '')
         || 'Migration 056: the face check recorded here compared client-supplied colour averages, '
         || 'not faces. It was not a verification and is no longer reported as one.'
 WHERE face_verified = TRUE OR verification_method = 'FACE_RECOGNITION';

UPDATE corporate_checkins
   SET face_verified = FALSE,
       liveness_score = NULL,
       anti_spoofing_score = NULL,
       state_audit_notes = COALESCE(state_audit_notes || E'\n', '')
         || 'Migration 056: the face and liveness values recorded here were not verifications '
         || 'and have been cleared.'
 WHERE face_verified = TRUE OR liveness_score IS NOT NULL OR anti_spoofing_score IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Remove the tables that held client-supplied numbers.
-- ---------------------------------------------------------------------------

-- attendance_with_sessions exposed face_verification_id, had no tenant column
-- and was read by nothing.
DROP VIEW IF EXISTS attendance_with_sessions;
ALTER TABLE school_attendance DROP CONSTRAINT IF EXISTS school_attendance_face_verification_id_fkey;
ALTER TABLE school_attendance DROP CONSTRAINT IF EXISTS school_attendance_face_enrollment_id_fkey;
ALTER TABLE school_attendance DROP COLUMN IF EXISTS face_verification_id;
ALTER TABLE school_attendance DROP COLUMN IF EXISTS face_enrollment_id;

DROP VIEW IF EXISTS student_face_status;
DROP TABLE IF EXISTS face_recognition_verifications;
DROP TABLE IF EXISTS face_recognition_enrollments;
DROP TABLE IF EXISTS student_face_embeddings;
DROP TABLE IF EXISTS student_profile_picture_embeddings;
DROP TABLE IF EXISTS employee_face_embeddings;
DROP TABLE IF EXISTS employee_profile_picture_embeddings;
DROP TABLE IF EXISTS corporate_face_embeddings;
DROP TABLE IF EXISTS corporate_profile_picture_embeddings;

-- ---------------------------------------------------------------------------
-- 3. Consent.
-- ---------------------------------------------------------------------------
-- A face template exists only while a consent record does. Consent names the
-- person it concerns, who recorded it and on what basis (for a minor, the
-- guardian's signed form, for example). Withdrawing it deletes the template.

CREATE TABLE IF NOT EXISTS biometric_consents (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  subject_type       VARCHAR(20) NOT NULL CHECK (subject_type IN ('student', 'employee')),
  subject_id         UUID NOT NULL,
  basis              TEXT NOT NULL CHECK (length(trim(basis)) >= 5),
  granted_by         UUID NOT NULL REFERENCES users(id),
  granted_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  withdrawn_at       TIMESTAMPTZ,
  withdrawn_by       UUID REFERENCES users(id),
  withdrawal_reason  TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_biometric_consent_current
  ON biometric_consents (tenant_id, subject_type, subject_id)
  WHERE withdrawn_at IS NULL;

-- ---------------------------------------------------------------------------
-- 4. Templates.
-- ---------------------------------------------------------------------------
-- One current template per person. The descriptor is encrypted with a key the
-- database never sees; the row holds ciphertext, IV and tag, and which key
-- version sealed it so keys can be rotated.

CREATE TABLE IF NOT EXISTS face_templates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  subject_type  VARCHAR(20) NOT NULL CHECK (subject_type IN ('student', 'employee')),
  subject_id    UUID NOT NULL,
  consent_id    UUID NOT NULL REFERENCES biometric_consents(id) ON DELETE RESTRICT,
  model         VARCHAR(40) NOT NULL,
  ciphertext    BYTEA NOT NULL,
  iv            BYTEA NOT NULL,
  auth_tag      BYTEA NOT NULL,
  key_version   SMALLINT NOT NULL,
  frames_used   SMALLINT NOT NULL CHECK (frames_used >= 2),
  spread        REAL NOT NULL,
  enrolled_by   UUID NOT NULL REFERENCES users(id),
  enrolled_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, subject_type, subject_id)
);

-- ---------------------------------------------------------------------------
-- 5. Challenges: single use, short lived, bound to who asked and why.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS biometric_challenges (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  issued_to     UUID NOT NULL REFERENCES users(id),
  purpose       VARCHAR(20) NOT NULL CHECK (purpose IN ('enroll', 'verify', 'identify')),
  subject_type  VARCHAR(20) CHECK (subject_type IN ('student', 'employee')),
  subject_id    UUID,
  schedule_id   UUID REFERENCES class_schedules(id) ON DELETE CASCADE,
  steps         TEXT[] NOT NULL CHECK (cardinality(steps) BETWEEN 2 AND 5),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at    TIMESTAMPTZ NOT NULL,
  consumed_at   TIMESTAMPTZ,
  CHECK (expires_at > created_at),
  CHECK (purpose = 'identify' OR subject_id IS NOT NULL),
  CHECK (purpose <> 'identify' OR schedule_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_biometric_challenges_issuer
  ON biometric_challenges (issued_to, created_at DESC);

-- ---------------------------------------------------------------------------
-- 6. Events: what happened, append-only.
-- ---------------------------------------------------------------------------
-- Every consent change, enrolment, match and deletion is recorded with its
-- outcome and, for matches, the distance and the threshold it was held to.
-- A successful match is what attendance cites; the unique indexes in step 7
-- stop one match being spent twice.

CREATE TABLE IF NOT EXISTS biometric_events (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  actor_user_id  UUID NOT NULL REFERENCES users(id),
  action         VARCHAR(30) NOT NULL CHECK (action IN (
                   'consent_granted', 'consent_withdrawn', 'enrolled', 'template_deleted',
                   'verified', 'identified', 'settings_changed')),
  outcome        VARCHAR(10) NOT NULL CHECK (outcome IN ('success', 'failure')),
  reason         VARCHAR(60),
  subject_type   VARCHAR(20) CHECK (subject_type IN ('student', 'employee')),
  subject_id     UUID,
  challenge_id   UUID REFERENCES biometric_challenges(id) ON DELETE SET NULL,
  schedule_id    UUID,
  distance       REAL,
  threshold      REAL,
  model          VARCHAR(40),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_biometric_events_subject
  ON biometric_events (tenant_id, subject_type, subject_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_biometric_events_tenant_time
  ON biometric_events (tenant_id, created_at DESC);

CREATE OR REPLACE FUNCTION guard_biometric_events() RETURNS TRIGGER AS $bio$
BEGIN
  -- A deleted challenge nulls its reference; that is the only change allowed.
  IF TG_OP = 'UPDATE'
     AND NEW.challenge_id IS NULL AND OLD.challenge_id IS NOT NULL
     AND (to_jsonb(NEW) - 'challenge_id') = (to_jsonb(OLD) - 'challenge_id') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Biometric events are append-only'
    USING ERRCODE = 'restrict_violation';
END;
$bio$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_biometric_events_append_only ON biometric_events;
CREATE TRIGGER trg_biometric_events_append_only
  BEFORE UPDATE OR DELETE ON biometric_events
  FOR EACH ROW EXECUTE FUNCTION guard_biometric_events();

-- ---------------------------------------------------------------------------
-- 7. Attendance cites the match it relied on, once.
-- ---------------------------------------------------------------------------

ALTER TABLE school_attendance
  ADD COLUMN IF NOT EXISTS face_match_event_id UUID REFERENCES biometric_events(id);
ALTER TABLE corporate_checkins
  ADD COLUMN IF NOT EXISTS face_match_event_id UUID REFERENCES biometric_events(id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_school_attendance_face_match
  ON school_attendance (face_match_event_id) WHERE face_match_event_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_corporate_checkins_face_match
  ON corporate_checkins (face_match_event_id) WHERE face_match_event_id IS NOT NULL;

-- face_verified may only be true when a match is cited. Setting the flag by
-- hand, which is how every previous "verification" was recorded, is refused.
ALTER TABLE school_attendance DROP CONSTRAINT IF EXISTS chk_school_attendance_face_cited;
ALTER TABLE school_attendance ADD CONSTRAINT chk_school_attendance_face_cited
  CHECK (NOT face_verified OR face_match_event_id IS NOT NULL);
ALTER TABLE corporate_checkins DROP CONSTRAINT IF EXISTS chk_corporate_checkins_face_cited;
ALTER TABLE corporate_checkins ADD CONSTRAINT chk_corporate_checkins_face_cited
  CHECK (NOT face_verified OR face_match_event_id IS NOT NULL);

-- ---------------------------------------------------------------------------
-- 8. Every biometric row stays inside its subject's tenant.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION guard_biometric_subject() RETURNS TRIGGER AS $subj$
DECLARE
  owner UUID;
BEGIN
  IF NEW.subject_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.subject_type = 'student' THEN
    SELECT tenant_id INTO owner FROM students WHERE id = NEW.subject_id;
  ELSE
    SELECT tenant_id INTO owner FROM employees WHERE id = NEW.subject_id;
  END IF;
  IF owner IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'A biometric record must belong to its subject''s tenant'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$subj$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_biometric_consents_subject ON biometric_consents;
CREATE TRIGGER trg_biometric_consents_subject
  BEFORE INSERT OR UPDATE OF tenant_id, subject_type, subject_id ON biometric_consents
  FOR EACH ROW EXECUTE FUNCTION guard_biometric_subject();

DROP TRIGGER IF EXISTS trg_face_templates_subject ON face_templates;
CREATE TRIGGER trg_face_templates_subject
  BEFORE INSERT OR UPDATE OF tenant_id, subject_type, subject_id ON face_templates
  FOR EACH ROW EXECUTE FUNCTION guard_biometric_subject();

DROP TRIGGER IF EXISTS trg_biometric_challenges_subject ON biometric_challenges;
CREATE TRIGGER trg_biometric_challenges_subject
  BEFORE INSERT OR UPDATE OF tenant_id, subject_type, subject_id ON biometric_challenges
  FOR EACH ROW EXECUTE FUNCTION guard_biometric_subject();

-- A template is sealed under its own consent, so the two must describe the
-- same person in the same tenant, and the consent must be current.
CREATE OR REPLACE FUNCTION guard_face_template_consent() RETURNS TRIGGER AS $tc$
DECLARE
  c RECORD;
BEGIN
  SELECT tenant_id, subject_type, subject_id, withdrawn_at INTO c
    FROM biometric_consents WHERE id = NEW.consent_id;
  IF c.tenant_id IS DISTINCT FROM NEW.tenant_id
     OR c.subject_type IS DISTINCT FROM NEW.subject_type
     OR c.subject_id IS DISTINCT FROM NEW.subject_id
     OR c.withdrawn_at IS NOT NULL THEN
    RAISE EXCEPTION 'A face template needs the current consent of the person it describes'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$tc$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_face_templates_consent ON face_templates;
CREATE TRIGGER trg_face_templates_consent
  BEFORE INSERT OR UPDATE ON face_templates
  FOR EACH ROW EXECUTE FUNCTION guard_face_template_consent();

-- ---------------------------------------------------------------------------
-- 9. Retention: a template does not outlive the reason it was kept.
-- ---------------------------------------------------------------------------
-- Withdrawing consent, leaving the school, leaving the employer or deleting
-- the record removes the template in the same transaction.

CREATE OR REPLACE FUNCTION drop_template_on_withdrawal() RETURNS TRIGGER AS $wd$
BEGIN
  IF NEW.withdrawn_at IS NOT NULL AND OLD.withdrawn_at IS NULL THEN
    DELETE FROM face_templates WHERE consent_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$wd$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_biometric_consents_withdrawal ON biometric_consents;
CREATE TRIGGER trg_biometric_consents_withdrawal
  AFTER UPDATE OF withdrawn_at ON biometric_consents
  FOR EACH ROW EXECUTE FUNCTION drop_template_on_withdrawal();

CREATE OR REPLACE FUNCTION drop_biometrics_for_subject() RETURNS TRIGGER AS $ds$
DECLARE
  kind TEXT := CASE TG_TABLE_NAME WHEN 'students' THEN 'student' ELSE 'employee' END;
  gone BOOLEAN := FALSE;
BEGIN
  -- One branch per table: PL/pgSQL resolves every field an expression names,
  -- so a single condition naming both tables' columns fails on either.
  IF TG_OP = 'DELETE' THEN
    gone := TRUE;
  ELSIF TG_TABLE_NAME = 'students' THEN
    gone := NEW.is_currently_enrolled = FALSE AND OLD.is_currently_enrolled IS DISTINCT FROM FALSE;
  ELSE
    gone := NEW.is_currently_employed = FALSE AND OLD.is_currently_employed IS DISTINCT FROM FALSE;
  END IF;

  IF gone THEN
    DELETE FROM face_templates WHERE subject_type = kind AND subject_id = OLD.id;
    UPDATE biometric_consents
       SET withdrawn_at = CURRENT_TIMESTAMP,
           withdrawal_reason = CASE WHEN TG_OP = 'DELETE' THEN 'Record deleted'
                                    ELSE 'No longer enrolled or employed' END
     WHERE subject_type = kind AND subject_id = OLD.id AND withdrawn_at IS NULL;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$ds$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_students_drop_biometrics ON students;
CREATE TRIGGER trg_students_drop_biometrics
  AFTER UPDATE OF is_currently_enrolled OR DELETE ON students
  FOR EACH ROW EXECUTE FUNCTION drop_biometrics_for_subject();

DROP TRIGGER IF EXISTS trg_employees_drop_biometrics ON employees;
CREATE TRIGGER trg_employees_drop_biometrics
  AFTER UPDATE OF is_currently_employed OR DELETE ON employees
  FOR EACH ROW EXECUTE FUNCTION drop_biometrics_for_subject();
