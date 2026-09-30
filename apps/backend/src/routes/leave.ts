import { Router, Response } from 'express'
import pool, { query } from '../db/connection.js'
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
  validateRequest,
  ensureBalance,
  adjustBalance,
  expandRange,
  LeaveError,
} from '../services/leaveService.js'
import { leaveDecided, leaveRequested } from '../notifications/events.js'

/**
 * EMS — leave types, balances, requests and approvals.
 *
 * Who may do what:
 *
 *   leave types   the company's policy, so HR-only
 *   balances      an employee reads their own; HR reads and sets any
 *   requests      an employee raises and cancels their own
 *   decisions     a manager or HR — never the requester, whatever their role,
 *                 because approving your own leave is not an approval
 *
 * Every route resolves the employee record from the authenticated identity
 * rather than taking an employee id from the client; where an id is supplied,
 * it is checked against the caller's tenant and never used to select it.
 */

const router = Router()

router.use(authenticateToken, resolveTenantContext, requireTenant, requirePlatform('corporate'))

type Ctx = ResolvedTenantContext & { tenantId: string }

function ctxOf(req: TenantRequest): Ctx {
  return req.ctx as Ctx
}

const hrOnly = requireRoles('hr', 'hr_director', 'admin')
const approvers = requireRoles('hr', 'hr_director', 'admin', 'manager')

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function fail(res: Response, label: string, e: unknown) {
  if (e instanceof LeaveError) {
    return res.status(e.status).json({ error: e.message })
  }
  const err = e as { code?: string; constraint?: string; message?: string }

  if (err.code === '23P01' && err.constraint === 'leave_requests_no_overlap') {
    return res.status(409).json({
      error: 'This employee already has leave covering some of those dates',
    })
  }
  if (err.code === '23505') {
    return res.status(409).json({ error: 'That record already exists' })
  }
  if (err.code === '23514') {
    return res.status(400).json({ error: 'The values supplied are outside what this record allows' })
  }
  console.error(`[LEAVE] ${label}:`, e)
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

/** The caller's own employee record in this tenant, if they have one. */
async function callerEmployee(ctx: Ctx): Promise<any | null> {
  const r = await query(
    `SELECT * FROM employees WHERE user_id = $1 AND tenant_id = $2 LIMIT 1`,
    [ctx.userId, ctx.tenantId]
  )
  return r.rows[0] ?? null
}

function isHr(ctx: Ctx): boolean {
  return ctx.isSuperadmin || ['hr', 'hr_director', 'admin'].includes(ctx.roleName)
}

/**
 * Resolves which employee a request is about.
 *
 * Without an id, it is the caller. With one, only HR and managers may name
 * someone else; anyone else asking about another employee gets their own
 * record rather than a refusal that would confirm the other id exists.
 */
async function targetEmployee(ctx: Ctx, suppliedId?: string): Promise<any | null> {
  if (!suppliedId) return callerEmployee(ctx)
  if (!isHr(ctx) && ctx.roleName !== 'manager') return callerEmployee(ctx)
  return owned('employees', ctx, suppliedId)
}

// ===========================================================================
// Leave types
// ===========================================================================

router.get('/types', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const result = await query(
      `SELECT * FROM leave_types WHERE tenant_id = $1 ORDER BY name`,
      [ctx.tenantId]
    )
    return res.json({ types: result.rows })
  } catch (e) {
    return fail(res, 'load leave types', e)
  }
})

router.post('/types', hrOnly, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const b = req.body ?? {}
    if (!b.code || !b.name) return res.status(400).json({ error: 'code and name are required' })

    const created = await query(
      `INSERT INTO leave_types
         (tenant_id, code, name, description, days_per_year, is_paid, requires_approval,
          requires_document, allows_half_day, max_carry_over, min_notice_days)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [
        ctx.tenantId, b.code, b.name, b.description || null,
        b.daysPerYear !== undefined ? Number(b.daysPerYear) : 0,
        b.isPaid !== undefined ? !!b.isPaid : true,
        b.requiresApproval !== undefined ? !!b.requiresApproval : true,
        !!b.requiresDocument,
        b.allowsHalfDay !== undefined ? !!b.allowsHalfDay : true,
        b.maxCarryOver !== undefined ? Number(b.maxCarryOver) : 0,
        b.minNoticeDays !== undefined ? Number(b.minNoticeDays) : 0,
      ]
    )
    return res.status(201).json({ type: created.rows[0] })
  } catch (e) {
    return fail(res, 'create leave type', e)
  }
})

router.patch('/types/:id', hrOnly, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const existing = await owned('leave_types', ctx, req.params.id)
    if (!existing) return notFound(res, 'Leave type')

    const b = req.body ?? {}
    const fields: string[] = []
    const values: any[] = []
    const set = (col: string, v: unknown) => {
      values.push(v)
      fields.push(`${col} = $${values.length}`)
    }

    if (b.name !== undefined) set('name', b.name)
    if (b.description !== undefined) set('description', b.description || null)
    if (b.daysPerYear !== undefined) set('days_per_year', Number(b.daysPerYear))
    if (b.isPaid !== undefined) set('is_paid', !!b.isPaid)
    if (b.requiresApproval !== undefined) set('requires_approval', !!b.requiresApproval)
    if (b.requiresDocument !== undefined) set('requires_document', !!b.requiresDocument)
    if (b.allowsHalfDay !== undefined) set('allows_half_day', !!b.allowsHalfDay)
    if (b.maxCarryOver !== undefined) set('max_carry_over', Number(b.maxCarryOver))
    if (b.minNoticeDays !== undefined) set('min_notice_days', Number(b.minNoticeDays))
    if (b.isActive !== undefined) set('is_active', !!b.isActive)

    if (fields.length === 0) return res.json({ type: existing })

    fields.push('updated_at = CURRENT_TIMESTAMP')
    values.push(existing.id, ctx.tenantId)
    const updated = await query(
      `UPDATE leave_types SET ${fields.join(', ')}
        WHERE id = $${values.length - 1} AND tenant_id = $${values.length} RETURNING *`,
      values
    )
    return res.json({ type: updated.rows[0] })
  } catch (e) {
    return fail(res, 'update leave type', e)
  }
})

router.delete('/types/:id', hrOnly, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const used = await query(
      `SELECT COUNT(*)::int AS n FROM leave_requests
        WHERE leave_type_id = $1 AND tenant_id = $2`,
      [req.params.id, ctx.tenantId]
    )
    if (used.rows[0].n > 0) {
      return res.status(409).json({
        error: `${used.rows[0].n} request(s) use this leave type. Deactivate it instead of deleting it.`,
      })
    }
    const deleted = await query(
      `DELETE FROM leave_types WHERE id = $1 AND tenant_id = $2 RETURNING id`,
      [req.params.id, ctx.tenantId]
    )
    if (deleted.rows.length === 0) return notFound(res, 'Leave type')
    return res.json({ message: 'Leave type deleted' })
  } catch (e) {
    return fail(res, 'delete leave type', e)
  }
})

// ===========================================================================
// Balances
// ===========================================================================

router.get('/balances', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const employee = await targetEmployee(ctx, req.query.employeeId as string | undefined)
    if (!employee) return notFound(res, 'Employee record')

    const year = Number(req.query.year) || new Date().getFullYear()

    const types = await query(
      `SELECT * FROM leave_types WHERE tenant_id = $1 AND is_active ORDER BY name`,
      [ctx.tenantId]
    )

    const balances = []
    for (const type of types.rows) {
      const balance = await ensureBalance(ctx.tenantId, employee.id, type.id, year)
      balances.push({
        leaveTypeId: type.id,
        code: type.code,
        name: type.name,
        isPaid: type.is_paid,
        ...balance,
      })
    }

    return res.json({
      employee: {
        id: employee.id,
        employeeNumber: employee.employee_id,
        firstName: employee.first_name,
        lastName: employee.last_name,
      },
      year,
      balances,
    })
  } catch (e) {
    return fail(res, 'load balances', e)
  }
})

router.put('/balances', hrOnly, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const { employeeId, leaveTypeId, year, entitledDays, carriedOver } = req.body ?? {}

    if (!employeeId || !leaveTypeId || !year) {
      return res.status(400).json({ error: 'employeeId, leaveTypeId and year are required' })
    }
    if (!(await owned('employees', ctx, String(employeeId)))) return notFound(res, 'Employee')
    if (!(await owned('leave_types', ctx, String(leaveTypeId)))) return notFound(res, 'Leave type')

    await ensureBalance(ctx.tenantId, String(employeeId), String(leaveTypeId), Number(year))

    // Only the entitlement and carry-over are settable. taken and pending are
    // maintained by the request lifecycle, and letting HR overwrite them by
    // hand would let a balance disagree with the requests behind it.
    const fields: string[] = []
    const values: any[] = []
    if (entitledDays !== undefined) {
      values.push(Number(entitledDays))
      fields.push(`entitled_days = $${values.length}`)
    }
    if (carriedOver !== undefined) {
      values.push(Number(carriedOver))
      fields.push(`carried_over = $${values.length}`)
    }
    if (fields.length === 0) {
      return res.status(400).json({ error: 'entitledDays or carriedOver is required' })
    }

    fields.push('updated_at = CURRENT_TIMESTAMP')
    values.push(ctx.tenantId, employeeId, leaveTypeId, Number(year))
    const updated = await query(
      `UPDATE leave_balances SET ${fields.join(', ')}
        WHERE tenant_id = $${values.length - 3} AND employee_id = $${values.length - 2}
          AND leave_type_id = $${values.length - 1} AND year = $${values.length}
        RETURNING *`,
      values
    )
    return res.json({ balance: updated.rows[0] })
  } catch (e) {
    return fail(res, 'set balance', e)
  }
})

// ===========================================================================
// Requests
// ===========================================================================

router.get('/requests', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const status = req.query.status ? String(req.query.status) : null
    const scope = String(req.query.scope ?? 'mine')

    const params: any[] = [ctx.tenantId]
    let where = 'r.tenant_id = $1'

    // Only HR and managers may see beyond their own requests.
    if (scope !== 'all' || !(isHr(ctx) || ctx.roleName === 'manager')) {
      const employee = await callerEmployee(ctx)
      if (!employee) return res.json({ requests: [] })
      params.push(employee.id)
      where += ` AND r.employee_id = $${params.length}`
    }

    if (status) {
      params.push(status)
      where += ` AND r.status = $${params.length}`
    }

    const result = await query(
      `SELECT r.*, t.code AS type_code, t.name AS type_name, t.is_paid,
              e.employee_id AS employee_number, e.first_name, e.last_name,
              d.name AS department_name
         FROM leave_requests r
         JOIN leave_types t ON t.id = r.leave_type_id
         JOIN employees e ON e.id = r.employee_id
         LEFT JOIN corporate_departments d ON d.id = e.department_id
        WHERE ${where}
        ORDER BY r.start_date DESC
        LIMIT 200`,
      params
    )
    return res.json({ requests: result.rows })
  } catch (e) {
    return fail(res, 'load leave requests', e)
  }
})

router.post('/requests', async (req: TenantRequest, res: Response) => {
  const client = await pool.connect()
  try {
    const ctx = ctxOf(req)
    const b = req.body ?? {}

    // An employee raises their own leave. HR may raise it on someone's
    // behalf, which is a distinct, named capability rather than a side effect
    // of the employeeId being settable.
    const employee = b.employeeId && isHr(ctx)
      ? await owned('employees', ctx, String(b.employeeId))
      : await callerEmployee(ctx)

    if (!employee) return notFound(res, 'Employee record')

    if (!b.leaveTypeId || !b.startDate || !b.endDate) {
      return res.status(400).json({ error: 'leaveTypeId, startDate and endDate are required' })
    }
    if (!(await owned('leave_types', ctx, String(b.leaveTypeId)))) {
      return notFound(res, 'Leave type')
    }

    const halfDays: string[] = Array.isArray(b.halfDays) ? b.halfDays.map(String) : []
    const { days, total } = await validateRequest(
      ctx.tenantId, employee.id, String(b.leaveTypeId),
      String(b.startDate), String(b.endDate), halfDays
    )

    const year = new Date(`${b.startDate}T00:00:00Z`).getUTCFullYear()

    await client.query('BEGIN')

    const created = await client.query(
      `INSERT INTO leave_requests
         (tenant_id, employee_id, leave_type_id, start_date, end_date, total_days, reason, document_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        ctx.tenantId, employee.id, b.leaveTypeId, b.startDate, b.endDate,
        total, b.reason || null, b.documentUrl || null,
      ]
    )
    const request = created.rows[0]

    for (const day of days) {
      await client.query(
        `INSERT INTO leave_request_days
           (tenant_id, request_id, employee_id, leave_date, portion)
         VALUES ($1,$2,$3,$4,$5)`,
        [ctx.tenantId, request.id, employee.id, day.date, day.portion]
      )
    }

    await ensureBalance(ctx.tenantId, employee.id, String(b.leaveTypeId), year, client)
    await adjustBalance(client, ctx.tenantId, employee.id, String(b.leaveTypeId), year, {
      pending: total,
    })

    await client.query('COMMIT')

    // A request nobody is told about waits until somebody happens to look.
    await leaveRequested({ tenantId: ctx.tenantId, userId: ctx.userId }, request.id)

    return res.status(201).json({ request, totalDays: total })
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    return fail(res, 'submit leave request', e)
  } finally {
    client.release()
  }
})

/**
 * Approve or reject.
 *
 * The requester may never decide their own request, whatever role they hold.
 * An HR manager taking leave still needs a colleague to approve it; otherwise
 * the approval chain means nothing for exactly the people it matters most for.
 */
router.post('/requests/:id/decision', approvers, async (req: TenantRequest, res: Response) => {
  const client = await pool.connect()
  try {
    const ctx = ctxOf(req)
    const request = await owned('leave_requests', ctx, req.params.id)
    if (!request) return notFound(res, 'Leave request')

    const { decision, note } = req.body ?? {}
    if (!['approved', 'rejected'].includes(String(decision))) {
      return res.status(400).json({ error: "decision must be 'approved' or 'rejected'" })
    }
    if (request.status !== 'pending') {
      return res.status(409).json({
        error: `This request is already ${request.status} and cannot be decided again`,
      })
    }

    const requester = await query(
      `SELECT user_id FROM employees WHERE id = $1 AND tenant_id = $2`,
      [request.employee_id, ctx.tenantId]
    )
    if (requester.rows[0]?.user_id === ctx.userId) {
      return res.status(403).json({ error: 'You cannot decide your own leave request' })
    }

    const year = new Date(request.start_date).getUTCFullYear()
    const total = Number(request.total_days)

    await client.query('BEGIN')

    await client.query(
      `UPDATE leave_requests
          SET status = $1, decided_by = $2, decided_at = CURRENT_TIMESTAMP,
              decision_note = $3, updated_at = CURRENT_TIMESTAMP
        WHERE id = $4 AND tenant_id = $5`,
      [decision, ctx.userId, note || null, request.id, ctx.tenantId]
    )

    // Approving moves the days from pending to taken; rejecting releases them.
    await adjustBalance(client, ctx.tenantId, request.employee_id, request.leave_type_id, year,
      decision === 'approved' ? { pending: -total, taken: total } : { pending: -total })

    await client.query('COMMIT')

    await leaveDecided({ tenantId: ctx.tenantId, userId: ctx.userId },
                       request.id, decision, note || null)

    const updated = await query(`SELECT * FROM leave_requests WHERE id = $1`, [request.id])
    return res.json({ request: updated.rows[0] })
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    return fail(res, 'decide leave request', e)
  } finally {
    client.release()
  }
})

router.post('/requests/:id/cancel', async (req: TenantRequest, res: Response) => {
  const client = await pool.connect()
  try {
    const ctx = ctxOf(req)
    const request = await owned('leave_requests', ctx, req.params.id)
    if (!request) return notFound(res, 'Leave request')

    const employee = await callerEmployee(ctx)
    const isOwn = employee && employee.id === request.employee_id
    if (!isOwn && !isHr(ctx)) {
      return res.status(403).json({ error: 'You can only cancel your own leave' })
    }

    if (!['pending', 'approved'].includes(request.status)) {
      return res.status(409).json({ error: `A ${request.status} request cannot be cancelled` })
    }

    const year = new Date(request.start_date).getUTCFullYear()
    const total = Number(request.total_days)

    await client.query('BEGIN')

    await client.query(
      `UPDATE leave_requests
          SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND tenant_id = $2`,
      [request.id, ctx.tenantId]
    )

    // Release whichever column the days were sitting in.
    await adjustBalance(client, ctx.tenantId, request.employee_id, request.leave_type_id, year,
      request.status === 'approved' ? { taken: -total } : { pending: -total })

    await client.query('COMMIT')
    return res.json({ message: 'Leave cancelled' })
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    return fail(res, 'cancel leave request', e)
  } finally {
    client.release()
  }
})

// ===========================================================================
// Calendar
// ===========================================================================

/**
 * Who is away, and when.
 *
 * Built from the stored day rows rather than by expanding ranges, so a
 * half-day reads as a half-day and the query is a plain select.
 */
router.get('/calendar', approvers, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const from = String(req.query.from ?? new Date().toISOString().slice(0, 10))
    const to = String(req.query.to ?? from)

    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return res.status(400).json({ error: 'from and to must be dates (YYYY-MM-DD)' })
    }

    const result = await query(
      `SELECT d.leave_date, d.portion,
              e.id AS employee_id, e.employee_id AS employee_number,
              e.first_name, e.last_name,
              t.code AS type_code, t.name AS type_name,
              r.status
         FROM leave_request_days d
         JOIN leave_requests r ON r.id = d.request_id
         JOIN employees e ON e.id = d.employee_id
         JOIN leave_types t ON t.id = r.leave_type_id
        WHERE d.tenant_id = $1
          AND d.leave_date BETWEEN $2 AND $3
          AND d.portion > 0
          AND r.status IN ('pending', 'approved')
        ORDER BY d.leave_date, e.last_name`,
      [ctx.tenantId, from, to]
    )

    return res.json({ from, to, days: result.rows })
  } catch (e) {
    return fail(res, 'load leave calendar', e)
  }
})

/** Dry run: what a request would cost, before committing to it. */
router.post('/requests/preview', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const b = req.body ?? {}
    if (!b.startDate || !b.endDate) {
      return res.status(400).json({ error: 'startDate and endDate are required' })
    }

    const { days, total } = expandRange(
      String(b.startDate), String(b.endDate),
      Array.isArray(b.halfDays) ? b.halfDays.map(String) : []
    )

    let available: number | null = null
    if (b.leaveTypeId && UUID.test(String(b.leaveTypeId))) {
      const employee = await callerEmployee(ctx)
      if (employee) {
        const year = new Date(`${b.startDate}T00:00:00Z`).getUTCFullYear()
        const balance = await ensureBalance(
          ctx.tenantId, employee.id, String(b.leaveTypeId), year
        )
        available = balance.available
      }
    }

    return res.json({ days, totalDays: total, available })
  } catch (e) {
    return fail(res, 'preview leave request', e)
  }
})

export default router
