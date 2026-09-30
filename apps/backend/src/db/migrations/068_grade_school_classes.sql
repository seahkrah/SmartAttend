-- 068: a grade school's classes, subjects and who sits in which class.
--
-- Migration 067 gave a grade school its grades. A grade is not where a child
-- sits: a school with sixty children in Grade 4 runs Grade 4A and Grade 4B,
-- each with a class teacher, and the register, the report card and the fee
-- bill are all a class's. So:
--
--   school_classes     a class (section) of one grade in one academic year,
--                      with a class teacher. Classes belong to a year because
--                      next year's Grade 4A is a different set of children.
--   class_placements   which class a student is in, for a year: at most one
--                      class per student per year. Moving a child from 4A to
--                      4B is an update of that row, not a second one.
--   subjects           what the school teaches (Mathematics, Language Arts).
--   grade_subjects     which grades take which subjects.
--
-- The university model (programmes, courses, departments) is untouched; a
-- grade school simply does not use it, and the API refuses these routes to
-- schools that are not grade schools.
--
-- A student row still needs a login account, which needs an email. A child
-- in nursery has neither, so the API gives a grade-school student registered
-- without an email an address on the reserved .invalid domain (RFC 2606),
-- where mail can never be delivered, and an account that cannot sign in.

-- ---------------------------------------------------------------------------
-- Classes
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS school_classes (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  academic_year_id  UUID NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
  grade_level_id    UUID NOT NULL REFERENCES grade_levels(id) ON DELETE RESTRICT,
  -- The section: "A", "B", "Blue". Shown after the grade: "Grade 4A".
  name              VARCHAR(30) NOT NULL,
  class_teacher_id  UUID REFERENCES faculty(id) ON DELETE SET NULL,
  capacity          INTEGER,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT school_classes_capacity CHECK (capacity IS NULL OR capacity > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_school_classes_year_grade_name
  ON school_classes (tenant_id, academic_year_id, grade_level_id, LOWER(name));

CREATE INDEX IF NOT EXISTS idx_school_classes_year
  ON school_classes (tenant_id, academic_year_id);

DROP TRIGGER IF EXISTS trg_school_classes_same_tenant ON school_classes;
CREATE TRIGGER trg_school_classes_same_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, academic_year_id, grade_level_id, class_teacher_id ON school_classes
  FOR EACH ROW EXECUTE FUNCTION guard_same_tenant(
    'academic_year_id', 'academic_years', 'grade_level_id', 'grade_levels', 'class_teacher_id', 'faculty');

-- ---------------------------------------------------------------------------
-- Placements
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS class_placements (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  student_id        UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  class_id          UUID NOT NULL REFERENCES school_classes(id) ON DELETE RESTRICT,
  -- Copied from the class so "one class per student per year" can be a
  -- unique index. A trigger keeps it equal to the class's year.
  academic_year_id  UUID NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
  placed_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  placed_by         UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_class_placements_student_year
  ON class_placements (student_id, academic_year_id);

CREATE INDEX IF NOT EXISTS idx_class_placements_class
  ON class_placements (tenant_id, class_id);

DROP TRIGGER IF EXISTS trg_class_placements_same_tenant ON class_placements;
CREATE TRIGGER trg_class_placements_same_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, student_id, class_id ON class_placements
  FOR EACH ROW EXECUTE FUNCTION guard_same_tenant('student_id', 'students', 'class_id', 'school_classes');

CREATE OR REPLACE FUNCTION class_placement_year() RETURNS TRIGGER AS $cpy$
BEGIN
  SELECT academic_year_id INTO NEW.academic_year_id FROM school_classes WHERE id = NEW.class_id;
  RETURN NEW;
END;
$cpy$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_class_placements_year ON class_placements;
CREATE TRIGGER trg_class_placements_year
  BEFORE INSERT OR UPDATE OF class_id ON class_placements
  FOR EACH ROW EXECUTE FUNCTION class_placement_year();

-- ---------------------------------------------------------------------------
-- Subjects, and which grades take them
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS subjects (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  code        VARCHAR(20) NOT NULL,
  name        VARCHAR(100) NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_subjects_tenant_code ON subjects (tenant_id, UPPER(code));
CREATE UNIQUE INDEX IF NOT EXISTS uq_subjects_tenant_name ON subjects (tenant_id, LOWER(name));

DROP TRIGGER IF EXISTS trg_subjects_same_tenant ON subjects;
CREATE TRIGGER trg_subjects_same_tenant
  BEFORE UPDATE OF tenant_id ON subjects
  FOR EACH ROW EXECUTE FUNCTION guard_same_tenant();

CREATE TABLE IF NOT EXISTS grade_subjects (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  grade_level_id  UUID NOT NULL REFERENCES grade_levels(id) ON DELETE RESTRICT,
  subject_id      UUID NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_grade_subjects ON grade_subjects (grade_level_id, subject_id);
CREATE INDEX IF NOT EXISTS idx_grade_subjects_tenant ON grade_subjects (tenant_id, grade_level_id);

DROP TRIGGER IF EXISTS trg_grade_subjects_same_tenant ON grade_subjects;
CREATE TRIGGER trg_grade_subjects_same_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, grade_level_id, subject_id ON grade_subjects
  FOR EACH ROW EXECUTE FUNCTION guard_same_tenant('grade_level_id', 'grade_levels', 'subject_id', 'subjects');

-- grade_levels (067) predates this and had no guard.
DROP TRIGGER IF EXISTS trg_grade_levels_same_tenant ON grade_levels;
CREATE TRIGGER trg_grade_levels_same_tenant
  BEFORE UPDATE OF tenant_id ON grade_levels
  FOR EACH ROW EXECUTE FUNCTION guard_same_tenant();
