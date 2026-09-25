import { axiosClient } from '../utils/axiosClient';

/**
 * EMS contracts, rosters and timesheets.
 *
 * Hours arrive from the API as the two-decimal strings the NUMERIC columns
 * hold, and are kept that way. Where a total has to be computed for display,
 * `sumHours` below does it in hundredths, for the same reason the payroll
 * service works in cents.
 *
 * The employee is resolved server-side from the authenticated identity, so
 * nothing here sends one except where HR is deliberately acting on somebody
 * else's behalf.
 */

export type ContractType = 'permanent' | 'fixed_term' | 'probation' | 'casual' | 'contractor';
export type ContractStatus = 'draft' | 'active' | 'ended' | 'cancelled';
export type ShiftStatus = 'scheduled' | 'published' | 'cancelled';
export type TimesheetStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'exported';
export type EntrySource = 'checkin' | 'roster' | 'manual' | 'leave';

export interface Contract {
  id: string;
  employee_id: string;
  reference: string;
  contract_type: ContractType;
  job_title: string;
  department_id: string | null;
  department_name?: string | null;
  manager_id: string | null;
  manager_first_name?: string | null;
  manager_last_name?: string | null;
  start_date: string;
  end_date: string | null;
  probation_end_date: string | null;
  notice_period_days: number;
  weekly_hours: string;
  working_days: string;
  status: ContractStatus;
  signed_at: string | null;
  ended_at: string | null;
  end_reason: string | null;
  note: string | null;
  first_name?: string;
  last_name?: string;
  employee_number?: string;
}

export interface ShiftPattern {
  id: string;
  code: string;
  name: string;
  start_time: string;
  end_time: string;
  break_minutes: number;
  crosses_midnight: boolean;
  paid_hours: string;
  colour: string | null;
  is_active: boolean;
}

export interface RosterShift {
  id: string;
  employee_id: string;
  pattern_id: string | null;
  code: string;
  name: string;
  work_date: string;
  start_time: string;
  end_time: string;
  break_minutes: number;
  paid_hours: string;
  status: ShiftStatus;
  published_at: string | null;
  cancel_reason: string | null;
  note: string | null;
  colour?: string | null;
  first_name?: string;
  last_name?: string;
  employee_number?: string;
}

export interface CoverageDay {
  work_date: string;
  shifts: number;
  people: number;
  hours: number;
  unpublished: number;
}

export interface Timesheet {
  id: string;
  employee_id: string;
  period_start: string;
  period_end: string;
  status: TimesheetStatus;
  contract_id: string | null;
  contracted_hours: string;
  rostered_hours: string;
  worked_hours: string;
  approved_hours: string;
  overtime_hours: string;
  flagged_hours: string;
  submitted_at: string | null;
  decided_at: string | null;
  decision_note: string | null;
  exported_at: string | null;
  payroll_input_id: string | null;
  first_name?: string;
  last_name?: string;
  employee_number?: string;
}

export interface TimesheetEntry {
  id: string;
  work_date: string;
  shift_id: string | null;
  rostered_hours: string;
  worked_hours: string;
  approved_hours: string;
  flagged_hours: string;
  source: EntrySource;
  note: string | null;
}

export interface ContractInForce {
  id: string;
  reference: string;
  contractType: string;
  jobTitle: string;
  weeklyHours: number;
  workingDays: number;
  startDate: string;
  endDate: string | null;
}

/** A preview is the same arithmetic as the stored sheet, in camelCase. */
export interface TimesheetPreview {
  contract: ContractInForce | null;
  contractedHours: string;
  rosteredHours: string;
  workedHours: string;
  flaggedHours: string;
  approvedHours: string;
  overtimeHours: string;
  leaveDays: number;
  entries: Array<{
    workDate: string;
    rosteredHours: string;
    workedHours: string;
    flaggedHours: string;
    approvedHours: string;
    source: EntrySource;
  }>;
}

// ---------------------------------------------------------------------------
// Hours
// ---------------------------------------------------------------------------

/** Hours as whole hundredths, so sums are exact. */
export function toCentihours(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0;
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(n)) return 0;
  const scaled = n * 100;
  return scaled < 0 ? -Math.round(-scaled) : Math.round(scaled);
}

export function fromCentihours(value: number): string {
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(value));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export function sumHours(values: Array<string | number | null | undefined>): string {
  return fromCentihours(values.reduce<number>((total, v) => total + toCentihours(v), 0));
}

/**
 * Hours for display.
 *
 * Trailing zeros dropped, because "8 h" reads better than "8.00 h" in a table
 * of them, and a half hour still shows as 8.5.
 */
export function formatHours(value: string | number | null | undefined): string {
  const ch = toCentihours(value);
  const whole = Math.floor(Math.abs(ch) / 100);
  const rest = Math.abs(ch) % 100;
  const sign = ch < 0 ? '-' : '';
  if (rest === 0) return `${sign}${whole}`;
  if (rest % 10 === 0) return `${sign}${whole}.${rest / 10}`;
  return `${sign}${whole}.${String(rest).padStart(2, '0')}`;
}

/** A DATE from the API as YYYY-MM-DD, whatever shape it arrives in. */
export function isoDay(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : '';
}

/** A TIME column as HH:MM; the column carries seconds nobody needs to read. */
export function shortTime(value: string | null | undefined): string {
  return value ? value.slice(0, 5) : '';
}

export const CONTRACT_TYPE_LABEL: Record<ContractType, string> = {
  permanent: 'Permanent',
  fixed_term: 'Fixed term',
  probation: 'Probation',
  casual: 'Casual',
  contractor: 'Contractor',
};

export const TIMESHEET_STATUS_LABEL: Record<TimesheetStatus, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  approved: 'Approved',
  rejected: 'Rejected',
  exported: 'Sent to payroll',
};


// ---------------------------------------------------------------------------
// Self-service check-in
// ---------------------------------------------------------------------------

export type CheckInType = 'office' | 'field';
export type CheckInState = 'VERIFIED' | 'FLAGGED' | 'REVOKED' | 'MANUAL_OVERRIDE';

export interface CheckIn {
  id: string;
  checkInType: CheckInType;
  checkInTime: string;
  checkOutTime: string | null;
  siteLocation: string | null;
  state: CheckInState;
  faceVerified: boolean;
  /** Hours for a closed check-in; null while it is open. */
  hours: string | null;
}

export interface MyAttendance {
  /** Null when the signed-in account has no employee record here. */
  employee: { id: string; employeeNumber: string; name: string } | null;
  onTheClock?: CheckIn | null;
  /** Open check-ins too old to close: they count for nothing until HR acts. */
  needsAttention?: CheckIn[];
  history?: CheckIn[];
  week?: { from: string; to: string; verifiedHours: string; flaggedHours: string };
}

export const CHECKIN_STATE_LABEL: Record<CheckInState, string> = {
  VERIFIED: 'Counted',
  MANUAL_OVERRIDE: 'Corrected by HR',
  FLAGGED: 'Flagged for review',
  REVOKED: 'Not counted',
};

export const workforceService = {
  // -- self-service check-in -----------------------------------------------
  /**
   * The caller's own attendance. No employee id is sent: the API resolves the
   * employee from the signed-in identity and would ignore one anyway.
   */
  async myAttendance(days = 30): Promise<MyAttendance> {
    const { data } = await axiosClient.get('/workforce/my/attendance', { params: { days } });
    return data;
  },

  /** The time is the server's; nothing here sends one. */
  async checkIn(input: { checkInType?: CheckInType; siteLocation?: string; faceMatchId?: string } = {}): Promise<CheckIn> {
    const { data } = await axiosClient.post('/workforce/my/check-in', input);
    return data.checkIn;
  },

  async checkOut(): Promise<CheckIn> {
    const { data } = await axiosClient.post('/workforce/my/check-out', {});
    return data.checkIn;
  },

  // -- contracts ---------------------------------------------------------
  async listContracts(status?: ContractStatus): Promise<Contract[]> {
    const { data } = await axiosClient.get('/workforce/contracts', { params: { status } });
    return data.contracts;
  },

  async myContract(): Promise<Contract | null> {
    const { data } = await axiosClient.get('/workforce/my/contract');
    return data.contract;
  },

  async createContract(input: {
    employeeId: string; reference: string; contractType?: ContractType;
    jobTitle: string; departmentId?: string; managerId?: string;
    startDate: string; endDate?: string | null; probationEndDate?: string | null;
    noticePeriodDays?: number; weeklyHours?: number; workingDays?: number;
    documentFileId?: string; note?: string;
  }): Promise<Contract> {
    const { data } = await axiosClient.post('/workforce/contracts', input);
    return data.contract;
  },

  async updateContract(id: string, input: Record<string, unknown>): Promise<Contract> {
    const { data } = await axiosClient.patch(`/workforce/contracts/${id}`, input);
    return data.contract;
  },

  async activateContract(id: string): Promise<Contract> {
    const { data } = await axiosClient.post(`/workforce/contracts/${id}/activate`, {});
    return data.contract;
  },

  async endContract(id: string, endDate: string, reason: string): Promise<Contract> {
    const { data } = await axiosClient.post(`/workforce/contracts/${id}/end`, { endDate, reason });
    return data.contract;
  },

  async withdrawContract(id: string): Promise<void> {
    await axiosClient.delete(`/workforce/contracts/${id}`);
  },

  // -- shift patterns ----------------------------------------------------
  async listPatterns(): Promise<ShiftPattern[]> {
    const { data } = await axiosClient.get('/workforce/shift-patterns');
    return data.patterns;
  },

  async createPattern(input: {
    code: string; name: string; startTime: string; endTime: string;
    breakMinutes?: number; colour?: string;
  }): Promise<ShiftPattern> {
    const { data } = await axiosClient.post('/workforce/shift-patterns', input);
    return data.pattern;
  },

  async updatePattern(id: string, input: Record<string, unknown>): Promise<ShiftPattern> {
    const { data } = await axiosClient.patch(`/workforce/shift-patterns/${id}`, input);
    return data.pattern;
  },

  async deletePattern(id: string): Promise<void> {
    await axiosClient.delete(`/workforce/shift-patterns/${id}`);
  },

  // -- the roster --------------------------------------------------------
  /** Returns `scope` so the caller knows whether it is looking at everybody. */
  async roster(from: string, to: string, employeeId?: string): Promise<{
    shifts: RosterShift[]; scope: 'all' | 'mine';
  }> {
    const { data } = await axiosClient.get('/workforce/roster', {
      params: { from, to, employeeId },
    });
    return data;
  },

  async rosterShift(input: {
    employeeId: string; patternId?: string | null; workDate: string;
    startTime?: string; endTime?: string; breakMinutes?: number; note?: string;
  }): Promise<RosterShift> {
    const { data } = await axiosClient.post('/workforce/roster', input);
    return data.shift;
  },

  /** Clashes come back listed rather than skipped: a gap in a rota matters. */
  async rosterBulk(input: {
    employeeId: string; patternId?: string | null; from: string; to: string;
    weekdays?: number[]; startTime?: string; endTime?: string; breakMinutes?: number;
  }): Promise<{ rostered: number; shifts: RosterShift[]; clashes: Array<{ workDate: string; reason: string }> }> {
    const { data } = await axiosClient.post('/workforce/roster/bulk', input);
    return data;
  },

  async publishRoster(from: string, to: string): Promise<number> {
    const { data } = await axiosClient.post('/workforce/roster/publish', { from, to });
    return data.published;
  },

  async cancelShift(id: string, reason: string): Promise<RosterShift> {
    const { data } = await axiosClient.post(`/workforce/roster/${id}/cancel`, { reason });
    return data.shift;
  },

  async coverage(from: string, to: string): Promise<CoverageDay[]> {
    const { data } = await axiosClient.get('/workforce/roster/coverage', { params: { from, to } });
    return data.days;
  },

  // -- timesheets --------------------------------------------------------
  async listTimesheets(status?: TimesheetStatus): Promise<Timesheet[]> {
    const { data } = await axiosClient.get('/workforce/timesheets', { params: { status } });
    return data.timesheets;
  },

  async myTimesheets(): Promise<Timesheet[]> {
    const { data } = await axiosClient.get('/workforce/my/timesheets');
    return data.timesheets;
  },

  async previewTimesheet(employeeId: string, from: string, to: string): Promise<TimesheetPreview> {
    const { data } = await axiosClient.get('/workforce/timesheets/preview', {
      params: { employeeId, from, to },
    });
    return data.preview;
  },

  async buildTimesheet(employeeId: string, periodStart: string, periodEnd: string): Promise<{
    timesheet: Timesheet; entries: TimesheetEntry[]; contract: ContractInForce | null;
  }> {
    const { data } = await axiosClient.post('/workforce/timesheets', {
      employeeId, periodStart, periodEnd,
    });
    return data;
  },

  async timesheet(id: string): Promise<{
    timesheet: Timesheet;
    entries: TimesheetEntry[];
    employee: { id: string; employee_id: string; first_name: string; last_name: string } | null;
    contract: { id: string; reference: string; job_title: string; weekly_hours: string } | null;
  }> {
    const { data } = await axiosClient.get(`/workforce/timesheets/${id}`);
    return data;
  },

  /** The worked figure never moves; only the approved one, and only with a reason. */
  async adjustDay(timesheetId: string, entryId: string, approvedHours: number, note: string): Promise<Timesheet> {
    const { data } = await axiosClient.patch(
      `/workforce/timesheets/${timesheetId}/days/${entryId}`,
      { approvedHours, note }
    );
    return data.timesheet;
  },

  async submitTimesheet(id: string): Promise<Timesheet> {
    const { data } = await axiosClient.post(`/workforce/timesheets/${id}/submit`, {});
    return data.timesheet;
  },

  async decideTimesheet(id: string, decision: 'approved' | 'rejected', note?: string): Promise<Timesheet> {
    const { data } = await axiosClient.post(`/workforce/timesheets/${id}/decision`, { decision, note });
    return data.timesheet;
  },

  async timesheetRate(id: string): Promise<{
    hourlyRate: string; currency: string; weeklyHours: number;
    overtimeHours: string; atMultiplierOne: string;
  }> {
    const { data } = await axiosClient.get(`/workforce/timesheets/${id}/rate`);
    return data;
  },

  async exportTimesheet(id: string, componentId: string, multiplier = 1): Promise<{
    timesheet: Timesheet; overtimeHours: string; hourlyRate: string;
    multiplier: number; amount: string;
  }> {
    const { data } = await axiosClient.post(`/workforce/timesheets/${id}/export`, {
      componentId, multiplier,
    });
    return data;
  },
};
