-- ============================================================================
-- Migration 027: Member-reported attendance discrepancies
-- ============================================================================
-- attendance_corrections records a correction an administrator applied. This
-- is the other direction: a student or employee asserting that a record is
-- wrong, before anyone has decided whether it is.
--
-- Shared infrastructure — both platforms need it — but tenant-owned, since a
-- report concerns one tenant's attendance record and must never be visible
-- to, or resolvable by, another tenant.

CREATE TABLE IF NOT EXISTS attendance_discrepancy_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  platform_id UUID NOT NULL REFERENCES platforms(id) ON DELETE RESTRICT,

  -- Who is reporting. Always the authenticated user; never taken from the body.
  reporter_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- What the report is about. course_id is null on the EMS side.
  course_id UUID REFERENCES courses(id) ON DELETE SET NULL,
  attendance_record_id UUID,
  date_of_class DATE NOT NULL,

  reported_status VARCHAR(20) NOT NULL
    CHECK (reported_status IN ('PRESENT', 'ABSENT', 'LATE', 'EXCUSED')),
  current_status VARCHAR(20)
    CHECK (current_status IN ('PRESENT', 'ABSENT', 'LATE', 'EXCUSED')),
  description TEXT NOT NULL,

  status VARCHAR(20) NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'REJECTED')),
  resolved_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  resolution_notes TEXT,
  resolved_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_discrepancy_tenant ON attendance_discrepancy_reports(tenant_id);
CREATE INDEX IF NOT EXISTS idx_discrepancy_reporter
  ON attendance_discrepancy_reports(tenant_id, reporter_user_id);
CREATE INDEX IF NOT EXISTS idx_discrepancy_open
  ON attendance_discrepancy_reports(tenant_id, status) WHERE status = 'OPEN';

-- Same reasoning as the notification guard: a report must belong to a tenant
-- the reporter is actually a member of, enforced below the application.
CREATE OR REPLACE FUNCTION assert_discrepancy_reporter_in_tenant()
RETURNS TRIGGER AS $guard$
DECLARE
  member_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO member_count
    FROM user_tenant_memberships m
   WHERE m.user_id = NEW.reporter_user_id
     AND m.tenant_id = NEW.tenant_id
     AND m.status = 'active';

  IF member_count = 0 THEN
    RAISE EXCEPTION 'Cross-tenant discrepancy report refused: user % is not a member of tenant %',
      NEW.reporter_user_id, NEW.tenant_id;
  END IF;

  RETURN NEW;
END;
$guard$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_discrepancy_reporter_in_tenant ON attendance_discrepancy_reports;
CREATE TRIGGER trg_discrepancy_reporter_in_tenant
BEFORE INSERT OR UPDATE OF reporter_user_id, tenant_id ON attendance_discrepancy_reports
FOR EACH ROW EXECUTE FUNCTION assert_discrepancy_reporter_in_tenant();
