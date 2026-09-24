-- 053: EMS contracts, rosters and timesheets.
--
-- The three gaps left in the EMS, built together because they are one chain
-- rather than three modules: a contract says how many hours a person is
-- engaged for, a roster plans which ones, a timesheet records which ones
-- actually happened, and the difference between the last two and the first is
-- overtime, which is money and therefore belongs to payroll.
--
-- Built that way deliberately. Each of the three on its own is a list people
-- keep in a spreadsheet; the value is in the joins, and in particular in the
-- one at the end — a timesheet that cannot reach payroll is a timesheet
-- somebody retypes into payroll, which is where the errors come from.
--
-- The same four rules as the payroll module, for the same reasons:
--
--   1. Terms are effective-dated. A contract is superseded by a later one; it
--      is never edited into a different set of terms, because the old terms
--      are what somebody agreed to.
--
--   2. A rostered shift is a COPY of the pattern it came from. Correcting a
--      shift pattern changes what the next roster is built from and nothing
--      about the weeks already published to the people working them.
--
--   3. Hours are evidence, not assertion. A timesheet's worked hours come from
--      check-ins that were actually verified; a revoked check-in is not paid
--      time, and a flagged one is reported rather than silently counted or
--      silently dropped.
--
--   4. Once a timesheet is approved it is frozen, because it has become the
--      basis of a payment.
--
-- On overlaps: an employee cannot hold two contracts at once, cannot be
-- rostered onto two shifts at once, and cannot have two timesheets covering
-- one day. All three are EXCLUDE constraints rather than service checks —
-- each is a race a service check loses under concurrency, and each produces
-- a person paid twice or not at all.

-- ---------------------------------------------------------------------------
-- Contracts
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS employment_contracts (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  employee_id        UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,

  reference          VARCHAR(40) NOT NULL,
  contract_type      VARCHAR(20) NOT NULL,

  job_title          VARCHAR(160) NOT NULL,
  department_id      UUID REFERENCES corporate_departments(id) ON DELETE SET NULL,
  manager_id         UUID REFERENCES employees(id) ON DELETE SET NULL,

  start_date         DATE NOT NULL,
  -- NULL is open-ended. A fixed-term contract with no end date is not a
  -- fixed-term contract, which the check below makes unrepresentable.
  end_date           DATE,
  probation_end_date DATE,
  notice_period_days INTEGER NOT NULL DEFAULT 30,

  -- The hours the person is engaged for. Everything downstream measures
  -- against this: a timesheet's overtime is what it exceeded.
  weekly_hours       NUMERIC(5,2) NOT NULL DEFAULT 40,
  working_days       NUMERIC(3,1) NOT NULL DEFAULT 5,

  status             VARCHAR(12) NOT NULL DEFAULT 'draft',
  -- The signed copy, if one has been uploaded. Points at the document store
  -- rather than holding a path, so the file's tenant ownership is enforced in
  -- one place.
  document_file_id   UUID REFERENCES stored_files(id) ON DELETE SET NULL,
  signed_at          TIMESTAMPTZ,

  ended_at           TIMESTAMPTZ,
  end_reason         TEXT,
  note               TEXT,

  created_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT employment_contracts_type CHECK (
    contract_type IN ('permanent', 'fixed_term', 'probation', 'casual', 'contractor')
  ),
  CONSTRAINT employment_contracts_status CHECK (
    status IN ('draft', 'active', 'ended', 'cancelled')
  ),
  CONSTRAINT employment_contracts_dates CHECK (end_date IS NULL OR end_date >= start_date),
  CONSTRAINT employment_contracts_probation CHECK (
    probation_end_date IS NULL
    OR (probation_end_date >= start_date
        AND (end_date IS NULL OR probation_end_date <= end_date))
  ),
  -- A fixed term needs a term. An open-ended contract that carries one is
  -- either mislabelled or about to end without anybody being told.
  CONSTRAINT employment_contracts_term_fits_type CHECK (
    (contract_type IN ('fixed_term', 'casual', 'contractor') AND end_date IS NOT NULL)
    OR (contract_type IN ('permanent', 'probation'))
  ),
  CONSTRAINT employment_contracts_hours CHECK (weekly_hours > 0 AND weekly_hours <= 168),
  CONSTRAINT employment_contracts_working_days CHECK (working_days > 0 AND working_days <= 7),
  CONSTRAINT employment_contracts_notice CHECK (notice_period_days >= 0),
  CONSTRAINT employment_contracts_ended_has_reason CHECK (
    status <> 'ended' OR (ended_at IS NOT NULL AND end_reason IS NOT NULL)
  ),
  -- An ended contract has to say when it ended, or the range it occupies is
  -- open and nothing can be signed after it.
  CONSTRAINT employment_contracts_ended_has_end_date CHECK (
    status <> 'ended' OR end_date IS NOT NULL
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_employment_contracts_reference
  ON employment_contracts (tenant_id, UPPER(reference));

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- One engagement at a time. Two overlapping contracts means two job titles,
-- two notice periods and two sets of contracted hours, and no way to say which
-- a timesheet should be measured against.
ALTER TABLE employment_contracts
  DROP CONSTRAINT IF EXISTS employment_contracts_no_overlap;
ALTER TABLE employment_contracts
  ADD CONSTRAINT employment_contracts_no_overlap
  EXCLUDE USING gist (
    employee_id WITH =,
    daterange(start_date, end_date, '[]') WITH &&
  ) WHERE (status <> 'cancelled');

CREATE INDEX IF NOT EXISTS idx_employment_contracts_tenant
  ON employment_contracts (tenant_id, status, start_date DESC);

CREATE INDEX IF NOT EXISTS idx_employment_contracts_employee
  ON employment_contracts (employee_id, start_date DESC);

-- ---------------------------------------------------------------------------
-- Shift patterns
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS shift_patterns (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  code          VARCHAR(30) NOT NULL,
  name          VARCHAR(120) NOT NULL,

  start_time    TIME NOT NULL,
  end_time      TIME NOT NULL,
  break_minutes INTEGER NOT NULL DEFAULT 0,

  -- Derived, not asserted. A night shift is one whose end time is not after
  -- its start time, and letting somebody tick a box for that is letting them
  -- tick it wrongly.
  crosses_midnight BOOLEAN GENERATED ALWAYS AS (end_time <= start_time) STORED,

  -- The hours this pattern pays for: its span, wrapping past midnight where
  -- it needs to, less the unpaid break. Computed by the database so a roster
  -- built by one caller and read by another cannot disagree about it.
  paid_hours NUMERIC(5,2) GENERATED ALWAYS AS (
    ROUND(
      ((MOD(EXTRACT(EPOCH FROM end_time) - EXTRACT(EPOCH FROM start_time) + 86400, 86400)
        - break_minutes * 60) / 3600.0)::numeric, 2)
  ) STORED,

  colour        VARCHAR(7),
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- 09:00 to 09:00 is either nothing or a full day and there is no way to
  -- tell which. Refused so somebody has to say which they meant.
  CONSTRAINT shift_patterns_has_duration CHECK (start_time <> end_time),
  CONSTRAINT shift_patterns_break CHECK (break_minutes >= 0 AND break_minutes < 1440),
  CONSTRAINT shift_patterns_colour CHECK (colour IS NULL OR colour ~ '^#[0-9A-Fa-f]{6}$')
);

-- The break cannot be longer than the shift; checked after the fact because a
-- generated column cannot be referenced from a CHECK on the same table.
ALTER TABLE shift_patterns DROP CONSTRAINT IF EXISTS shift_patterns_break_fits;
ALTER TABLE shift_patterns
  ADD CONSTRAINT shift_patterns_break_fits CHECK (paid_hours > 0);

CREATE UNIQUE INDEX IF NOT EXISTS uq_shift_patterns_code
  ON shift_patterns (tenant_id, UPPER(code));

CREATE INDEX IF NOT EXISTS idx_shift_patterns_tenant
  ON shift_patterns (tenant_id, is_active, start_time);

-- ---------------------------------------------------------------------------
-- The roster
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS roster_shifts (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  employee_id   UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,

  -- Provenance only. The pattern may be renamed, retimed or retired; a shift
  -- already published to the person working it keeps what it was built from.
  pattern_id    UUID REFERENCES shift_patterns(id) ON DELETE SET NULL,

  code          VARCHAR(30) NOT NULL,
  name          VARCHAR(120) NOT NULL,
  work_date     DATE NOT NULL,
  start_time    TIME NOT NULL,
  end_time      TIME NOT NULL,
  break_minutes INTEGER NOT NULL DEFAULT 0,

  -- Resolved to real instants so an overlap across midnight is an overlap the
  -- database can see. A night shift starting on Monday ends on Tuesday, and
  -- comparing times alone would let somebody be rostered through it.
  starts_at TIMESTAMP GENERATED ALWAYS AS (work_date + start_time) STORED,
  ends_at   TIMESTAMP GENERATED ALWAYS AS (
    work_date + end_time
    + CASE WHEN end_time <= start_time THEN INTERVAL '1 day' ELSE INTERVAL '0 day' END
  ) STORED,

  paid_hours NUMERIC(5,2) GENERATED ALWAYS AS (
    ROUND(
      ((MOD(EXTRACT(EPOCH FROM end_time) - EXTRACT(EPOCH FROM start_time) + 86400, 86400)
        - break_minutes * 60) / 3600.0)::numeric, 2)
  ) STORED,

  -- A roster nobody has seen can be rearranged freely. One that has been
  -- published is what people have arranged their lives around, so a change to
  -- it is a change, not a correction.
  status        VARCHAR(12) NOT NULL DEFAULT 'scheduled',
  published_at  TIMESTAMPTZ,
  cancelled_at  TIMESTAMPTZ,
  cancel_reason TEXT,
  note          TEXT,

  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT roster_shifts_status CHECK (status IN ('scheduled', 'published', 'cancelled')),
  CONSTRAINT roster_shifts_has_duration CHECK (start_time <> end_time),
  CONSTRAINT roster_shifts_break CHECK (break_minutes >= 0 AND break_minutes < 1440),
  CONSTRAINT roster_shifts_published_has_time
    CHECK (status <> 'published' OR published_at IS NOT NULL),
  CONSTRAINT roster_shifts_cancelled_has_reason
    CHECK (status <> 'cancelled' OR (cancelled_at IS NOT NULL AND cancel_reason IS NOT NULL))
);

ALTER TABLE roster_shifts DROP CONSTRAINT IF EXISTS roster_shifts_break_fits;
ALTER TABLE roster_shifts
  ADD CONSTRAINT roster_shifts_break_fits CHECK (paid_hours > 0);

-- Nobody works two shifts at once. This is the constraint the whole rostering
-- module exists to enforce, and it is here rather than in a service because
-- two schedulers saving at the same moment both pass a service check.
ALTER TABLE roster_shifts DROP CONSTRAINT IF EXISTS roster_shifts_no_overlap;
ALTER TABLE roster_shifts
  ADD CONSTRAINT roster_shifts_no_overlap
  EXCLUDE USING gist (
    employee_id WITH =,
    tsrange(starts_at, ends_at) WITH &&
  ) WHERE (status <> 'cancelled');

CREATE INDEX IF NOT EXISTS idx_roster_shifts_tenant_date
  ON roster_shifts (tenant_id, work_date, status);

CREATE INDEX IF NOT EXISTS idx_roster_shifts_employee
  ON roster_shifts (employee_id, work_date);

-- ---------------------------------------------------------------------------
-- Timesheets
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS timesheets (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  employee_id       UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,

  period_start      DATE NOT NULL,
  period_end        DATE NOT NULL,

  status            VARCHAR(12) NOT NULL DEFAULT 'draft',

  -- Copied from the contract in force when the sheet was built, not looked up
  -- on read. A contract signed afterwards must not retrospectively turn last
  -- month's ordinary hours into overtime.
  contract_id       UUID REFERENCES employment_contracts(id) ON DELETE SET NULL,
  contracted_hours  NUMERIC(6,2) NOT NULL DEFAULT 0,

  rostered_hours    NUMERIC(6,2) NOT NULL DEFAULT 0,
  worked_hours      NUMERIC(6,2) NOT NULL DEFAULT 0,
  approved_hours    NUMERIC(6,2) NOT NULL DEFAULT 0,
  overtime_hours    NUMERIC(6,2) NOT NULL DEFAULT 0,

  -- Hours from check-ins that were flagged rather than verified. Counted in
  -- neither worked nor approved, and surfaced so somebody decides rather than
  -- the number quietly going missing.
  flagged_hours     NUMERIC(6,2) NOT NULL DEFAULT 0,

  submitted_at      TIMESTAMPTZ,
  submitted_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  decided_at        TIMESTAMPTZ,
  decided_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  decision_note     TEXT,

  -- Where this ended up in payroll, once it was sent there.
  exported_at       TIMESTAMPTZ,
  payroll_input_id  UUID REFERENCES payroll_inputs(id) ON DELETE SET NULL,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT timesheets_status CHECK (
    status IN ('draft', 'submitted', 'approved', 'rejected', 'exported')
  ),
  CONSTRAINT timesheets_dates CHECK (period_end >= period_start),
  CONSTRAINT timesheets_hours CHECK (
    contracted_hours >= 0 AND rostered_hours >= 0 AND worked_hours >= 0
    AND approved_hours >= 0 AND overtime_hours >= 0 AND flagged_hours >= 0
  ),
  -- Overtime is what the approved hours exceeded, and nothing else. Storing it
  -- as a free number is how a sheet claims overtime it did not work.
  CONSTRAINT timesheets_overtime_is_arithmetic CHECK (
    overtime_hours = GREATEST(approved_hours - contracted_hours, 0)
  ),
  CONSTRAINT timesheets_submitted_has_time
    CHECK (status = 'draft' OR submitted_at IS NOT NULL),
  CONSTRAINT timesheets_decided_has_time CHECK (
    status NOT IN ('approved', 'rejected', 'exported') OR decided_at IS NOT NULL
  ),
  CONSTRAINT timesheets_exported_has_time
    CHECK (status <> 'exported' OR exported_at IS NOT NULL)
);

-- One sheet per person per span of days. Two would each be plausible on their
-- own and together pay for the same hours twice.
ALTER TABLE timesheets DROP CONSTRAINT IF EXISTS timesheets_no_overlap;
ALTER TABLE timesheets
  ADD CONSTRAINT timesheets_no_overlap
  EXCLUDE USING gist (
    employee_id WITH =,
    daterange(period_start, period_end, '[]') WITH &&
  );

CREATE INDEX IF NOT EXISTS idx_timesheets_tenant
  ON timesheets (tenant_id, status, period_start DESC);

CREATE INDEX IF NOT EXISTS idx_timesheets_employee
  ON timesheets (employee_id, period_start DESC);

CREATE TABLE IF NOT EXISTS timesheet_entries (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  timesheet_id   UUID NOT NULL REFERENCES timesheets(id) ON DELETE CASCADE,

  work_date      DATE NOT NULL,

  -- Provenance for the day: which shift was planned, if one was.
  shift_id       UUID REFERENCES roster_shifts(id) ON DELETE SET NULL,

  rostered_hours NUMERIC(5,2) NOT NULL DEFAULT 0,
  -- What the verified check-ins add up to.
  worked_hours   NUMERIC(5,2) NOT NULL DEFAULT 0,
  -- What a human signed off. Defaults to the worked hours and is the figure
  -- that gets paid; the two differ exactly when somebody decided they should.
  approved_hours NUMERIC(5,2) NOT NULL DEFAULT 0,
  flagged_hours  NUMERIC(5,2) NOT NULL DEFAULT 0,

  source         VARCHAR(12) NOT NULL DEFAULT 'checkin',
  note           TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT timesheet_entries_hours CHECK (
    rostered_hours >= 0 AND worked_hours >= 0
    AND approved_hours >= 0 AND flagged_hours >= 0
  ),
  -- 24 hours is the most a day can hold, whatever the check-ins say.
  CONSTRAINT timesheet_entries_within_a_day CHECK (
    worked_hours <= 24 AND approved_hours <= 24 AND rostered_hours <= 24
  ),
  CONSTRAINT timesheet_entries_source CHECK (
    source IN ('checkin', 'roster', 'manual', 'leave')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_timesheet_entries_day
  ON timesheet_entries (timesheet_id, work_date);

CREATE INDEX IF NOT EXISTS idx_timesheet_entries_tenant
  ON timesheet_entries (tenant_id, work_date);

-- ---------------------------------------------------------------------------
-- Immutability
-- ---------------------------------------------------------------------------

-- A contract's terms are what somebody agreed to. Draft terms can be revised
-- freely; once it is active the only move is to end it, and an ended contract
-- does not change at all. Different terms are a new contract.
CREATE OR REPLACE FUNCTION guard_employment_contract() RETURNS TRIGGER AS $contract$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'A contract cannot be moved between tenants'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.employee_id IS DISTINCT FROM OLD.employee_id THEN
    RAISE EXCEPTION 'A contract cannot be moved to a different employee'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF OLD.status = 'ended' AND NEW.status = 'ended' THEN
    RAISE EXCEPTION 'Contract % has ended; its terms are what was agreed', OLD.reference
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF OLD.status = 'active' AND (
       NEW.contract_type IS DISTINCT FROM OLD.contract_type
    OR NEW.weekly_hours IS DISTINCT FROM OLD.weekly_hours
    OR NEW.working_days IS DISTINCT FROM OLD.working_days
    OR NEW.notice_period_days IS DISTINCT FROM OLD.notice_period_days
    OR NEW.start_date IS DISTINCT FROM OLD.start_date
    OR NEW.job_title IS DISTINCT FROM OLD.job_title
  ) THEN
    RAISE EXCEPTION
      'Contract % is active; different terms are a new contract, not an edit',
      OLD.reference
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF OLD.status = 'ended' AND NEW.status IN ('draft', 'active') THEN
    RAISE EXCEPTION 'An ended contract cannot be reopened'
      USING ERRCODE = 'restrict_violation';
  END IF;

  NEW.updated_at := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$contract$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_employment_contracts_guard ON employment_contracts;
CREATE TRIGGER trg_employment_contracts_guard
  BEFORE UPDATE ON employment_contracts
  FOR EACH ROW EXECUTE FUNCTION guard_employment_contract();

-- A published shift is what somebody has arranged childcare around. It can be
-- cancelled, which is visible, but not quietly retimed.
CREATE OR REPLACE FUNCTION guard_roster_shift() RETURNS TRIGGER AS $shift$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'A shift cannot be moved between tenants'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF OLD.status = 'published' AND NEW.status = 'published' AND (
       NEW.work_date IS DISTINCT FROM OLD.work_date
    OR NEW.start_time IS DISTINCT FROM OLD.start_time
    OR NEW.end_time IS DISTINCT FROM OLD.end_time
    OR NEW.break_minutes IS DISTINCT FROM OLD.break_minutes
    OR NEW.employee_id IS DISTINCT FROM OLD.employee_id
  ) THEN
    RAISE EXCEPTION
      'This shift is published; cancel it and roster another rather than retiming it'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF OLD.status = 'cancelled' AND NEW.status <> 'cancelled' THEN
    RAISE EXCEPTION 'A cancelled shift cannot be reinstated; roster a new one'
      USING ERRCODE = 'restrict_violation';
  END IF;

  NEW.updated_at := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$shift$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_roster_shifts_guard ON roster_shifts;
CREATE TRIGGER trg_roster_shifts_guard
  BEFORE UPDATE ON roster_shifts
  FOR EACH ROW EXECUTE FUNCTION guard_roster_shift();

-- An approved timesheet has become the basis of a payment.
CREATE OR REPLACE FUNCTION guard_timesheet() RETURNS TRIGGER AS $sheet$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'A timesheet cannot be moved between tenants'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF OLD.status IN ('approved', 'exported') AND (
       NEW.approved_hours IS DISTINCT FROM OLD.approved_hours
    OR NEW.worked_hours IS DISTINCT FROM OLD.worked_hours
    OR NEW.overtime_hours IS DISTINCT FROM OLD.overtime_hours
    OR NEW.contracted_hours IS DISTINCT FROM OLD.contracted_hours
    OR NEW.period_start IS DISTINCT FROM OLD.period_start
    OR NEW.period_end IS DISTINCT FROM OLD.period_end
  ) THEN
    RAISE EXCEPTION 'This timesheet is %; its hours are what was signed off', OLD.status
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF OLD.status = 'exported' AND NEW.status <> 'exported' THEN
    RAISE EXCEPTION 'A timesheet that has reached payroll cannot be reopened'
      USING ERRCODE = 'restrict_violation';
  END IF;

  NEW.updated_at := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$sheet$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_timesheets_guard ON timesheets;
CREATE TRIGGER trg_timesheets_guard
  BEFORE UPDATE ON timesheets
  FOR EACH ROW EXECUTE FUNCTION guard_timesheet();

CREATE OR REPLACE FUNCTION guard_timesheet_entry() RETURNS TRIGGER AS $entry$
DECLARE
  sheet_status TEXT;
  target UUID;
BEGIN
  target := COALESCE(NEW.timesheet_id, OLD.timesheet_id);
  SELECT status INTO sheet_status FROM timesheets WHERE id = target;

  -- Deleting the sheet, or the tenant, cascades; that is how a draft is
  -- rebuilt and how a tenant's data is removed.
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;

  -- shift_id is provenance, not an hour. Cancelling a roster nulls it through
  -- ON DELETE SET NULL, which arrives here as an UPDATE; a frozen sheet must
  -- not make its own shifts undeletable, and the hours do not move.
  IF TG_OP = 'UPDATE' AND pg_trigger_depth() > 1
     AND NEW.shift_id IS NULL AND OLD.shift_id IS NOT NULL
     AND NEW.worked_hours = OLD.worked_hours
     AND NEW.approved_hours = OLD.approved_hours
     AND NEW.rostered_hours = OLD.rostered_hours
     AND NEW.flagged_hours = OLD.flagged_hours
     AND NEW.work_date = OLD.work_date
     AND NEW.timesheet_id = OLD.timesheet_id
     AND NEW.tenant_id = OLD.tenant_id THEN
    RETURN NEW;
  END IF;

  IF sheet_status IS NOT NULL AND sheet_status IN ('approved', 'exported') THEN
    RAISE EXCEPTION 'This timesheet is %; its days can no longer be changed', sheet_status
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF TG_OP <> 'DELETE' THEN
    NEW.updated_at := CURRENT_TIMESTAMP;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$entry$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_timesheet_entries_guard ON timesheet_entries;
CREATE TRIGGER trg_timesheet_entries_guard
  BEFORE INSERT OR UPDATE OR DELETE ON timesheet_entries
  FOR EACH ROW EXECUTE FUNCTION guard_timesheet_entry();
