-- Phase 4: abuse alerts for the manual fallback (brief 5.2).
--
-- Raised by the attendance core as it records a capture, at most one per
-- kind, subject and day:
--   device_manual_burst          many people entered manually from one device
--                                within an hour (buddy-punching by "the
--                                camera is broken");
--   manual_outside_shift         a manual check-in outside the employee's
--                                rostered shift;
--   repeated_face_not_recognised one person "not recognised" again and again,
--                                which is either a poor enrolment or someone
--                                avoiding the check.
-- Administrators see them under /api/attendance-review/alerts and
-- acknowledge them; acknowledging records who and when and removes nothing.
CREATE TABLE IF NOT EXISTS attendance_alerts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind            VARCHAR(40) NOT NULL
                    CHECK (kind IN ('device_manual_burst', 'manual_outside_shift', 'repeated_face_not_recognised')),
  student_id      UUID REFERENCES students(id) ON DELETE CASCADE,
  employee_id     UUID REFERENCES employees(id) ON DELETE CASCADE,
  device_id       VARCHAR(128),
  event_id        UUID REFERENCES attendance_events(id) ON DELETE CASCADE,
  alert_day       DATE NOT NULL DEFAULT CURRENT_DATE,
  detail          JSONB NOT NULL DEFAULT '{}'::jsonb,
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- One alert per kind, subject and day.
CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_alerts_once
  ON attendance_alerts (tenant_id, kind, alert_day,
                        COALESCE(student_id, employee_id, '00000000-0000-0000-0000-000000000000'::uuid),
                        COALESCE(device_id, ''));
CREATE INDEX IF NOT EXISTS ix_attendance_alerts_open ON attendance_alerts (tenant_id, created_at DESC)
  WHERE acknowledged_at IS NULL;

SELECT app_apply_tenant_rls();
SELECT app_apply_same_tenant_guards();
