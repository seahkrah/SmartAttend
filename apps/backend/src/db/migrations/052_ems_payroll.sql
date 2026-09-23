-- 052: EMS payroll.
--
-- The largest gap in the platform. An employee record carried a designation
-- and a joining date and no indication of what the person is paid.
--
-- Payroll is the part of an HR system where being approximately right is
-- worthless, so the shape is chosen for the same reasons the fees module was:
--
--   1. Compensation is effective-dated. A raise in March must not change
--      February's payslip. What applies to a period is the latest record
--      taking effect on or before the period starts.
--
--   2. A payslip line is a COPY of the component it came from, not a
--      reference. Renaming an allowance or changing its rate alters what the
--      next run produces and nothing about the ones already issued.
--
--   3. A payslip carries its breakdown, not just a net figure. "Your net pay
--      is 3,421.50" with nothing behind it is unanswerable when challenged,
--      and payroll gets challenged.
--
--   4. Once a run is approved the payslips in it are frozen. A correction is
--      a later adjustment, never an edit to what somebody was already told
--      they were paid.
--
-- On tax: no bracket table is shipped. Rates, bands and the treatment of
-- pension contributions differ by country and change yearly, and a default
-- table would be wrong everywhere while looking authoritative. A tenant with
-- no brackets configured gets zero tax and a payslip that says so, rather
-- than a number nobody can source.

-- ---------------------------------------------------------------------------
-- Components: the vocabulary of pay
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS salary_components (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  code           VARCHAR(30) NOT NULL,
  name           VARCHAR(120) NOT NULL,
  description    TEXT,

  kind           VARCHAR(10) NOT NULL,

  -- How the amount is arrived at. A percentage is of the employee's basic,
  -- which is the only base that is stable while a run is being computed:
  -- a percentage of gross would depend on the order components are applied.
  calculation    VARCHAR(20) NOT NULL DEFAULT 'fixed',
  default_amount NUMERIC(14,2),
  default_rate   NUMERIC(7,4),

  -- Earnings only: whether this counts towards the tax base.
  is_taxable     BOOLEAN NOT NULL DEFAULT TRUE,
  -- Deductions only: whether this comes off before tax is computed, which is
  -- how pension and similar schemes usually work.
  reduces_taxable BOOLEAN NOT NULL DEFAULT FALSE,
  -- Required by law rather than chosen by the employer. Listed separately on
  -- a payslip and not removable per employee.
  is_statutory   BOOLEAN NOT NULL DEFAULT FALSE,

  sequence       INTEGER NOT NULL DEFAULT 0,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT salary_components_kind CHECK (kind IN ('earning', 'deduction')),
  CONSTRAINT salary_components_calculation
    CHECK (calculation IN ('fixed', 'percent_of_basic')),
  CONSTRAINT salary_components_amount CHECK (default_amount IS NULL OR default_amount >= 0),
  CONSTRAINT salary_components_rate
    CHECK (default_rate IS NULL OR (default_rate >= 0 AND default_rate <= 100)),
  -- A fixed component needs an amount; a percentage needs a rate. Either way
  -- a component with neither produces nothing and is a configuration mistake.
  CONSTRAINT salary_components_has_basis CHECK (
    (calculation = 'fixed' AND default_amount IS NOT NULL)
    OR (calculation = 'percent_of_basic' AND default_rate IS NOT NULL)
  ),
  -- reduces_taxable is meaningless on an earning, and is_taxable is
  -- meaningless on a deduction. Pinned so a misconfigured row cannot quietly
  -- change a tax base.
  CONSTRAINT salary_components_flags_fit_kind CHECK (
    (kind = 'earning' AND reduces_taxable = FALSE)
    OR (kind = 'deduction')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_salary_components_code
  ON salary_components (tenant_id, UPPER(code));

CREATE INDEX IF NOT EXISTS idx_salary_components_tenant
  ON salary_components (tenant_id, kind, sequence);

-- ---------------------------------------------------------------------------
-- Compensation: what a person is paid, and from when
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS employee_compensation (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  employee_id    UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,

  -- The date this takes effect. A record is superseded by the next one, and
  -- what applies to a payroll period is the latest effective on or before the
  -- period's start date. Nothing is ever edited in place.
  effective_from DATE NOT NULL,

  currency       CHAR(3) NOT NULL DEFAULT 'USD',
  basic_salary   NUMERIC(14,2) NOT NULL,
  pay_frequency  VARCHAR(12) NOT NULL DEFAULT 'monthly',

  reason         VARCHAR(255),
  created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT employee_compensation_salary CHECK (basic_salary >= 0),
  CONSTRAINT employee_compensation_frequency
    CHECK (pay_frequency IN ('monthly', 'biweekly', 'weekly'))
);

-- One record per employee per effective date: two salaries starting the same
-- day is ambiguous, and picking one arbitrarily is how somebody is paid the
-- wrong amount.
CREATE UNIQUE INDEX IF NOT EXISTS uq_employee_compensation_effective
  ON employee_compensation (employee_id, effective_from);

CREATE INDEX IF NOT EXISTS idx_employee_compensation_lookup
  ON employee_compensation (tenant_id, employee_id, effective_from DESC);

-- Per-employee recurring additions and deductions, also effective-dated.
CREATE TABLE IF NOT EXISTS employee_salary_components (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  employee_id    UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  component_id   UUID NOT NULL REFERENCES salary_components(id) ON DELETE RESTRICT,

  -- Overrides the component's default where set.
  amount         NUMERIC(14,2),
  rate           NUMERIC(7,4),

  effective_from DATE NOT NULL,
  effective_to   DATE,

  created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT employee_salary_components_amount CHECK (amount IS NULL OR amount >= 0),
  CONSTRAINT employee_salary_components_rate
    CHECK (rate IS NULL OR (rate >= 0 AND rate <= 100)),
  CONSTRAINT employee_salary_components_dates
    CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

-- One assignment of a component to a person at a time. Overlapping ranges
-- would mean applying the same allowance twice in one run.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE employee_salary_components
  DROP CONSTRAINT IF EXISTS employee_salary_components_no_overlap;
ALTER TABLE employee_salary_components
  ADD CONSTRAINT employee_salary_components_no_overlap
  EXCLUDE USING gist (
    employee_id WITH =,
    component_id WITH =,
    daterange(effective_from, effective_to, '[]') WITH &&
  );

CREATE INDEX IF NOT EXISTS idx_employee_salary_components_lookup
  ON employee_salary_components (tenant_id, employee_id, effective_from);

-- ---------------------------------------------------------------------------
-- Tax
-- ---------------------------------------------------------------------------

-- Progressive bands, per tenant, effective-dated. Deliberately empty: see the
-- note at the top of this file.
CREATE TABLE IF NOT EXISTS tax_brackets (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name           VARCHAR(120) NOT NULL DEFAULT 'Income tax',
  effective_from DATE NOT NULL,
  sequence       INTEGER NOT NULL,

  -- The band covers income above lower_bound up to and including
  -- upper_bound. A null upper bound is the top band.
  lower_bound    NUMERIC(14,2) NOT NULL,
  upper_bound    NUMERIC(14,2),
  rate           NUMERIC(7,4) NOT NULL,

  created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT tax_brackets_bounds
    CHECK (lower_bound >= 0 AND (upper_bound IS NULL OR upper_bound > lower_bound)),
  CONSTRAINT tax_brackets_rate CHECK (rate >= 0 AND rate <= 100)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tax_brackets_sequence
  ON tax_brackets (tenant_id, effective_from, sequence);

CREATE INDEX IF NOT EXISTS idx_tax_brackets_lookup
  ON tax_brackets (tenant_id, effective_from DESC, sequence);

-- ---------------------------------------------------------------------------
-- Periods and runs
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS payroll_periods (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  code         VARCHAR(30) NOT NULL,
  name         VARCHAR(120) NOT NULL,
  start_date   DATE NOT NULL,
  end_date     DATE NOT NULL,
  pay_date     DATE NOT NULL,
  frequency    VARCHAR(12) NOT NULL DEFAULT 'monthly',
  status       VARCHAR(12) NOT NULL DEFAULT 'open',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT payroll_periods_dates CHECK (end_date >= start_date),
  CONSTRAINT payroll_periods_pay_date CHECK (pay_date >= start_date),
  CONSTRAINT payroll_periods_frequency
    CHECK (frequency IN ('monthly', 'biweekly', 'weekly')),
  CONSTRAINT payroll_periods_status CHECK (status IN ('open', 'locked', 'closed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_periods_code
  ON payroll_periods (tenant_id, UPPER(code));

-- Two periods of the same frequency covering the same day would mean paying
-- somebody twice for it.
ALTER TABLE payroll_periods DROP CONSTRAINT IF EXISTS payroll_periods_no_overlap;
ALTER TABLE payroll_periods
  ADD CONSTRAINT payroll_periods_no_overlap
  EXCLUDE USING gist (
    tenant_id WITH =,
    frequency WITH =,
    daterange(start_date, end_date, '[]') WITH &&
  );

CREATE INDEX IF NOT EXISTS idx_payroll_periods_tenant
  ON payroll_periods (tenant_id, start_date DESC);

CREATE TABLE IF NOT EXISTS payroll_runs (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  period_id        UUID NOT NULL REFERENCES payroll_periods(id) ON DELETE RESTRICT,

  status           VARCHAR(12) NOT NULL DEFAULT 'draft',
  currency         CHAR(3) NOT NULL DEFAULT 'USD',

  employee_count   INTEGER NOT NULL DEFAULT 0,
  gross_total      NUMERIC(16,2) NOT NULL DEFAULT 0,
  tax_total        NUMERIC(16,2) NOT NULL DEFAULT 0,
  deduction_total  NUMERIC(16,2) NOT NULL DEFAULT 0,
  net_total        NUMERIC(16,2) NOT NULL DEFAULT 0,

  -- Whether a tax table was in force when this was computed. Recorded per
  -- run so a payslip showing no tax can be explained years later.
  tax_table_applied BOOLEAN NOT NULL DEFAULT FALSE,

  note             TEXT,
  calculated_at    TIMESTAMPTZ,
  calculated_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at      TIMESTAMPTZ,
  approved_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  paid_at          TIMESTAMPTZ,
  paid_by          UUID REFERENCES users(id) ON DELETE SET NULL,
  cancelled_at     TIMESTAMPTZ,
  cancel_reason    TEXT,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT payroll_runs_status
    CHECK (status IN ('draft', 'calculated', 'approved', 'paid', 'cancelled')),
  CONSTRAINT payroll_runs_totals CHECK (
    gross_total >= 0 AND tax_total >= 0 AND deduction_total >= 0 AND net_total >= 0
  ),
  -- The arithmetic, not three numbers somebody typed.
  CONSTRAINT payroll_runs_net_is_arithmetic
    CHECK (net_total = gross_total - deduction_total),
  -- Tax is part of the deductions, so it can never exceed them.
  CONSTRAINT payroll_runs_tax_within_deductions CHECK (tax_total <= deduction_total),
  CONSTRAINT payroll_runs_calculated_has_time
    CHECK (status = 'draft' OR status = 'cancelled' OR calculated_at IS NOT NULL),
  CONSTRAINT payroll_runs_approved_has_time
    CHECK (status NOT IN ('approved', 'paid') OR approved_at IS NOT NULL),
  CONSTRAINT payroll_runs_paid_has_time
    CHECK (status <> 'paid' OR paid_at IS NOT NULL),
  CONSTRAINT payroll_runs_cancelled_has_reason
    CHECK (status <> 'cancelled' OR (cancelled_at IS NOT NULL AND cancel_reason IS NOT NULL))
);

-- One live run per period. A cancelled run stays for the record but does not
-- stop a fresh attempt.
CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_runs_one_live
  ON payroll_runs (period_id)
  WHERE status <> 'cancelled';

CREATE INDEX IF NOT EXISTS idx_payroll_runs_tenant
  ON payroll_runs (tenant_id, status, created_at DESC);

-- ---------------------------------------------------------------------------
-- Payslips
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS payslips (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id            UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  run_id               UUID NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  employee_id          UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,

  currency             CHAR(3) NOT NULL DEFAULT 'USD',

  -- The basic actually applied, after any proration for unpaid leave.
  basic                NUMERIC(14,2) NOT NULL DEFAULT 0,
  gross                NUMERIC(14,2) NOT NULL DEFAULT 0,
  taxable_gross        NUMERIC(14,2) NOT NULL DEFAULT 0,
  pre_tax_deductions   NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax                  NUMERIC(14,2) NOT NULL DEFAULT 0,
  post_tax_deductions  NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_deductions     NUMERIC(14,2) NOT NULL DEFAULT 0,
  net                  NUMERIC(14,2) NOT NULL DEFAULT 0,

  -- Why the basic was prorated, when it was.
  working_days         INTEGER,
  unpaid_days          NUMERIC(6,2) NOT NULL DEFAULT 0,

  note                 TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT payslips_amounts CHECK (
    basic >= 0 AND gross >= 0 AND taxable_gross >= 0
    AND pre_tax_deductions >= 0 AND tax >= 0 AND post_tax_deductions >= 0
    AND total_deductions >= 0
  ),
  CONSTRAINT payslips_deductions_add_up
    CHECK (total_deductions = pre_tax_deductions + tax + post_tax_deductions),
  CONSTRAINT payslips_net_is_arithmetic CHECK (net = gross - total_deductions),
  -- The tax base can never exceed what was actually earned.
  CONSTRAINT payslips_taxable_within_gross CHECK (taxable_gross <= gross),
  CONSTRAINT payslips_unpaid_days CHECK (unpaid_days >= 0)
);

-- One payslip per person per run.
CREATE UNIQUE INDEX IF NOT EXISTS uq_payslips_run_employee
  ON payslips (run_id, employee_id);

CREATE INDEX IF NOT EXISTS idx_payslips_employee
  ON payslips (tenant_id, employee_id, created_at DESC);

-- The breakdown. Copies, not references: see the note at the top.
CREATE TABLE IF NOT EXISTS payslip_lines (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  payslip_id    UUID NOT NULL REFERENCES payslips(id) ON DELETE CASCADE,

  -- Provenance only. The component may be renamed, repriced or deactivated;
  -- the line keeps what it was computed from.
  component_id  UUID REFERENCES salary_components(id) ON DELETE SET NULL,

  code          VARCHAR(30) NOT NULL,
  name          VARCHAR(120) NOT NULL,
  kind          VARCHAR(10) NOT NULL,
  amount        NUMERIC(14,2) NOT NULL,
  is_taxable    BOOLEAN NOT NULL DEFAULT TRUE,
  reduces_taxable BOOLEAN NOT NULL DEFAULT FALSE,

  -- Where this line came from, so a payslip can be read back to its inputs.
  source        VARCHAR(20) NOT NULL DEFAULT 'component',
  sequence      INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT payslip_lines_kind CHECK (kind IN ('earning', 'deduction')),
  CONSTRAINT payslip_lines_amount CHECK (amount >= 0),
  CONSTRAINT payslip_lines_source
    CHECK (source IN ('basic', 'component', 'input', 'statutory', 'tax', 'leave'))
);

CREATE INDEX IF NOT EXISTS idx_payslip_lines_payslip
  ON payslip_lines (payslip_id, sequence);

CREATE INDEX IF NOT EXISTS idx_payslip_lines_tenant ON payslip_lines (tenant_id);

-- ---------------------------------------------------------------------------
-- Per-period inputs
-- ---------------------------------------------------------------------------

-- Overtime, a bonus, a one-off deduction: things that apply to one period
-- rather than every one.
CREATE TABLE IF NOT EXISTS payroll_inputs (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  period_id    UUID NOT NULL REFERENCES payroll_periods(id) ON DELETE CASCADE,
  employee_id  UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  component_id UUID NOT NULL REFERENCES salary_components(id) ON DELETE RESTRICT,

  amount       NUMERIC(14,2) NOT NULL,
  note         TEXT,
  created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT payroll_inputs_amount CHECK (amount >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_inputs_one
  ON payroll_inputs (period_id, employee_id, component_id);

CREATE INDEX IF NOT EXISTS idx_payroll_inputs_lookup
  ON payroll_inputs (tenant_id, period_id, employee_id);

-- ---------------------------------------------------------------------------
-- Immutability
-- ---------------------------------------------------------------------------

-- A run that has been approved is what people were told they would be paid.
-- Its totals and its payslips stop being editable at that moment; the only
-- transitions left are to paid, and a correction is a later adjustment run.
CREATE OR REPLACE FUNCTION guard_payroll_run() RETURNS TRIGGER AS $payrun$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'A payroll run cannot be moved between tenants'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF OLD.status IN ('approved', 'paid') AND (
       NEW.gross_total IS DISTINCT FROM OLD.gross_total
    OR NEW.tax_total IS DISTINCT FROM OLD.tax_total
    OR NEW.deduction_total IS DISTINCT FROM OLD.deduction_total
    OR NEW.net_total IS DISTINCT FROM OLD.net_total
    OR NEW.employee_count IS DISTINCT FROM OLD.employee_count
    OR NEW.period_id IS DISTINCT FROM OLD.period_id
    OR NEW.currency IS DISTINCT FROM OLD.currency
  ) THEN
    RAISE EXCEPTION 'Run % is %; its figures are what people were told they would be paid',
      OLD.id, OLD.status
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF OLD.status = 'paid' AND NEW.status <> 'paid' THEN
    RAISE EXCEPTION 'A paid payroll run cannot be re-opened'
      USING ERRCODE = 'restrict_violation';
  END IF;

  NEW.updated_at := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$payrun$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payroll_runs_guard ON payroll_runs;
CREATE TRIGGER trg_payroll_runs_guard
  BEFORE UPDATE ON payroll_runs
  FOR EACH ROW EXECUTE FUNCTION guard_payroll_run();

-- Payslips and their lines follow the run they belong to.
CREATE OR REPLACE FUNCTION guard_payslip_change() RETURNS TRIGGER AS $payslip$
DECLARE
  run_status TEXT;
  target UUID;
BEGIN
  target := COALESCE(NEW.run_id, OLD.run_id);
  SELECT status INTO run_status FROM payroll_runs WHERE id = target;

  -- Deleting the run, or the tenant, cascades; that is how a draft is
  -- recalculated and how a tenant's data is removed.
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;

  IF run_status IS NOT NULL AND run_status IN ('approved', 'paid') THEN
    RAISE EXCEPTION 'Run is %; its payslips can no longer be changed', run_status
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$payslip$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payslips_guard ON payslips;
CREATE TRIGGER trg_payslips_guard
  BEFORE INSERT OR UPDATE OR DELETE ON payslips
  FOR EACH ROW EXECUTE FUNCTION guard_payslip_change();

CREATE OR REPLACE FUNCTION guard_payslip_line_change() RETURNS TRIGGER AS $paylin$
DECLARE
  run_status TEXT;
  target UUID;
BEGIN
  target := COALESCE(NEW.payslip_id, OLD.payslip_id);
  SELECT r.status INTO run_status
    FROM payslips p JOIN payroll_runs r ON r.id = p.run_id
   WHERE p.id = target;

  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;

  -- component_id is provenance, not part of the figure. Deleting a component
  -- nulls it through ON DELETE SET NULL, which arrives here as an UPDATE; a
  -- frozen run must not make its own components undeletable, and a line whose
  -- component has gone still carries the code, name and amount it was
  -- computed from. Only that one column may move, and only by cascade.
  IF TG_OP = 'UPDATE' AND pg_trigger_depth() > 1
     AND NEW.component_id IS NULL AND OLD.component_id IS NOT NULL
     AND NEW.code = OLD.code AND NEW.name = OLD.name AND NEW.kind = OLD.kind
     AND NEW.amount = OLD.amount AND NEW.payslip_id = OLD.payslip_id
     AND NEW.tenant_id = OLD.tenant_id AND NEW.source = OLD.source
     AND NEW.is_taxable = OLD.is_taxable
     AND NEW.reduces_taxable = OLD.reduces_taxable THEN
    RETURN NEW;
  END IF;

  IF run_status IS NOT NULL AND run_status IN ('approved', 'paid') THEN
    RAISE EXCEPTION 'Run is %; payslip lines can no longer be changed', run_status
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$paylin$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payslip_lines_guard ON payslip_lines;
CREATE TRIGGER trg_payslip_lines_guard
  BEFORE INSERT OR UPDATE OR DELETE ON payslip_lines
  FOR EACH ROW EXECUTE FUNCTION guard_payslip_line_change();
