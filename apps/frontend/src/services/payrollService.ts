import { axiosClient } from '../utils/axiosClient';

/**
 * EMS payroll: components, compensation, tax bands, periods, runs, payslips.
 *
 * Money arrives from the API as the two-decimal strings the NUMERIC columns
 * hold, and is kept that way. Parsing "3421.50" into a JavaScript number to
 * render it back is a round trip through binary floating point for no gain;
 * where a total has to be computed for display, `sumMoney` below does it in
 * integer minor units.
 *
 * The employee is resolved server-side from the authenticated identity, so
 * nothing here sends one except where HR is deliberately acting on somebody's
 * behalf.
 */

export type ComponentKind = 'earning' | 'deduction';
export type Calculation = 'fixed' | 'percent_of_basic';
export type RunStatus = 'draft' | 'calculated' | 'approved' | 'paid' | 'cancelled';
export type PeriodStatus = 'open' | 'locked' | 'closed';
export type LineSource = 'basic' | 'component' | 'input' | 'statutory' | 'tax' | 'leave';

export interface SalaryComponent {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  kind: ComponentKind;
  calculation: Calculation;
  default_amount: string | null;
  default_rate: string | null;
  is_taxable: boolean;
  reduces_taxable: boolean;
  is_statutory: boolean;
  sequence: number;
  is_active: boolean;
  assignment_count?: number;
}

export interface Compensation {
  id: string;
  employee_id: string;
  effective_from: string;
  currency: string;
  basic_salary: string;
  pay_frequency: 'monthly' | 'biweekly' | 'weekly';
  reason?: string | null;
  created_at: string;
}

export interface ComponentAssignment {
  id: string;
  component_id: string;
  code: string;
  name: string;
  kind: ComponentKind;
  calculation: Calculation;
  amount: string | null;
  rate: string | null;
  is_taxable: boolean;
  reduces_taxable: boolean;
  is_statutory: boolean;
  effective_from: string;
  effective_to: string | null;
}

export interface TaxBracket {
  id: string;
  name: string;
  effective_from: string;
  sequence: number;
  lower_bound: string;
  upper_bound: string | null;
  rate: string;
}

export interface PayrollPeriod {
  id: string;
  code: string;
  name: string;
  start_date: string;
  end_date: string;
  pay_date: string;
  frequency: 'monthly' | 'biweekly' | 'weekly';
  status: PeriodStatus;
  run_id?: string | null;
  run_status?: RunStatus | null;
  employee_count?: number | null;
  gross_total?: string | null;
  net_total?: string | null;
}

export interface PayrollRun {
  id: string;
  period_id: string;
  status: RunStatus;
  currency: string;
  employee_count: number;
  gross_total: string;
  tax_total: string;
  deduction_total: string;
  net_total: string;
  tax_table_applied: boolean;
  note?: string | null;
  calculated_at?: string | null;
  calculated_by?: string | null;
  approved_at?: string | null;
  paid_at?: string | null;
  cancel_reason?: string | null;
  period_code?: string;
  period_name?: string;
  start_date?: string;
  end_date?: string;
  pay_date?: string;
}

export interface Payslip {
  id: string;
  run_id: string;
  employee_id: string;
  currency: string;
  basic: string;
  gross: string;
  taxable_gross: string;
  pre_tax_deductions: string;
  tax: string;
  post_tax_deductions: string;
  total_deductions: string;
  net: string;
  working_days: number | null;
  unpaid_days: string;
  created_at: string;
  first_name?: string;
  last_name?: string;
  employee_number?: string;
  department_name?: string | null;
  run_status?: RunStatus;
  period_code?: string;
  period_name?: string;
  start_date?: string;
  end_date?: string;
  pay_date?: string;
}

export interface PayslipLine {
  code: string;
  name: string;
  kind: ComponentKind;
  amount: string;
  is_taxable: boolean;
  reduces_taxable: boolean;
  source: LineSource;
  sequence: number;
}

export interface PayrollInput {
  id: string;
  employee_id: string;
  component_id: string;
  code: string;
  component_name: string;
  kind: ComponentKind;
  amount: string;
  note?: string | null;
  first_name: string;
  last_name: string;
  employee_number: string;
}

/** A preview is the same arithmetic as a run, in camelCase and unwritten. */
export interface PayslipPreview {
  employeeId: string;
  currency: string;
  basic: string;
  gross: string;
  taxableGross: string;
  preTaxDeductions: string;
  tax: string;
  postTaxDeductions: string;
  totalDeductions: string;
  net: string;
  workingDays: number;
  unpaidDays: number;
  taxTableApplied: boolean;
  lines: Array<{
    code: string;
    name: string;
    kind: ComponentKind;
    amount: string;
    isTaxable: boolean;
    reducesTaxable: boolean;
    source: LineSource;
  }>;
}

export interface SkippedEmployee {
  employeeId: string;
  name: string;
  reason: string;
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

/** A two-decimal string as whole minor units, for arithmetic only. */
export function toMinor(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0;
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(n)) return 0;
  const scaled = n * 100;
  return scaled < 0 ? -Math.round(-scaled) : Math.round(scaled);
}

/** Minor units back to the two-decimal string the API speaks. */
export function fromMinor(minor: number): string {
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(minor));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Adds amounts without going through floating point. */
export function sumMoney(values: Array<string | number | null | undefined>): string {
  return fromMinor(values.reduce<number>((total, v) => total + toMinor(v), 0));
}

/** For display: grouped digits, with the currency in front. */
export function formatMoney(value: string | number | null | undefined, currency = 'USD'): string {
  const minor = toMinor(value);
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  const whole = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const prefix = currency ? `${currency} ` : '';
  return `${sign}${prefix}${whole}.${String(abs % 100).padStart(2, '0')}`;
}

/**
 * A rate for display.
 *
 * The column is NUMERIC(7,4), so a flat 5% arrives as "5.0000". Trailing
 * zeros are dropped and the significant ones kept, because a rate of 7.5% and
 * one of 7.55% have to stay distinguishable.
 */
export function formatRate(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const s = String(value);
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

/** A DATE from the API as YYYY-MM-DD, whatever shape it arrives in. */
export function isoDay(value: string | null | undefined): string {
  if (!value) return '';
  return value.slice(0, 10);
}

export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  draft: 'Draft',
  calculated: 'Calculated',
  approved: 'Approved',
  paid: 'Paid',
  cancelled: 'Cancelled',
};

export const payrollService = {
  // -- components --------------------------------------------------------
  async listComponents(): Promise<SalaryComponent[]> {
    const { data } = await axiosClient.get('/payroll/components');
    return data.components;
  },

  async createComponent(input: {
    code: string; name: string; description?: string; kind: ComponentKind;
    calculation?: Calculation; defaultAmount?: string | number;
    defaultRate?: string | number; isTaxable?: boolean;
    reducesTaxable?: boolean; isStatutory?: boolean; sequence?: number;
  }): Promise<SalaryComponent> {
    const { data } = await axiosClient.post('/payroll/components', input);
    return data.component;
  },

  async updateComponent(id: string, input: Record<string, unknown>): Promise<SalaryComponent> {
    const { data } = await axiosClient.patch(`/payroll/components/${id}`, input);
    return data.component;
  },

  async deleteComponent(id: string): Promise<void> {
    await axiosClient.delete(`/payroll/components/${id}`);
  },

  // -- compensation ------------------------------------------------------
  async compensation(employeeId: string): Promise<{
    employee: { id: string; name: string; employeeNumber: string };
    compensation: Compensation[];
    components: ComponentAssignment[];
  }> {
    const { data } = await axiosClient.get(`/payroll/employees/${employeeId}/compensation`);
    return data;
  },

  async recordCompensation(employeeId: string, input: {
    basicSalary: string | number; effectiveFrom: string; currency?: string;
    payFrequency?: string; reason?: string;
  }): Promise<Compensation> {
    const { data } = await axiosClient.post(`/payroll/employees/${employeeId}/compensation`, input);
    return data.compensation;
  },

  async assignComponent(employeeId: string, input: {
    componentId: string; amount?: string | number; rate?: string | number;
    effectiveFrom: string; effectiveTo?: string | null;
  }): Promise<ComponentAssignment> {
    const { data } = await axiosClient.post(`/payroll/employees/${employeeId}/components`, input);
    return data.assignment;
  },

  /**
   * Ends an assignment. With an end date it is closed off and stays on the
   * record; without one it is removed outright. Either way what a past
   * payslip says does not move — its lines are copies.
   */
  async endAssignment(employeeId: string, assignmentId: string, endDate?: string): Promise<void> {
    await axiosClient.delete(`/payroll/employees/${employeeId}/components/${assignmentId}`, {
      params: endDate ? { endDate } : undefined,
    });
  },

  // -- tax ---------------------------------------------------------------
  async taxBrackets(): Promise<{ brackets: TaxBracket[]; configured: boolean }> {
    const { data } = await axiosClient.get('/payroll/tax-brackets');
    return data;
  },

  /** A whole table at a time; bands that do not tile the range are refused. */
  async saveTaxBrackets(input: {
    effectiveFrom: string; name?: string;
    brackets: Array<{ lowerBound: string | number; upperBound?: string | number | null; rate: string | number }>;
  }): Promise<TaxBracket[]> {
    const { data } = await axiosClient.put('/payroll/tax-brackets', input);
    return data.brackets;
  },

  // -- periods -----------------------------------------------------------
  async listPeriods(): Promise<PayrollPeriod[]> {
    const { data } = await axiosClient.get('/payroll/periods');
    return data.periods;
  },

  async createPeriod(input: {
    code: string; name: string; startDate: string; endDate: string;
    payDate: string; frequency?: string;
  }): Promise<PayrollPeriod> {
    const { data } = await axiosClient.post('/payroll/periods', input);
    return data.period;
  },

  async listInputs(periodId: string): Promise<PayrollInput[]> {
    const { data } = await axiosClient.get(`/payroll/periods/${periodId}/inputs`);
    return data.inputs;
  },

  async saveInput(periodId: string, input: {
    employeeId: string; componentId: string; amount: string | number; note?: string;
  }): Promise<PayrollInput> {
    const { data } = await axiosClient.post(`/payroll/periods/${periodId}/inputs`, input);
    return data.input;
  },

  async deleteInput(periodId: string, inputId: string): Promise<void> {
    await axiosClient.delete(`/payroll/periods/${periodId}/inputs/${inputId}`);
  },

  // -- runs --------------------------------------------------------------
  async listRuns(): Promise<PayrollRun[]> {
    const { data } = await axiosClient.get('/payroll/runs');
    return data.runs;
  },

  async openRun(periodId: string, currency?: string, note?: string): Promise<PayrollRun> {
    const { data } = await axiosClient.post('/payroll/runs', { periodId, currency, note });
    return data.run;
  },

  async run(runId: string): Promise<{
    run: PayrollRun; period: PayrollPeriod | null; payslips: Payslip[];
  }> {
    const { data } = await axiosClient.get(`/payroll/runs/${runId}`);
    return data;
  },

  async calculate(runId: string): Promise<{
    run: PayrollRun; payslipCount: number; skipped: SkippedEmployee[];
  }> {
    const { data } = await axiosClient.post(`/payroll/runs/${runId}/calculate`, {});
    return data;
  },

  async approve(runId: string): Promise<PayrollRun> {
    const { data } = await axiosClient.post(`/payroll/runs/${runId}/approve`, {});
    return data.run;
  },

  async markPaid(runId: string): Promise<PayrollRun> {
    const { data } = await axiosClient.post(`/payroll/runs/${runId}/pay`, {});
    return data.run;
  },

  async cancel(runId: string, reason: string): Promise<PayrollRun> {
    const { data } = await axiosClient.post(`/payroll/runs/${runId}/cancel`, { reason });
    return data.run;
  },

  async preview(runId: string, employeeId: string): Promise<PayslipPreview> {
    const { data } = await axiosClient.get(`/payroll/runs/${runId}/preview/${employeeId}`);
    return data.preview;
  },

  // -- payslips ----------------------------------------------------------
  async myPayslips(): Promise<Payslip[]> {
    const { data } = await axiosClient.get('/payroll/my/payslips');
    return data.payslips;
  },

  async payslip(payslipId: string): Promise<{
    payslip: Payslip;
    run: PayrollRun;
    employee: { id: string; employee_id: string; first_name: string; last_name: string; designation: string | null } | null;
    lines: PayslipLine[];
  }> {
    const { data } = await axiosClient.get(`/payroll/payslips/${payslipId}`);
    return data;
  },
};
