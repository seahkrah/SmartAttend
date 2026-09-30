-- 040: the SMS academic core — academic years, programmes and curriculum.
--
-- The schema had departments, semesters, courses, schedules and enrolments,
-- which is enough to take a register and no more. Everything a school
-- actually runs on hangs off structure that did not exist:
--
--   * An academic year. Semesters carried dates but nothing grouped them, so
--     there was no way to say "this student's 2025/26 record" — which is what
--     a transcript, a progression decision and a fee schedule are all keyed on.
--   * A programme. A student was enrolled in courses but not in anything that
--     those courses added up to, so there was no degree, no credit
--     requirement and no notion of completion.
--   * A curriculum. Nothing said which courses a programme requires, in which
--     year, or whether they are core or elective, so enrolment could not be
--     validated against anything.
--
-- Semesters are extended rather than replaced: they already hold the term
-- dates every existing query reads, and a parallel `terms` table would have
-- left two answers to the same question.
--
-- Every table here is tenant-owned, with NOT NULL tenant_id, per-tenant
-- uniqueness, and no platform_id — a school's academic structure belongs to
-- that school, not to the 'school' platform.

-- ---------------------------------------------------------------------------
-- Academic years
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS academic_years (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name        VARCHAR(50) NOT NULL,
  start_date  DATE NOT NULL,
  end_date    DATE NOT NULL,
  is_current  BOOLEAN NOT NULL DEFAULT FALSE,
  status      VARCHAR(20) NOT NULL DEFAULT 'planned',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT academic_years_dates CHECK (end_date > start_date),
  CONSTRAINT academic_years_status CHECK (status IN ('planned', 'active', 'closed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_academic_years_tenant_name
  ON academic_years (tenant_id, LOWER(name));

CREATE INDEX IF NOT EXISTS idx_academic_years_tenant ON academic_years (tenant_id);

-- Exactly one current year per school. A partial unique index says so in the
-- schema rather than leaving it to whichever handler last remembered.
CREATE UNIQUE INDEX IF NOT EXISTS uq_academic_years_one_current
  ON academic_years (tenant_id) WHERE is_current;

-- Semesters become terms within a year. Nullable so existing rows stay valid;
-- new ones are given a year by the API.
ALTER TABLE semesters
  ADD COLUMN IF NOT EXISTS academic_year_id UUID REFERENCES academic_years(id) ON DELETE RESTRICT;

ALTER TABLE semesters
  ADD COLUMN IF NOT EXISTS sequence INTEGER;

CREATE INDEX IF NOT EXISTS idx_semesters_academic_year ON semesters (academic_year_id);

-- ---------------------------------------------------------------------------
-- Programmes
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS programmes (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  department_id      UUID REFERENCES school_departments(id) ON DELETE RESTRICT,
  code               VARCHAR(50) NOT NULL,
  name               VARCHAR(255) NOT NULL,
  description        TEXT,
  award              VARCHAR(100),
  level              VARCHAR(50),
  duration_years     NUMERIC(3,1) NOT NULL DEFAULT 4,
  credits_required   INTEGER,
  is_active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT programmes_duration CHECK (duration_years > 0 AND duration_years <= 10),
  CONSTRAINT programmes_credits CHECK (credits_required IS NULL OR credits_required > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_programmes_tenant_code
  ON programmes (tenant_id, UPPER(code));

CREATE INDEX IF NOT EXISTS idx_programmes_tenant ON programmes (tenant_id);
CREATE INDEX IF NOT EXISTS idx_programmes_department ON programmes (department_id);

-- ---------------------------------------------------------------------------
-- Curriculum: which courses a programme requires, and when
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS programme_courses (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  programme_id   UUID NOT NULL REFERENCES programmes(id) ON DELETE CASCADE,
  course_id      UUID NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
  study_year     INTEGER NOT NULL,
  term_sequence  INTEGER,
  requirement    VARCHAR(20) NOT NULL DEFAULT 'core',
  credits        INTEGER,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT programme_courses_year CHECK (study_year >= 1 AND study_year <= 10),
  CONSTRAINT programme_courses_requirement
    CHECK (requirement IN ('core', 'elective', 'optional'))
);

-- A course appears once in a programme's curriculum.
CREATE UNIQUE INDEX IF NOT EXISTS uq_programme_courses_unique
  ON programme_courses (programme_id, course_id);

CREATE INDEX IF NOT EXISTS idx_programme_courses_tenant ON programme_courses (tenant_id);
CREATE INDEX IF NOT EXISTS idx_programme_courses_programme ON programme_courses (programme_id, study_year);

-- ---------------------------------------------------------------------------
-- Student programme enrolment
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS student_programmes (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  student_id         UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  programme_id       UUID NOT NULL REFERENCES programmes(id) ON DELETE RESTRICT,
  academic_year_id   UUID REFERENCES academic_years(id) ON DELETE RESTRICT,
  entry_year         INTEGER NOT NULL,
  current_study_year INTEGER NOT NULL DEFAULT 1,
  status             VARCHAR(30) NOT NULL DEFAULT 'active',
  started_at         DATE NOT NULL DEFAULT CURRENT_DATE,
  completed_at       DATE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT student_programmes_status
    CHECK (status IN ('active', 'deferred', 'withdrawn', 'graduated', 'dismissed')),
  CONSTRAINT student_programmes_study_year
    CHECK (current_study_year >= 1 AND current_study_year <= 10)
);

-- A student reads one programme at a time. Historical rows stay, so the
-- constraint is on the active one only.
CREATE UNIQUE INDEX IF NOT EXISTS uq_student_programmes_one_active
  ON student_programmes (student_id) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_student_programmes_tenant ON student_programmes (tenant_id);
CREATE INDEX IF NOT EXISTS idx_student_programmes_programme
  ON student_programmes (programme_id, current_study_year);
