-- Phase 4: layered presentation-attack signals and group capture (brief 5.4).
--
-- Presentation-attack signals: each face event records the score its
-- capture earned and the signals behind it (src/biometrics/pad.ts), so a
-- rejection says why and an administrator can see the trend.
ALTER TABLE biometric_events ADD COLUMN IF NOT EXISTS pad_score REAL;
ALTER TABLE biometric_events ADD COLUMN IF NOT EXISTS pad_signals JSONB;

-- Group capture: one class photograph, several faces. A 'group' challenge
-- asks for one frame, so steps may be a single pose for it.
ALTER TABLE biometric_challenges DROP CONSTRAINT IF EXISTS biometric_challenges_purpose_check;
ALTER TABLE biometric_challenges ADD CONSTRAINT biometric_challenges_purpose_check
  CHECK (purpose IN ('enroll', 'verify', 'identify', 'group'));
ALTER TABLE biometric_challenges DROP CONSTRAINT IF EXISTS biometric_challenges_check1;
ALTER TABLE biometric_challenges ADD CONSTRAINT biometric_challenges_check1
  CHECK (purpose IN ('identify', 'group') OR subject_id IS NOT NULL);
ALTER TABLE biometric_challenges DROP CONSTRAINT IF EXISTS biometric_challenges_check2;
ALTER TABLE biometric_challenges ADD CONSTRAINT biometric_challenges_check2
  CHECK (purpose NOT IN ('identify', 'group') OR schedule_id IS NOT NULL);
ALTER TABLE biometric_challenges DROP CONSTRAINT IF EXISTS biometric_challenges_steps_check;
ALTER TABLE biometric_challenges ADD CONSTRAINT biometric_challenges_steps_check
  CHECK (cardinality(steps) BETWEEN 1 AND 5 AND (purpose = 'group' OR cardinality(steps) >= 2));

-- What a group capture proposed, for the lecturer to confirm one by one.
-- Nothing is recorded as attendance until confirmed. A confirmation becomes
-- an 'identified' match event and a face mark through the attendance core.
-- Proposals expire with the capture.
CREATE TABLE IF NOT EXISTS group_captures (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  issued_to    UUID NOT NULL REFERENCES users(id),
  schedule_id  UUID NOT NULL REFERENCES class_schedules(id) ON DELETE CASCADE,
  challenge_id UUID REFERENCES biometric_challenges(id) ON DELETE SET NULL,
  attendance_date DATE NOT NULL,
  -- [{ "proposal": n, "studentId": ..., "distance": ..., "margin": ... }]
  proposals    JSONB NOT NULL,
  faces_found  INTEGER NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  decided_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

SELECT app_apply_tenant_rls();
SELECT app_apply_same_tenant_guards();
