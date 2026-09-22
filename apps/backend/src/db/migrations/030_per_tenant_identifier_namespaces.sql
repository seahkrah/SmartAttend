-- ============================================================================
-- Migration 030: Make identifier namespaces per-tenant
-- ============================================================================
-- Several uniqueness rules were global or platform-wide, predating tenancy.
-- That is wrong in both directions:
--
--   * it blocks legitimate use — two universities cannot both number a student
--     S-001, two campuses cannot both have a room R-101, two employers cannot
--     both have an Operations department
--   * it leaks — the conflict error tells a tenant that an identifier exists
--     somewhere it cannot see, which is an oracle for enumerating another
--     tenant's data
--
-- Each becomes unique within its tenant instead.
--
-- Widening a global constraint to a per-tenant one can never invalidate
-- existing rows: anything unique globally is unique within a tenant.
--
-- Rows whose tenant_id is still NULL (unattributed by 025) are excluded by the
-- partial predicate rather than being collapsed into one shared namespace.
--
-- Left alone deliberately:
--   courses(semester_id, code), semesters(department_id, name),
--   course_sessions(course_id, ...), faculty_courses(faculty_id, course_id),
--   school_attendance(schedule_id, student_id, date),
--   student_courses(schedule_id, student_id)
-- all key on a parent that is itself tenant-scoped, so they are already
-- confined to one tenant.
--
--   students(user_id), employees(user_id), faculty(user_id)
-- keep one record per identity. Whether one person may hold a student record
-- at two institutions is a product question, not a leak, so it is not changed
-- here.

-- ── Departments ────────────────────────────────────────────────────────────
ALTER TABLE corporate_departments DROP CONSTRAINT IF EXISTS corp_dept_platform_id_name_unique;
ALTER TABLE corporate_departments DROP CONSTRAINT IF EXISTS corporate_departments_code_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_corporate_departments_tenant_name
  ON corporate_departments (tenant_id, LOWER(name)) WHERE tenant_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_corporate_departments_tenant_code
  ON corporate_departments (tenant_id, code) WHERE tenant_id IS NOT NULL AND code IS NOT NULL;

ALTER TABLE school_departments DROP CONSTRAINT IF EXISTS sch_dept_platform_id_name_unique;
ALTER TABLE school_departments DROP CONSTRAINT IF EXISTS school_departments_code_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_school_departments_tenant_name
  ON school_departments (tenant_id, LOWER(name)) WHERE tenant_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_school_departments_tenant_code
  ON school_departments (tenant_id, code) WHERE tenant_id IS NOT NULL AND code IS NOT NULL;

-- ── Enrolment and staff numbers ────────────────────────────────────────────
ALTER TABLE students DROP CONSTRAINT IF EXISTS students_student_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_students_tenant_student_id
  ON students (tenant_id, student_id) WHERE tenant_id IS NOT NULL;

ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_employee_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_employees_tenant_employee_id
  ON employees (tenant_id, employee_id) WHERE tenant_id IS NOT NULL;

ALTER TABLE faculty DROP CONSTRAINT IF EXISTS faculty_employee_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_faculty_tenant_employee_id
  ON faculty (tenant_id, employee_id) WHERE tenant_id IS NOT NULL;

-- ── Rooms ──────────────────────────────────────────────────────────────────
ALTER TABLE rooms DROP CONSTRAINT IF EXISTS rooms_room_number_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_rooms_tenant_room_number
  ON rooms (tenant_id, room_number) WHERE tenant_id IS NOT NULL;
