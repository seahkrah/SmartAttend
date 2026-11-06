-- Phase 4: biometric rate limits and failure alerts (brief 5.8).
--
-- Challenges record the device that asked (X-Device-Id, optional), so
-- captures can be limited per device as well as per person and per tenant.
ALTER TABLE biometric_challenges ADD COLUMN IF NOT EXISTS device_id VARCHAR(128);
CREATE INDEX IF NOT EXISTS ix_biometric_challenges_device ON biometric_challenges (tenant_id, device_id, created_at DESC)
  WHERE device_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_biometric_challenges_tenant_time ON biometric_challenges (tenant_id, created_at DESC);

-- Two more alert kinds, raised by the face service:
--   face_lockout          a person's face check paused after repeated failed matches;
--   device_face_failures  one device failing to identify anyone, again and again.
ALTER TABLE attendance_alerts DROP CONSTRAINT IF EXISTS attendance_alerts_kind_check;
ALTER TABLE attendance_alerts ADD CONSTRAINT attendance_alerts_kind_check CHECK (kind IN (
  'device_manual_burst', 'manual_outside_shift', 'repeated_face_not_recognised', 'face_lockout', 'device_face_failures'));
