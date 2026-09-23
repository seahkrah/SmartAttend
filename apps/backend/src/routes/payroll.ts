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
  PayrollError,
  type PayrollContext,
  approveRun,
  calculateRun,
  cancelRun,
  computePayslip,
  fromMinor,
  isoDay,
  markRunPaid,
  normaliseCurrency,
  periodsPerYear,
  taxTableFor,
  toMinor,
} from '../services/payrollService.js'
import { payrollApproved } from '../notifications/events.js'

/**
 * EMS — payroll.
 *
 * Who may do what:
 *
 *   components      the employer's pay structure, so HR only
 *   compensation    what a person is paid: HR only, and never their own
 *   tax brackets    HR only; there is no default table, by design
 *   periods & runs  HR only
 *   approval        a payroll director or admin, and never the person who
 *                   calculated it — signing off your own arithmetic is not
 *                   an approval
 *   own payslips    an employee reads their own, and nothing else
 *
 * An employee's own record is resolved from the authenticated identity, never
 * from an id in the request. Where HR supplies an id it is checked against
 * the caller's tenant before it is used, and a record belonging to another
 * tenant reads as absent rather than forbidden — a 403 would confirm it
 * exists.
 */

const router = Router()

router.use(authenticateToken, resolveTenantContext, requireTenant, requirePlatform('corporate'))

type Ctx = ResolvedTenantContext & { tenantId: string }

function ctxOf(req: TenantRequest): Ctx {
  return req.ctx as Ctx
}

function svcCtx(req: TenantRequest): PayrollContext {
  const c = req.ctx as Ctx
  return { tenantId: c.tenantId, platformId: c.platformId, userId: c.userId }
}

const payrollStaff = requireRoles('hr', 'hr_director', 'admin')
// Approval and payment are a second pair of eyes over what HR calculated.
const payrollApprover = requireRoles('hr_director', 'admin')

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function fail(res: Response, label: string, e: unknown) {
  if (e instanceof PayrollError) return res.status(e.status).json({ error: e.message })

  const err = e as { code?: string; constraint?: string; message?: string }

  // The triggers refuse edits to an approved run and its payslips. That is a
  // deliberate rule, not a server fault, so it reads as a conflict.
  if (err.code === '2F003' || err.code === 'P0001' || err.code === '23001') {
    return res.status(409).json({ error: err.message ?? 'That record can no longer be changed' })
  }
  if (err.code === '23P01') {
    if (err.constraint === 'payroll_periods_no_overlap') {
      return res.status(409).json({
        error: 'Another period of the same frequency already covers some of those dates',
      })
    }
    if (err.constraint === 'employee_salary_components_no_overlap') {
      return res.status(409).json({
        error: 'This employee already has that component over some of those dates',
      })
    }
    return res.status(409).json({ error: 'That overlaps a record which already exists' })
  }
  if (err.code === '23505') {
    if (err.constraint === 'uq_salary_components_code') {
      return res.status(409).json({ error: 'A component with that code already exists' })
    }
    if (err.constraint === 'uq_payroll_periods_code') {
      return res.status(409).json({ error: 'A period with that code already exists' })
    }
    if (err.constraint === 'uq_payroll_runs_one_live') {
      return res.status(409).json({ error: 'This period already has a run; cancel it first' })
    }
    if (err.constraint === 'uq_employee_compensation_effective') {
      return res.status(409).json({
        error: 'This employee already has a compensation record taking effect that day',
      })
    }
    if (err.constraint === 'uq_tax_brackets_sequence') {
      return res.status(409).json({ error: 'That band number is already used in this table' })
    }
    return res.status(409).json({ error: 'That record already exists' })
  }
  if (err.code === '23514') {
    return res.status(400).json({ error: 'The values supplied are outside what this record allows' })
  }
  if (err.code === '23503') {
    return res.status(400).json({ error: 'That record refers to something which does not exist' })
  }
  console.error(`[PAYROLL] ${label}:`, e)
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

function isPayrollStaff(ctx: Ctx): boolean {
  return ctx.isSuperadmin || ['hr', 'hr_director', 'admin'].includes(ctx.roleName)
}

/** The caller's own employee record in this tenant, if they have one. */
async function callerEmployee(ctx: Ctx): Promise<any | null> {
  const r = await query(
    `SELECT * FROM employees WHERE user_id = $1 AND tenant_id = $2 LIMIT 1`,
    [ctx.userId, ctx.tenantId]
  )
  return r.rows[0] ?? null
}

function requireDate(value: unknown, label: string): string {
  const s = String(value ?? '')
  if (!ISO_DATE.test(s)) throw new PayrollError(`${label} must be a date as YYYY-MM-DD`)
  return s
}

function optionalDate(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === '') return null
  return requireDate(value, label)
}

// ---------------------------------------------------------------------------
// Path parameters
// ---------------------------------------------------------------------------

router.param('componentId', async (req: TenantRequest, res: Response, next: NextFunction, id: string) => {
  try {
    const row = await owned('salary_components', ctxOf(req), id)
    if (!row) return notFound(res, 'Salary component')
    ;(req as any).component = row
    return next()
  } catch (e) {
    return fail(res, 'load salary component', e)
  }
})

router.param('periodId', async (req: TenantRequest, res: Response, next: NextFunction, id: string) => {
  try {
    const row = await owned('payroll_periods', ctxOf(req), id)
    if (!row) return notFound(res, 'Payroll period')
    ;(req as any).period = row
    return next()
  } catch (e) {
    return fail(res, 'load payroll period', e)
  }
})

router.param('runId', async (req: TenantRequest, res: Response, next: NextFunction, id: string) => {
  try {
    const row = await owned('payroll_runs', ctxOf(req), id)
    if (!row) return notFound(res, 'Payroll run')
    ;(req as any).run = row
    return next()
  } catch (e) {
    return fail(res, 'load payroll run', e)
  }
})

/**
 * Loads the path's payslip, and refuses an employee who is not its subject.
 *
 * Doing it here rather than in each handler means no payslip route can be
 * added that forgets either check.
 */
router.param('payslipId', async (req: TenantRequest, res: Response, next: NextFunction, id: string) => {
  try {
    const ctx = ctxOf(req)
    const row = await owned('payslips', ctx, id)
    if (!row) return notFound(res, 'Payslip')

    if (!isPayrollStaff(ctx)) {
      const mine = await callerEmployee(ctx)
      // Somebody else's payslip reads as absent, not as forbidden. Salary is
      // the one figure in this system that colleagues most want to see, and a
      // 403 would confirm both that the payslip exists and whose it is.
      if (!mine || mine.id !== row.employee_id) return notFound(res, 'Payslip')
    }

    ;(req as any).payslip = row
    return next()
  } catch (e) {
    return fail(res, 'load payslip', e)
  }
})

// ===========================================================================
// Salary components
// ===========================================================================

router.get('/components', payrollStaff, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const result = await query(
      `SELECT c.*,
              (SELECT COUNT(*)::int FROM employee_salary_components esc
                WHERE esc.component_id = c.id AND esc.tenant_id = c.tenant_id) AS assignment_count
         FROM salary_components c
        WHERE c.tenant_id = $1
        ORDER BY c.kind, c.sequence, c.code`,
      [ctx.tenantId]
    )
    return res.json({ components: result.rows })
  } catch (e) {
    return fail(res, 'load salary components', e)
  }
})

router.post('/components', payrollStaff, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const b = req.body ?? {}
    if (!b.code || !b.name) return res.status(400).json({ error: 'code and name are required' })
    if (b.kind !== 'earning' && b.kind !== 'deduction') {
      return res.status(400).json({ error: 'kind must be earning or deduction' })
    }

    const calculation = b.calculation === 'percent_of_basic' ? 'percent_of_basic' : 'fixed'
    if (calculation === 'fixed' && (b.defaultAmount === undefined || b.defaultAmount === null)) {
      return res.status(400).json({ error: 'A fixed component needs a default amount' })
    }
    if (calculation === 'percent_of_basic' && (b.defaultRate === undefined || b.defaultRate === null)) {
      return res.status(400).json({ error: 'A percentage component needs a default rate' })
    }

    const created = await query(
      `INSERT INTO salary_components
         (tenant_id, code, name, description, kind, calculation, default_amount,
          default_rate, is_taxable, reduces_taxable, is_statutory, sequence, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [
        ctx.tenantId, String(b.code).trim(), String(b.name).trim(), b.description || null,
        b.kind, calculation,
        calculation === 'fixed' ? fromMinor(toMinor(b.defaultAmount)) : null,
        calculation === 'percent_of_basic' ? Number(b.defaultRate) : null,
        // The flags only mean anything on their own side of the ledger; the
        // table's check constraint refuses the other combination outright.
        b.kind === 'earning' ? b.isTaxable !== false : false,
        b.kind === 'deduction' ? b.reducesTaxable === true : false,
        b.isStatutory === true,
        b.sequence === undefined ? 0 : Number(b.sequence),
        b.isActive !== undefined ? !!b.isActive : true,
      ]
    )
    return res.status(201).json({ component: created.rows[0] })
  } catch (e) {
    return fail(res, 'create salary component', e)
  }
})

router.patch('/components/:componentId', payrollStaff, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const component = (req as any).component
    const b = req.body ?? {}

    // kind and calculation are deliberately not editable. Flipping an earning
    // into a deduction changes the meaning of every payslip line already
    // issued from it, and those lines are copies precisely so that they do
    // not move. A different kind is a different component.
    const updated = await query(
      `UPDATE salary_components
          SET name = COALESCE($3, name),
              description = COALESCE($4, description),
              default_amount = CASE WHEN $5::numeric IS NULL THEN default_amount ELSE $5::numeric END,
              default_rate = CASE WHEN $6::numeric IS NULL THEN default_rate ELSE $6::numeric END,
              is_taxable = COALESCE($7::boolean, is_taxable),
              reduces_taxable = COALESCE($8::boolean, reduces_taxable),
              sequence = COALESCE($9::int, sequence),
              is_active = COALESCE($10::boolean, is_active),
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND tenant_id = $2
        RETURNING *`,
      [
        component.id, ctx.tenantId,
        b.name === undefined ? null : String(b.name).trim(),
        b.description === undefined ? null : b.description,
        b.defaultAmount === undefined || b.defaultAmount === null
          ? null : fromMinor(toMinor(b.defaultAmount)),
        b.defaultRate === undefined || b.defaultRate === null ? null : Number(b.defaultRate),
        b.isTaxable === undefined ? null : !!b.isTaxable,
        b.reducesTaxable === undefined ? null : !!b.reducesTaxable,
        b.sequence === undefined ? null : Number(b.sequence),
        b.isActive === undefined ? null : !!b.isActive,
      ]
    )
    return res.json({ component: updated.rows[0] })
  } catch (e) {
    return fail(res, 'update salary component', e)
  }
})

router.delete('/components/:componentId', payrollStaff, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const component = (req as any).component
    await query(`DELETE FROM salary_components WHERE id = $1 AND tenant_id = $2`,
      [component.id, ctx.tenantId])
    return res.json({ deleted: true })
  } catch (e) {
    // employee_salary_components and payroll_inputs hold it under RESTRICT:
    // a component somebody is assigned cannot vanish from under them.
    const err = e as { code?: string }
    if (err.code === '23503') {
      return res.status(409).json({
        error: 'This component is in use; deactivate it instead of deleting it',
      })
    }
    return fail(res, 'delete salary component', e)
  }
})

// ===========================================================================
// Compensation
// ===========================================================================

/**
 * An employee's compensation history.
 *
 * HR reads anybody's; an employee reads their own and no one else's. The
 * employee id in the path is only ever used after it has been matched against
 * the caller's tenant, and for a non-HR caller, against the caller.
 */
router.get('/employees/:employeeId/compensation', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const employee = await owned('employees', ctx, String(req.params.employeeId))
    if (!employee) return notFound(res, 'Employee')

    if (!isPayrollStaff(ctx)) {
      const mine = await callerEmployee(ctx)
      if (!mine || mine.id !== employee.id) return notFound(res, 'Employee')
    }

    const history = await query(
      `SELECT * FROM employee_compensation
        WHERE employee_id = $1 AND tenant_id = $2
        ORDER BY effective_from DESC`,
      [employee.id, ctx.tenantId]
    )
    const components = await query(
      `SELECT esc.*, c.code, c.name, c.kind, c.calculation,
              c.is_taxable, c.reduces_taxable, c.is_statutory
         FROM employee_salary_components esc
         JOIN salary_components c ON c.id = esc.component_id AND c.tenant_id = esc.tenant_id
        WHERE esc.employee_id = $1 AND esc.tenant_id = $2
        ORDER BY esc.effective_from DESC, c.code`,
      [employee.id, ctx.tenantId]
    )
    return res.json({
      employee: {
        id: employee.id,
        name: `${employee.first_name} ${employee.last_name}`,
        employeeNumber: employee.employee_id,
      },
      compensation: history.rows,
      components: components.rows,
    })
  } catch (e) {
    return fail(res, 'load compensation', e)
  }
})

/**
 * Records a new salary, taking effect from a date.
 *
 * There is no update: a raise is a new record, and February's payslip goes on
 * saying what February was paid. Refused for the caller's own record, because
 * setting your own salary is not a workflow.
 */
router.post('/employees/:employeeId/compensation', payrollStaff, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const b = req.body ?? {}
    const employee = await owned('employees', ctx, String(req.params.employeeId))
    if (!employee) return notFound(res, 'Employee')

    const mine = await callerEmployee(ctx)
    if (mine && mine.id === employee.id && !ctx.isSuperadmin) {
      return res.status(403).json({ error: 'You cannot set your own compensation' })
    }

    if (b.basicSalary === undefined || b.basicSalary === null) {
      return res.status(400).json({ error: 'basicSalary is required' })
    }
    const salaryMinor = toMinor(b.basicSalary)
    if (salaryMinor < 0) return res.status(400).json({ error: 'A salary cannot be negative' })

    const effectiveFrom = requireDate(b.effectiveFrom, 'effectiveFrom')
    const frequency = b.payFrequency ?? 'monthly'
    periodsPerYear(frequency)

    const created = await query(
      `INSERT INTO employee_compensation
         (tenant_id, employee_id, effective_from, currency, basic_salary,
          pay_frequency, reason, created_by)
       VALUES ($1,$2,$3::date,$4,$5,$6,$7,$8) RETURNING *`,
      [
        ctx.tenantId, employee.id, effectiveFrom, normaliseCurrency(b.currency),
        fromMinor(salaryMinor), frequency, b.reason || null, ctx.userId,
      ]
    )
    return res.status(201).json({ compensation: created.rows[0] })
  } catch (e) {
    return fail(res, 'record compensation', e)
  }
})

/** Assigns a recurring component to an employee over a date range. */
router.post('/employees/:employeeId/components', payrollStaff, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const b = req.body ?? {}
    const employee = await owned('employees', ctx, String(req.params.employeeId))
    if (!employee) return notFound(res, 'Employee')

    const component = await owned('salary_components', ctx, String(b.componentId ?? ''))
    if (!component) return notFound(res, 'Salary component')

    const effectiveFrom = requireDate(b.effectiveFrom, 'effectiveFrom')
    const effectiveTo = optionalDate(b.effectiveTo, 'effectiveTo')
    if (effectiveTo && effectiveTo < effectiveFrom) {
      return res.status(400).json({ error: 'effectiveTo cannot be before effectiveFrom' })
    }

    const created = await query(
      `INSERT INTO employee_salary_components
         (tenant_id, employee_id, component_id, amount, rate,
          effective_from, effective_to, created_by)
       VALUES ($1,$2,$3,$4,$5,$6::date,$7::date,$8) RETURNING *`,
      [
        ctx.tenantId, employee.id, component.id,
        b.amount === undefined || b.amount === null ? null : fromMinor(toMinor(b.amount)),
        b.rate === undefined || b.rate === null ? null : Number(b.rate),
        effectiveFrom, effectiveTo, ctx.userId,
      ]
    )
    return res.status(201).json({ assignment: created.rows[0] })
  } catch (e) {
    return fail(res, 'assign salary component', e)
  }
})

/**
 * Ends an assignment.
 *
 * Closed off with an end date rather than deleted where it has already been
 * paid against; deleted outright only where it never was. Either way what a
 * past payslip says does not move — its lines are copies.
 */
router.delete('/employees/:employeeId/components/:assignmentId', payrollStaff, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const employee = await owned('employees', ctx, String(req.params.employeeId))
    if (!employee) return notFound(res, 'Employee')

    const assignment = await owned('employee_salary_components', ctx, String(req.params.assignmentId))
    if (!assignment || assignment.employee_id !== employee.id) {
      return notFound(res, 'Assignment')
    }

    const endDate = optionalDate(req.query.endDate, 'endDate')
    if (endDate) {
      const closed = await query(
        `UPDATE employee_salary_components
            SET effective_to = $3::date
          WHERE id = $1 AND tenant_id = $2 RETURNING *`,
        [assignment.id, ctx.tenantId, endDate]
      )
      return res.json({ assignment: closed.rows[0] })
    }

    await query(`DELETE FROM employee_salary_components WHERE id = $1 AND tenant_id = $2`,
      [assignment.id, ctx.tenantId])
    return res.json({ deleted: true })
  } catch (e) {
    return fail(res, 'end salary component assignment', e)
  }
})

// ===========================================================================
// Tax brackets
// ===========================================================================

/**
 * The tenant's tax table.
 *
 * Empty until somebody configures it, and empty is a legitimate state: a run
 * against no table charges no tax and records that it did not have one, which
 * is honest. A shipped default would be wrong in every country but one.
 */
router.get('/tax-brackets', payrollStaff, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const result = await query(
      `SELECT * FROM tax_brackets WHERE tenant_id = $1
        ORDER BY effective_from DESC, sequence`,
      [ctx.tenantId]
    )
    return res.json({ brackets: result.rows, configured: result.rowCount > 0 })
  } catch (e) {
    return fail(res, 'load tax brackets', e)
  }
})

/**
 * Replaces the table taking effect on a date.
 *
 * A whole table at a time, never a band at a time: bands that do not tile the
 * income range leave a gap that silently goes untaxed, and there is no way to
 * check that while they arrive one by one. An earlier table stays exactly as
 * it was, so a run recalculated for last year still uses last year's rates.
 */
router.put('/tax-brackets', payrollStaff, async (req: TenantRequest, res: Response) => {
  const b = req.body ?? {}
  let client
  try {
    const ctx = svcCtx(req)
    const effectiveFrom = requireDate(b.effectiveFrom, 'effectiveFrom')
    const bands = Array.isArray(b.brackets) ? b.brackets : []
    if (bands.length === 0) {
      return res.status(400).json({ error: 'A tax table needs at least one band' })
    }

    // Sorted and checked as a set before anything is written. A table with a
    // hole in it would undercharge everybody whose income lands in the hole.
    const parsed = bands.map((band: any, index: number) => ({
      sequence: index + 1,
      lowerMinor: toMinor(band.lowerBound ?? 0),
      upperMinor: band.upperBound === undefined || band.upperBound === null
        ? null : toMinor(band.upperBound),
      rate: Number(band.rate),
    }))
    parsed.sort((x: any, y: any) => x.lowerMinor - y.lowerMinor)

    for (let i = 0; i < parsed.length; i += 1) {
      const band = parsed[i]
      band.sequence = i + 1
      if (!Number.isFinite(band.rate) || band.rate < 0 || band.rate > 100) {
        return res.status(400).json({ error: 'Every band needs a rate between 0 and 100' })
      }
      if (band.upperMinor !== null && band.upperMinor <= band.lowerMinor) {
        return res.status(400).json({ error: 'A band cannot end at or below where it starts' })
      }
      if (i === 0 && band.lowerMinor !== 0) {
        return res.status(400).json({ error: 'The first band has to start at zero' })
      }
      if (i > 0) {
        const previous = parsed[i - 1]
        if (previous.upperMinor === null) {
          return res.status(400).json({ error: 'Only the last band may have no upper bound' })
        }
        if (previous.upperMinor !== band.lowerMinor) {
          return res.status(400).json({
            error: 'The bands have to meet exactly; there is a gap or an overlap between them',
          })
        }
      }
    }
    if (parsed[parsed.length - 1].upperMinor !== null) {
      return res.status(400).json({ error: 'The last band has to be open-ended' })
    }

    client = await getConnection()
    await client.query('BEGIN')

    await client.query(
      `DELETE FROM tax_brackets WHERE tenant_id = $1 AND effective_from = $2::date`,
      [ctx.tenantId, effectiveFrom]
    )
    const rows: any[] = []
    for (const band of parsed) {
      const created = await client.query(
        `INSERT INTO tax_brackets
           (tenant_id, name, effective_from, sequence, lower_bound, upper_bound,
            rate, created_by)
         VALUES ($1,$2,$3::date,$4,$5,$6,$7,$8) RETURNING *`,
        [
          ctx.tenantId, b.name || 'Income tax', effectiveFrom, band.sequence,
          fromMinor(band.lowerMinor),
          band.upperMinor === null ? null : fromMinor(band.upperMinor),
          band.rate, ctx.userId,
        ]
      )
      rows.push(created.rows[0])
    }

    await client.query('COMMIT')
    return res.status(201).json({ brackets: rows })
  } catch (e) {
    if (client) await client.query('ROLLBACK').catch(() => undefined)
    return fail(res, 'save tax brackets', e)
  } finally {
    if (client) client.release()
  }
})

// ===========================================================================
// Periods
// ===========================================================================

router.get('/periods', payrollStaff, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const result = await query(
      `SELECT p.*,
              r.id AS run_id, r.status AS run_status, r.employee_count,
              r.gross_total, r.net_total
         FROM payroll_periods p
         LEFT JOIN payroll_runs r
           ON r.period_id = p.id AND r.tenant_id = p.tenant_id AND r.status <> 'cancelled'
        WHERE p.tenant_id = $1
        ORDER BY p.start_date DESC`,
      [ctx.tenantId]
    )
    return res.json({ periods: result.rows })
  } catch (e) {
    return fail(res, 'load payroll periods', e)
  }
})

router.post('/periods', payrollStaff, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const b = req.body ?? {}
    if (!b.code || !b.name) return res.status(400).json({ error: 'code and name are required' })

    const startDate = requireDate(b.startDate, 'startDate')
    const endDate = requireDate(b.endDate, 'endDate')
    if (endDate < startDate) {
      return res.status(400).json({ error: 'A period cannot end before it starts' })
    }
    const payDate = requireDate(b.payDate, 'payDate')
    if (payDate < startDate) {
      return res.status(400).json({ error: 'A period cannot be paid before it starts' })
    }
    const frequency = b.frequency ?? 'monthly'
    periodsPerYear(frequency)

    const created = await query(
      `INSERT INTO payroll_periods
         (tenant_id, code, name, start_date, end_date, pay_date, frequency)
       VALUES ($1,$2,$3,$4::date,$5::date,$6::date,$7) RETURNING *`,
      [ctx.tenantId, String(b.code).trim(), String(b.name).trim(), startDate, endDate, payDate, frequency]
    )
    return res.status(201).json({ period: created.rows[0] })
  } catch (e) {
    return fail(res, 'create payroll period', e)
  }
})

/** The variable inputs staged against a period: overtime, bonuses, one-offs. */
router.get('/periods/:periodId/inputs', payrollStaff, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const period = (req as any).period
    const result = await query(
      `SELECT i.*, c.code, c.name AS component_name, c.kind,
              e.first_name, e.last_name, e.employee_id AS employee_number
         FROM payroll_inputs i
         JOIN salary_components c ON c.id = i.component_id AND c.tenant_id = i.tenant_id
         JOIN employees e ON e.id = i.employee_id AND e.tenant_id = i.tenant_id
        WHERE i.tenant_id = $1 AND i.period_id = $2
        ORDER BY e.last_name, e.first_name, c.code`,
      [ctx.tenantId, period.id]
    )
    return res.json({ inputs: result.rows })
  } catch (e) {
    return fail(res, 'load payroll inputs', e)
  }
})

router.post('/periods/:periodId/inputs', payrollStaff, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const period = (req as any).period
    const b = req.body ?? {}

    if (period.status !== 'open') {
      return res.status(409).json({ error: `This period is ${period.status}` })
    }

    const employee = await owned('employees', ctx, String(b.employeeId ?? ''))
    if (!employee) return notFound(res, 'Employee')
    const component = await owned('salary_components', ctx, String(b.componentId ?? ''))
    if (!component) return notFound(res, 'Salary component')

    const amountMinor = toMinor(b.amount)
    if (amountMinor < 0) return res.status(400).json({ error: 'An input cannot be negative' })

    // Upserted rather than refused on a repeat: correcting somebody's overtime
    // before the run is the normal case, and making HR delete first would only
    // mean the same thing in two requests.
    const saved = await query(
      `INSERT INTO payroll_inputs
         (tenant_id, period_id, employee_id, component_id, amount, note, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (period_id, employee_id, component_id)
       DO UPDATE SET amount = EXCLUDED.amount, note = EXCLUDED.note,
                     created_by = EXCLUDED.created_by
       RETURNING *`,
      [
        ctx.tenantId, period.id, employee.id, component.id,
        fromMinor(amountMinor), b.note || null, ctx.userId,
      ]
    )
    return res.status(201).json({ input: saved.rows[0] })
  } catch (e) {
    return fail(res, 'record payroll input', e)
  }
})

router.delete('/periods/:periodId/inputs/:inputId', payrollStaff, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const period = (req as any).period
    const input = await owned('payroll_inputs', ctx, String(req.params.inputId))
    if (!input || input.period_id !== period.id) return notFound(res, 'Payroll input')

    await query(`DELETE FROM payroll_inputs WHERE id = $1 AND tenant_id = $2`,
      [input.id, ctx.tenantId])
    return res.json({ deleted: true })
  } catch (e) {
    return fail(res, 'delete payroll input', e)
  }
})

// ===========================================================================
// Runs
// ===========================================================================

router.get('/runs', payrollStaff, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const result = await query(
      `SELECT r.*, p.code AS period_code, p.name AS period_name,
              p.start_date, p.end_date, p.pay_date
         FROM payroll_runs r
         JOIN payroll_periods p ON p.id = r.period_id AND p.tenant_id = r.tenant_id
        WHERE r.tenant_id = $1
        ORDER BY p.start_date DESC, r.created_at DESC`,
      [ctx.tenantId]
    )
    return res.json({ runs: result.rows })
  } catch (e) {
    return fail(res, 'load payroll runs', e)
  }
})

/** Opens a run against a period. Calculating it is a separate step. */
router.post('/runs', payrollStaff, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const b = req.body ?? {}
    const period = await owned('payroll_periods', ctx, String(b.periodId ?? ''))
    if (!period) return notFound(res, 'Payroll period')
    if (period.status === 'closed') {
      return res.status(409).json({ error: 'This period is closed' })
    }

    const created = await query(
      `INSERT INTO payroll_runs (tenant_id, period_id, currency, note)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [ctx.tenantId, period.id, normaliseCurrency(b.currency), b.note || null]
    )
    return res.status(201).json({ run: created.rows[0] })
  } catch (e) {
    return fail(res, 'open payroll run', e)
  }
})

router.get('/runs/:runId', payrollStaff, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const run = (req as any).run
    const period = await query(
      `SELECT * FROM payroll_periods WHERE id = $1 AND tenant_id = $2`,
      [run.period_id, ctx.tenantId]
    )
    const payslips = await query(
      `SELECT ps.*, e.first_name, e.last_name, e.employee_id AS employee_number,
              d.name AS department_name
         FROM payslips ps
         JOIN employees e ON e.id = ps.employee_id AND e.tenant_id = ps.tenant_id
         LEFT JOIN corporate_departments d ON d.id = e.department_id AND d.tenant_id = e.tenant_id
        WHERE ps.run_id = $1 AND ps.tenant_id = $2
        ORDER BY e.last_name, e.first_name`,
      [run.id, ctx.tenantId]
    )
    return res.json({ run, period: period.rows[0] ?? null, payslips: payslips.rows })
  } catch (e) {
    return fail(res, 'load payroll run', e)
  }
})

/**
 * Calculates every payslip in the run.
 *
 * Whole run in one transaction: a payroll half computed is worse than one not
 * computed at all, because the totals on it look like a figure somebody can
 * act on.
 */
router.post('/runs/:runId/calculate', payrollStaff, async (req: TenantRequest, res: Response) => {
  let client
  try {
    const ctx = svcCtx(req)
    const run = (req as any).run
    client = await getConnection()
    await client.query('BEGIN')
    const result = await calculateRun(client, ctx, run.id)
    await client.query('COMMIT')
    return res.json({
      run: result.run,
      payslipCount: result.payslips.length,
      skipped: result.skipped,
    })
  } catch (e) {
    if (client) await client.query('ROLLBACK').catch(() => undefined)
    return fail(res, 'calculate payroll run', e)
  } finally {
    if (client) client.release()
  }
})

/**
 * Approves the run, which freezes it, and tells everybody in it.
 *
 * Refused for whoever calculated it: the second pair of eyes is the whole
 * point of having an approval step, and a role that can do both does not make
 * one person two people.
 */
router.post('/runs/:runId/approve', payrollApprover, async (req: TenantRequest, res: Response) => {
  let client
  try {
    const ctx = svcCtx(req)
    const run = (req as any).run

    if (run.calculated_by && run.calculated_by === ctx.userId && !ctxOf(req).isSuperadmin) {
      return res.status(403).json({
        error: 'A payroll run has to be approved by somebody other than whoever calculated it',
      })
    }

    client = await getConnection()
    await client.query('BEGIN')
    const approved = await approveRun(client, ctx, run.id)
    await client.query('COMMIT')

    // After the commit, deliberately: telling somebody their payslip is ready
    // against a transaction that then rolls back is the worst failure this
    // module can produce.
    await payrollApproved({ tenantId: ctx.tenantId, userId: ctx.userId }, run.id)

    return res.json({ run: approved })
  } catch (e) {
    if (client) await client.query('ROLLBACK').catch(() => undefined)
    return fail(res, 'approve payroll run', e)
  } finally {
    if (client) client.release()
  }
})

router.post('/runs/:runId/pay', payrollApprover, async (req: TenantRequest, res: Response) => {
  let client
  try {
    const ctx = svcCtx(req)
    const run = (req as any).run
    client = await getConnection()
    await client.query('BEGIN')
    const paid = await markRunPaid(client, ctx, run.id)
    // The period closes with the run that paid it: nothing else is owed for
    // those dates, and a second run against them would be a second payment.
    await client.query(
      `UPDATE payroll_periods SET status = 'closed', updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND tenant_id = $2`,
      [paid.period_id, ctx.tenantId]
    )
    await client.query('COMMIT')
    return res.json({ run: paid })
  } catch (e) {
    if (client) await client.query('ROLLBACK').catch(() => undefined)
    return fail(res, 'mark payroll run paid', e)
  } finally {
    if (client) client.release()
  }
})

router.post('/runs/:runId/cancel', payrollStaff, async (req: TenantRequest, res: Response) => {
  let client
  try {
    const ctx = svcCtx(req)
    const run = (req as any).run
    client = await getConnection()
    await client.query('BEGIN')
    const cancelled = await cancelRun(client, ctx, run.id, String(req.body?.reason ?? ''))
    await client.query('COMMIT')
    return res.json({ run: cancelled })
  } catch (e) {
    if (client) await client.query('ROLLBACK').catch(() => undefined)
    return fail(res, 'cancel payroll run', e)
  } finally {
    if (client) client.release()
  }
})

/**
 * What one employee would be paid, without writing anything.
 *
 * HR checking a figure before committing to it. Computed by exactly the same
 * code the run uses, because a preview that takes a different path is a
 * preview of something else.
 */
router.get('/runs/:runId/preview/:employeeId', payrollStaff, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = svcCtx(req)
    const full = ctxOf(req)
    const run = (req as any).run
    const employee = await owned('employees', full, String(req.params.employeeId))
    if (!employee) return notFound(res, 'Employee')

    const period = await query(
      `SELECT * FROM payroll_periods WHERE id = $1 AND tenant_id = $2`,
      [run.period_id, ctx.tenantId]
    )
    if (period.rowCount === 0) return notFound(res, 'Payroll period')
    const p = period.rows[0]

    const brackets = await taxTableFor({ query }, ctx.tenantId, isoDay(p.end_date))
    const computed = await computePayslip(
      { query },
      ctx,
      { id: p.id, startDate: isoDay(p.start_date), endDate: isoDay(p.end_date), frequency: p.frequency },
      employee.id,
      brackets
    )

    return res.json({
      preview: {
        employeeId: computed.employeeId,
        currency: computed.currency,
        basic: fromMinor(computed.basicMinor),
        gross: fromMinor(computed.grossMinor),
        taxableGross: fromMinor(computed.taxableGrossMinor),
        preTaxDeductions: fromMinor(computed.preTaxDeductionsMinor),
        tax: fromMinor(computed.taxMinor),
        postTaxDeductions: fromMinor(computed.postTaxDeductionsMinor),
        totalDeductions: fromMinor(computed.totalDeductionsMinor),
        net: fromMinor(computed.netMinor),
        workingDays: computed.workingDays,
        unpaidDays: computed.unpaidDays,
        taxTableApplied: computed.taxTableApplied,
        lines: computed.lines.map((l) => ({
          code: l.code,
          name: l.name,
          kind: l.kind,
          amount: fromMinor(l.amountMinor),
          isTaxable: l.isTaxable,
          reducesTaxable: l.reducesTaxable,
          source: l.source,
        })),
      },
    })
  } catch (e) {
    return fail(res, 'preview payslip', e)
  }
})

// ===========================================================================
// Payslips
// ===========================================================================

/**
 * The caller's own payslips.
 *
 * Only from approved and paid runs. A calculated run is a draft that may
 * still be recalculated, and an employee who sees a draft figure has been
 * told something that is not yet true.
 */
router.get('/my/payslips', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const employee = await callerEmployee(ctx)
    if (!employee) return res.json({ payslips: [] })

    const result = await query(
      `SELECT ps.id, ps.currency, ps.basic, ps.gross, ps.tax, ps.total_deductions,
              ps.net, ps.working_days, ps.unpaid_days, ps.created_at,
              r.status AS run_status, r.paid_at,
              p.code AS period_code, p.name AS period_name,
              p.start_date, p.end_date, p.pay_date
         FROM payslips ps
         JOIN payroll_runs r ON r.id = ps.run_id AND r.tenant_id = ps.tenant_id
         JOIN payroll_periods p ON p.id = r.period_id AND p.tenant_id = r.tenant_id
        WHERE ps.tenant_id = $1 AND ps.employee_id = $2
          AND r.status IN ('approved', 'paid')
        ORDER BY p.start_date DESC`,
      [ctx.tenantId, employee.id]
    )
    return res.json({ payslips: result.rows })
  } catch (e) {
    return fail(res, 'load payslips', e)
  }
})

/**
 * One payslip and its breakdown.
 *
 * Whose payslip it is was settled by the router.param above. An employee
 * additionally cannot read their own before the run is approved, for the same
 * reason the list does not show it.
 */
router.get('/payslips/:payslipId', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const payslip = (req as any).payslip

    const run = await query(
      `SELECT r.*, p.code AS period_code, p.name AS period_name,
              p.start_date, p.end_date, p.pay_date
         FROM payroll_runs r
         JOIN payroll_periods p ON p.id = r.period_id AND p.tenant_id = r.tenant_id
        WHERE r.id = $1 AND r.tenant_id = $2`,
      [payslip.run_id, ctx.tenantId]
    )
    if (run.rowCount === 0) return notFound(res, 'Payslip')

    if (!isPayrollStaff(ctx) && !['approved', 'paid'].includes(run.rows[0].status)) {
      return notFound(res, 'Payslip')
    }

    const lines = await query(
      `SELECT code, name, kind, amount, is_taxable, reduces_taxable, source, sequence
         FROM payslip_lines
        WHERE payslip_id = $1 AND tenant_id = $2
        ORDER BY sequence`,
      [payslip.id, ctx.tenantId]
    )
    const employee = await query(
      `SELECT id, employee_id, first_name, last_name, designation
         FROM employees WHERE id = $1 AND tenant_id = $2`,
      [payslip.employee_id, ctx.tenantId]
    )

    return res.json({
      payslip,
      run: run.rows[0],
      employee: employee.rows[0] ?? null,
      lines: lines.rows,
    })
  } catch (e) {
    return fail(res, 'load payslip', e)
  }
})

export default router
