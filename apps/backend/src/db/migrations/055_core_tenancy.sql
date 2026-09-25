-- 055: the core school and corporate tables refuse rows that belong to no
-- tenant, and rows that point into another tenant.
--
-- An audit of every route for cross-tenant access found the same two shapes
-- over and over:
--
--   * a row written with no tenant at all. POST /api/corporate/employees,
--     POST /api/corporate/admin/employees, POST /api/corporate/assignments,
--     POST /api/school/students and POST /api/school/faculty all inserted
--     without tenant_id. Such a row is outside isolation in both directions:
--     no tenant-scoped query ever sees it, including its owner's.
--
--   * a row whose tenant is right but whose reference is not. POST
--     /api/school/faculty/:facultyId/courses/:courseId paired whichever
--     lecturer and course it was given; the employee routes took a
--     department id from the body; any of them could join one tenant's row to
--     another's.
--
-- The routes are fixed. This migration makes both shapes unrepresentable, so
-- the next route that makes the same mistake fails instead of leaking.

-- ---------------------------------------------------------------------------
-- 1. Attribute tenantless rows where the attribution is certain.
-- ---------------------------------------------------------------------------
--
-- A person's record belongs to the tenant their account is associated with,
-- when there is exactly one. Anything ambiguous is left for step 3 to refuse
-- rather than guessed.

UPDATE employees e
   SET tenant_id = a.tenant_id
  FROM (SELECT user_id, MIN(corporate_entity_id::text)::uuid AS tenant_id
          FROM corporate_user_associations
         GROUP BY user_id
        HAVING COUNT(DISTINCT corporate_entity_id) = 1) a
 WHERE e.tenant_id IS NULL AND a.user_id = e.user_id;

UPDATE students s
   SET tenant_id = a.tenant_id
  FROM (SELECT user_id, MIN(school_entity_id::text)::uuid AS tenant_id
          FROM school_user_associations
         GROUP BY user_id
        HAVING COUNT(DISTINCT school_entity_id) = 1) a
 WHERE s.tenant_id IS NULL AND a.user_id = s.user_id;

UPDATE faculty f
   SET tenant_id = a.tenant_id
  FROM (SELECT user_id, MIN(school_entity_id::text)::uuid AS tenant_id
          FROM school_user_associations
         GROUP BY user_id
        HAVING COUNT(DISTINCT school_entity_id) = 1) a
 WHERE f.tenant_id IS NULL AND a.user_id = f.user_id;

UPDATE work_assignments w
   SET tenant_id = e.tenant_id
  FROM employees e
 WHERE w.tenant_id IS NULL AND e.id = w.employee_id AND e.tenant_id IS NOT NULL;

-- A lecturer-course pairing with no tenant was written by the unscoped
-- assignment route. Where lecturer and course share a tenant it is an
-- ordinary assignment and is attributed. Where they do not, it is exactly the
-- row that route should never have been able to write: it joins two
-- organisations, belongs to neither, and is removed.
UPDATE faculty_courses fc
   SET tenant_id = f.tenant_id
  FROM faculty f, courses c
 WHERE fc.tenant_id IS NULL
   AND f.id = fc.faculty_id AND c.id = fc.course_id
   AND f.tenant_id IS NOT NULL AND f.tenant_id = c.tenant_id;

DO $$
DECLARE n INTEGER;
BEGIN
  DELETE FROM faculty_courses WHERE tenant_id IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN
    RAISE NOTICE 'Migration 055: removed % lecturer-course pairing(s) that joined two tenants', n;
  END IF;
END $$;

UPDATE student_courses sc
   SET tenant_id = s.tenant_id
  FROM students s, class_schedules cs
 WHERE sc.tenant_id IS NULL
   AND s.id = sc.student_id AND cs.id = sc.schedule_id
   AND s.tenant_id IS NOT NULL AND s.tenant_id = cs.tenant_id;

-- ---------------------------------------------------------------------------
-- 2. Nothing tenant-owned is left without an owner.
-- ---------------------------------------------------------------------------
--
-- If a row survived step 1 with no tenant, the migration stops and names the
-- table. Setting NOT NULL would fail anyway; failing with the reason is
-- kinder to whoever has to resolve it, and resolving it is a decision about
-- whose data it is, which a migration should not make.

DO $$
DECLARE
  t TEXT;
  n BIGINT;
  bad TEXT := '';
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'employees', 'work_assignments', 'corporate_departments',
    'students', 'faculty', 'faculty_courses', 'student_courses',
    'school_departments', 'semesters', 'courses', 'rooms',
    'class_schedules', 'school_attendance', 'course_sessions'
  ] LOOP
    EXECUTE format('SELECT COUNT(*) FROM %I WHERE tenant_id IS NULL', t) INTO n;
    IF n > 0 THEN
      bad := bad || format(' %s (%s)', t, n);
    END IF;
  END LOOP;
  IF bad <> '' THEN
    RAISE EXCEPTION 'Migration 055: rows with no tenant that cannot be attributed with certainty:%', bad
      USING HINT = 'Assign each to its tenant, or remove it, then run the migration again.';
  END IF;
END $$;

ALTER TABLE employees             ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE work_assignments      ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE corporate_departments ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE students              ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE faculty               ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE faculty_courses       ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE student_courses       ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE school_departments    ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE semesters             ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE courses               ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE rooms                 ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE class_schedules       ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE school_attendance     ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE course_sessions       ALTER COLUMN tenant_id SET NOT NULL;

-- Rows that already join two tenants are refused the same way. The triggers
-- below guard every write from here on but do not look back, so without this
-- a database could carry a cross-tenant reference past the migration that
-- claims to forbid them.
DO $$
DECLARE
  pair TEXT[];
  n BIGINT;
  bad TEXT := '';
BEGIN
  FOREACH pair SLICE 1 IN ARRAY ARRAY[
    ['employees', 'department_id', 'corporate_departments'],
    ['employees', 'manager_id', 'employees'],
    ['work_assignments', 'employee_id', 'employees'],
    ['students', 'department_id', 'school_departments'],
    ['faculty', 'department_id', 'school_departments'],
    ['faculty_courses', 'faculty_id', 'faculty'],
    ['faculty_courses', 'course_id', 'courses'],
    ['student_courses', 'student_id', 'students'],
    ['student_courses', 'schedule_id', 'class_schedules'],
    ['semesters', 'department_id', 'school_departments'],
    ['courses', 'department_id', 'school_departments'],
    ['courses', 'semester_id', 'semesters'],
    ['class_schedules', 'course_id', 'courses'],
    ['class_schedules', 'faculty_id', 'faculty'],
    ['class_schedules', 'room_id', 'rooms'],
    ['school_attendance', 'student_id', 'students'],
    ['school_attendance', 'schedule_id', 'class_schedules'],
    ['course_sessions', 'course_id', 'courses']
  ] LOOP
    EXECUTE format(
      'SELECT COUNT(*) FROM %I c JOIN %I p ON p.id = c.%I WHERE p.tenant_id IS DISTINCT FROM c.tenant_id',
      pair[1], pair[3], pair[2]) INTO n;
    IF n > 0 THEN
      bad := bad || format(' %s.%s (%s)', pair[1], pair[2], n);
    END IF;
  END LOOP;
  IF bad <> '' THEN
    RAISE EXCEPTION 'Migration 055: rows that refer to another tenant''s records:%', bad
      USING HINT = 'Each of these joins two organisations. Correct or remove them, then run the migration again.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. A reference stays inside its row's tenant, and a row stays in its tenant.
-- ---------------------------------------------------------------------------
--
-- The foreign keys say a referenced row exists; they say nothing about whose
-- it is. This trigger adds that. Its arguments are (column, referenced table)
-- pairs; each non-null reference must resolve to a row with the same
-- tenant_id. A reference to a row that does not exist is left for the
-- foreign key to report, so the error a caller sees is the accurate one.
--
-- It also refuses moving a row between tenants. Ownership is set when a row
-- is created and an ordinary update does not change it.

CREATE OR REPLACE FUNCTION guard_same_tenant() RETURNS TRIGGER AS $same$
DECLARE
  i INTEGER := 0;
  col TEXT;
  parent TEXT;
  ref TEXT;
  parent_tenant UUID;
  found_rows INTEGER;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'A % row cannot be moved to another tenant', TG_TABLE_NAME
      USING ERRCODE = 'restrict_violation';
  END IF;

  WHILE i < TG_NARGS LOOP
    col := TG_ARGV[i];
    parent := TG_ARGV[i + 1];
    ref := to_jsonb(NEW) ->> col;
    IF ref IS NOT NULL THEN
      EXECUTE format('SELECT tenant_id FROM %I WHERE id = $1', parent)
        INTO parent_tenant USING ref::uuid;
      -- EXECUTE does not set FOUND; the row count is what says whether the
      -- referenced row exists.
      GET DIAGNOSTICS found_rows = ROW_COUNT;
      IF found_rows > 0 AND parent_tenant IS DISTINCT FROM NEW.tenant_id THEN
        RAISE EXCEPTION '%.% refers to a % row that belongs to another tenant',
          TG_TABLE_NAME, col, parent
          USING ERRCODE = 'restrict_violation';
      END IF;
    END IF;
    i := i + 2;
  END LOOP;

  RETURN NEW;
END;
$same$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_employees_same_tenant ON employees;
CREATE TRIGGER trg_employees_same_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, department_id, manager_id ON employees
  FOR EACH ROW EXECUTE FUNCTION guard_same_tenant(
    'department_id', 'corporate_departments', 'manager_id', 'employees');

DROP TRIGGER IF EXISTS trg_work_assignments_same_tenant ON work_assignments;
CREATE TRIGGER trg_work_assignments_same_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, employee_id ON work_assignments
  FOR EACH ROW EXECUTE FUNCTION guard_same_tenant('employee_id', 'employees');

DROP TRIGGER IF EXISTS trg_corporate_departments_same_tenant ON corporate_departments;
CREATE TRIGGER trg_corporate_departments_same_tenant
  BEFORE UPDATE OF tenant_id ON corporate_departments
  FOR EACH ROW EXECUTE FUNCTION guard_same_tenant();

DROP TRIGGER IF EXISTS trg_students_same_tenant ON students;
CREATE TRIGGER trg_students_same_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, department_id ON students
  FOR EACH ROW EXECUTE FUNCTION guard_same_tenant('department_id', 'school_departments');

DROP TRIGGER IF EXISTS trg_faculty_same_tenant ON faculty;
CREATE TRIGGER trg_faculty_same_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, department_id ON faculty
  FOR EACH ROW EXECUTE FUNCTION guard_same_tenant('department_id', 'school_departments');

DROP TRIGGER IF EXISTS trg_faculty_courses_same_tenant ON faculty_courses;
CREATE TRIGGER trg_faculty_courses_same_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, faculty_id, course_id ON faculty_courses
  FOR EACH ROW EXECUTE FUNCTION guard_same_tenant('faculty_id', 'faculty', 'course_id', 'courses');

DROP TRIGGER IF EXISTS trg_student_courses_same_tenant ON student_courses;
CREATE TRIGGER trg_student_courses_same_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, student_id, schedule_id ON student_courses
  FOR EACH ROW EXECUTE FUNCTION guard_same_tenant('student_id', 'students', 'schedule_id', 'class_schedules');

DROP TRIGGER IF EXISTS trg_school_departments_same_tenant ON school_departments;
CREATE TRIGGER trg_school_departments_same_tenant
  BEFORE UPDATE OF tenant_id ON school_departments
  FOR EACH ROW EXECUTE FUNCTION guard_same_tenant();

DROP TRIGGER IF EXISTS trg_semesters_same_tenant ON semesters;
CREATE TRIGGER trg_semesters_same_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, department_id ON semesters
  FOR EACH ROW EXECUTE FUNCTION guard_same_tenant('department_id', 'school_departments');

DROP TRIGGER IF EXISTS trg_courses_same_tenant ON courses;
CREATE TRIGGER trg_courses_same_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, department_id, semester_id ON courses
  FOR EACH ROW EXECUTE FUNCTION guard_same_tenant(
    'department_id', 'school_departments', 'semester_id', 'semesters');

DROP TRIGGER IF EXISTS trg_rooms_same_tenant ON rooms;
CREATE TRIGGER trg_rooms_same_tenant
  BEFORE UPDATE OF tenant_id ON rooms
  FOR EACH ROW EXECUTE FUNCTION guard_same_tenant();

DROP TRIGGER IF EXISTS trg_class_schedules_same_tenant ON class_schedules;
CREATE TRIGGER trg_class_schedules_same_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, course_id, faculty_id, room_id ON class_schedules
  FOR EACH ROW EXECUTE FUNCTION guard_same_tenant(
    'course_id', 'courses', 'faculty_id', 'faculty', 'room_id', 'rooms');

DROP TRIGGER IF EXISTS trg_school_attendance_same_tenant ON school_attendance;
CREATE TRIGGER trg_school_attendance_same_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, student_id, schedule_id ON school_attendance
  FOR EACH ROW EXECUTE FUNCTION guard_same_tenant('student_id', 'students', 'schedule_id', 'class_schedules');

DROP TRIGGER IF EXISTS trg_course_sessions_same_tenant ON course_sessions;
CREATE TRIGGER trg_course_sessions_same_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, course_id ON course_sessions
  FOR EACH ROW EXECUTE FUNCTION guard_same_tenant('course_id', 'courses');

-- ---------------------------------------------------------------------------
-- 4. Purging a deleted file no longer switches its guard off.
-- ---------------------------------------------------------------------------
--
-- The purge blanked storage keys by disabling trg_stored_files_guard for the
-- whole table around the update. ALTER TABLE ... DISABLE TRIGGER is not
-- scoped to a session: until it was re-enabled, every connection's writes to
-- stored_files went unguarded. The guard now permits the one change purging
-- makes — emptying the key of a file that is already deleted — and nothing
-- else, so it never needs to be disabled.

CREATE OR REPLACE FUNCTION guard_stored_file() RETURNS TRIGGER AS $storedfile$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'A file cannot be moved between tenants'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW.storage_key IS DISTINCT FROM OLD.storage_key
     AND NOT (OLD.deleted_at IS NOT NULL AND NEW.storage_key = '') THEN
    RAISE EXCEPTION 'What a stored file is and where it lives are fixed once it is written'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW.backend IS DISTINCT FROM OLD.backend
     OR NEW.checksum_sha256 IS DISTINCT FROM OLD.checksum_sha256
     OR NEW.byte_size IS DISTINCT FROM OLD.byte_size
     OR NEW.content_type IS DISTINCT FROM OLD.content_type THEN
    RAISE EXCEPTION 'What a stored file is and where it lives are fixed once it is written'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
    RAISE EXCEPTION 'A deleted file is not undeleted; upload it again'
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$storedfile$ LANGUAGE plpgsql;

-- A purged file's key is '', and uq_stored_files_key covered every row, so
-- the second file ever purged on a backend collided with the first. From then
-- on every purge failed at this update — after the bytes had already been
-- removed — and kept failing on each retry. The uniqueness that matters is
-- between keys that still name an object.
DROP INDEX IF EXISTS uq_stored_files_key;
CREATE UNIQUE INDEX uq_stored_files_key
  ON stored_files (backend, storage_key)
  WHERE storage_key <> '';
