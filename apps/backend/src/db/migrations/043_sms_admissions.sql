-- 043: SMS admissions.
--
-- The student lifecycle had no beginning. A student appeared in the system
-- already enrolled, created by an administrator typing their details into a
-- form, with no record of how they got there: no application, no decision, no
-- evidence that anyone assessed them, and nothing to report on when the
-- registrar is asked how many people applied against how many were admitted.
--
-- Admissions is upstream of everything Phase 1 built. It needs the programmes
-- and academic years that now exist, and it produces the students that the
-- gradebook, the curriculum and attendance all hang off.
--
-- The shape:
--
--   admission_intakes      an admissions cycle — "September 2026 entry"
--   applicants             a person who has applied; not yet a user account
--   applications           one applicant's application to one intake
--   application_choices    ranked programme preferences
--   application_documents  what was asked for and what arrived
--   application_events     an append-only record of every state change
--
-- An applicant is deliberately not a user. Most applicants never become
-- students, and giving every enquiry a login would mean an authentication
-- record for people with no relationship to the school. The account is
-- created at the moment of enrolment, which is also where the student record
-- and the programme enrolment appear.

-- ---------------------------------------------------------------------------
-- Intakes
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS admission_intakes (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  academic_year_id  UUID REFERENCES academic_years(id) ON DELETE RESTRICT,
  code              VARCHAR(50) NOT NULL,
  name              VARCHAR(255) NOT NULL,
  description       TEXT,
  opens_at          DATE NOT NULL,
  closes_at         DATE NOT NULL,
  decision_by       DATE,
  capacity          INTEGER,
  status            VARCHAR(20) NOT NULL DEFAULT 'draft',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT admission_intakes_dates CHECK (closes_at >= opens_at),
  CONSTRAINT admission_intakes_capacity CHECK (capacity IS NULL OR capacity > 0),
  CONSTRAINT admission_intakes_status
    CHECK (status IN ('draft', 'open', 'closed', 'archived'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_admission_intakes_tenant_code
  ON admission_intakes (tenant_id, UPPER(code));

CREATE INDEX IF NOT EXISTS idx_admission_intakes_tenant
  ON admission_intakes (tenant_id, status);

-- ---------------------------------------------------------------------------
-- Applicants
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS applicants (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  reference      VARCHAR(30) NOT NULL,
  first_name     VARCHAR(100) NOT NULL,
  middle_name    VARCHAR(100),
  last_name      VARCHAR(100) NOT NULL,
  email          VARCHAR(255) NOT NULL,
  phone          VARCHAR(50),
  date_of_birth  DATE,
  gender         VARCHAR(20),
  nationality    VARCHAR(100),
  address        TEXT,
  prior_school   VARCHAR(255),
  prior_qualification VARCHAR(255),
  -- Set when the applicant becomes a student, so the admission that produced
  -- a student is traceable from either end.
  converted_student_id UUID REFERENCES students(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT applicants_email_shape CHECK (POSITION('@' IN email) > 1)
);

-- One person, one applicant record per school. Re-applying in a later cycle
-- reuses the record rather than duplicating the person.
CREATE UNIQUE INDEX IF NOT EXISTS uq_applicants_tenant_email
  ON applicants (tenant_id, LOWER(email));

CREATE UNIQUE INDEX IF NOT EXISTS uq_applicants_tenant_reference
  ON applicants (tenant_id, UPPER(reference));

CREATE INDEX IF NOT EXISTS idx_applicants_tenant ON applicants (tenant_id);
CREATE INDEX IF NOT EXISTS idx_applicants_name ON applicants (tenant_id, last_name, first_name);

-- ---------------------------------------------------------------------------
-- Applications
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS applications (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  applicant_id    UUID NOT NULL REFERENCES applicants(id) ON DELETE CASCADE,
  intake_id       UUID NOT NULL REFERENCES admission_intakes(id) ON DELETE RESTRICT,
  reference       VARCHAR(30) NOT NULL,
  status          VARCHAR(20) NOT NULL DEFAULT 'draft',
  submitted_at    TIMESTAMPTZ,
  reviewed_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at     TIMESTAMPTZ,
  decision_note   TEXT,
  -- The programme actually offered, which need not be the first choice.
  offered_programme_id UUID REFERENCES programmes(id) ON DELETE RESTRICT,
  offer_expires_at DATE,
  -- Populated at enrolment; the link between an application and the student
  -- it produced.
  student_id      UUID REFERENCES students(id) ON DELETE SET NULL,
  enrolled_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT applications_status CHECK (status IN (
    'draft', 'submitted', 'under_review', 'offer', 'accepted',
    'declined', 'rejected', 'waitlisted', 'withdrawn', 'enrolled'
  )),
  -- A submitted application records when. A draft has not been submitted, so
  -- it must not claim to have been.
  CONSTRAINT applications_submitted_has_time
    CHECK (status = 'draft' OR submitted_at IS NOT NULL),
  -- An offer names the programme being offered; an offer of nothing is not
  -- an offer.
  CONSTRAINT applications_offer_has_programme
    CHECK (status NOT IN ('offer', 'accepted', 'enrolled') OR offered_programme_id IS NOT NULL),
  -- An enrolled application points at the student it produced.
  CONSTRAINT applications_enrolled_has_student
    CHECK (status <> 'enrolled' OR (student_id IS NOT NULL AND enrolled_at IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_applications_tenant_reference
  ON applications (tenant_id, UPPER(reference));

-- One live application per applicant per intake. Withdrawn and rejected ones
-- stay for the record but do not block a fresh attempt.
CREATE UNIQUE INDEX IF NOT EXISTS uq_applications_one_live
  ON applications (applicant_id, intake_id)
  WHERE status NOT IN ('withdrawn', 'rejected', 'declined');

CREATE INDEX IF NOT EXISTS idx_applications_tenant ON applications (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_applications_intake ON applications (intake_id, status);
CREATE INDEX IF NOT EXISTS idx_applications_applicant ON applications (applicant_id);

-- ---------------------------------------------------------------------------
-- Programme choices
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS application_choices (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  application_id  UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  programme_id    UUID NOT NULL REFERENCES programmes(id) ON DELETE RESTRICT,
  preference_rank INTEGER NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT application_choices_rank CHECK (preference_rank >= 1 AND preference_rank <= 10)
);

-- A programme appears once in an application, and each rank is used once.
CREATE UNIQUE INDEX IF NOT EXISTS uq_application_choices_programme
  ON application_choices (application_id, programme_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_application_choices_rank
  ON application_choices (application_id, preference_rank);

CREATE INDEX IF NOT EXISTS idx_application_choices_tenant ON application_choices (tenant_id);

-- ---------------------------------------------------------------------------
-- Documents
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS application_documents (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  application_id  UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  kind            VARCHAR(50) NOT NULL,
  label           VARCHAR(255) NOT NULL,
  file_url        TEXT,
  is_required     BOOLEAN NOT NULL DEFAULT TRUE,
  status          VARCHAR(20) NOT NULL DEFAULT 'awaited',
  verified_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  verified_at     TIMESTAMPTZ,
  note            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT application_documents_status
    CHECK (status IN ('awaited', 'received', 'verified', 'rejected')),
  -- A received document has something to point at.
  CONSTRAINT application_documents_received_has_file
    CHECK (status = 'awaited' OR file_url IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_application_documents_app
  ON application_documents (application_id, status);

CREATE INDEX IF NOT EXISTS idx_application_documents_tenant
  ON application_documents (tenant_id);

-- ---------------------------------------------------------------------------
-- Events
-- ---------------------------------------------------------------------------

-- Every state change, append-only. An admissions decision is the sort of
-- thing that gets challenged months later, and "who decided this, when, and
-- what did they say" has to survive the answer.
CREATE TABLE IF NOT EXISTS application_events (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  application_id  UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  from_status     VARCHAR(20),
  to_status       VARCHAR(20) NOT NULL,
  actor_id        UUID REFERENCES users(id) ON DELETE RESTRICT,
  note            TEXT,
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_application_events_app
  ON application_events (application_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_application_events_tenant
  ON application_events (tenant_id);

-- The trail is evidence, so it is immutable like the other audit tables.
CREATE OR REPLACE FUNCTION prevent_application_event_change() RETURNS TRIGGER AS $appevent$
BEGIN
  RAISE EXCEPTION 'Application events are immutable. % is not permitted.', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$appevent$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_application_events_no_update ON application_events;
DROP TRIGGER IF EXISTS trg_application_events_no_delete ON application_events;

CREATE TRIGGER trg_application_events_no_update
  BEFORE UPDATE ON application_events
  FOR EACH ROW EXECUTE FUNCTION prevent_application_event_change();

-- DELETE is allowed only through the CASCADE from applications, which is how
-- a tenant's own data is removed; a direct delete is refused.
CREATE TRIGGER trg_application_events_no_delete
  BEFORE DELETE ON application_events
  FOR EACH ROW
  WHEN (pg_trigger_depth() = 0)
  EXECUTE FUNCTION prevent_application_event_change();
