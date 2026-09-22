-- 041: assessments, grading schemes and results.
--
-- The first complete SMS vertical slice beyond attendance. A school's
-- academic record is the thing it exists to produce, and none of it was here:
-- no assessments, no marks, no grade scale, no course result, no GPA, no
-- transcript.
--
-- Four tables and one view, in dependency order:
--
--   grading_schemes / grade_bands   what a mark means at this school
--   assessments                     what a course is assessed on, and weights
--   assessment_scores               one student's mark on one assessment
--   course_results                  the published outcome for a course
--
-- Every table is tenant-owned. A grade scale is a school's own policy, marks
-- are a student's record, and neither may cross a tenant boundary.

-- ---------------------------------------------------------------------------
-- Grading schemes
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS grading_schemes (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name           VARCHAR(100) NOT NULL,
  description    TEXT,
  max_grade_point NUMERIC(4,2) NOT NULL DEFAULT 4.00,
  pass_mark      NUMERIC(5,2) NOT NULL DEFAULT 40.00,
  is_default     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT grading_schemes_pass_mark CHECK (pass_mark >= 0 AND pass_mark <= 100),
  CONSTRAINT grading_schemes_max_point CHECK (max_grade_point > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_grading_schemes_tenant_name
  ON grading_schemes (tenant_id, LOWER(name));

-- One default scheme per school, so a course without an explicit scheme has
-- exactly one answer rather than whichever row sorted first.
CREATE UNIQUE INDEX IF NOT EXISTS uq_grading_schemes_one_default
  ON grading_schemes (tenant_id) WHERE is_default;

CREATE INDEX IF NOT EXISTS idx_grading_schemes_tenant ON grading_schemes (tenant_id);

-- ---------------------------------------------------------------------------
-- Grade bands
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS grade_bands (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  scheme_id    UUID NOT NULL REFERENCES grading_schemes(id) ON DELETE CASCADE,
  letter       VARCHAR(5) NOT NULL,
  min_score    NUMERIC(5,2) NOT NULL,
  max_score    NUMERIC(5,2) NOT NULL,
  grade_point  NUMERIC(4,2) NOT NULL,
  is_pass      BOOLEAN NOT NULL DEFAULT TRUE,
  remark       VARCHAR(50),
  CONSTRAINT grade_bands_range CHECK (max_score >= min_score),
  CONSTRAINT grade_bands_bounds CHECK (min_score >= 0 AND max_score <= 100),
  CONSTRAINT grade_bands_point CHECK (grade_point >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_grade_bands_scheme_letter
  ON grade_bands (scheme_id, UPPER(letter));

CREATE INDEX IF NOT EXISTS idx_grade_bands_scheme ON grade_bands (scheme_id, min_score);
CREATE INDEX IF NOT EXISTS idx_grade_bands_tenant ON grade_bands (tenant_id);

-- Bands within a scheme must not overlap: a mark has one grade, not two.
-- An exclusion constraint enforces that in the schema, where the application
-- cannot forget it. GiST needs btree_gist to index the uuid equality side.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE grade_bands DROP CONSTRAINT IF EXISTS grade_bands_no_overlap;

ALTER TABLE grade_bands
  ADD CONSTRAINT grade_bands_no_overlap
  EXCLUDE USING gist (
    scheme_id WITH =,
    numrange(min_score, max_score, '[]') WITH &&
  );

-- ---------------------------------------------------------------------------
-- Assessments
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS assessments (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  course_id     UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  semester_id   UUID REFERENCES semesters(id) ON DELETE RESTRICT,
  title         VARCHAR(255) NOT NULL,
  kind          VARCHAR(30) NOT NULL DEFAULT 'assignment',
  max_score     NUMERIC(6,2) NOT NULL DEFAULT 100,
  weight        NUMERIC(5,2) NOT NULL,
  due_date      DATE,
  published     BOOLEAN NOT NULL DEFAULT FALSE,
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT assessments_kind
    CHECK (kind IN ('assignment', 'quiz', 'test', 'midterm', 'exam', 'project', 'practical', 'participation')),
  CONSTRAINT assessments_max_score CHECK (max_score > 0),
  CONSTRAINT assessments_weight CHECK (weight > 0 AND weight <= 100)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_assessments_course_title
  ON assessments (course_id, LOWER(title));

CREATE INDEX IF NOT EXISTS idx_assessments_tenant ON assessments (tenant_id);
CREATE INDEX IF NOT EXISTS idx_assessments_course ON assessments (course_id, due_date);

-- ---------------------------------------------------------------------------
-- Scores
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS assessment_scores (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  assessment_id  UUID NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  student_id     UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  score          NUMERIC(6,2),
  status         VARCHAR(20) NOT NULL DEFAULT 'graded',
  feedback       TEXT,
  graded_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  graded_at      TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT assessment_scores_status
    CHECK (status IN ('graded', 'pending', 'absent', 'excused', 'submitted')),
  CONSTRAINT assessment_scores_value CHECK (score IS NULL OR score >= 0),
  -- A graded row must carry a mark; a pending one must not pretend to.
  CONSTRAINT assessment_scores_graded_has_score
    CHECK (status <> 'graded' OR score IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_assessment_scores_unique
  ON assessment_scores (assessment_id, student_id);

CREATE INDEX IF NOT EXISTS idx_assessment_scores_tenant ON assessment_scores (tenant_id);
CREATE INDEX IF NOT EXISTS idx_assessment_scores_student ON assessment_scores (student_id);

-- A score may not exceed the assessment it belongs to. The bound lives on the
-- assessment, so a trigger is the only place this can be checked reliably.
CREATE OR REPLACE FUNCTION check_assessment_score_bound() RETURNS TRIGGER AS $scorebound$
DECLARE
  v_max NUMERIC(6,2);
BEGIN
  IF NEW.score IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT max_score INTO v_max FROM assessments WHERE id = NEW.assessment_id;

  IF v_max IS NOT NULL AND NEW.score > v_max THEN
    RAISE EXCEPTION 'Score % exceeds the assessment maximum of %', NEW.score, v_max
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$scorebound$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_assessment_score_bound ON assessment_scores;

CREATE TRIGGER trg_assessment_score_bound
  BEFORE INSERT OR UPDATE OF score, assessment_id ON assessment_scores
  FOR EACH ROW EXECUTE FUNCTION check_assessment_score_bound();

-- ---------------------------------------------------------------------------
-- Course results
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS course_results (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  student_id     UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  course_id      UUID NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
  semester_id    UUID REFERENCES semesters(id) ON DELETE RESTRICT,
  scheme_id      UUID REFERENCES grading_schemes(id) ON DELETE RESTRICT,
  total_score    NUMERIC(6,2),
  letter         VARCHAR(5),
  grade_point    NUMERIC(4,2),
  credits        INTEGER,
  is_pass        BOOLEAN,
  status         VARCHAR(20) NOT NULL DEFAULT 'provisional',
  published_at   TIMESTAMPTZ,
  published_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  computed_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT course_results_status
    CHECK (status IN ('provisional', 'published', 'withheld')),
  CONSTRAINT course_results_total CHECK (total_score IS NULL OR (total_score >= 0 AND total_score <= 100)),
  -- Published results must be complete; a blank published grade is worse
  -- than no grade, because it looks like an outcome.
  CONSTRAINT course_results_published_is_complete
    CHECK (status <> 'published' OR (total_score IS NOT NULL AND letter IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_course_results_unique
  ON course_results (student_id, course_id, COALESCE(semester_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE INDEX IF NOT EXISTS idx_course_results_tenant ON course_results (tenant_id);
CREATE INDEX IF NOT EXISTS idx_course_results_student ON course_results (student_id, status);

-- ---------------------------------------------------------------------------
-- Transcript view
-- ---------------------------------------------------------------------------

-- Published results only. A transcript is the record a school stands behind,
-- so a provisional or withheld mark has no business appearing on one.
CREATE OR REPLACE VIEW student_transcript AS
  SELECT r.tenant_id,
         r.student_id,
         s.student_id  AS student_number,
         s.first_name,
         s.last_name,
         r.course_id,
         c.code        AS course_code,
         c.name        AS course_name,
         r.semester_id,
         sem.name      AS semester_name,
         ay.id         AS academic_year_id,
         ay.name       AS academic_year,
         r.total_score,
         r.letter,
         r.grade_point,
         COALESCE(r.credits, c.credits, 0) AS credits,
         r.is_pass,
         r.published_at
    FROM course_results r
    JOIN students s   ON s.id = r.student_id
    JOIN courses  c   ON c.id = r.course_id
    LEFT JOIN semesters sem ON sem.id = r.semester_id
    LEFT JOIN academic_years ay ON ay.id = sem.academic_year_id
   WHERE r.status = 'published';
