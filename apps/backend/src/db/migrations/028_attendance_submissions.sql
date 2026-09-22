-- ============================================================================
-- Migration 028: Attendance submission lifecycle
-- ============================================================================
-- school_attendance.attendance_state records the trustworthiness of one
-- record (VERIFIED, FLAGGED, REVOKED, MANUAL_OVERRIDE). It says nothing about
-- whether the lecturer has finished taking the register.
--
-- The faculty workflow needs that second axis: a register for one course on
-- one date is a draft until submitted, and locked once finalised. Locking is
-- what makes the record defensible — after it, marks change only through the
-- correction trail rather than by editing in place.

CREATE TABLE IF NOT EXISTS attendance_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  attendance_date DATE NOT NULL,

  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'SUBMITTED', 'LOCKED')),

  submitted_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  submitted_at TIMESTAMPTZ,
  locked_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  locked_at TIMESTAMPTZ,

  marks_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- One register per course per day, within a tenant. The tenant is part of
  -- the key so two tenants can hold the same course id shape independently.
  UNIQUE (tenant_id, course_id, attendance_date)
);

CREATE INDEX IF NOT EXISTS idx_attendance_submissions_tenant
  ON attendance_submissions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_attendance_submissions_lookup
  ON attendance_submissions(tenant_id, course_id, attendance_date);

-- A locked register must not move backwards. Enforced here rather than only
-- in the route, so any future code path inherits the guarantee.
CREATE OR REPLACE FUNCTION assert_submission_transition()
RETURNS TRIGGER AS $trans$
BEGIN
  IF OLD.status = 'LOCKED' AND NEW.status <> 'LOCKED' THEN
    RAISE EXCEPTION 'A locked attendance register cannot be reopened (course %, date %)',
      OLD.course_id, OLD.attendance_date;
  END IF;
  NEW.updated_at := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$trans$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_submission_transition ON attendance_submissions;
CREATE TRIGGER trg_submission_transition
BEFORE UPDATE ON attendance_submissions
FOR EACH ROW EXECUTE FUNCTION assert_submission_transition();
