import { query } from '../db/connection.js'
import type { PoolClient } from 'pg'

/**
 * EMS — leave entitlement and the arithmetic of a request.
 *
 * The balance rules live here rather than in a handler because three callers
 * must agree on them: an employee checking what they have left, a manager
 * approving, and HR reporting. A different answer from any of them is a
 * payroll dispute.
 *
 * The model:
 *
 *   available = entitled + carried over - taken - pending
 *
 * Pending is deducted deliberately. A request awaiting approval is a claim on
 * the balance, and letting an employee submit five more while the first is
 * undecided is how a leave system ends up approving more days than exist.
 */

export class LeaveError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
    this.name = 'LeaveError'
  }
}

export interface DayPortion {
  date: string
  portion: number
}

/** Saturday and Sunday. Company-specific weekends are a later refinement. */
function isWeekend(d: Date): boolean {
  const day = d.getUTCDay()
  return day === 0 || day === 6
}

/**
 * Expands a date range into working days.
 *
 * Weekends count as zero rather than being dropped, so the stored day rows
 * describe the whole span a person is away — which is what a calendar and a
 * cover rota need — while only working days consume entitlement.
 *
 * `halfDays` names dates taken as a half day.
 */
export function expandRange(
  startDate: string,
  endDate: string,
  halfDays: string[] = []
): { days: DayPortion[]; total: number } {
  const start = new Date(`${startDate}T00:00:00Z`)
  const end = new Date(`${endDate}T00:00:00Z`)

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new LeaveError('startDate and endDate must be valid dates (YYYY-MM-DD)')
  }
  if (end < start) {
    throw new LeaveError('The leave cannot end before it starts')
  }

  // A year is the practical ceiling; anything longer is a data-entry error
  // rather than a request, and expanding it would write thousands of rows.
  const spanDays = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1
  if (spanDays > 366) {
    throw new LeaveError('A single leave request cannot span more than a year')
  }

  const half = new Set(halfDays)
  const days: DayPortion[] = []
  let total = 0

  for (let i = 0; i < spanDays; i++) {
    const d = new Date(start.getTime() + i * 86_400_000)
    const iso = d.toISOString().slice(0, 10)

    const portion = isWeekend(d) ? 0 : half.has(iso) ? 0.5 : 1
    days.push({ date: iso, portion })
    total += portion
  }

  if (total <= 0) {
    throw new LeaveError('That range contains no working days')
  }

  return { days, total: Math.round(total * 10) / 10 }
}

export interface Balance {
  entitled: number
  carriedOver: number
  taken: number
  pending: number
  available: number
}

/**
 * The balance for one employee, type and year.
 *
 * Creates the row from the leave type's annual entitlement the first time it
 * is asked for, so a new employee has a balance without HR seeding one by
 * hand for every type.
 */
export async function ensureBalance(
  tenantId: string,
  employeeId: string,
  leaveTypeId: string,
  year: number,
  client?: PoolClient
): Promise<Balance> {
  const run = client ? client.query.bind(client) : query

  const existing = await run(
    `SELECT * FROM leave_balances
      WHERE tenant_id = $1 AND employee_id = $2 AND leave_type_id = $3 AND year = $4`,
    [tenantId, employeeId, leaveTypeId, year]
  )

  let row = existing.rows[0]

  if (!row) {
    const type = await run(
      `SELECT days_per_year FROM leave_types WHERE id = $1 AND tenant_id = $2`,
      [leaveTypeId, tenantId]
    )
    if (type.rows.length === 0) throw new LeaveError('Leave type not found', 404)

    const created = await run(
      `INSERT INTO leave_balances (tenant_id, employee_id, leave_type_id, year, entitled_days)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (employee_id, leave_type_id, year) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [tenantId, employeeId, leaveTypeId, year, type.rows[0].days_per_year]
    )
    row = created.rows[0]
  }

  return toBalance(row)
}

function toBalance(row: any): Balance {
  const entitled = Number(row.entitled_days)
  const carriedOver = Number(row.carried_over)
  const taken = Number(row.taken_days)
  const pending = Number(row.pending_days)
  return {
    entitled,
    carriedOver,
    taken,
    pending,
    // A pending request is a claim on the balance, so it is deducted here.
    available: Math.round((entitled + carriedOver - taken - pending) * 10) / 10,
  }
}

/**
 * Moves days between the taken and pending columns as a request changes state.
 *
 * Always called inside the caller's transaction, so a balance cannot drift
 * from the requests that produced it.
 */
export async function adjustBalance(
  client: PoolClient,
  tenantId: string,
  employeeId: string,
  leaveTypeId: string,
  year: number,
  delta: { pending?: number; taken?: number }
): Promise<void> {
  const updated = await client.query(
    `UPDATE leave_balances
        SET pending_days = GREATEST(pending_days + $5, 0),
            taken_days   = GREATEST(taken_days + $6, 0),
            updated_at   = CURRENT_TIMESTAMP
      WHERE tenant_id = $1 AND employee_id = $2 AND leave_type_id = $3 AND year = $4
      RETURNING id`,
    [tenantId, employeeId, leaveTypeId, year, delta.pending ?? 0, delta.taken ?? 0]
  )

  if (updated.rows.length === 0) {
    throw new LeaveError('No leave balance exists for that employee, type and year', 409)
  }
}

/**
 * Confirms a request can be made, and returns the day breakdown.
 *
 * Checks the notice period, the entitlement and the half-day policy. Overlap
 * is left to the database's exclusion constraint, which cannot be raced.
 */
export async function validateRequest(
  tenantId: string,
  employeeId: string,
  leaveTypeId: string,
  startDate: string,
  endDate: string,
  halfDays: string[]
): Promise<{ days: DayPortion[]; total: number; balance: Balance }> {
  const typeResult = await query(
    `SELECT * FROM leave_types WHERE id = $1 AND tenant_id = $2 AND is_active`,
    [leaveTypeId, tenantId]
  )
  if (typeResult.rows.length === 0) throw new LeaveError('Leave type not found', 404)
  const type = typeResult.rows[0]

  if (halfDays.length > 0 && !type.allows_half_day) {
    throw new LeaveError(`${type.name} cannot be taken as a half day`)
  }

  const { days, total } = expandRange(startDate, endDate, halfDays)

  if (type.min_notice_days > 0) {
    const today = new Date()
    today.setUTCHours(0, 0, 0, 0)
    const noticeGiven = Math.round(
      (new Date(`${startDate}T00:00:00Z`).getTime() - today.getTime()) / 86_400_000
    )
    if (noticeGiven < type.min_notice_days) {
      throw new LeaveError(
        `${type.name} needs ${type.min_notice_days} day(s) notice; this request gives ${Math.max(noticeGiven, 0)}`
      )
    }
  }

  const year = new Date(`${startDate}T00:00:00Z`).getUTCFullYear()
  const balance = await ensureBalance(tenantId, employeeId, leaveTypeId, year)

  // Unpaid and uncapped types carry no entitlement to exhaust.
  if (type.days_per_year > 0 && total > balance.available) {
    throw new LeaveError(
      `This request is ${total} day(s) but only ${balance.available} remain of ${type.name}`,
      409
    )
  }

  return { days, total, balance }
}
