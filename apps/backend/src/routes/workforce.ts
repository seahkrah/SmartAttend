import { Router, Response, NextFunction } from 'express'
import { query, getConnection } from '../db/connection.js'
import { authenticateToken } from '../auth/middleware.js'
import {
  resolveTenantContext,
  requireTenant,
  requirePlatform,
  requireRoles,
  type ResolvedTenantContext,
  type TenantRequest,
} from '../auth/tenantContextMiddleware.js'
import {
  WorkforceError,
  type WorkforceContext,
  activateContract,
  attendanceFor,
  buildTimesheet,
  checkIn,
  checkOut,
  contractInForce,
  endContract,
  exportTimesheet,
  fromCentihours,
  hourlyRateMinor,
  isoDay,
  publishRoster,
  requireDay,
  requireTime,
  retotalTimesheet,
  rosterShift,
  saveTimesheet,
  shiftHours,
  toCentihours,
} from '../services/workforceService.js'
import { fromMinor } from '../services/payrollService.js'
import { rosterPublished, timesheetDecided } from '../notifications/events.js'
import { assertUsableMatch, BiometricError } from '../biometrics/service.js'

/**
 * EMS — contracts, rosters and timesheets.
 *
 * Who may do what:
 *
 *   contracts     the terms somebody is engaged on, so HR only; ending one
 *                 needs a director, because it ends somebody's employment
 *   patterns      the shapes a shift can take: HR only
 *   the roster    built and published by HR and managers
 *   timesheets    built and adjusted by HR and managers; approved by somebody
 *                 other than whoever submitted it; sent to payroll by a
 *                 director
 *   own records   an employee reads their own contract, their own published
 *                 shifts and their own timesheets, and nothing else
 *
 * An employee's own record is resolved from the authenticated identity, never
 * from an id in the request. Where HR supplies an id it is checked against the
 * caller's tenant first, and a record belonging to another tenant reads as
 * absent rather than forbidden — a 403 would confirm it exists.
 *
 * An employee sees only PUBLISHED shifts. A draft roster is a plan somebody is
 * still moving around, and showing it as though it were settled is worse than
 * showing nothing.
 */

const router = Router()

router.use(authenticateToken, resolveTenantContext, requireTenant, requirePlatform('corporate'))

type Ctx = ResolvedTenantContext & { tenantId: string }

function ctxOf(req: TenantRequest): Ctx {
  return req.ctx as Ctx
}

function svcCtx(req: TenantRequest): WorkforceContext {
  const c = req.ctx as Ctx
  return { tenantId: c.tenantId, platformId: c.platformId, userId: c.userId }
}

const hrOnly = requireRoles('hr', 'hr_director', 'admin')
const schedulers = requireRoles('hr', 'hr_director', 'admin', 'manager')
// Ending a contract ends somebody's employment, and sending hours to payroll
// spends money. Both are a second pair of eyes.
const directors = requireRoles('hr_director', 'admin')

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function fail(res: Response, label: string, e: unknown) {
  if (e instanceof WorkforceError) return res.status(e.status).json({ error: e.message })
  if (e instanceof BiometricError) return res.status(e.status).json({ error: e.message, code: e.code })
  if ((e as any)?.code === '23505' && (e as any)?.constraint === 'uq_corporate_checkins_face_match') {
    return res.status(409).json({ error: 'That face match has already been used', code: 'match_used' })
  }

  const err = e as { code?: string; constraint?: string; message?: string }

  if (err.code === '2F003' || err.code === 'P0001' || err.code === '23001') {
    return res.status(409).json({ error: err.message ?? 'That record can no longer be changed' })
  }
  if (err.code === '23P01') {
    if (err.constraint === 'employment_contracts_no_overlap') {
      return res.status(409).json({
        error: 'This employee already holds a contract covering some of those dates',
      })
    }
    if (err.constraint === 'roster_shifts_no_overlap') {
      return res.status(409).json({
        error: 'This employee is already rostered onto a shift overlapping that one',
      })
    }
    if (err.constraint === 'timesheets_no_overlap') {
      return res.status(409).json({
        error: 'This employee already has a timesheet covering some of those days',
      })
    }
    return res.status(409).json({ error: 'That overlaps a record which already exists' })
  }
  if (err.code === '23505') {
    if (err.constraint === 'uq_employment_contracts_reference') {
      return res.status(409).json({ error: 'A contract with that reference already exists' })
    }
    if (err.constraint === 'uq_shift_patterns_code') {
      return res.status(409).json({ error: 'A shift pattern with that code already exists' })
    }
    return res.status(409).json({ error: 'That record already exists' })
  }
  if (err.code === '23514') {
    if (err.constraint === 'employment_contracts_term_fits_type') {
      return res.status(400).json({
        error: 'A fixed-term, casual or contractor agreement needs an end date',
      })
    }
    if (err.constraint === 'shift_patterns_break_fits' || err.constraint === 'roster_shifts_break_fits') {
      return res.status(400).json({ error: 'That break is at least as long as the shift' })
    }
    if (err.constraint === 'shift_patterns_has_duration' || err.constraint === 'roster_shifts_has_duration') {
      return res.status(400).json({
        error: 'A shift starting and ending at the same time is either nothing or a whole day; '
          + 'say which',
      })
    }
    return res.status(400).json({ error: 'The values supplied are outside what this record allows' })
  }
  if (err.code === '23503') {
    return res.status(400).json({ error: 'That record refers to something which does not exist' })
  }
  console.error(`[WORKFORCE] ${label}:`, e)
  return res.status(500).json({ error: `Failed to ${label}` })
}

function notFound(res: Response, what: string) {
  return res.status(404).json({ error: `${what} not found` })
}

async function owned(table: string, ctx: Ctx, id: string): Promise<any | null> {
  if (!/^[a-z_]+$/.test(table)) throw new Error('unsafe table')
  if (!UUID.test(id ?? '')) return null
  const r = await query(`SELECT * FROM ${table} WHERE id = $1 AND tenant_id = $2`, [id, ctx.tenantId])
  return r.rows[0] ?? null
}

function isHr(ctx: Ctx): boolean {
  return ctx.isSuperadmin || ['hr', 'hr_director', 'admin'].includes(ctx.roleName)
}

function isScheduler(ctx: Ctx): boolean {
  return isHr(ctx) || ctx.roleName === 'manager'
}

/** The caller's own employee record in this tenant, if they have one. */
async function callerEmployee(ctx: Ctx): Promise<any | null> {
  const r = await query(
    `SELECT * FROM employees WHERE user_id = $1 AND tenant_id = $2 LIMIT 1`,
    [ctx.userId, ctx.tenantId]
  )
  return r.rows[0] ?? null
}

/**
 * Which employee a request is about.
 *
 * Without an id it is the caller. With one, only HR and managers may name
 * somebody else; anyone else asking about another employee gets their own
 * record rather than a refusal that would confirm the other id exists.
 */
async function targetEmployee(ctx: Ctx, suppliedId?: string): Promise<any | null> {
  if (!suppliedId) return callerEmployee(ctx)
  if (!isScheduler(ctx)) return callerEmployee(ctx)
  return owned('employees', ctx, suppliedId)
}

// ---------------------------------------------------------------------------
// Path parameters
// ---------------------------------------------------------------------------

router.param('contractId', async (req: TenantRequest, res: Response, next: NextFunction, id: string) => {
  try {
    const ctx = ctxOf(req)
    const row = await owned('employment_contracts', ctx, id)
    if (!row) return notFound(res, 'Contract')

    if (!isHr(ctx)) {
      const mine = await callerEmployee(ctx)
      // Somebody else's contract reads as absent. A 403 would confirm both
      // that it exists and whose it is, and a contract carries a salary band
      // in all but name.
      if (!mine || mine.id !== row.employee_id) return notFound(res, 'Contract')
    }

    ;(req as any).contract = row
    return next()
  } catch (e) {
    return fail(res, 'load contract', e)
  }
})

router.param('patternId', async (req: TenantRequest, res: Response, next: NextFunction, id: string) => {
  try {
    const row = await owned('shift_patterns', ctxOf(req), id)
    if (!row) return notFound(res, 'Shift pattern')
    ;(req as any).pattern = row
    return next()
  } catch (e) {
    return fail(res, 'load shift pattern', e)
  }
})

router.param('shiftId', async (req: TenantRequest, res: Response, next: NextFunction, id: string) => {
  try {
    const ctx = ctxOf(req)
    const row = await owned('roster_shifts', ctx, id)
    if (!row) return notFound(res, 'Shift')

    if (!isScheduler(ctx)) {
      const mine = await callerEmployee(ctx)
      if (!mine || mine.id !== row.employee_id) return notFound(res, 'Shift')
      // An employee cannot see a shift that has not been published, even their
      // own: it is a plan, not a commitment.
      if (row.status === 'scheduled') return notFound(res, 'Shift')
    }

    ;(req as any).shift = row
    return next()
  } catch (e) {
    return fail(res, 'load shift', e)
  }
})

router.param('timesheetId', async (req: TenantRequest, res: Response, next: NextFunction, id: string) => {
  try {
    const ctx = ctxOf(req)
    const row = await owned('timesheets', ctx, id)
    if (!row) return notFound(res, 'Timesheet')

    if (!isScheduler(ctx)) {
      const mine = await callerEmployee(ctx)
      if (!mine || mine.id !== row.employee_id) return notFound(res, 'Timesheet')
    }

    ;(req as any).timesheet = row
    return next()
  } catch (e) {
    return fail(res, 'load timesheet', e)
  }
})

// ===========================================================================
// Contracts
// ===========================================================================

router.get('/contracts', hrOnly, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const status = typeof req.query.status === 'string' ? req.query.status : null
    const result = await query(
      `SELECT c.*, e.first_name, e.last_name, e.employee_id AS employee_number,
              d.name AS department_name,
              m.first_name AS manager_first_name, m.last_name AS manager_last_name
         FROM employment_contracts c
         JOIN employees e ON e.id = c.employee_id AND e.tenant_id = c.tenant_id
         LEFT JOIN corporate_departments d ON d.id = c.department_id AND d.tenant_id = c.tenant_id
         LEFT JOIN employees m ON m.id = c.manager_id AND m.tenant_id = c.tenant_id
        WHERE c.tenant_id = $1
          AND ($2::text IS NULL OR c.status = $2::text)
        ORDER BY c.start_date DESC, e.last_name`,
      [ctx.tenantId, status]
    )
    return res.json({ contracts: result.rows })
  } catch (e) {
    return fail(res, 'load contracts', e)
  }
})

/**
 * The caller's own contract.
 *
 * Its terms, not its history: an employee reads what they are engaged on now.
 * Nothing here takes an employee id.
 */
router.get('/my/contract', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const employee = await callerEmployee(ctx)
    if (!employee) return res.json({ contract: null })

    const today = new Date().toISOString().slice(0, 10)
    const inForce = await contractInForce(
      { query }, ctx.tenantId, employee.id, today
    )
    if (!inForce) return res.json({ contract: null })

    const full = await query(
      `SELECT c.id, c.reference, c.contract_type, c.job_title, c.start_date, c.end_date,
              c.probation_end_date, c.notice_period_days, c.weekly_hours, c.working_days,
              c.status, c.signed_at, c.document_file_id,
              d.name AS department_name,
              m.first_name AS manager_first_name, m.last_name AS manager_last_name
         FROM employment_contracts c
         LEFT JOIN corporate_departments d ON d.id = c.department_id AND d.tenant_id = c.tenant_id
         LEFT JOIN employees m ON m.id = c.manager_id AND m.tenant_id = c.tenant_id
        WHERE c.id = $1 AND c.tenant_id = $2`,
      [inForce.id, ctx.tenantId]
    )
    return res.json({ contract: full.rows[0] ?? null })
  } catch (e) {
    return fail(res, 'load your contract', e)
  }
})

router.post('/contracts', hrOnly, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const b = req.body ?? {}

    const employee = await owned('employees', ctx, String(b.employeeId ?? ''))
    if (!employee) return notFound(res, 'Employee')

    if (!b.reference || !b.jobTitle) {
      return res.status(400).json({ error: 'reference and jobTitle are required' })
    }
    const startDate = requireDay(b.startDate, 'startDate')
    const endDate = b.endDate ? requireDay(b.endDate, 'endDate') : null
    const probationEnd = b.probationEndDate ? requireDay(b.probationEndDate, 'probationEndDate') : null

    if (b.departmentId && !(await owned('corporate_departments', ctx, String(b.departmentId)))) {
      return notFound(res, 'Department')
    }
    if (b.managerId) {
      const manager = await owned('employees', ctx, String(b.managerId))
      if (!manager) return notFound(res, 'Manager')
      if (manager.id === employee.id) {
        return res.status(400).json({ error: 'Somebody cannot report to themselves' })
      }
    }
    if (b.documentFileId && !(await owned('stored_files', ctx, String(b.documentFileId)))) {
      return notFound(res, 'Document')
    }

    const created = await query(
      `INSERT INTO employment_contracts
         (tenant_id, employee_id, reference, contract_type, job_title, department_id,
          manager_id, start_date, end_date, probation_end_date, notice_period_days,
          weekly_hours, working_days, document_file_id, note, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::date,$9::date,$10::date,$11,$12,$13,$14,$15,$16)
       RETURNING *`,
      [
        ctx.tenantId, employee.id, String(b.reference).trim(),
        b.contractType || 'permanent', String(b.jobTitle).trim(),
        b.departmentId || employee.department_id || null, b.managerId || null,
        startDate, endDate, probationEnd,
        b.noticePeriodDays === undefined ? 30 : Number(b.noticePeriodDays),
        b.weeklyHours === undefined ? 40 : Number(b.weeklyHours),
        b.workingDays === undefined ? 5 : Number(b.workingDays),
        b.documentFileId || null, b.note || null, ctx.userId,
      ]
    )
    return res.status(201).json({ contract: created.rows[0] })
  } catch (e) {
    return fail(res, 'create contract', e)
  }
})

/**
 * Revises a draft contract.
 *
 * Only a draft: once it is active the terms are what somebody agreed to, and
 * different terms are a new contract. The trigger refuses the rest, and this
 * refuses early so the caller gets a sentence rather than a constraint.
 */
router.patch('/contracts/:contractId', hrOnly, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const contract = (req as any).contract
    const b = req.body ?? {}

    if (contract.status !== 'draft') {
      return res.status(409).json({
        error: `This contract is ${contract.status}; different terms are a new contract`,
      })
    }

    if (b.departmentId && !(await owned('corporate_departments', ctx, String(b.departmentId)))) {
      return notFound(res, 'Department')
    }
    if (b.managerId && !(await owned('employees', ctx, String(b.managerId)))) {
      return notFound(res, 'Manager')
    }
    if (b.documentFileId && !(await owned('stored_files', ctx, String(b.documentFileId)))) {
      return notFound(res, 'Document')
    }

    const updated = await query(
      `UPDATE employment_contracts
          SET job_title = COALESCE($3, job_title),
              contract_type = COALESCE($4, contract_type),
              department_id = COALESCE($5, department_id),
              manager_id = COALESCE($6, manager_id),
              start_date = COALESCE($7::date, start_date),
              end_date = CASE WHEN $8::text = 'clear' THEN NULL
                              WHEN $9::date IS NOT NULL THEN $9::date
                              ELSE end_date END,
              probation_end_date = CASE WHEN $10::text = 'clear' THEN NULL
                                        WHEN $11::date IS NOT NULL THEN $11::date
                                        ELSE probation_end_date END,
              notice_period_days = COALESCE($12::int, notice_period_days),
              weekly_hours = COALESCE($13::numeric, weekly_hours),
              working_days = COALESCE($14::numeric, working_days),
              document_file_id = COALESCE($15, document_file_id),
              note = COALESCE($16, note)
        WHERE id = $1 AND tenant_id = $2
        RETURNING *`,
      [
        contract.id, ctx.tenantId,
        b.jobTitle === undefined ? null : String(b.jobTitle).trim(),
        b.contractType === undefined ? null : b.contractType,
        b.departmentId === undefined ? null : b.departmentId,
        b.managerId === undefined ? null : b.managerId,
        b.startDate === undefined ? null : requireDay(b.startDate, 'startDate'),
        b.endDate === null ? 'clear' : 'keep',
        b.endDate ? requireDay(b.endDate, 'endDate') : null,
        b.probationEndDate === null ? 'clear' : 'keep',
        b.probationEndDate ? requireDay(b.probationEndDate, 'probationEndDate') : null,
        b.noticePeriodDays === undefined ? null : Number(b.noticePeriodDays),
        b.weeklyHours === undefined ? null : Number(b.weeklyHours),
        b.workingDays === undefined ? null : Number(b.workingDays),
        b.documentFileId === undefined ? null : b.documentFileId,
        b.note === undefined ? null : b.note,
      ]
    )
    return res.json({ contract: updated.rows[0] })
  } catch (e) {
    return fail(res, 'update contract', e)
  }
})

router.post('/contracts/:contractId/activate', hrOnly, async (req: TenantRequest, res: Response) => {
  let client
  try {
    const ctx = svcCtx(req)
    const contract = (req as any).contract
    client = await getConnection()
    await client.query('BEGIN')
    const activated = await activateContract(client, ctx, contract.id)
    await client.query('COMMIT')
    return res.json({ contract: activated })
  } catch (e) {
    if (client) await client.query('ROLLBACK').catch(() => undefined)
    return fail(res, 'activate contract', e)
  } finally {
    if (client) client.release()
  }
})

router.post('/contracts/:contractId/end', directors, async (req: TenantRequest, res: Response) => {
  let client
  try {
    const ctx = svcCtx(req)
    const contract = (req as any).contract
    const b = req.body ?? {}
    client = await getConnection()
    await client.query('BEGIN')
    const ended = await endContract(
      client, ctx, contract.id,
      String(b.endDate ?? ''), String(b.reason ?? '')
    )
    await client.query('COMMIT')
    return res.json({ contract: ended })
  } catch (e) {
    if (client) await client.query('ROLLBACK').catch(() => undefined)
    return fail(res, 'end contract', e)
  } finally {
    if (client) client.release()
  }
})

/** Withdraws a draft that was never signed. An active one is ended, not deleted. */
router.delete('/contracts/:contractId', hrOnly, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const contract = (req as any).contract
    if (contract.status !== 'draft') {
      return res.status(409).json({
        error: `This contract is ${contract.status}; it can be ended but not withdrawn`,
      })
    }
    await query(`DELETE FROM employment_contracts WHERE id = $1 AND tenant_id = $2`,
      [contract.id, ctx.tenantId])
    return res.json({ deleted: true })
  } catch (e) {
    return fail(res, 'withdraw contract', e)
  }
})

// ===========================================================================
// Shift patterns
// ===========================================================================

router.get('/shift-patterns', schedulers, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const result = await query(
      `SELECT * FROM shift_patterns WHERE tenant_id = $1 ORDER BY start_time, code`,
      [ctx.tenantId]
    )
    return res.json({ patterns: result.rows })
  } catch (e) {
    return fail(res, 'load shift patterns', e)
  }
})

router.post('/shift-patterns', hrOnly, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const b = req.body ?? {}
    if (!b.code || !b.name) return res.status(400).json({ error: 'code and name are required' })

    const startTime = requireTime(b.startTime, 'startTime')
    const endTime = requireTime(b.endTime, 'endTime')
    const breakMinutes = b.breakMinutes === undefined ? 0 : Number(b.breakMinutes)
    if (!Number.isFinite(breakMinutes) || breakMinutes < 0) {
      return res.status(400).json({ error: 'A break cannot be negative' })
    }
    // Rejected here with a sentence rather than by the constraint with a name.
    shiftHours(startTime, endTime, breakMinutes)

    const created = await query(
      `INSERT INTO shift_patterns
         (tenant_id, code, name, start_time, end_time, break_minutes, colour)
       VALUES ($1,$2,$3,$4::time,$5::time,$6,$7) RETURNING *`,
      [
        ctx.tenantId, String(b.code).trim(), String(b.name).trim(),
        startTime, endTime, breakMinutes, b.colour || null,
      ]
    )
    return res.status(201).json({ pattern: created.rows[0] })
  } catch (e) {
    return fail(res, 'create shift pattern', e)
  }
})

router.patch('/shift-patterns/:patternId', hrOnly, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const pattern = (req as any).pattern
    const b = req.body ?? {}

    const startTime = b.startTime === undefined ? null : requireTime(b.startTime, 'startTime')
    const endTime = b.endTime === undefined ? null : requireTime(b.endTime, 'endTime')
    const breakMinutes = b.breakMinutes === undefined ? null : Number(b.breakMinutes)

    // Checked against the values that will actually be stored, not the ones
    // supplied: changing only the end time still has to leave a shift longer
    // than its break.
    shiftHours(
      startTime ?? pattern.start_time,
      endTime ?? pattern.end_time,
      breakMinutes ?? Number(pattern.break_minutes)
    )

    const updated = await query(
      `UPDATE shift_patterns
          SET name = COALESCE($3, name),
              start_time = COALESCE($4::time, start_time),
              end_time = COALESCE($5::time, end_time),
              break_minutes = COALESCE($6::int, break_minutes),
              colour = COALESCE($7, colour),
              is_active = COALESCE($8::boolean, is_active),
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND tenant_id = $2
        RETURNING *`,
      [
        pattern.id, ctx.tenantId,
        b.name === undefined ? null : String(b.name).trim(),
        startTime, endTime, breakMinutes,
        b.colour === undefined ? null : b.colour,
        b.isActive === undefined ? null : !!b.isActive,
      ]
    )
    return res.json({ pattern: updated.rows[0] })
  } catch (e) {
    return fail(res, 'update shift pattern', e)
  }
})

router.delete('/shift-patterns/:patternId', hrOnly, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const pattern = (req as any).pattern
    // Shifts hold the pattern under ON DELETE SET NULL and keep their own copy
    // of its times, so deleting it loses the provenance and nothing else.
    await query(`DELETE FROM shift_patterns WHERE id = $1 AND tenant_id = $2`,
      [pattern.id, ctx.tenantId])
    return res.json({ deleted: true })
  } catch (e) {
    return fail(res, 'delete shift pattern', e)
  }
})

// ===========================================================================
// The roster
// ===========================================================================

/**
 * The roster over a range.
 *
 * HR and managers see everything, including what is still being planned. An
 * employee sees their own published shifts and nothing else — not colleagues',
 * because a full rota is a map of who is in the building when.
 */
router.get('/roster', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const from = requireDay(req.query.from, 'from')
    const to = requireDay(req.query.to, 'to')

    if (isScheduler(ctx)) {
      const employeeId = typeof req.query.employeeId === 'string' ? req.query.employeeId : null
      if (employeeId && !(await owned('employees', ctx, employeeId))) {
        return notFound(res, 'Employee')
      }
      const result = await query(
        `SELECT s.*, e.first_name, e.last_name, e.employee_id AS employee_number,
                p.colour
           FROM roster_shifts s
           JOIN employees e ON e.id = s.employee_id AND e.tenant_id = s.tenant_id
           LEFT JOIN shift_patterns p ON p.id = s.pattern_id AND p.tenant_id = s.tenant_id
          WHERE s.tenant_id = $1
            AND s.work_date BETWEEN $2::date AND $3::date
            AND ($4::uuid IS NULL OR s.employee_id = $4::uuid)
          ORDER BY s.work_date, s.start_time, e.last_name`,
        [ctx.tenantId, from, to, employeeId]
      )
      return res.json({ shifts: result.rows, scope: 'all' })
    }

    const mine = await callerEmployee(ctx)
    if (!mine) return res.json({ shifts: [], scope: 'mine' })

    const result = await query(
      `SELECT s.*, p.colour
         FROM roster_shifts s
         LEFT JOIN shift_patterns p ON p.id = s.pattern_id AND p.tenant_id = s.tenant_id
        WHERE s.tenant_id = $1
          AND s.employee_id = $2
          AND s.work_date BETWEEN $3::date AND $4::date
          AND s.status = 'published'
        ORDER BY s.work_date, s.start_time`,
      [ctx.tenantId, mine.id, from, to]
    )
    return res.json({ shifts: result.rows, scope: 'mine' })
  } catch (e) {
    return fail(res, 'load the roster', e)
  }
})

router.post('/roster', schedulers, async (req: TenantRequest, res: Response) => {
  let client
  try {
    const ctx = svcCtx(req)
    const b = req.body ?? {}
    client = await getConnection()
    await client.query('BEGIN')
    const shift = await rosterShift(client, ctx, {
      employeeId: String(b.employeeId ?? ''),
      patternId: b.patternId ?? null,
      workDate: String(b.workDate ?? ''),
      startTime: b.startTime,
      endTime: b.endTime,
      breakMinutes: b.breakMinutes,
      note: b.note ?? null,
    })
    await client.query('COMMIT')
    return res.status(201).json({ shift })
  } catch (e) {
    if (client) await client.query('ROLLBACK').catch(() => undefined)
    return fail(res, 'roster that shift', e)
  } finally {
    if (client) client.release()
  }
})

/**
 * Rosters a pattern across a range of days.
 *
 * The thing a scheduler actually does: five mornings, not one shift five
 * times. Days that clash with something already rostered are reported rather
 * than skipped silently, because a gap in a rota is how somebody is not there.
 */
router.post('/roster/bulk', schedulers, async (req: TenantRequest, res: Response) => {
  let client
  try {
    const ctx = svcCtx(req)
    const full = ctxOf(req)
    const b = req.body ?? {}

    const employee = await owned('employees', full, String(b.employeeId ?? ''))
    if (!employee) return notFound(res, 'Employee')

    const from = requireDay(b.from, 'from')
    const to = requireDay(b.to, 'to')
    const days: number[] = Array.isArray(b.weekdays)
      ? b.weekdays.map(Number).filter((d: number) => Number.isInteger(d) && d >= 0 && d <= 6)
      : [1, 2, 3, 4, 5]
    if (days.length === 0) {
      return res.status(400).json({ error: 'weekdays must name at least one day, 0 (Sunday) to 6' })
    }

    const { eachDay } = await import('../services/workforceService.js')
    const dates = eachDay(from, to).filter((d) => {
      const [y, m, dd] = d.split('-').map(Number)
      return days.includes(new Date(Date.UTC(y, m - 1, dd)).getUTCDay())
    })
    if (dates.length > 92) {
      return res.status(400).json({ error: 'That range covers too many days to roster at once' })
    }

    client = await getConnection()
    const created: any[] = []
    const clashes: Array<{ workDate: string; reason: string }> = []

    // Each day in its own transaction: one clash mid-week must not discard the
    // days that did roster, and reporting the clash is more use than refusing
    // the whole week.
    for (const workDate of dates) {
      try {
        await client.query('BEGIN')
        created.push(await rosterShift(client, ctx, {
          employeeId: employee.id,
          patternId: b.patternId ?? null,
          workDate,
          startTime: b.startTime,
          endTime: b.endTime,
          breakMinutes: b.breakMinutes,
          note: b.note ?? null,
        }))
        await client.query('COMMIT')
      } catch (e) {
        await client.query('ROLLBACK').catch(() => undefined)
        const err = e as { code?: string; constraint?: string; message?: string }
        if (err.code === '23P01' || e instanceof WorkforceError) {
          clashes.push({
            workDate,
            reason: err.code === '23P01'
              ? 'already rostered onto an overlapping shift'
              : String(err.message),
          })
          continue
        }
        throw e
      }
    }

    return res.status(201).json({ rostered: created.length, shifts: created, clashes })
  } catch (e) {
    return fail(res, 'roster those shifts', e)
  } finally {
    if (client) client.release()
  }
})

router.post('/roster/publish', schedulers, async (req: TenantRequest, res: Response) => {
  let client
  try {
    const ctx = svcCtx(req)
    const b = req.body ?? {}
    client = await getConnection()
    await client.query('BEGIN')
    const published = await publishRoster(client, ctx, String(b.from ?? ''), String(b.to ?? ''))
    await client.query('COMMIT')

    // After the commit: telling somebody about a shift that then rolls back is
    // worse than telling them a moment later.
    if (published > 0) {
      await rosterPublished(
        { tenantId: ctx.tenantId, userId: ctx.userId },
        requireDay(b.from, 'from'), requireDay(b.to, 'to')
      )
    }
    return res.json({ published })
  } catch (e) {
    if (client) await client.query('ROLLBACK').catch(() => undefined)
    return fail(res, 'publish the roster', e)
  } finally {
    if (client) client.release()
  }
})

router.post('/roster/:shiftId/cancel', schedulers, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const shift = (req as any).shift
    const reason = String(req.body?.reason ?? '').trim()
    if (!reason) return res.status(400).json({ error: 'Cancelling a shift has to say why' })
    if (shift.status === 'cancelled') {
      return res.status(409).json({ error: 'That shift is already cancelled' })
    }

    const cancelled = await query(
      `UPDATE roster_shifts
          SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP, cancel_reason = $3
        WHERE id = $1 AND tenant_id = $2
        RETURNING *`,
      [shift.id, ctx.tenantId, reason]
    )
    return res.json({ shift: cancelled.rows[0] })
  } catch (e) {
    return fail(res, 'cancel that shift', e)
  }
})

/** Who is covering a range, and which days nobody is. */
router.get('/roster/coverage', schedulers, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const from = requireDay(req.query.from, 'from')
    const to = requireDay(req.query.to, 'to')

    const result = await query(
      `SELECT to_char(s.work_date, 'YYYY-MM-DD') AS work_date,
              COUNT(*)::int AS shifts,
              COUNT(DISTINCT s.employee_id)::int AS people,
              SUM(s.paid_hours)::float8 AS hours,
              COUNT(*) FILTER (WHERE s.status = 'scheduled')::int AS unpublished
         FROM roster_shifts s
        WHERE s.tenant_id = $1
          AND s.work_date BETWEEN $2::date AND $3::date
          AND s.status <> 'cancelled'
        GROUP BY 1
        ORDER BY 1`,
      [ctx.tenantId, from, to]
    )
    return res.json({ days: result.rows })
  } catch (e) {
    return fail(res, 'load coverage', e)
  }
})

// ===========================================================================
// Timesheets
// ===========================================================================

router.get('/timesheets', schedulers, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const status = typeof req.query.status === 'string' ? req.query.status : null
    const result = await query(
      `SELECT t.*, e.first_name, e.last_name, e.employee_id AS employee_number
         FROM timesheets t
         JOIN employees e ON e.id = t.employee_id AND e.tenant_id = t.tenant_id
        WHERE t.tenant_id = $1
          AND ($2::text IS NULL OR t.status = $2::text)
        ORDER BY t.period_start DESC, e.last_name`,
      [ctx.tenantId, status]
    )
    return res.json({ timesheets: result.rows })
  } catch (e) {
    return fail(res, 'load timesheets', e)
  }
})

// ===========================================================================
// Self-service check-in
// ===========================================================================

/**
 * The caller's own attendance.
 *
 * No employee id is accepted, by design: these three routes replace ones that
 * took it from the request body and so let anybody check anybody in. The
 * employee is whoever is signed in, and somebody with no employee record in
 * this tenant is told so rather than shown somebody else's.
 */
router.get('/my/attendance', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const employee = await callerEmployee(ctx)
    if (!employee) return res.json({ employee: null })

    const days = Number(req.query.days ?? 30)
    const summary = await attendanceFor({ query }, svcCtx(req), employee.id, days)
    return res.json({
      employee: {
        id: employee.id,
        employeeNumber: employee.employee_id,
        name: `${employee.first_name} ${employee.last_name}`,
      },
      ...summary,
    })
  } catch (e) {
    return fail(res, 'load your attendance', e)
  }
})

router.post('/my/check-in', async (req: TenantRequest, res: Response) => {
  let client
  try {
    const ctx = ctxOf(req)
    const employee = await callerEmployee(ctx)
    if (!employee) return notFound(res, 'Employee record')

    client = await getConnection()
    await client.query('BEGIN')
    // A face match is optional. When one is cited it must be this employee's
    // own, made by them, in this tenant, within the last few minutes.
    let faceMatchId: string | null = null
    if (req.body?.faceMatchId) {
      faceMatchId = await assertUsableMatch(client, ctx as any, req.body.faceMatchId, {
        action: 'verified',
        subject: { type: 'employee', id: employee.id },
      })
    }
    const row = await checkIn(client, svcCtx(req), employee.id, {
      checkInType: req.body?.checkInType,
      siteLocation: req.body?.siteLocation,
      faceMatchId,
    })
    await client.query('COMMIT')
    return res.status(201).json({ checkIn: row })
  } catch (e) {
    if (client) await client.query('ROLLBACK').catch(() => undefined)
    return fail(res, 'check you in', e)
  } finally {
    if (client) client.release()
  }
})

router.post('/my/check-out', async (req: TenantRequest, res: Response) => {
  let client
  try {
    const ctx = ctxOf(req)
    const employee = await callerEmployee(ctx)
    if (!employee) return notFound(res, 'Employee record')

    client = await getConnection()
    await client.query('BEGIN')
    const row = await checkOut(client, svcCtx(req), employee.id)
    await client.query('COMMIT')
    return res.json({ checkIn: row })
  } catch (e) {
    if (client) await client.query('ROLLBACK').catch(() => undefined)
    return fail(res, 'check you out', e)
  } finally {
    if (client) client.release()
  }
})

router.get('/my/timesheets', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const employee = await callerEmployee(ctx)
    if (!employee) return res.json({ timesheets: [] })

    const result = await query(
      `SELECT * FROM timesheets
        WHERE tenant_id = $1 AND employee_id = $2
        ORDER BY period_start DESC`,
      [ctx.tenantId, employee.id]
    )
    return res.json({ timesheets: result.rows })
  } catch (e) {
    return fail(res, 'load your timesheets', e)
  }
})

/**
 * What a timesheet would say, without writing one.
 *
 * Computed by exactly the same code that builds the stored sheet, for the same
 * reason the payroll preview is: a preview taking a different path is a
 * preview of something else.
 */
router.get('/timesheets/preview', schedulers, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = svcCtx(req)
    const full = ctxOf(req)
    const employee = await owned('employees', full, String(req.query.employeeId ?? ''))
    if (!employee) return notFound(res, 'Employee')

    const built = await buildTimesheet(
      { query }, ctx, employee.id,
      requireDay(req.query.from, 'from'), requireDay(req.query.to, 'to')
    )

    return res.json({
      preview: {
        contract: built.contract,
        contractedHours: fromCentihours(built.contractedCentihours),
        rosteredHours: fromCentihours(built.rosteredCentihours),
        workedHours: fromCentihours(built.workedCentihours),
        flaggedHours: fromCentihours(built.flaggedCentihours),
        approvedHours: fromCentihours(built.approvedCentihours),
        overtimeHours: fromCentihours(built.overtimeCentihours),
        leaveDays: built.leaveDays,
        entries: built.entries.map((x) => ({
          workDate: x.workDate,
          rosteredHours: fromCentihours(x.rostered),
          workedHours: fromCentihours(x.worked),
          flaggedHours: fromCentihours(x.flagged),
          approvedHours: fromCentihours(x.approved),
          source: x.source,
        })),
      },
    })
  } catch (e) {
    return fail(res, 'preview that timesheet', e)
  }
})

/** Builds, or rebuilds, a draft timesheet from the evidence. */
router.post('/timesheets', schedulers, async (req: TenantRequest, res: Response) => {
  let client
  try {
    const ctx = svcCtx(req)
    const full = ctxOf(req)
    const b = req.body ?? {}

    const employee = await owned('employees', full, String(b.employeeId ?? ''))
    if (!employee) return notFound(res, 'Employee')

    const from = requireDay(b.periodStart, 'periodStart')
    const to = requireDay(b.periodEnd, 'periodEnd')

    client = await getConnection()
    await client.query('BEGIN')
    const result = await saveTimesheet(client, ctx, employee.id, from, to)
    await client.query('COMMIT')

    return res.status(201).json({
      timesheet: result.timesheet,
      entries: result.entries,
      contract: result.built.contract,
    })
  } catch (e) {
    if (client) await client.query('ROLLBACK').catch(() => undefined)
    return fail(res, 'build that timesheet', e)
  } finally {
    if (client) client.release()
  }
})

router.get('/timesheets/:timesheetId', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const timesheet = (req as any).timesheet

    const entries = await query(
      `SELECT * FROM timesheet_entries
        WHERE timesheet_id = $1 AND tenant_id = $2
        ORDER BY work_date`,
      [timesheet.id, ctx.tenantId]
    )
    const employee = await query(
      `SELECT id, employee_id, first_name, last_name FROM employees
        WHERE id = $1 AND tenant_id = $2`,
      [timesheet.employee_id, ctx.tenantId]
    )
    const contract = timesheet.contract_id
      ? (await query(
          `SELECT id, reference, job_title, weekly_hours, working_days, contract_type
             FROM employment_contracts WHERE id = $1 AND tenant_id = $2`,
          [timesheet.contract_id, ctx.tenantId]
        )).rows[0] ?? null
      : null

    return res.json({
      timesheet,
      entries: entries.rows,
      employee: employee.rows[0] ?? null,
      contract,
    })
  } catch (e) {
    return fail(res, 'load that timesheet', e)
  }
})

/**
 * Adjusts one day's approved hours.
 *
 * The worked figure never moves: it is what the check-ins say, and a system
 * that lets it be edited is a system where the evidence is whatever the last
 * person typed. The approved figure is the one a human owns, and the two being
 * visibly different is the point — an adjustment should be legible as an
 * adjustment.
 */
router.patch('/timesheets/:timesheetId/days/:entryId', schedulers, async (req: TenantRequest, res: Response) => {
  let client
  try {
    const ctx = svcCtx(req)
    const full = ctxOf(req)
    const timesheet = (req as any).timesheet
    const b = req.body ?? {}

    if (!['draft', 'submitted', 'rejected'].includes(timesheet.status)) {
      return res.status(409).json({
        error: `This timesheet is ${timesheet.status}; its days can no longer be changed`,
      })
    }

    const entry = await owned('timesheet_entries', full, String(req.params.entryId))
    if (!entry || entry.timesheet_id !== timesheet.id) return notFound(res, 'Day')

    if (b.approvedHours === undefined || b.approvedHours === null) {
      return res.status(400).json({ error: 'approvedHours is required' })
    }
    const approved = toCentihours(b.approvedHours)
    if (approved < 0) return res.status(400).json({ error: 'Hours cannot be negative' })
    if (approved > 2400) return res.status(400).json({ error: 'A day holds at most 24 hours' })
    if (!String(b.note ?? '').trim()) {
      return res.status(400).json({
        error: 'Changing a day from what the check-ins say has to record why',
      })
    }

    client = await getConnection()
    await client.query('BEGIN')
    await client.query(
      `UPDATE timesheet_entries
          SET approved_hours = $3, note = $4, source = 'manual'
        WHERE id = $1 AND tenant_id = $2`,
      [entry.id, ctx.tenantId, fromCentihours(approved), String(b.note).trim()]
    )
    const updated = await retotalTimesheet(client, ctx, timesheet.id)
    await client.query('COMMIT')

    return res.json({ timesheet: updated })
  } catch (e) {
    if (client) await client.query('ROLLBACK').catch(() => undefined)
    return fail(res, 'adjust that day', e)
  } finally {
    if (client) client.release()
  }
})

router.post('/timesheets/:timesheetId/submit', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const timesheet = (req as any).timesheet

    // An employee submits their own; a scheduler submits anybody's in their
    // tenant. The router.param above has already refused a foreign sheet.
    if (!isScheduler(ctx)) {
      const mine = await callerEmployee(ctx)
      if (!mine || mine.id !== timesheet.employee_id) return notFound(res, 'Timesheet')
    }

    if (!['draft', 'rejected'].includes(timesheet.status)) {
      return res.status(409).json({ error: `This timesheet is already ${timesheet.status}` })
    }

    const submitted = await query(
      `UPDATE timesheets
          SET status = 'submitted', submitted_at = CURRENT_TIMESTAMP, submitted_by = $3,
              decided_at = NULL, decided_by = NULL, decision_note = NULL
        WHERE id = $1 AND tenant_id = $2
        RETURNING *`,
      [timesheet.id, ctx.tenantId, ctx.userId]
    )
    return res.json({ timesheet: submitted.rows[0] })
  } catch (e) {
    return fail(res, 'submit that timesheet', e)
  }
})

/**
 * Approves or rejects a submitted timesheet.
 *
 * Never by whoever submitted it. Signing off your own hours is not an
 * approval, and it is the one control that makes the rest of this module worth
 * having.
 */
router.post('/timesheets/:timesheetId/decision', schedulers, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const timesheet = (req as any).timesheet
    const { decision, note } = req.body ?? {}

    if (!['approved', 'rejected'].includes(String(decision))) {
      return res.status(400).json({ error: "decision must be 'approved' or 'rejected'" })
    }
    if (timesheet.status !== 'submitted') {
      return res.status(409).json({
        error: timesheet.status === 'draft'
          ? 'This timesheet has not been submitted yet'
          : `This timesheet is already ${timesheet.status}`,
      })
    }
    if (timesheet.submitted_by && timesheet.submitted_by === ctx.userId && !ctx.isSuperadmin) {
      return res.status(403).json({
        error: 'A timesheet has to be decided by somebody other than whoever submitted it',
      })
    }
    if (decision === 'rejected' && !String(note ?? '').trim()) {
      return res.status(400).json({ error: 'Rejecting a timesheet has to say why' })
    }

    const decided = await query(
      `UPDATE timesheets
          SET status = $3, decided_at = CURRENT_TIMESTAMP, decided_by = $4,
              decision_note = $5
        WHERE id = $1 AND tenant_id = $2
        RETURNING *`,
      [timesheet.id, ctx.tenantId, decision, ctx.userId, note ? String(note).trim() : null]
    )

    await timesheetDecided(
      { tenantId: ctx.tenantId, userId: ctx.userId },
      timesheet.id, String(decision), note ? String(note).trim() : null
    )

    return res.json({ timesheet: decided.rows[0] })
  } catch (e) {
    return fail(res, 'decide that timesheet', e)
  }
})

/**
 * Sends an approved timesheet's overtime to payroll.
 *
 * The join the three modules exist for. Restricted to a director because it
 * spends money: the amount lands on the next payslip.
 */
router.post('/timesheets/:timesheetId/export', directors, async (req: TenantRequest, res: Response) => {
  let client
  try {
    const ctx = svcCtx(req)
    const timesheet = (req as any).timesheet
    const b = req.body ?? {}

    if (!b.componentId) {
      return res.status(400).json({ error: 'componentId is required' })
    }

    client = await getConnection()
    await client.query('BEGIN')
    const result = await exportTimesheet(
      client, ctx, timesheet.id, String(b.componentId),
      b.multiplier === undefined ? 1 : Number(b.multiplier)
    )
    await client.query('COMMIT')

    return res.json({
      timesheet: result.timesheet,
      payrollInput: result.input,
      overtimeHours: result.overtimeHours,
      hourlyRate: result.hourlyRate,
      multiplier: result.multiplier,
      amount: result.amount,
    })
  } catch (e) {
    if (client) await client.query('ROLLBACK').catch(() => undefined)
    return fail(res, 'send that timesheet to payroll', e)
  } finally {
    if (client) client.release()
  }
})

/**
 * The hourly rate an export would use.
 *
 * Shown before committing, because the figure is derived from two records —
 * the salary and the contracted hours — and somebody about to authorise a
 * payment should be able to see which.
 */
router.get('/timesheets/:timesheetId/rate', schedulers, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = svcCtx(req)
    const timesheet = (req as any).timesheet

    const weeklyHours = timesheet.contract_id
      ? Number((await query(
          `SELECT weekly_hours FROM employment_contracts WHERE id = $1 AND tenant_id = $2`,
          [timesheet.contract_id, ctx.tenantId]
        )).rows[0]?.weekly_hours ?? 0)
      : 0

    const { rateMinor, currency } = await hourlyRateMinor(
      { query }, ctx.tenantId, timesheet.employee_id,
      isoDay(timesheet.period_end), weeklyHours
    )

    return res.json({
      hourlyRate: fromMinor(rateMinor),
      currency,
      weeklyHours,
      overtimeHours: timesheet.overtime_hours,
      atMultiplierOne: fromMinor(
        Math.round((rateMinor * toCentihours(timesheet.overtime_hours)) / 100)
      ),
    })
  } catch (e) {
    return fail(res, 'work out the hourly rate', e)
  }
})

export default router
