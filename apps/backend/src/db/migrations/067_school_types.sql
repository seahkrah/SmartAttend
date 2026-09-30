-- 067: school types and the levels a school offers.
--
-- Every school was modelled as a university: programmes, years of study,
-- credits, lecturers. A private school in Monrovia runs nursery to 12th
-- grade, and a vocational institute runs trades. Neither fits, and offering
-- them a university's tools is offering tools that do not describe them.
--
-- A school tenant now has a TYPE, chosen when it is created:
--
--   grade_school  nursery / kindergarten, elementary, junior high, senior high
--   vocational    trades at certificate and diploma level
--   college       certificate to bachelor
--   university    undergraduate and postgraduate (the model that exists)
--
-- and the STAGES of that type it offers. The catalogue of types, stages and
-- what each switches on lives in src/services/schoolTypes.ts; the database
-- only checks the type's name.
--
-- For a grade school the stages generate its grades (Elementary gives
-- Grades 1 to 6). They are rows, not a label, because classes, enrolment,
-- attendance and fees will hang off them.
--
-- Rules the API enforces:
--   * stages can be added at any time: a school running grades 1 to 6 this
--     year adds junior high next year and gets empty grades 7 to 9;
--   * a stage can be removed only while nothing refers to its grades (the
--     foreign keys that will point at grade_levels say so);
--   * the type is fixed once the school has a student, because the shape of
--     its records depends on it.
--
-- Existing school tenants were built on the university model and become
-- universities offering undergraduate study, so nothing they have changes.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS school_type VARCHAR(20);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS school_stages TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_school_type_check;
ALTER TABLE tenants ADD CONSTRAINT tenants_school_type_check
  CHECK (school_type IS NULL
         OR school_type IN ('grade_school', 'vocational', 'college', 'university'));

-- A company has no school type.
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_school_type_kind;
ALTER TABLE tenants ADD CONSTRAINT tenants_school_type_kind
  CHECK (kind = 'school' OR school_type IS NULL);

UPDATE tenants
   SET school_type = 'university',
       school_stages = ARRAY['undergraduate']
 WHERE kind = 'school' AND school_type IS NULL;

-- ---------------------------------------------------------------------------
-- Grade levels: the grades of a grade school
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS grade_levels (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  stage       VARCHAR(30) NOT NULL,
  code        VARCHAR(10) NOT NULL,
  name        VARCHAR(50) NOT NULL,
  sort_order  INTEGER NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_grade_levels_tenant_code
  ON grade_levels (tenant_id, code);

CREATE INDEX IF NOT EXISTS idx_grade_levels_tenant
  ON grade_levels (tenant_id, sort_order);
