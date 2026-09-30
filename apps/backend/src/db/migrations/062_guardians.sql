-- 062: guardians — the parents, carers and sponsors behind a student.
--
-- Every mid-market school system has them and this one did not: a school
-- could invoice a student, publish their results and record their absences,
-- but had nowhere to write down who pays the fees or who should be told when
-- a fourteen-year-old misses a morning of lessons.
--
-- Two tables, both owned by one school:
--
--   guardians          a person, with or without an account. Most guardians
--                      start as a name and a phone number on an admission
--                      form; an account is something the school may later
--                      invite them to, not a precondition for being recorded.
--
--   guardian_students  who is whose, and what each guardian may see. A
--                      sponsor paying the fees has no business reading the
--                      disciplinary record, and a separated parent's access
--                      is a decision the school makes per child — so access
--                      is per link, not per guardian.
--
-- Isolation follows migration 055: tenant_id is NOT NULL, and
-- guard_same_tenant() refuses a link that joins one school's guardian to
-- another school's student, whatever the route in front of it does.

-- The guardian role. Created here rather than in a seed so that every
-- deployment has it, and on the school platform only: a guardian is a
-- relationship to a student, which the corporate platform does not have.
INSERT INTO roles (platform_id, name, description, permissions)
SELECT p.id, 'guardian',
       'Parent, carer or sponsor of one or more students. Reads what the school shares with them about those students; changes nothing.',
       '[]'::jsonb
  FROM platforms p
 WHERE p.name = 'school'
ON CONFLICT (platform_id, name) DO NOTHING;

CREATE TABLE IF NOT EXISTS guardians (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  -- Set when the guardian has been given an account. ON DELETE SET NULL: the
  -- school's record of who a student's mother is must outlive her login.
  user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  first_name    VARCHAR(100) NOT NULL,
  last_name     VARCHAR(100) NOT NULL,
  email         VARCHAR(255),
  phone         VARCHAR(30),
  address       TEXT,
  occupation    VARCHAR(150),
  notes         TEXT,
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- A guardian nobody can reach is a name, not a contact.
  CONSTRAINT guardians_reachable CHECK (email IS NOT NULL OR phone IS NOT NULL),
  CONSTRAINT guardians_names_present CHECK (btrim(first_name) <> '' AND btrim(last_name) <> '')
);

-- One record per person per school. Two schools may each record the same
-- parent; one school recording them twice is a duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS idx_guardians_tenant_email
  ON guardians (tenant_id, LOWER(email)) WHERE email IS NOT NULL;
-- An account is one guardian per school: the portal resolves "my record" from
-- the signed-in identity, and two answers would be no answer.
CREATE UNIQUE INDEX IF NOT EXISTS idx_guardians_tenant_user
  ON guardians (tenant_id, user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_guardians_tenant ON guardians (tenant_id);

CREATE TABLE IF NOT EXISTS guardian_students (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  guardian_id             UUID NOT NULL REFERENCES guardians(id) ON DELETE CASCADE,
  student_id              UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  relationship            VARCHAR(30) NOT NULL DEFAULT 'guardian',
  -- The contact the school rings first. At most one per student.
  is_primary              BOOLEAN NOT NULL DEFAULT FALSE,
  can_view_attendance     BOOLEAN NOT NULL DEFAULT TRUE,
  can_view_results        BOOLEAN NOT NULL DEFAULT TRUE,
  can_view_fees           BOOLEAN NOT NULL DEFAULT TRUE,
  receives_notifications  BOOLEAN NOT NULL DEFAULT TRUE,
  created_by              UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT guardian_students_relationship CHECK (relationship IN (
    'mother', 'father', 'parent', 'guardian', 'grandparent', 'sibling',
    'relative', 'sponsor', 'other')),
  CONSTRAINT guardian_students_unique UNIQUE (guardian_id, student_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_guardian_students_one_primary
  ON guardian_students (student_id) WHERE is_primary;
CREATE INDEX IF NOT EXISTS idx_guardian_students_student ON guardian_students (tenant_id, student_id);
CREATE INDEX IF NOT EXISTS idx_guardian_students_guardian ON guardian_students (tenant_id, guardian_id);

-- A row stays in its school, and a link stays inside one school.
DROP TRIGGER IF EXISTS trg_guardians_same_tenant ON guardians;
CREATE TRIGGER trg_guardians_same_tenant
  BEFORE UPDATE OF tenant_id ON guardians
  FOR EACH ROW EXECUTE FUNCTION guard_same_tenant();

DROP TRIGGER IF EXISTS trg_guardian_students_same_tenant ON guardian_students;
CREATE TRIGGER trg_guardian_students_same_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, guardian_id, student_id ON guardian_students
  FOR EACH ROW EXECUTE FUNCTION guard_same_tenant(
    'guardian_id', 'guardians', 'student_id', 'students');
