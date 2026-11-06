-- Phase 4: where, from what and when an employee may check in (brief 5.5).
--
-- Each control is a tenant setting, off by default (checkin.geofence,
-- checkin.network, checkin.device, checkin.shift_window): "flag" records the
-- check-in but holds its hours for a manager, "enforce" refuses it. What
-- each control found is kept on the check-in's event.

-- Places people work: a circle for the geofence, and the networks a
-- check-in may come from (CIDR; IPv4 or IPv6).
CREATE TABLE IF NOT EXISTS checkin_sites (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          VARCHAR(120) NOT NULL,
  latitude      NUMERIC(9, 6) NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude     NUMERIC(9, 6) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  radius_m      INTEGER NOT NULL DEFAULT 150 CHECK (radius_m BETWEEN 10 AND 5000),
  allowed_cidrs TEXT[] NOT NULL DEFAULT '{}',
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_by    UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_checkin_sites_tenant ON checkin_sites (tenant_id) WHERE is_active;

-- Devices registered for check-in: one person's phone (employee_id set), or a
-- shared kiosk (employee_id null). Revoking keeps the row.
CREATE TABLE IF NOT EXISTS attendance_devices (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  device_id     VARCHAR(128) NOT NULL CHECK (length(trim(device_id)) >= 8),
  employee_id   UUID REFERENCES employees(id) ON DELETE CASCADE,
  label         VARCHAR(120),
  registered_by UUID,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at    TIMESTAMPTZ,
  revoked_by    UUID
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_devices_active
  ON attendance_devices (tenant_id, device_id, COALESCE(employee_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE revoked_at IS NULL;

-- Breaks inside a check-in. Worked hours are the check-in's span less its
-- closed breaks; an open break at check-out is closed at check-out.
CREATE TABLE IF NOT EXISTS checkin_breaks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  checkin_id  UUID NOT NULL REFERENCES corporate_checkins(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  started_at  TIMESTAMP NOT NULL,
  ended_at    TIMESTAMP,
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_checkin_breaks_one_open ON checkin_breaks (checkin_id) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_checkin_breaks_checkin ON checkin_breaks (tenant_id, checkin_id);

-- The event says where the request came from and what each control found.
ALTER TABLE attendance_events ADD COLUMN IF NOT EXISTS client_ip VARCHAR(64);
ALTER TABLE attendance_events ADD COLUMN IF NOT EXISTS controls JSONB;
ALTER TABLE attendance_events DROP CONSTRAINT IF EXISTS attendance_events_kind_check;
ALTER TABLE attendance_events ADD CONSTRAINT attendance_events_kind_check CHECK (kind IN (
  'mark', 'clear', 'check_in', 'check_out', 'approval', 'break_start', 'break_end'));
CREATE INDEX IF NOT EXISTS ix_attendance_events_device_time ON attendance_events (tenant_id, device_id, server_time DESC)
  WHERE device_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_attendance_events_employee_time ON attendance_events (tenant_id, employee_id, server_time DESC)
  WHERE employee_id IS NOT NULL;

-- More alert kinds, raised by the attendance core:
--   buddy_punching        one unshared device checking in different people within moments;
--   impossible_travel     two check-ins further apart than anyone could travel in between;
--   outside_geofence, outside_network, unregistered_device, outside_shift_window
--                         a control in "flag" mode that the check-in failed.
ALTER TABLE attendance_alerts DROP CONSTRAINT IF EXISTS attendance_alerts_kind_check;
ALTER TABLE attendance_alerts ADD CONSTRAINT attendance_alerts_kind_check CHECK (kind IN (
  'device_manual_burst', 'manual_outside_shift', 'repeated_face_not_recognised', 'face_lockout', 'device_face_failures',
  'buddy_punching', 'impossible_travel', 'outside_geofence', 'outside_network', 'unregistered_device',
  'outside_shift_window'));

SELECT app_apply_tenant_rls();
SELECT app_apply_same_tenant_guards();
