-- Phase 4: enrolment and consent (brief 5.3).
--
-- A student's date of birth, so face-matching consent for a minor can be
-- told apart. Optional: with none recorded, a K-12 school treats the
-- student as a minor and a college or university as an adult
-- (src/biometrics/service.ts, isMinor).
ALTER TABLE students ADD COLUMN IF NOT EXISTS date_of_birth DATE
  CHECK (date_of_birth IS NULL OR date_of_birth >= DATE '1900-01-01');

-- For a minor, consent names the guardian who gave it: one of the
-- student's linked guardians, in the same tenant.
ALTER TABLE biometric_consents ADD COLUMN IF NOT EXISTS guardian_id UUID REFERENCES guardians(id) ON DELETE SET NULL;

SELECT app_apply_same_tenant_guards();
