-- 031: complete the SMS schema the application has always assumed.
--
-- A static check of every literal SQL statement against the live catalogue
-- found the school routes querying columns and tables that were never
-- created. The school-admin surface (/api/auth/admin/school/*) therefore
-- failed outright: creating a schedule, listing rooms, reading settings all
-- raised undefined_column and came back as a 500.
--
-- Two kinds of gap, treated differently:
--
--   * Real domain concepts that the schema simply lacked — a schedule's
--     section and its meeting days, a room's floor and type, per-tenant
--     settings. Those are added here.
--
--   * Attempts to scope by platform_id on tables that have no such column.
--     Those are NOT added. Under the unified tenancy model a school's data
--     belongs to its tenant, not to the shared 'school' platform, and
--     platform_id would have scoped every school in the deployment into one
--     visible pool. The routes are rewritten to scope on tenant_id instead.

-- ---------------------------------------------------------------------------
-- class_schedules: section and meeting days
-- ---------------------------------------------------------------------------

-- A course runs as parallel sections; day_of_week alone cannot express a class
-- that meets Monday and Wednesday. days_of_week holds the full set as a
-- comma-separated list of 0-6, and day_of_week keeps the first of them so the
-- existing NOT NULL column stays meaningful and ordered queries still work.
ALTER TABLE class_schedules
  ADD COLUMN IF NOT EXISTS section INTEGER NOT NULL DEFAULT 1;

ALTER TABLE class_schedules
  ADD COLUMN IF NOT EXISTS days_of_week VARCHAR(20);

UPDATE class_schedules
   SET days_of_week = day_of_week::text
 WHERE days_of_week IS NULL;

ALTER TABLE class_schedules
  DROP CONSTRAINT IF EXISTS class_schedules_section_positive;

ALTER TABLE class_schedules
  ADD CONSTRAINT class_schedules_section_positive CHECK (section >= 1);

ALTER TABLE class_schedules
  DROP CONSTRAINT IF EXISTS class_schedules_days_of_week_format;

-- Only digits 0-6 separated by commas, so the LIKE matching used to find
-- today's classes cannot be fed arbitrary text.
ALTER TABLE class_schedules
  ADD CONSTRAINT class_schedules_days_of_week_format
  CHECK (days_of_week IS NULL OR days_of_week ~ '^[0-6](,[0-6])*$');

-- Keeps day_of_week equal to the first entry of days_of_week, so the two can
-- never disagree regardless of which one a writer sets.
CREATE OR REPLACE FUNCTION sync_schedule_days() RETURNS TRIGGER AS $syncdays$
BEGIN
  IF NEW.days_of_week IS NOT NULL AND NEW.days_of_week <> '' THEN
    NEW.day_of_week := split_part(NEW.days_of_week, ',', 1)::int;
  ELSE
    NEW.days_of_week := NEW.day_of_week::text;
  END IF;
  RETURN NEW;
END;
$syncdays$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_schedule_days ON class_schedules;

CREATE TRIGGER trg_sync_schedule_days
  BEFORE INSERT OR UPDATE OF day_of_week, days_of_week ON class_schedules
  FOR EACH ROW EXECUTE FUNCTION sync_schedule_days();

-- A section number identifies one offering of a course within its tenant.
CREATE UNIQUE INDEX IF NOT EXISTS uq_class_schedules_tenant_course_section
  ON class_schedules (tenant_id, course_id, section)
  WHERE tenant_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- rooms: floor and type
-- ---------------------------------------------------------------------------

ALTER TABLE rooms ADD COLUMN IF NOT EXISTS floor INTEGER;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS room_type VARCHAR(50);

-- ---------------------------------------------------------------------------
-- courses: a catalogue entry need not belong to a semester
-- ---------------------------------------------------------------------------

-- The offering is the class_schedule; the course is the catalogue entry. A
-- NOT NULL semester_id forced every course creation to invent a semester, and
-- the school-admin create route did not supply one at all.
ALTER TABLE courses ALTER COLUMN semester_id DROP NOT NULL;

-- Course codes are unique within a tenant's catalogue. The old constraint was
-- (semester_id, code), which both allows two tenants sharing a semester row to
-- collide and stops one tenant reusing a code across semesters.
CREATE UNIQUE INDEX IF NOT EXISTS uq_courses_tenant_code
  ON courses (tenant_id, code)
  WHERE tenant_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- tenant_settings
-- ---------------------------------------------------------------------------

-- The routes reached for a platform_settings table. Settings are a tenant's
-- own configuration — an attendance threshold, a grace period — so one school
-- changing a value must not change it for every school on the platform.
CREATE TABLE IF NOT EXISTS tenant_settings (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  setting_key   VARCHAR(100) NOT NULL,
  setting_value TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by    UUID REFERENCES users(id),
  CONSTRAINT uq_tenant_settings_key UNIQUE (tenant_id, setting_key)
);

CREATE INDEX IF NOT EXISTS idx_tenant_settings_tenant ON tenant_settings (tenant_id);

-- ---------------------------------------------------------------------------
-- student_courses: enrolment state
-- ---------------------------------------------------------------------------

-- The routes expect an enrolment status rather than a boolean, and the
-- distinction matters: a student who dropped a course is not the same as one
-- who completed it, and neither is the same as never having enrolled.
-- is_active is kept in step so existing readers stay correct.
ALTER TABLE student_courses
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'enrolled';

ALTER TABLE student_courses
  DROP CONSTRAINT IF EXISTS student_courses_status_check;

ALTER TABLE student_courses
  ADD CONSTRAINT student_courses_status_check
  CHECK (status IN ('enrolled', 'dropped', 'completed', 'withdrawn'));

UPDATE student_courses
   SET status = CASE WHEN is_active THEN 'enrolled' ELSE 'dropped' END
 WHERE status IS DISTINCT FROM CASE WHEN is_active THEN 'enrolled' ELSE 'dropped' END;

CREATE OR REPLACE FUNCTION sync_enrolment_active() RETURNS TRIGGER AS $syncenrol$
BEGIN
  NEW.is_active := (NEW.status = 'enrolled');
  RETURN NEW;
END;
$syncenrol$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_enrolment_active ON student_courses;

CREATE TRIGGER trg_sync_enrolment_active
  BEFORE INSERT OR UPDATE OF status ON student_courses
  FOR EACH ROW EXECUTE FUNCTION sync_enrolment_active();

CREATE INDEX IF NOT EXISTS idx_student_courses_status
  ON student_courses (schedule_id, status);
