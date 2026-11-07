-- Phase 4: fixes from the independent audit.
--
-- A face match is spent once, whatever it is spent on. Check-ins had a unique
-- index on the match they cite; a kiosk check-out cites one too, and had
-- nothing (audit F1). Every spend is a row here, refused the second time.
CREATE TABLE IF NOT EXISTS face_match_spends (
  -- Face events are append-only; only a tenant's removal (or a test reset)
  -- deletes them, and a spend of an event that is gone means nothing.
  match_event_id UUID PRIMARY KEY REFERENCES biometric_events(id) ON DELETE CASCADE,
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  spent_for      VARCHAR(40) NOT NULL,
  spent_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Two more alert kinds:
--   kiosk_pin_locked  a kiosk's attendant PIN locked after wrong guesses (F5);
--   checkout_flagged  a check-out from outside the sites or networks, or long
--                     after the rostered shift ended (F9).
ALTER TABLE attendance_alerts DROP CONSTRAINT IF EXISTS attendance_alerts_kind_check;
ALTER TABLE attendance_alerts ADD CONSTRAINT attendance_alerts_kind_check CHECK (kind IN (
  'device_manual_burst', 'manual_outside_shift', 'repeated_face_not_recognised', 'face_lockout', 'device_face_failures',
  'buddy_punching', 'impossible_travel', 'outside_geofence', 'outside_network', 'unregistered_device',
  'outside_shift_window', 'kiosk_pin_locked', 'checkout_flagged'));

-- Who gave a minor's consent is evidence: a guardian who gave one cannot be
-- deleted out from under it (was ON DELETE SET NULL, audit F13).
ALTER TABLE biometric_consents DROP CONSTRAINT IF EXISTS biometric_consents_guardian_id_fkey;
ALTER TABLE biometric_consents ADD CONSTRAINT biometric_consents_guardian_id_fkey
  FOREIGN KEY (guardian_id) REFERENCES guardians(id) ON DELETE RESTRICT;

SELECT app_apply_tenant_rls();
SELECT app_apply_same_tenant_guards();
