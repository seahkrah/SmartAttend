import type { PoolClient } from 'pg'
import { toMinor, fromMinor } from './payrollService.js'

/**
 * EMS — contracts, rosters and timesheets.
 *
 * One chain rather than three modules. A contract says how many hours a person
 * is engaged for; a roster plans which ones; a timesheet records which ones
 * actually happened; and the difference between the last and the first is
 * overtime, which is money and goes to payroll.
 *
 * The rules that matter here are about where a number came from:
 *
 *   - Contracted hours on a timesheet are COPIED from the contract in force
 *     when the sheet was built, never looked up on read. A contract signed
 *     afterwards must not retrospectively turn last month's ordinary hours
 *     into overtime.
 *   - Worked hours are evidence. They come from check-ins that were actually
 *     verified and actually closed; a revoked check-in is not paid time, and a
 *     flagged one is reported rather than counted or quietly dropped.
 *   - Approved hours are a human's decision, defaulting to the worked hours.
 *     The two differ exactly when somebody decided they should, and the sheet
 *     shows both.
 *   - Overtime is arithmetic over those two, and the database refuses a row
 *     where it is not.
 *
 * Hours are NUMERIC(5,2) and handled as hundredths throughout for the same
 * reason payroll handles money as cents: summing 7.4 and 0.1 in binary
 * floating point does not give 7.5, and a fortnight of that is somebody's
 * overtime.
 */

export class WorkforceError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.name = 'WorkforceError'
    this.status = status
  }
}

export interface WorkforceContext {
  tenantId: string
  platformId: string
  userId: string
}

type Runner = { query: (text: string, params?: any[]) => Promise<any> }

// ---------------------------------------------------------------------------
// Hours
// ---------------------------------------------------------------------------

/** Hours as whole hundredths, so sums are exact. */
export function toCentihours(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').trim())
  if (!Number.isFinite(n)) throw new WorkforceError('That is not a number of hours')
  const scaled = n * 100
  return scaled < 0 ? -Math.round(-scaled) : Math.round(scaled)
}

/** Hundredths back to the two-decimal string the NUMERIC columns hold. */
export function fromCentihours(value: number): string {
  const sign = value < 0 ? '-' : ''
  const abs = Math.abs(Math.trunc(value))
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

/**
 * A DATE column as YYYY-MM-DD.
 *
 * node-postgres hands DATE back as a JS Date in the server's local zone, and
 * String(d).slice(0, 10) on that gives "Fri Aug 14" — a weekday name that
 * compares as a date without erroring.
 */
export function isoDay(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) {
    const y = value.getFullYear()
    const m = String(value.getMonth() + 1).padStart(2, '0')
    const d = String(value.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  const s = String(value)
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : ''
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export function requireDay(value: unknown, label: string): string {
  const s = String(value ?? '')
  if (!ISO_DATE.test(s)) throw new WorkforceError(`${label} must be a date as YYYY-MM-DD`)
  // Rejects 2026-02-30, which matches the pattern and is not a day.
  const [y, m, d] = s.split('-').map(Number)
  const probe = new Date(Date.UTC(y, m - 1, d))
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() + 1 !== m || probe.getUTCDate() !== d) {
    throw new WorkforceError(`${label} is not a real date`)
  }
  return s
}

const TIME = /^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/

export function requireTime(value: unknown, label: string): string {
  const s = String(value ?? '')
  if (!TIME.test(s)) throw new WorkforceError(`${label} must be a time as HH:MM`)
  return s.length === 5 ? `${s}:00` : s
}

/** Calendar days in a range, inclusive of both ends. */
export function daysInRange(from: string, to: string): number {
  const a = Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10)))
  const b = Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1, Number(to.slice(8, 10)))
  if (b < a) throw new WorkforceError('That range runs backwards')
  return Math.round((b - a) / 86400000) + 1
}

/** Every day in a range, as YYYY-MM-DD. */
export function eachDay(from: string, to: string): string[] {
  const out: string[] = []
  const count = daysInRange(from, to)
  const start = Date.UTC(
    Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10))
  )
  for (let i = 0; i < count; i += 1) {
    out.push(new Date(start + i * 86400000).toISOString().slice(0, 10))
  }
  return out
}

/**
 * The paid length of a shift, in hundredths of an hour.
 *
 * Wraps past midnight, because a shift ending at 06:00 having started at 22:00
 * is eight hours and not minus sixteen. The database computes the same thing
 * in a generated column; this exists so a caller can be told the figure before
 * committing to it.
 */
export function shiftHours(startTime: string, endTime: string, breakMinutes: number): number {
  const toSeconds = (t: string) => {
    const [h, m, s] = t.split(':').map(Number)
    return h * 3600 + m * 60 + (s || 0)
  }
  const span = (((toSeconds(endTime) - toSeconds(startTime)) % 86400) + 86400) % 86400
  const paid = span - breakMinutes * 60
  if (paid <= 0) throw new WorkforceError('That break is at least as long as the shift')
  return Math.round((paid / 3600) * 100)
}

// ---------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------

export interface ContractInForce {
  id: string
  reference: string
  contractType: string
  jobTitle: string
  weeklyHours: number
  workingDays: number
  startDate: string
  endDate: string | null
}

/**
 * The contract covering a date.
 *
 * Active contracts only: a draft is a proposal, and paying somebody against a
 * proposal is how a negotiation becomes a commitment nobody made. Overlapping
 * contracts are impossible by constraint, so at most one can match.
 */
export async function contractInForce(
  runner: Runner,
  tenantId: string,
  employeeId: string,
  onDate: string
): Promise<ContractInForce | null> {
  const r = await runner.query(
    `SELECT id, reference, contract_type, job_title, weekly_hours, working_days,
            start_date, end_date
       FROM employment_contracts
      WHERE tenant_id = $1
        AND employee_id = $2
        AND status = 'active'
        AND start_date <= $3::date
        AND (end_date IS NULL OR end_date >= $3::date)
      LIMIT 1`,
    [tenantId, employeeId, onDate]
  )
  if (r.rowCount === 0) return null
  const row = r.rows[0]
  return {
    id: row.id,
    reference: row.reference,
    contractType: row.contract_type,
    jobTitle: row.job_title,
    weeklyHours: Number(row.weekly_hours),
    workingDays: Number(row.working_days),
    startDate: isoDay(row.start_date),
    endDate: row.end_date ? isoDay(row.end_date) : null,
  }
}

/**
 * Activates a draft contract.
 *
 * Separate from creating it because a contract is usually drafted, checked and
 * only then signed. From here the terms are fixed — the trigger sees to that —
 * so this is the point of no return.
 */
export async function activateContract(
  client: PoolClient,
  ctx: WorkforceContext,
  contractId: string
): Promise<any> {
  const existing = await client.query(
    `SELECT id, status, reference FROM employment_contracts
      WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
    [contractId, ctx.tenantId]
  )
  if (existing.rowCount === 0) throw new WorkforceError('Contract not found', 404)
  if (existing.rows[0].status !== 'draft') {
    throw new WorkforceError(`This contract is already ${existing.rows[0].status}`, 409)
  }

  const activated = await client.query(
    `UPDATE employment_contracts
        SET status = 'active', signed_at = COALESCE(signed_at, CURRENT_TIMESTAMP)
      WHERE id = $1 AND tenant_id = $2
      RETURNING *`,
    [contractId, ctx.tenantId]
  )
  return activated.rows[0]
}

/**
 * Ends an active contract on a date.
 *
 * The end date is set as well as the status, so the range the contract
 * occupies closes and a successor can start the day after. Without that the
 * overlap constraint would refuse every future contract for that person.
 */
export async function endContract(
  client: PoolClient,
  ctx: WorkforceContext,
  contractId: string,
  endDate: string,
  reason: string
): Promise<any> {
  if (!reason || !String(reason).trim()) {
    throw new WorkforceError('Ending a contract has to say why')
  }
  const day = requireDay(endDate, 'endDate')

  const existing = await client.query(
    `SELECT id, status, start_date FROM employment_contracts
      WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
    [contractId, ctx.tenantId]
  )
  if (existing.rowCount === 0) throw new WorkforceError('Contract not found', 404)
  const row = existing.rows[0]
  if (row.status === 'ended') throw new WorkforceError('This contract has already ended', 409)
  if (row.status === 'cancelled') throw new WorkforceError('This contract was cancelled', 409)
  if (row.status !== 'active') {
    throw new WorkforceError('Only an active contract can be ended; cancel a draft instead', 409)
  }
  if (day < isoDay(row.start_date)) {
    throw new WorkforceError('A contract cannot end before it started')
  }

  const ended = await client.query(
    `UPDATE employment_contracts
        SET status = 'ended', end_date = $3::date, ended_at = CURRENT_TIMESTAMP,
            end_reason = $4
      WHERE id = $1 AND tenant_id = $2
      RETURNING *`,
    [contractId, ctx.tenantId, day, String(reason).trim()]
  )
  return ended.rows[0]
}

// ---------------------------------------------------------------------------
// Rosters
// ---------------------------------------------------------------------------

export interface RosterRequest {
  employeeId: string
  patternId?: string | null
  workDate: string
  startTime?: string
  endTime?: string
  breakMinutes?: number
  note?: string | null
}

/**
 * Rosters one shift.
 *
 * Built from a pattern by copying it, or from times given directly. The copy
 * is the point: correcting a pattern changes what the next roster is built
 * from and nothing about the weeks already published to the people working
 * them.
 *
 * Refused where the employee has no contract covering the day. Rostering
 * somebody who is not engaged is how an ex-employee ends up on next month's
 * rota, and the check is here rather than in the router so every path that
 * creates a shift has it.
 */
export async function rosterShift(
  client: PoolClient,
  ctx: WorkforceContext,
  input: RosterRequest
): Promise<any> {
  const workDate = requireDay(input.workDate, 'workDate')

  const employee = await client.query(
    `SELECT id FROM employees WHERE id = $1 AND tenant_id = $2 AND is_currently_employed = TRUE`,
    [input.employeeId, ctx.tenantId]
  )
  if (employee.rowCount === 0) throw new WorkforceError('Employee not found', 404)

  const contract = await contractInForce(client, ctx.tenantId, input.employeeId, workDate)
  if (!contract) {
    throw new WorkforceError(
      'This employee has no active contract covering that day', 409
    )
  }

  let code: string
  let name: string
  let startTime: string
  let endTime: string
  let breakMinutes: number
  let patternId: string | null = null

  if (input.patternId) {
    const pattern = await client.query(
      `SELECT * FROM shift_patterns WHERE id = $1 AND tenant_id = $2`,
      [input.patternId, ctx.tenantId]
    )
    if (pattern.rowCount === 0) throw new WorkforceError('Shift pattern not found', 404)
    const p = pattern.rows[0]
    if (!p.is_active) throw new WorkforceError('That shift pattern is no longer in use', 409)
    patternId = p.id
    code = p.code
    name = p.name
    // Overridable per shift: a pattern is a starting point, not a straitjacket.
    startTime = input.startTime ? requireTime(input.startTime, 'startTime') : p.start_time
    endTime = input.endTime ? requireTime(input.endTime, 'endTime') : p.end_time
    breakMinutes = input.breakMinutes === undefined || input.breakMinutes === null
      ? Number(p.break_minutes)
      : Number(input.breakMinutes)
  } else {
    if (!input.startTime || !input.endTime) {
      throw new WorkforceError('A shift needs either a pattern or a start and end time')
    }
    code = 'ADHOC'
    name = 'Ad hoc shift'
    startTime = requireTime(input.startTime, 'startTime')
    endTime = requireTime(input.endTime, 'endTime')
    breakMinutes = Number(input.breakMinutes ?? 0)
  }

  if (!Number.isFinite(breakMinutes) || breakMinutes < 0) {
    throw new WorkforceError('A break cannot be negative')
  }
  // Validated here as well as by the check constraint so the caller gets a
  // sentence rather than a constraint name.
  shiftHours(startTime, endTime, breakMinutes)

  const created = await client.query(
    `INSERT INTO roster_shifts
       (tenant_id, employee_id, pattern_id, code, name, work_date,
        start_time, end_time, break_minutes, note, created_by)
     VALUES ($1,$2,$3,$4,$5,$6::date,$7::time,$8::time,$9,$10,$11)
     RETURNING *`,
    [
      ctx.tenantId, input.employeeId, patternId, code, name, workDate,
      startTime, endTime, breakMinutes, input.note ?? null, ctx.userId,
    ]
  )
  return created.rows[0]
}

/**
 * Publishes every scheduled shift in a date range.
 *
 * A roster is published as a block because that is how people read it: half a
 * published week is worse than none, since the gaps look like days off.
 */
export async function publishRoster(
  client: PoolClient,
  ctx: WorkforceContext,
  from: string,
  to: string
): Promise<number> {
  const start = requireDay(from, 'from')
  const end = requireDay(to, 'to')
  if (end < start) throw new WorkforceError('That range runs backwards')

  const published = await client.query(
    `UPDATE roster_shifts
        SET status = 'published', published_at = CURRENT_TIMESTAMP
      WHERE tenant_id = $1
        AND work_date BETWEEN $2::date AND $3::date
        AND status = 'scheduled'
      RETURNING id`,
    [ctx.tenantId, start, end]
  )
  return published.rowCount ?? 0
}

// ---------------------------------------------------------------------------
// Timesheets
// ---------------------------------------------------------------------------

export interface DayHours {
  workDate: string
  shiftId: string | null
  rostered: number
  worked: number
  flagged: number
  approved: number
  source: 'checkin' | 'roster' | 'manual' | 'leave'
}

export interface BuiltTimesheet {
  contract: ContractInForce | null
  contractedCentihours: number
  rosteredCentihours: number
  workedCentihours: number
  flaggedCentihours: number
  approvedCentihours: number
  overtimeCentihours: number
  /** Days of leave in the period, half days counted as halves. */
  leaveDays: number
  entries: DayHours[]
}

/** Check-in states that count as time actually worked. */
const COUNTED_STATES = ['VERIFIED', 'MANUAL_OVERRIDE']

/**
 * What the evidence says a person worked over a period.
 *
 * Hours come from closed check-ins in a counted state. Three things are
 * deliberately excluded:
 *
 *   - A check-in with no check-out. Nobody knows when it ended, and assuming a
 *     shift's length would be inventing the number this table exists to avoid
 *     inventing.
 *   - A revoked check-in. That is a record somebody looked at and rejected.
 *   - A flagged one, which is returned separately instead, so a human decides
 *     rather than the hours silently appearing or silently not.
 *
 * A shift spanning midnight counts on the day it began, which is the same
 * convention the roster uses.
 */
export async function workedHours(
  runner: Runner,
  tenantId: string,
  employeeId: string,
  from: string,
  to: string
): Promise<Map<string, { worked: number; flagged: number }>> {
  const result = await runner.query(
    `SELECT to_char(c.check_in_time::date, 'YYYY-MM-DD') AS day,
            COALESCE(SUM(
              GREATEST(EXTRACT(EPOCH FROM (c.check_out_time - c.check_in_time)), 0)
            ) FILTER (WHERE c.checkin_state = ANY($4::text[])), 0)::float8 AS worked_seconds,
            COALESCE(SUM(
              GREATEST(EXTRACT(EPOCH FROM (c.check_out_time - c.check_in_time)), 0)
            ) FILTER (WHERE c.checkin_state = 'FLAGGED'), 0)::float8 AS flagged_seconds
       FROM corporate_checkins c
      WHERE c.tenant_id = $1
        AND c.employee_id = $2
        AND c.check_out_time IS NOT NULL
        AND c.check_in_time >= $3::date
        AND c.check_in_time < ($5::date + INTERVAL '1 day')
      GROUP BY 1`,
    [tenantId, employeeId, from, COUNTED_STATES, to]
  )

  const out = new Map<string, { worked: number; flagged: number }>()
  for (const row of result.rows) {
    out.set(row.day, {
      // Rounded once per day, so a week's total is the sum of the days shown
      // rather than a figure that disagrees with them.
      worked: Math.round((Number(row.worked_seconds) / 3600) * 100),
      flagged: Math.round((Number(row.flagged_seconds) / 3600) * 100),
    })
  }
  return out
}

/** Rostered hours per day over a period, cancelled shifts excluded. */
export async function rosteredHours(
  runner: Runner,
  tenantId: string,
  employeeId: string,
  from: string,
  to: string
): Promise<Map<string, { hours: number; shiftId: string }>> {
  const result = await runner.query(
    `SELECT to_char(work_date, 'YYYY-MM-DD') AS day,
            SUM(paid_hours)::float8 AS hours,
            MIN(id::text) AS shift_id
       FROM roster_shifts
      WHERE tenant_id = $1 AND employee_id = $2
        AND work_date BETWEEN $3::date AND $4::date
        AND status <> 'cancelled'
      GROUP BY 1`,
    [tenantId, employeeId, from, to]
  )
  const out = new Map<string, { hours: number; shiftId: string }>()
  for (const row of result.rows) {
    out.set(row.day, { hours: Math.round(Number(row.hours) * 100), shiftId: row.shift_id })
  }
  return out
}

/**
 * Approved leave inside a period, as a portion of a day each.
 *
 * Portions, not a count of rows: a half day is 0.5, and treating it as a
 * whole one would forgive four hours somebody was contracted to work. Paid
 * and unpaid leave both appear, because the question here is whether the
 * person was expected at work, not whether they were paid for not being.
 */
export async function leaveDays(
  runner: Runner,
  tenantId: string,
  employeeId: string,
  from: string,
  to: string
): Promise<Map<string, number>> {
  const result = await runner.query(
    `SELECT to_char(d.leave_date, 'YYYY-MM-DD') AS day,
            SUM(d.portion)::float8 AS portion
       FROM leave_request_days d
       JOIN leave_requests r ON r.id = d.request_id AND r.tenant_id = d.tenant_id
      WHERE d.tenant_id = $1
        AND d.employee_id = $2
        AND r.status = 'approved'
        AND d.leave_date BETWEEN $3::date AND $4::date
      GROUP BY 1`,
    [tenantId, employeeId, from, to]
  )
  const out = new Map<string, number>()
  for (const row of result.rows) {
    // Capped at a whole day: two overlapping half-day requests would otherwise
    // forgive more than the day contains.
    out.set(row.day, Math.min(Number(row.portion), 1))
  }
  return out
}

/**
 * Builds one employee's timesheet for a period, without writing anything.
 *
 * The contracted figure is the part worth explaining. A person's daily hours
 * are their weekly hours divided by the days a week they work; the days the
 * period is expected to contain are their working days scaled by its length;
 * and approved leave reduces that count, because you are not contracted to
 * work a day you were signed off for.
 *
 * Without that last step somebody who took two days' leave and worked their
 * remaining three would show a 16-hour shortfall, and somebody who took leave
 * and covered a colleague's shift would show overtime they did not earn.
 */
export async function buildTimesheet(
  runner: Runner,
  ctx: WorkforceContext,
  employeeId: string,
  periodStart: string,
  periodEnd: string
): Promise<BuiltTimesheet> {
  const from = requireDay(periodStart, 'periodStart')
  const to = requireDay(periodEnd, 'periodEnd')
  if (to < from) throw new WorkforceError('That period runs backwards')
  const span = daysInRange(from, to)
  if (span > 62) throw new WorkforceError('A timesheet covers at most two months')

  const contract = await contractInForce(runner, ctx.tenantId, employeeId, from)

  const [worked, rostered, leave] = await Promise.all([
    workedHours(runner, ctx.tenantId, employeeId, from, to),
    rosteredHours(runner, ctx.tenantId, employeeId, from, to),
    leaveDays(runner, ctx.tenantId, employeeId, from, to),
  ])

  const entries: DayHours[] = []
  let rosteredTotal = 0
  let workedTotal = 0
  let flaggedTotal = 0

  for (const day of eachDay(from, to)) {
    const w = worked.get(day)
    const r = rostered.get(day)
    const leavePortion = leave.get(day) ?? 0
    const onLeave = leavePortion > 0

    const workedCh = w?.worked ?? 0
    const flaggedCh = w?.flagged ?? 0
    const rosteredCh = r?.hours ?? 0

    // A day with nothing on it at all is left out. A timesheet listing every
    // Saturday at zero is a timesheet nobody reads to the bottom of.
    if (workedCh === 0 && flaggedCh === 0 && rosteredCh === 0 && !onLeave) continue

    rosteredTotal += rosteredCh
    workedTotal += workedCh
    flaggedTotal += flaggedCh

    entries.push({
      workDate: day,
      shiftId: r?.shiftId ?? null,
      rostered: rosteredCh,
      worked: workedCh,
      flagged: flaggedCh,
      // Defaults to what the evidence says. A human moves it from here.
      approved: workedCh,
      source: onLeave && workedCh === 0 ? 'leave' : r ? 'roster' : 'checkin',
    })
  }

  let contractedCh = 0
  if (contract) {
    const dailyCh = Math.round((contract.weeklyHours / contract.workingDays) * 100)
    const expectedDays = (contract.workingDays * span) / 7
    let leaveTaken = 0
    for (const portion of leave.values()) leaveTaken += portion
    const payableDays = Math.max(expectedDays - leaveTaken, 0)
    contractedCh = Math.round(dailyCh * payableDays)
  }

  const approvedTotal = workedTotal
  return {
    contract,
    contractedCentihours: contractedCh,
    rosteredCentihours: rosteredTotal,
    workedCentihours: workedTotal,
    flaggedCentihours: flaggedTotal,
    approvedCentihours: approvedTotal,
    overtimeCentihours: Math.max(approvedTotal - contractedCh, 0),
    leaveDays: Math.round([...leave.values()].reduce((a, b) => a + b, 0) * 100) / 100,
    entries,
  }
}

/**
 * Writes a timesheet and its days.
 *
 * The caller owns BEGIN and COMMIT. A draft being rebuilt has its days deleted
 * first, so a shift cancelled since the last attempt does not leave its row
 * behind; the trigger refuses that once the sheet is approved.
 */
export async function saveTimesheet(
  client: PoolClient,
  ctx: WorkforceContext,
  employeeId: string,
  periodStart: string,
  periodEnd: string
): Promise<{ timesheet: any; entries: any[]; built: BuiltTimesheet }> {
  const employee = await client.query(
    `SELECT id FROM employees WHERE id = $1 AND tenant_id = $2`,
    [employeeId, ctx.tenantId]
  )
  if (employee.rowCount === 0) throw new WorkforceError('Employee not found', 404)

  const built = await buildTimesheet(client, ctx, employeeId, periodStart, periodEnd)

  const existing = await client.query(
    `SELECT id, status FROM timesheets
      WHERE tenant_id = $1 AND employee_id = $2 AND period_start = $3::date
      FOR UPDATE`,
    [ctx.tenantId, employeeId, periodStart]
  )
  if (existing.rowCount > 0 && !['draft', 'rejected'].includes(existing.rows[0].status)) {
    throw new WorkforceError(
      `This timesheet is ${existing.rows[0].status} and can no longer be rebuilt`, 409
    )
  }

  let timesheetId: string
  if (existing.rowCount > 0) {
    timesheetId = existing.rows[0].id
    await client.query(
      `DELETE FROM timesheet_entries WHERE timesheet_id = $1 AND tenant_id = $2`,
      [timesheetId, ctx.tenantId]
    )
    await client.query(
      `UPDATE timesheets
          SET status = 'draft', contract_id = $3, contracted_hours = $4,
              rostered_hours = $5, worked_hours = $6, approved_hours = $7,
              overtime_hours = $8, flagged_hours = $9,
              submitted_at = NULL, submitted_by = NULL,
              decided_at = NULL, decided_by = NULL, decision_note = NULL
        WHERE id = $1 AND tenant_id = $2`,
      [
        timesheetId, ctx.tenantId, built.contract?.id ?? null,
        fromCentihours(built.contractedCentihours),
        fromCentihours(built.rosteredCentihours),
        fromCentihours(built.workedCentihours),
        fromCentihours(built.approvedCentihours),
        fromCentihours(built.overtimeCentihours),
        fromCentihours(built.flaggedCentihours),
      ]
    )
  } else {
    const created = await client.query(
      `INSERT INTO timesheets
         (tenant_id, employee_id, period_start, period_end, contract_id,
          contracted_hours, rostered_hours, worked_hours, approved_hours,
          overtime_hours, flagged_hours)
       VALUES ($1,$2,$3::date,$4::date,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id`,
      [
        ctx.tenantId, employeeId, periodStart, periodEnd, built.contract?.id ?? null,
        fromCentihours(built.contractedCentihours),
        fromCentihours(built.rosteredCentihours),
        fromCentihours(built.workedCentihours),
        fromCentihours(built.approvedCentihours),
        fromCentihours(built.overtimeCentihours),
        fromCentihours(built.flaggedCentihours),
      ]
    )
    timesheetId = created.rows[0].id
  }

  const entries: any[] = []
  for (const entry of built.entries) {
    const row = await client.query(
      `INSERT INTO timesheet_entries
         (tenant_id, timesheet_id, work_date, shift_id, rostered_hours,
          worked_hours, approved_hours, flagged_hours, source)
       VALUES ($1,$2,$3::date,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        ctx.tenantId, timesheetId, entry.workDate, entry.shiftId,
        fromCentihours(entry.rostered), fromCentihours(entry.worked),
        fromCentihours(entry.approved), fromCentihours(entry.flagged), entry.source,
      ]
    )
    entries.push(row.rows[0])
  }

  const sheet = await client.query(
    `SELECT * FROM timesheets WHERE id = $1 AND tenant_id = $2`,
    [timesheetId, ctx.tenantId]
  )
  return { timesheet: sheet.rows[0], entries, built }
}

/**
 * Recomputes a sheet's totals from its days.
 *
 * Called after a day is adjusted. The totals are never typed in: they are the
 * sum of what the days say, and overtime is what the approved total exceeded
 * the contracted one by. The database refuses a row where that is not true, so
 * this and the constraint say the same thing in two places on purpose.
 */
export async function retotalTimesheet(
  client: PoolClient,
  ctx: WorkforceContext,
  timesheetId: string
): Promise<any> {
  const totals = await client.query(
    `SELECT COALESCE(SUM(rostered_hours), 0)::float8 AS rostered,
            COALESCE(SUM(worked_hours), 0)::float8 AS worked,
            COALESCE(SUM(approved_hours), 0)::float8 AS approved,
            COALESCE(SUM(flagged_hours), 0)::float8 AS flagged
       FROM timesheet_entries WHERE timesheet_id = $1 AND tenant_id = $2`,
    [timesheetId, ctx.tenantId]
  )
  const t = totals.rows[0]
  const contracted = await client.query(
    `SELECT contracted_hours FROM timesheets WHERE id = $1 AND tenant_id = $2`,
    [timesheetId, ctx.tenantId]
  )
  if (contracted.rowCount === 0) throw new WorkforceError('Timesheet not found', 404)

  const approvedCh = Math.round(Number(t.approved) * 100)
  const contractedCh = toCentihours(contracted.rows[0].contracted_hours)

  const updated = await client.query(
    `UPDATE timesheets
        SET rostered_hours = $3, worked_hours = $4, approved_hours = $5,
            flagged_hours = $6, overtime_hours = $7
      WHERE id = $1 AND tenant_id = $2
      RETURNING *`,
    [
      timesheetId, ctx.tenantId,
      fromCentihours(Math.round(Number(t.rostered) * 100)),
      fromCentihours(Math.round(Number(t.worked) * 100)),
      fromCentihours(approvedCh),
      fromCentihours(Math.round(Number(t.flagged) * 100)),
      fromCentihours(Math.max(approvedCh - contractedCh, 0)),
    ]
  )
  return updated.rows[0]
}

// ---------------------------------------------------------------------------
// The link to payroll
// ---------------------------------------------------------------------------

/**
 * An employee's hourly rate, derived from their salary and their contract.
 *
 * Annual pay divided by annual contracted hours. There is no stored hourly
 * rate: one would be a second copy of the same fact, and the two would drift
 * the first time somebody's salary changed and their contract did not.
 *
 * Returned in cents per hour, so the multiplication below stays in integers.
 */
export async function hourlyRateMinor(
  runner: Runner,
  tenantId: string,
  employeeId: string,
  onDate: string,
  weeklyHours: number
): Promise<{ rateMinor: number; currency: string }> {
  if (!(weeklyHours > 0)) {
    throw new WorkforceError('This contract has no hours to derive a rate from', 409)
  }

  const comp = await runner.query(
    `SELECT currency, basic_salary, pay_frequency
       FROM employee_compensation
      WHERE tenant_id = $1 AND employee_id = $2 AND effective_from <= $3::date
      ORDER BY effective_from DESC
      LIMIT 1`,
    [tenantId, employeeId, onDate]
  )
  if (comp.rowCount === 0) {
    throw new WorkforceError('This employee has no compensation record to derive a rate from', 409)
  }

  const row = comp.rows[0]
  const perYear: Record<string, number> = { monthly: 12, biweekly: 26, weekly: 52 }
  const periods = perYear[row.pay_frequency]
  if (!periods) throw new WorkforceError(`Unknown pay frequency: ${row.pay_frequency}`, 409)

  const annualMinor = toMinor(row.basic_salary) * periods
  const annualHours = weeklyHours * 52
  return {
    rateMinor: Math.round(annualMinor / annualHours),
    currency: String(row.currency).toUpperCase(),
  }
}

export interface ExportResult {
  input: any
  timesheet: any
  overtimeHours: string
  hourlyRate: string
  multiplier: number
  amount: string
}

/**
 * Sends an approved timesheet's overtime to payroll.
 *
 * This is the join the three modules exist for. Without it a timesheet is a
 * number somebody retypes into payroll, and retyping is where the errors come
 * from.
 *
 * Refused unless the sheet is approved, because sending unapproved hours to
 * payroll is paying them. Refused for a sheet with no overtime, because an
 * input of zero is noise on a payslip. And refused where the payroll period is
 * not open, since a run already calculated would not pick it up and a run
 * already approved must not change.
 */
export async function exportTimesheet(
  client: PoolClient,
  ctx: WorkforceContext,
  timesheetId: string,
  componentId: string,
  multiplier: number
): Promise<ExportResult> {
  if (!Number.isFinite(multiplier) || multiplier <= 0 || multiplier > 10) {
    throw new WorkforceError('The overtime multiplier must be between 0 and 10')
  }

  const sheetRow = await client.query(
    `SELECT * FROM timesheets WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
    [timesheetId, ctx.tenantId]
  )
  if (sheetRow.rowCount === 0) throw new WorkforceError('Timesheet not found', 404)
  const sheet = sheetRow.rows[0]

  if (sheet.status === 'exported') {
    throw new WorkforceError('This timesheet has already been sent to payroll', 409)
  }
  if (sheet.status !== 'approved') {
    throw new WorkforceError('Only an approved timesheet can be sent to payroll', 409)
  }

  const overtimeCh = toCentihours(sheet.overtime_hours)
  if (overtimeCh <= 0) {
    throw new WorkforceError('This timesheet has no overtime to send', 409)
  }

  const component = await client.query(
    `SELECT id, kind, is_active FROM salary_components WHERE id = $1 AND tenant_id = $2`,
    [componentId, ctx.tenantId]
  )
  if (component.rowCount === 0) throw new WorkforceError('Salary component not found', 404)
  if (component.rows[0].kind !== 'earning') {
    throw new WorkforceError('Overtime has to be paid against an earning, not a deduction', 409)
  }
  if (!component.rows[0].is_active) {
    throw new WorkforceError('That component is no longer in use', 409)
  }

  const periodEnd = isoDay(sheet.period_end)

  // The payroll period the work falls in. Matched on the end of the timesheet
  // rather than its start, so a week straddling a month end is paid with the
  // month it finished in rather than the one it began in.
  const period = await client.query(
    `SELECT id, status, name FROM payroll_periods
      WHERE tenant_id = $1 AND $2::date BETWEEN start_date AND end_date
      ORDER BY start_date DESC
      LIMIT 1`,
    [ctx.tenantId, periodEnd]
  )
  if (period.rowCount === 0) {
    throw new WorkforceError(
      'There is no payroll period covering the end of this timesheet', 409
    )
  }
  if (period.rows[0].status !== 'open') {
    throw new WorkforceError(
      `The payroll period covering this timesheet is ${period.rows[0].status}`, 409
    )
  }

  const weeklyHours = sheet.contract_id
    ? Number(
        (await client.query(
          `SELECT weekly_hours FROM employment_contracts WHERE id = $1 AND tenant_id = $2`,
          [sheet.contract_id, ctx.tenantId]
        )).rows[0]?.weekly_hours ?? 0
      )
    : 0

  const { rateMinor, currency } = await hourlyRateMinor(
    client, ctx.tenantId, sheet.employee_id, periodEnd, weeklyHours
  )

  // Integers throughout: cents per hour times hundredths of an hour is cents
  // times ten thousand, divided back down once at the end.
  const amountMinor = Math.round((rateMinor * overtimeCh * multiplier) / 100)

  // Added to whatever is already staged rather than replacing it. An employee
  // may have two timesheets landing in one payroll period, and the second
  // overwriting the first would silently drop a week of overtime.
  const input = await client.query(
    `INSERT INTO payroll_inputs
       (tenant_id, period_id, employee_id, component_id, amount, note, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (period_id, employee_id, component_id)
     DO UPDATE SET amount = payroll_inputs.amount + EXCLUDED.amount,
                   note = EXCLUDED.note,
                   created_by = EXCLUDED.created_by
     RETURNING *`,
    [
      ctx.tenantId, period.rows[0].id, sheet.employee_id, componentId,
      fromMinor(amountMinor),
      `${fromCentihours(overtimeCh)} h overtime at ${fromMinor(rateMinor)} ${currency}/h`
        + `${multiplier === 1 ? '' : ` x${multiplier}`}`,
      ctx.userId,
    ]
  )

  const updated = await client.query(
    `UPDATE timesheets
        SET status = 'exported', exported_at = CURRENT_TIMESTAMP, payroll_input_id = $3
      WHERE id = $1 AND tenant_id = $2
      RETURNING *`,
    [timesheetId, ctx.tenantId, input.rows[0].id]
  )

  return {
    input: input.rows[0],
    timesheet: updated.rows[0],
    overtimeHours: fromCentihours(overtimeCh),
    hourlyRate: fromMinor(rateMinor),
    multiplier,
    amount: fromMinor(amountMinor),
  }
}

// ---------------------------------------------------------------------------
// Self-service check-in
// ---------------------------------------------------------------------------

/**
 * How long an open check-in stays open.
 *
 * Somebody who checks in and forgets to check out leaves a row with no end.
 * Closing it days later would record a shift of days, so after this long it
 * stops counting as "on the clock": the employee can check in again, the old
 * row is reported as needing HR's attention, and — having no check-out — it
 * contributes nothing to a timesheet, which is what the timesheet engine
 * already does with any open row.
 */
export const OPEN_CHECKIN_HOURS = 24

const CHECKIN_TYPES = ['office', 'field'] as const
export type CheckInType = typeof CHECKIN_TYPES[number]

export interface CheckInRow {
  id: string
  checkInType: string
  checkInTime: string
  checkOutTime: string | null
  siteLocation: string | null
  state: string
  faceVerified: boolean
  /** Hours for a closed check-in; null while it is open. */
  hours: string | null
}

function toCheckInRow(r: any): CheckInRow {
  return {
    id: r.id,
    checkInType: r.check_in_type,
    checkInTime: r.check_in_time,
    checkOutTime: r.check_out_time,
    siteLocation: r.site_location,
    state: r.checkin_state,
    faceVerified: r.face_verified === true,
    hours: r.hours === null || r.hours === undefined ? null : String(r.hours),
  }
}

const CHECKIN_COLUMNS = `
  id, check_in_type, check_in_time, check_out_time, site_location,
  checkin_state, face_verified,
  CASE WHEN check_out_time IS NULL THEN NULL
       ELSE ROUND((GREATEST(EXTRACT(EPOCH FROM (check_out_time - check_in_time)), 0)
                   / 3600.0)::numeric, 2)
  END AS hours`

/**
 * The employee's open check-in, if they are on the clock.
 *
 * LOCALTIMESTAMP rather than CURRENT_TIMESTAMP because check_in_time is a
 * timestamp without time zone; comparing it with a zoned value would convert
 * one of them and the 24-hour window would move with the session's zone.
 */
async function openCheckIn(runner: Runner, tenantId: string, employeeId: string, lock = false) {
  const r = await runner.query(
    `SELECT ${CHECKIN_COLUMNS}
       FROM corporate_checkins
      WHERE tenant_id = $1 AND employee_id = $2
        AND check_out_time IS NULL
        AND check_in_time > LOCALTIMESTAMP - make_interval(hours => $3)
      ORDER BY check_in_time DESC
      LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
    [tenantId, employeeId, OPEN_CHECKIN_HOURS]
  )
  return r.rows[0] ?? null
}

/**
 * Locks the employee row for the length of the caller's transaction.
 *
 * Two check-ins submitted at once — a double tap, two tabs — would each find
 * nobody on the clock and each insert one. Serialising on the employee makes
 * the second one see the first. The lock is also the ownership check: the row
 * is selected inside the caller's tenant and only if they are still employed.
 */
async function lockEmployee(client: PoolClient, tenantId: string, employeeId: string) {
  const r = await client.query(
    `SELECT id FROM employees
      WHERE id = $1 AND tenant_id = $2 AND is_currently_employed = TRUE
      FOR UPDATE`,
    [employeeId, tenantId]
  )
  if (r.rowCount === 0) throw new WorkforceError('Employee record not found', 404)
}

/**
 * Checks the employee in, now.
 *
 * Three things are deliberately not taken from the request, whatever it says:
 * who is checking in (the signed-in identity), when (the server's clock), and
 * whether a face was verified (it was not — this is a web check-in, and the
 * face-verification service is a lecturer's tool for a class, not something
 * an employee can call). The removed route took all three from the client.
 */
export async function checkIn(
  client: PoolClient,
  ctx: WorkforceContext,
  employeeId: string,
  input: { checkInType?: unknown; siteLocation?: unknown; faceMatchId?: string | null }
): Promise<CheckInRow> {
  const type = input.checkInType === undefined || input.checkInType === null || input.checkInType === ''
    ? 'office'
    : String(input.checkInType)
  if (!(CHECKIN_TYPES as readonly string[]).includes(type)) {
    throw new WorkforceError('checkInType must be office or field')
  }
  const site = input.siteLocation === undefined || input.siteLocation === null
    ? null
    : String(input.siteLocation).trim().slice(0, 255) || null

  await lockEmployee(client, ctx.tenantId, employeeId)

  const open = await openCheckIn(client, ctx.tenantId, employeeId)
  if (open) {
    throw new WorkforceError('You are already checked in; check out first', 409)
  }

  // face_verified is true only when the caller cites a match the server made
  // for this employee moments ago (validated by the route, and spendable once:
  // a unique index refuses a second use). The database refuses the flag
  // without the citation.
  const created = await client.query(
    `INSERT INTO corporate_checkins
       (tenant_id, employee_id, check_in_type, check_in_time, site_location, face_verified, face_match_event_id)
     VALUES ($1, $2, $3, LOCALTIMESTAMP, $4, $5, $6)
     RETURNING ${CHECKIN_COLUMNS}`,
    [ctx.tenantId, employeeId, type, site, !!input.faceMatchId, input.faceMatchId ?? null]
  )
  return toCheckInRow(created.rows[0])
}

/** Checks the employee out of their open check-in, now. */
export async function checkOut(
  client: PoolClient,
  ctx: WorkforceContext,
  employeeId: string
): Promise<CheckInRow> {
  await lockEmployee(client, ctx.tenantId, employeeId)

  const open = await openCheckIn(client, ctx.tenantId, employeeId, true)
  if (!open) {
    throw new WorkforceError(
      `You are not checked in. A check-in left open for more than ${OPEN_CHECKIN_HOURS} hours `
        + 'is not closed automatically; ask HR to correct it',
      409
    )
  }

  const closed = await client.query(
    `UPDATE corporate_checkins
        SET check_out_time = LOCALTIMESTAMP
      WHERE id = $1 AND tenant_id = $2 AND employee_id = $3 AND check_out_time IS NULL
      RETURNING ${CHECKIN_COLUMNS}`,
    [open.id, ctx.tenantId, employeeId]
  )
  return toCheckInRow(closed.rows[0])
}

export interface AttendanceSummary {
  onTheClock: CheckInRow | null
  /** Open check-ins older than the window: counted nowhere, awaiting HR. */
  needsAttention: CheckInRow[]
  history: CheckInRow[]
  week: { from: string; to: string; verifiedHours: string; flaggedHours: string }
}

/**
 * The employee's own attendance: whether they are on the clock, what needs
 * HR's attention, their recent history, and this week's hours.
 *
 * The weekly figure comes from workedHours — the function timesheets are
 * built from — so the number an employee sees here is the number their
 * timesheet will say, rather than a second calculation that can disagree.
 */
export async function attendanceFor(
  runner: Runner,
  ctx: WorkforceContext,
  employeeId: string,
  days: number
): Promise<AttendanceSummary> {
  const window = Math.min(Math.max(Math.trunc(days) || 30, 1), 90)

  const history = await runner.query(
    `SELECT ${CHECKIN_COLUMNS}
       FROM corporate_checkins
      WHERE tenant_id = $1 AND employee_id = $2
        AND check_in_time > LOCALTIMESTAMP - make_interval(days => $3)
      ORDER BY check_in_time DESC
      LIMIT 200`,
    [ctx.tenantId, employeeId, window]
  )
  const rows = history.rows.map(toCheckInRow)

  const open = await openCheckIn(runner, ctx.tenantId, employeeId)
  const stale = await runner.query(
    `SELECT ${CHECKIN_COLUMNS}
       FROM corporate_checkins
      WHERE tenant_id = $1 AND employee_id = $2
        AND check_out_time IS NULL
        AND check_in_time <= LOCALTIMESTAMP - make_interval(hours => $3)
        AND check_in_time > LOCALTIMESTAMP - make_interval(days => $4)
      ORDER BY check_in_time DESC`,
    [ctx.tenantId, employeeId, OPEN_CHECKIN_HOURS, window]
  )

  // Monday to today, in the database's own calendar so it agrees with the
  // ::date grouping inside workedHours.
  const bounds = await runner.query(
    `SELECT to_char(date_trunc('week', LOCALTIMESTAMP)::date, 'YYYY-MM-DD') AS monday,
            to_char(LOCALTIMESTAMP::date, 'YYYY-MM-DD') AS today`
  )
  const { monday, today } = bounds.rows[0]
  const week = await workedHours(runner, ctx.tenantId, employeeId, monday, today)
  let verified = 0
  let flagged = 0
  for (const d of week.values()) {
    verified += d.worked
    flagged += d.flagged
  }

  return {
    onTheClock: open ? toCheckInRow(open) : null,
    needsAttention: stale.rows.map(toCheckInRow),
    history: rows,
    week: {
      from: monday,
      to: today,
      verifiedHours: fromCentihours(verified),
      flaggedHours: fromCentihours(flagged),
    },
  }
}
