-- 042: EMS leave management.
--
-- The EMS could record that someone checked in and nothing else. Leave is
-- where an HR system starts: it is the first thing every employee uses, the
-- first approval chain a manager touches, and the thing attendance has to be
-- read against — an absence with approved leave behind it is not an absence.
--
-- Four tables:
--
--   leave_types       what kinds of leave this company grants, and the rules
--   leave_balances    one employee's entitlement and usage for a year
--   leave_requests    a request and where it is in the approval chain
--   leave_request_days one row per day, so half-days and partial overlaps are
--                     representable and a calendar can be built without
--                     re-deriving ranges
--
-- Every table is tenant-owned. A company's leave policy, and its employees'
-- absence records, belong to that company.

-- ---------------------------------------------------------------------------
-- Leave types
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS leave_types (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  code               VARCHAR(30) NOT NULL,
  name               VARCHAR(100) NOT NULL,
  description        TEXT,
  days_per_year      NUMERIC(5,1) NOT NULL DEFAULT 0,
  is_paid            BOOLEAN NOT NULL DEFAULT TRUE,
  requires_approval  BOOLEAN NOT NULL DEFAULT TRUE,
  requires_document  BOOLEAN NOT NULL DEFAULT FALSE,
  allows_half_day    BOOLEAN NOT NULL DEFAULT TRUE,
  max_carry_over     NUMERIC(5,1) NOT NULL DEFAULT 0,
  min_notice_days    INTEGER NOT NULL DEFAULT 0,
  is_active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT leave_types_days CHECK (days_per_year >= 0 AND days_per_year <= 366),
  CONSTRAINT leave_types_carry_over CHECK (max_carry_over >= 0),
  CONSTRAINT leave_types_notice CHECK (min_notice_days >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_leave_types_tenant_code
  ON leave_types (tenant_id, UPPER(code));

CREATE INDEX IF NOT EXISTS idx_leave_types_tenant ON leave_types (tenant_id);

-- ---------------------------------------------------------------------------
-- Balances
-- ---------------------------------------------------------------------------

-- A balance is per employee, per type, per year. Entitlement and carry-over
-- are set by HR; taken and pending are maintained by the request lifecycle so
-- that "how many days do I have left" has one answer rather than being
-- recomputed differently by each caller.
CREATE TABLE IF NOT EXISTS leave_balances (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  employee_id    UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leave_type_id  UUID NOT NULL REFERENCES leave_types(id) ON DELETE CASCADE,
  year           INTEGER NOT NULL,
  entitled_days  NUMERIC(5,1) NOT NULL DEFAULT 0,
  carried_over   NUMERIC(5,1) NOT NULL DEFAULT 0,
  taken_days     NUMERIC(5,1) NOT NULL DEFAULT 0,
  pending_days   NUMERIC(5,1) NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT leave_balances_year CHECK (year >= 1900 AND year <= 2200),
  CONSTRAINT leave_balances_non_negative
    CHECK (entitled_days >= 0 AND carried_over >= 0 AND taken_days >= 0 AND pending_days >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_leave_balances_unique
  ON leave_balances (employee_id, leave_type_id, year);

CREATE INDEX IF NOT EXISTS idx_leave_balances_tenant ON leave_balances (tenant_id, year);

-- ---------------------------------------------------------------------------
-- Requests
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS leave_requests (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  employee_id     UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leave_type_id   UUID NOT NULL REFERENCES leave_types(id) ON DELETE RESTRICT,
  start_date      DATE NOT NULL,
  end_date        DATE NOT NULL,
  total_days      NUMERIC(5,1) NOT NULL,
  reason          TEXT,
  status          VARCHAR(20) NOT NULL DEFAULT 'pending',
  decided_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  decided_at      TIMESTAMPTZ,
  decision_note   TEXT,
  cancelled_at    TIMESTAMPTZ,
  document_url    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT leave_requests_dates CHECK (end_date >= start_date),
  CONSTRAINT leave_requests_days CHECK (total_days > 0),
  CONSTRAINT leave_requests_status
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  -- A decided request records who decided it and when; an undecided one must
  -- not carry a decision it never had.
  CONSTRAINT leave_requests_decision_is_complete
    CHECK (status NOT IN ('approved', 'rejected') OR decided_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_leave_requests_tenant ON leave_requests (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_leave_requests_employee
  ON leave_requests (employee_id, start_date DESC);
CREATE INDEX IF NOT EXISTS idx_leave_requests_range
  ON leave_requests (tenant_id, start_date, end_date) WHERE status = 'approved';

-- Two live requests may not cover the same day for the same employee. A
-- person cannot be on two kinds of leave at once, and the overlap is what
-- every double-booking bug in a leave system comes down to.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE leave_requests DROP CONSTRAINT IF EXISTS leave_requests_no_overlap;

ALTER TABLE leave_requests
  ADD CONSTRAINT leave_requests_no_overlap
  EXCLUDE USING gist (
    employee_id WITH =,
    daterange(start_date, end_date, '[]') WITH &&
  ) WHERE (status IN ('pending', 'approved'));

-- ---------------------------------------------------------------------------
-- Request days
-- ---------------------------------------------------------------------------

-- One row per calendar day of a request. Half-days become 0.5, a weekend or
-- holiday inside a range becomes 0, and a leave calendar is a plain select
-- rather than a range expansion repeated in three places.
CREATE TABLE IF NOT EXISTS leave_request_days (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  request_id  UUID NOT NULL REFERENCES leave_requests(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leave_date  DATE NOT NULL,
  portion     NUMERIC(2,1) NOT NULL DEFAULT 1.0,
  CONSTRAINT leave_request_days_portion CHECK (portion IN (0, 0.5, 1.0))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_leave_request_days_unique
  ON leave_request_days (request_id, leave_date);

CREATE INDEX IF NOT EXISTS idx_leave_request_days_calendar
  ON leave_request_days (tenant_id, leave_date);

CREATE INDEX IF NOT EXISTS idx_leave_request_days_employee
  ON leave_request_days (employee_id, leave_date);
