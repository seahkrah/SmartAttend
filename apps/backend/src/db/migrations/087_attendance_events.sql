-- Phase 4: one attendance core for both platforms (brief 5.1).
--
-- Every capture, on either platform, is one append-only row here, written
-- only by src/attendance/core.ts: a school mark, the clearing of a register,
-- an employee's check-in or check-out, and an approval of any of them. The
-- current-state tables (school_attendance, corporate_checkins) remain what
-- reports and timesheets read; the core writes both in one transaction.
-- A correction or an approval is a new event naming the one it supersedes;
-- nothing here is ever updated or deleted.
CREATE TABLE IF NOT EXISTS attendance_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  platform            VARCHAR(10) NOT NULL CHECK (platform IN ('school', 'corporate')),
  kind                VARCHAR(12) NOT NULL CHECK (kind IN ('mark', 'clear', 'check_in', 'check_out', 'approval')),
  student_id          UUID REFERENCES students(id) ON DELETE CASCADE,
  employee_id         UUID REFERENCES employees(id) ON DELETE CASCADE,
  schedule_id         UUID,
  attendance_date     DATE,
  status              VARCHAR(10) CHECK (status IS NULL OR status IN ('present', 'absent', 'late', 'excused')),
  attendance_id       UUID,
  checkin_id          UUID,
  -- How presence was established. 'system' is an approval or a register
  -- cleared, which establishes nothing about presence.
  method              VARCHAR(16) NOT NULL
                        CHECK (method IN ('face', 'manual', 'offline_face', 'offline_manual', 'system')),
  device_id           VARCHAR(128),
  server_time         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  client_time         TIMESTAMPTZ,
  drift_seconds       NUMERIC(12, 3),
  latitude            NUMERIC(9, 6),
  longitude           NUMERIC(9, 6),
  location_accuracy_m NUMERIC(10, 2),
  match_event_id      UUID,
  -- Why a manual entry was manual (brief 5.2). Required for every manual
  -- method; 'face_not_in_use' when the tenant has face matching off.
  reason_code         VARCHAR(32)
                        CHECK (reason_code IS NULL OR reason_code IN (
                          'camera_failure', 'consent_withheld', 'enrolment_pending', 'face_not_recognised',
                          'network_outage', 'other', 'face_not_in_use')),
  reason_text         VARCHAR(500),
  actor_user_id       UUID NOT NULL,
  approval_state      VARCHAR(10) NOT NULL DEFAULT 'not_needed'
                        CHECK (approval_state IN ('not_needed', 'pending', 'approved', 'rejected')),
  idempotency_key     VARCHAR(128),
  supersedes_event_id UUID REFERENCES attendance_events(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT attendance_events_subject CHECK (
    (platform = 'school' AND employee_id IS NULL AND (student_id IS NOT NULL OR kind = 'clear'))
    OR (platform = 'corporate' AND student_id IS NULL AND employee_id IS NOT NULL)),
  CONSTRAINT attendance_events_manual_reason CHECK (
    method NOT IN ('manual', 'offline_manual') OR reason_code IS NOT NULL),
  CONSTRAINT attendance_events_other_says_why CHECK (
    reason_code IS DISTINCT FROM 'other' OR length(trim(coalesce(reason_text, ''))) >= 3),
  CONSTRAINT attendance_events_face_cites_match CHECK (
    method NOT IN ('face', 'offline_face') OR match_event_id IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_events_idempotency
  ON attendance_events (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_attendance_events_student ON attendance_events (tenant_id, student_id, server_time DESC);
CREATE INDEX IF NOT EXISTS ix_attendance_events_employee ON attendance_events (tenant_id, employee_id, server_time DESC);
CREATE INDEX IF NOT EXISTS ix_attendance_events_device ON attendance_events (tenant_id, device_id, server_time DESC)
  WHERE device_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_attendance_events_pending ON attendance_events (tenant_id, approval_state)
  WHERE approval_state = 'pending';

CREATE OR REPLACE FUNCTION prevent_attendance_event_change() RETURNS trigger
  LANGUAGE plpgsql AS
$$
BEGIN
  -- Deleting a tenant, or a person, is the control plane's (the system pool)
  -- and takes their history with it; nothing else removes an event.
  IF TG_OP = 'DELETE' AND app_is_system() THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Attendance events are append-only: record a new event that supersedes this one'
    USING ERRCODE = 'insufficient_privilege';
END
$$;
DROP TRIGGER IF EXISTS trg_attendance_events_immutable ON attendance_events;
CREATE TRIGGER trg_attendance_events_immutable
  BEFORE UPDATE OR DELETE ON attendance_events
  FOR EACH ROW EXECUTE FUNCTION prevent_attendance_event_change();

-- Tenant policy, and same-tenant guards for the references above.
SELECT app_apply_tenant_rls();
SELECT app_apply_same_tenant_guards();

COMMENT ON TABLE attendance_events IS
  'Append-only attendance captures for both platforms; written only by src/attendance/core.ts.';
