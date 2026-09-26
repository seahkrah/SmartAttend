-- 063: access requests — organisations asking to use the platform.
--
-- The public "Request access" form used to be a self-registration screen: it
-- asked a would-be student or employee to choose a password and to type their
-- institution's internal UUID, which nobody outside the database knows. People
-- now get accounts from their own administrator, by invitation. What the
-- public form is for is the step before that: a school or employer telling the
-- platform operator they want to talk.
--
-- So this holds an enquiry, not an account, and only what is needed to reply
-- to it (data minimisation, GDPR Art. 5(1)(c)): who they are, how to reach
-- them, and enough about the organisation to route the conversation. No
-- password, no address, no date of birth, no identity numbers.
--
-- It belongs to no tenant: the organisation is not one yet. Only the platform
-- operator (superadmin) reads it.

CREATE TABLE IF NOT EXISTS access_requests (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organisation_name   VARCHAR(200) NOT NULL,
  -- Which product they want: the school system, the employer system, or both.
  organisation_type   VARCHAR(20)  NOT NULL,
  -- ISO 3166-1 alpha-2, e.g. 'LR', 'GH', 'GB'.
  country_code        CHAR(2)      NOT NULL,
  -- Students (schools) or employees (employers), as a band rather than a figure.
  size_band           VARCHAR(20),
  contact_name        VARCHAR(150) NOT NULL,
  job_title           VARCHAR(150),
  email               VARCHAR(255) NOT NULL,
  -- E.164: '+' then 7 to 15 digits, no spaces.
  phone               VARCHAR(16),
  preferred_contact   VARCHAR(10)  NOT NULL DEFAULT 'email',
  message             TEXT,
  -- What they agreed to, and when. The text version lets a later wording
  -- change be told apart from what this person actually saw.
  consent_at          TIMESTAMPTZ  NOT NULL,
  consent_version     VARCHAR(20)  NOT NULL,
  status              VARCHAR(20)  NOT NULL DEFAULT 'new',
  internal_notes      TEXT,
  handled_by          UUID REFERENCES users(id) ON DELETE SET NULL,
  handled_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT access_requests_type CHECK (organisation_type IN ('school', 'employer', 'both')),
  CONSTRAINT access_requests_country CHECK (country_code ~ '^[A-Z]{2}$'),
  CONSTRAINT access_requests_size CHECK (size_band IS NULL OR size_band IN
    ('1-50', '51-200', '201-1000', '1001-5000', '5000+')),
  CONSTRAINT access_requests_phone CHECK (phone IS NULL OR phone ~ '^\+[1-9][0-9]{6,14}$'),
  CONSTRAINT access_requests_contact CHECK (preferred_contact IN ('email', 'phone', 'whatsapp')),
  -- Asking to be phoned needs a number to phone.
  CONSTRAINT access_requests_contact_reachable CHECK (preferred_contact = 'email' OR phone IS NOT NULL),
  CONSTRAINT access_requests_status CHECK (status IN ('new', 'contacted', 'closed'))
);

CREATE INDEX IF NOT EXISTS idx_access_requests_status ON access_requests (status, created_at DESC);
