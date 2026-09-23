import type { PoolClient } from 'pg'

/**
 * EMS — payroll.
 *
 * The engine that turns a person's compensation, their recurring components,
 * whatever happened to them during a period and the tenant's tax table into a
 * payslip that can be read back to its inputs.
 *
 * Four rules govern it, and three of them are about what may change after the
 * fact:
 *
 *   - Compensation is effective-dated. What applies to a period is the latest
 *     record taking effect on or before the period STARTS. A raise dated
 *     mid-period does not apply until the next one, because paying half a
 *     month at each of two rates is a proration nobody asked for and the
 *     result would differ from the letter the employee was given.
 *   - A payslip line is a copy. Renaming an allowance or changing its rate
 *     alters what the next run produces and nothing about the ones already
 *     issued.
 *   - A payslip carries its breakdown. "Your net pay is 3,421.50" with
 *     nothing behind it is unanswerable when challenged.
 *   - An approved run is frozen. The database enforces that with triggers,
 *     because a rule that lives only in a service is a rule the next caller
 *     forgets.
 *
 * Arithmetic is in integer minor units throughout and converted back at the
 * edges, for the same reason the fees module does it: 0.1 + 0.2 is
 * 0.30000000000000004 in binary floating point, and somebody's salary is not
 * the place to find that out.
 */

export class PayrollError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.name = 'PayrollError'
    this.status = status
  }
}

export interface PayrollContext {
  tenantId: string
  platformId: string
  userId: string
}

type Runner = { query: (text: string, params?: any[]) => Promise<any> }

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

/** A decimal string or number as whole minor units. */
export function toMinor(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').trim())
  if (!Number.isFinite(n)) throw new PayrollError('That is not an amount')
  const scaled = n * 100
  // Half away from zero. Math.round takes -0.5 towards zero, which loses a
  // cent on anything negative.
  return scaled < 0 ? -Math.round(-scaled) : Math.round(scaled)
}

/** Minor units back to the two-decimal string the NUMERIC columns hold. */
export function fromMinor(minor: number): string {
  const sign = minor < 0 ? '-' : ''
  const abs = Math.abs(Math.trunc(minor))
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

const CURRENCY = /^[A-Z]{3}$/

export function normaliseCurrency(value: unknown, fallback = 'USD'): string {
  if (value === undefined || value === null || value === '') return fallback
  const code = String(value).toUpperCase()
  if (!CURRENCY.test(code)) throw new PayrollError('Currency must be a three-letter code')
  return code
}

/**
 * A DATE column as YYYY-MM-DD.
 *
 * node-postgres hands DATE back as a JS Date in the server's local zone.
 * String(d).slice(0, 10) on that gives "Fri Aug 14" — a weekday name that
 * compares as a date without erroring, which is how a closed intake once
 * accepted applications. Formatted from the parts instead.
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

// ---------------------------------------------------------------------------
// Tax
// ---------------------------------------------------------------------------

export interface TaxBracket {
  sequence: number
  lowerMinor: number
  /** null is the top band. */
  upperMinor: number | null
  /** Percent, 0–100. */
  rate: number
}

export interface TaxResult {
  taxMinor: number
  /** Whether a table was in force at all. Zero tax means two different things
   *  — no table configured, or a base below the first band — and a payslip
   *  has to be able to say which. */
  tableApplied: boolean
  bands: Array<{ sequence: number; rate: number; onMinor: number; taxMinor: number }>
}

/**
 * Progressive tax over a set of bands.
 *
 * Each band is charged only on the part of the base that falls inside it, so
 * crossing a threshold never reduces take-home pay. The annual table is
 * applied to an annualised base and the result divided back down, because
 * charging monthly income against annual bands would put everybody in the
 * bottom band and charging annual income monthly would put everybody in the
 * top one.
 */
export function computeTax(
  baseMinor: number,
  brackets: TaxBracket[],
  periodsPerYear: number
): TaxResult {
  if (brackets.length === 0) {
    return { taxMinor: 0, tableApplied: false, bands: [] }
  }
  if (baseMinor <= 0) {
    return { taxMinor: 0, tableApplied: true, bands: [] }
  }

  const ordered = [...brackets].sort((a, b) => a.lowerMinor - b.lowerMinor)
  const annualBase = baseMinor * periodsPerYear

  let annualTax = 0
  const bands: TaxResult['bands'] = []

  for (const band of ordered) {
    if (annualBase <= band.lowerMinor) break
    const ceiling = band.upperMinor === null ? annualBase : Math.min(annualBase, band.upperMinor)
    const slice = ceiling - band.lowerMinor
    if (slice <= 0) continue
    // Rounded once per band; summing unrounded slices and rounding at the end
    // makes the payslip's bands not add up to its tax figure.
    const bandTax = Math.round((slice * band.rate) / 100)
    annualTax += bandTax
    bands.push({
      sequence: band.sequence,
      rate: band.rate,
      onMinor: Math.round(slice / periodsPerYear),
      taxMinor: Math.round(bandTax / periodsPerYear),
    })
  }

  return {
    taxMinor: Math.round(annualTax / periodsPerYear),
    tableApplied: true,
    bands,
  }
}

export const PERIODS_PER_YEAR: Record<string, number> = {
  monthly: 12,
  biweekly: 26,
  weekly: 52,
}

export function periodsPerYear(frequency: string): number {
  const n = PERIODS_PER_YEAR[frequency]
  if (!n) throw new PayrollError(`Unknown pay frequency: ${frequency}`)
  return n
}

/**
 * The tax table in force for a date.
 *
 * Brackets are effective-dated as a set: the table that applies is the one
 * with the latest effective_from on or before the date, and all of its bands.
 * Mixing bands from two effective dates would produce a table that never
 * existed.
 */
export async function taxTableFor(
  runner: Runner,
  tenantId: string,
  onDate: string
): Promise<TaxBracket[]> {
  const result = await runner.query(
    `SELECT sequence, lower_bound, upper_bound, rate
       FROM tax_brackets
      WHERE tenant_id = $1
        AND effective_from = (
          SELECT MAX(effective_from) FROM tax_brackets
           WHERE tenant_id = $1 AND effective_from <= $2::date
        )
      ORDER BY sequence`,
    [tenantId, onDate]
  )
  return result.rows.map((r: any) => ({
    sequence: Number(r.sequence),
    lowerMinor: toMinor(r.lower_bound),
    upperMinor: r.upper_bound === null ? null : toMinor(r.upper_bound),
    rate: Number(r.rate),
  }))
}

// ---------------------------------------------------------------------------
// Leave
// ---------------------------------------------------------------------------

/**
 * Days of approved UNPAID leave an employee has inside a period.
 *
 * Only leave types marked is_paid = false count, and only approved requests.
 * A request that straddles the period boundary is counted in proportion to
 * the part that falls inside it, so a five-day absence spanning month end is
 * not deducted twice.
 */
export async function unpaidLeaveDays(
  runner: Runner,
  tenantId: string,
  employeeId: string,
  startDate: string,
  endDate: string
): Promise<number> {
  const result = await runner.query(
    `SELECT COALESCE(SUM(
              r.total_days
              * (
                  (LEAST(r.end_date, $4::date) - GREATEST(r.start_date, $3::date) + 1)::numeric
                  / NULLIF((r.end_date - r.start_date + 1), 0)::numeric
                )
            ), 0)::float8 AS days
       FROM leave_requests r
       JOIN leave_types t
         ON t.id = r.leave_type_id AND t.tenant_id = r.tenant_id
      WHERE r.tenant_id = $1
        AND r.employee_id = $2
        AND r.status = 'approved'
        AND t.is_paid = FALSE
        AND r.start_date <= $4::date
        AND r.end_date >= $3::date`,
    [tenantId, employeeId, startDate, endDate]
  )
  const days = Number(result.rows[0]?.days ?? 0)
  return Number.isFinite(days) && days > 0 ? Math.round(days * 100) / 100 : 0
}

/** Calendar days in a period, inclusive of both ends. */
export function periodDays(startDate: string, endDate: string): number {
  const start = Date.UTC(
    Number(startDate.slice(0, 4)),
    Number(startDate.slice(5, 7)) - 1,
    Number(startDate.slice(8, 10))
  )
  const end = Date.UTC(
    Number(endDate.slice(0, 4)),
    Number(endDate.slice(5, 7)) - 1,
    Number(endDate.slice(8, 10))
  )
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    throw new PayrollError('That period runs backwards')
  }
  return Math.round((end - start) / 86400000) + 1
}

// ---------------------------------------------------------------------------
// The calculation
// ---------------------------------------------------------------------------

export interface ComputedLine {
  componentId: string | null
  code: string
  name: string
  kind: 'earning' | 'deduction'
  amountMinor: number
  isTaxable: boolean
  reducesTaxable: boolean
  source: 'basic' | 'component' | 'input' | 'statutory' | 'tax' | 'leave'
  sequence: number
}

export interface ComputedPayslip {
  employeeId: string
  currency: string
  basicMinor: number
  grossMinor: number
  taxableGrossMinor: number
  preTaxDeductionsMinor: number
  taxMinor: number
  postTaxDeductionsMinor: number
  totalDeductionsMinor: number
  netMinor: number
  workingDays: number
  unpaidDays: number
  taxTableApplied: boolean
  lines: ComputedLine[]
}

export interface PeriodShape {
  id: string
  startDate: string
  endDate: string
  frequency: string
}

/**
 * Everything one employee is paid for one period.
 *
 * The order is fixed and the reason for each step is that the steps after it
 * depend on it:
 *
 *   1. Prorate the basic by unpaid leave. Every percentage below is of the
 *      basic, so it has to be settled first.
 *   2. Earnings: prorated basic, then recurring earning components, then
 *      one-off inputs for this period.
 *   3. Gross is the sum of the earnings.
 *   4. Taxable gross is the sum of the earnings marked taxable. A
 *      non-taxable allowance is still paid; it just is not in the base.
 *   5. Pre-tax deductions — pension and the like — come off the base.
 *   6. Tax is charged on what is left, over the tenant's bands.
 *   7. Post-tax deductions come off what remains.
 *   8. Net is gross less every deduction, tax included.
 *
 * Nothing here reads a tenant from its input: the caller's tenant is applied
 * to every query, and an employee from another tenant simply does not appear.
 */
export async function computePayslip(
  runner: Runner,
  ctx: PayrollContext,
  period: PeriodShape,
  employeeId: string,
  brackets: TaxBracket[]
): Promise<ComputedPayslip> {
  const perYear = periodsPerYear(period.frequency)

  // -- 0. The employee, inside the caller's tenant ------------------------
  // Read here rather than trusted from the caller so that computing one
  // payslip on its own is as tenant-safe as computing a whole run.
  const employee = await runner.query(
    `SELECT id, date_of_joining FROM employees WHERE id = $1 AND tenant_id = $2`,
    [employeeId, ctx.tenantId]
  )
  if (employee.rowCount === 0) throw new PayrollError('Employee not found', 404)
  const joined = isoDay(employee.rows[0].date_of_joining)

  // -- 1. Compensation and proration --------------------------------------
  const comp = await runner.query(
    `SELECT currency, basic_salary, pay_frequency, effective_from
       FROM employee_compensation
      WHERE tenant_id = $1 AND employee_id = $2 AND effective_from <= $3::date
      ORDER BY effective_from DESC
      LIMIT 1`,
    [ctx.tenantId, employeeId, period.startDate]
  )
  if (comp.rowCount === 0) {
    throw new PayrollError('This employee has no compensation record in force for that period', 409)
  }
  const currency = normaliseCurrency(comp.rows[0].currency)
  const fullBasicMinor = toMinor(comp.rows[0].basic_salary)

  const workingDays = periodDays(period.startDate, period.endDate)

  // Somebody who joined part way through the period is paid from the day
  // they joined. Without this a new hire's first payslip is a full month's
  // salary for a week's work, which is the kind of error that is only ever
  // found by the person who was overpaid.
  const employedFrom = joined > period.startDate ? joined : period.startDate
  const employedDays = employedFrom > period.endDate
    ? 0
    : periodDays(employedFrom, period.endDate)

  const unpaidDays = Math.min(
    await unpaidLeaveDays(runner, ctx.tenantId, employeeId, employedFrom, period.endDate),
    employedDays
  )

  // Prorated on calendar days in the period, not a nominal 30, so February
  // and a 31-day month each deduct the right fraction.
  const paidDays = employedDays - unpaidDays
  const basicMinor = paidDays >= workingDays
    ? fullBasicMinor
    : Math.round((fullBasicMinor * paidDays) / workingDays)

  const lines: ComputedLine[] = []
  let sequence = 0

  lines.push({
    componentId: null,
    code: 'BASIC',
    name: 'Basic salary',
    kind: 'earning',
    amountMinor: basicMinor,
    isTaxable: true,
    reducesTaxable: false,
    source: 'basic',
    sequence: sequence++,
  })

  if (paidDays < workingDays) {
    // Recorded as a zero-amount line rather than a deduction: the money was
    // never earned, so deducting it would inflate both gross and deductions
    // by the same amount and make the payslip claim a gross nobody was paid.
    // It is on the payslip because a basic that does not match the contract
    // has to say why.
    const why = unpaidDays > 0 && employedDays < workingDays
      ? `joined ${joined}, ${unpaidDays} days unpaid leave`
      : unpaidDays > 0
        ? `${unpaidDays} of ${workingDays} days unpaid leave`
        : `joined ${joined}`
    lines.push({
      componentId: null,
      code: 'PRORATA',
      name: `Prorated: ${why} (${paidDays} of ${workingDays} days paid)`,
      kind: 'deduction',
      amountMinor: 0,
      isTaxable: false,
      reducesTaxable: false,
      source: 'leave',
      sequence: sequence++,
    })
  }

  // -- 2. Recurring components --------------------------------------------
  const recurring = await runner.query(
    `SELECT c.id AS component_id, c.code, c.name, c.kind, c.calculation,
            c.is_taxable, c.reduces_taxable, c.is_statutory, c.sequence,
            COALESCE(esc.amount, c.default_amount) AS amount,
            COALESCE(esc.rate, c.default_rate) AS rate
       FROM employee_salary_components esc
       JOIN salary_components c
         ON c.id = esc.component_id AND c.tenant_id = esc.tenant_id
      WHERE esc.tenant_id = $1
        AND esc.employee_id = $2
        AND c.is_active = TRUE
        AND esc.effective_from <= $4::date
        AND (esc.effective_to IS NULL OR esc.effective_to >= $3::date)
      ORDER BY c.kind, c.sequence, c.code`,
    [ctx.tenantId, employeeId, period.startDate, period.endDate]
  )

  for (const row of recurring.rows) {
    const kind = row.kind === 'deduction' ? 'deduction' : 'earning'
    const amountMinor = row.calculation === 'percent_of_basic'
      // Of the PRORATED basic: a 10% allowance on a half-worked month is 10%
      // of what was actually earned, not of the full salary.
      ? Math.round((basicMinor * Number(row.rate ?? 0)) / 100)
      : toMinor(row.amount ?? 0)

    if (amountMinor === 0) continue

    lines.push({
      componentId: row.component_id,
      code: row.code,
      name: row.name,
      kind,
      amountMinor,
      isTaxable: kind === 'earning' ? row.is_taxable === true : false,
      reducesTaxable: kind === 'deduction' ? row.reduces_taxable === true : false,
      source: row.is_statutory === true ? 'statutory' : 'component',
      sequence: sequence++,
    })
  }

  // -- 3. One-off inputs for this period ----------------------------------
  const inputs = await runner.query(
    `SELECT i.component_id, i.amount, c.code, c.name, c.kind,
            c.is_taxable, c.reduces_taxable, c.is_statutory
       FROM payroll_inputs i
       JOIN salary_components c
         ON c.id = i.component_id AND c.tenant_id = i.tenant_id
      WHERE i.tenant_id = $1 AND i.period_id = $2 AND i.employee_id = $3
      ORDER BY c.kind, c.code`,
    [ctx.tenantId, period.id, employeeId]
  )

  for (const row of inputs.rows) {
    const kind = row.kind === 'deduction' ? 'deduction' : 'earning'
    const amountMinor = toMinor(row.amount)
    if (amountMinor === 0) continue
    lines.push({
      componentId: row.component_id,
      code: row.code,
      name: row.name,
      kind,
      amountMinor,
      isTaxable: kind === 'earning' ? row.is_taxable === true : false,
      reducesTaxable: kind === 'deduction' ? row.reduces_taxable === true : false,
      source: 'input',
      sequence: sequence++,
    })
  }

  // -- 4. Totals -----------------------------------------------------------
  let grossMinor = 0
  let taxableGrossMinor = 0
  let preTaxDeductionsMinor = 0
  let postTaxDeductionsMinor = 0

  for (const line of lines) {
    if (line.kind === 'earning') {
      grossMinor += line.amountMinor
      if (line.isTaxable) taxableGrossMinor += line.amountMinor
    } else if (line.reducesTaxable) {
      preTaxDeductionsMinor += line.amountMinor
    } else {
      postTaxDeductionsMinor += line.amountMinor
    }
  }

  // -- 5. Tax --------------------------------------------------------------
  const taxBaseMinor = Math.max(0, taxableGrossMinor - preTaxDeductionsMinor)
  const tax = computeTax(taxBaseMinor, brackets, perYear)

  if (tax.taxMinor > 0) {
    lines.push({
      componentId: null,
      code: 'TAX',
      name: 'Income tax',
      kind: 'deduction',
      amountMinor: tax.taxMinor,
      isTaxable: false,
      reducesTaxable: false,
      source: 'tax',
      sequence: sequence++,
    })
  }

  const totalDeductionsMinor = preTaxDeductionsMinor + tax.taxMinor + postTaxDeductionsMinor

  // A deduction set larger than the pay it comes out of would leave somebody
  // owing their employer for having worked. Refused rather than clamped: a
  // clamp would silently pay them zero and lose the discrepancy.
  if (totalDeductionsMinor > grossMinor) {
    throw new PayrollError(
      'The deductions configured for this employee exceed their pay for the period',
      409
    )
  }

  return {
    employeeId,
    currency,
    basicMinor,
    grossMinor,
    taxableGrossMinor,
    preTaxDeductionsMinor,
    taxMinor: tax.taxMinor,
    postTaxDeductionsMinor,
    totalDeductionsMinor,
    netMinor: grossMinor - totalDeductionsMinor,
    workingDays,
    unpaidDays,
    taxTableApplied: tax.tableApplied,
    lines,
  }
}

// ---------------------------------------------------------------------------
// Running payroll
// ---------------------------------------------------------------------------

export interface RunResult {
  run: any
  payslips: any[]
  /** Employees the run could not cover, and why. Reported rather than
   *  swallowed: a run that silently skips somebody is how a person does not
   *  get paid. */
  skipped: Array<{ employeeId: string; name: string; reason: string }>
}

/**
 * Calculates every payslip in a run.
 *
 * The caller owns BEGIN and COMMIT. The run is left as a draft until every
 * payslip is in, then moved to 'calculated' with its totals — so a failure
 * part way leaves nothing half-computed behind, and the guard trigger (which
 * freezes an approved run's figures) never sees a partial set.
 *
 * Re-calculating a draft deletes its payslips first. That is allowed only
 * while it is a draft; the trigger refuses it once approved.
 */
export async function calculateRun(
  client: PoolClient,
  ctx: PayrollContext,
  runId: string
): Promise<RunResult> {
  const runRow = await client.query(
    `SELECT r.*, p.start_date, p.end_date, p.frequency, p.status AS period_status
       FROM payroll_runs r
       JOIN payroll_periods p ON p.id = r.period_id AND p.tenant_id = r.tenant_id
      WHERE r.id = $1 AND r.tenant_id = $2
      FOR UPDATE OF r`,
    [runId, ctx.tenantId]
  )
  if (runRow.rowCount === 0) throw new PayrollError('Payroll run not found', 404)
  const run = runRow.rows[0]

  if (run.status === 'cancelled') {
    throw new PayrollError('This run was cancelled', 409)
  }
  if (run.status === 'approved' || run.status === 'paid') {
    throw new PayrollError(
      `This run is ${run.status}; its figures are what people were told they would be paid`,
      409
    )
  }

  const period: PeriodShape = {
    id: run.period_id,
    startDate: isoDay(run.start_date),
    endDate: isoDay(run.end_date),
    frequency: run.frequency,
  }

  // The table in force at the END of the period: a rate change part way
  // through applies to the pay for the period it lands in.
  const brackets = await taxTableFor(client, ctx.tenantId, period.endDate)

  // Everyone employed and holding compensation that took effect by the start
  // of the period. Selected inside the tenant; there is no filtering of a
  // wider set afterwards.
  const staff = await client.query(
    `SELECT e.id, e.first_name, e.last_name
       FROM employees e
      WHERE e.tenant_id = $1
        AND e.is_currently_employed = TRUE
        AND e.date_of_joining <= $2::date
      ORDER BY e.last_name, e.first_name`,
    [ctx.tenantId, period.endDate]
  )

  // A draft being recalculated starts clean. Delete before insert so a
  // component removed since the last attempt does not leave its line behind.
  await client.query(
    `DELETE FROM payslips WHERE run_id = $1 AND tenant_id = $2`,
    [runId, ctx.tenantId]
  )

  const payslips: any[] = []
  const skipped: RunResult['skipped'] = []
  let grossTotal = 0
  let taxTotal = 0
  let deductionTotal = 0
  let anyTableApplied = false

  for (const employee of staff.rows) {
    let computed: ComputedPayslip
    try {
      computed = await computePayslip(client, ctx, period, employee.id, brackets)
    } catch (e) {
      if (e instanceof PayrollError && e.status === 409) {
        skipped.push({
          employeeId: employee.id,
          name: `${employee.first_name} ${employee.last_name}`,
          reason: e.message,
        })
        continue
      }
      throw e
    }

    if (computed.currency !== run.currency) {
      skipped.push({
        employeeId: employee.id,
        name: `${employee.first_name} ${employee.last_name}`,
        reason: `Paid in ${computed.currency}; this run is in ${run.currency}`,
      })
      continue
    }

    const slip = await client.query(
      `INSERT INTO payslips
         (tenant_id, run_id, employee_id, currency, basic, gross, taxable_gross,
          pre_tax_deductions, tax, post_tax_deductions, total_deductions, net,
          working_days, unpaid_days)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [
        ctx.tenantId, runId, employee.id, computed.currency,
        fromMinor(computed.basicMinor), fromMinor(computed.grossMinor),
        fromMinor(computed.taxableGrossMinor), fromMinor(computed.preTaxDeductionsMinor),
        fromMinor(computed.taxMinor), fromMinor(computed.postTaxDeductionsMinor),
        fromMinor(computed.totalDeductionsMinor), fromMinor(computed.netMinor),
        computed.workingDays, computed.unpaidDays,
      ]
    )
    const payslipId = slip.rows[0].id as string

    for (const line of computed.lines) {
      await client.query(
        `INSERT INTO payslip_lines
           (tenant_id, payslip_id, component_id, code, name, kind, amount,
            is_taxable, reduces_taxable, source, sequence)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          ctx.tenantId, payslipId, line.componentId, line.code, line.name, line.kind,
          fromMinor(line.amountMinor), line.isTaxable, line.reducesTaxable,
          line.source, line.sequence,
        ]
      )
    }

    grossTotal += computed.grossMinor
    taxTotal += computed.taxMinor
    deductionTotal += computed.totalDeductionsMinor
    if (computed.taxTableApplied) anyTableApplied = true

    payslips.push({ ...slip.rows[0], lines: computed.lines })
  }

  const updated = await client.query(
    `UPDATE payroll_runs
        SET status = 'calculated',
            employee_count = $3,
            gross_total = $4,
            tax_total = $5,
            deduction_total = $6,
            net_total = $7,
            tax_table_applied = $8,
            calculated_at = CURRENT_TIMESTAMP,
            calculated_by = $9,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND tenant_id = $2
      RETURNING *`,
    [
      runId, ctx.tenantId, payslips.length,
      fromMinor(grossTotal), fromMinor(taxTotal), fromMinor(deductionTotal),
      fromMinor(grossTotal - deductionTotal),
      brackets.length > 0 && anyTableApplied,
      ctx.userId,
    ]
  )

  return { run: updated.rows[0], payslips, skipped }
}

/**
 * Approves a run.
 *
 * The point of no return: from here the trigger refuses any change to the
 * figures or to the payslips beneath them, and the only transition left is
 * to paid. A run with nobody in it is refused, because approving an empty
 * run reads as "everyone was paid" on every report afterwards.
 */
export async function approveRun(
  client: PoolClient,
  ctx: PayrollContext,
  runId: string
): Promise<any> {
  const existing = await client.query(
    `SELECT id, status, employee_count FROM payroll_runs
      WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
    [runId, ctx.tenantId]
  )
  if (existing.rowCount === 0) throw new PayrollError('Payroll run not found', 404)
  const run = existing.rows[0]

  if (run.status !== 'calculated') {
    throw new PayrollError(
      run.status === 'draft'
        ? 'This run has not been calculated yet'
        : `This run is already ${run.status}`,
      409
    )
  }
  if (Number(run.employee_count) === 0) {
    throw new PayrollError('There is nobody in this run to approve', 409)
  }

  const approved = await client.query(
    `UPDATE payroll_runs
        SET status = 'approved', approved_at = CURRENT_TIMESTAMP, approved_by = $3
      WHERE id = $1 AND tenant_id = $2
      RETURNING *`,
    [runId, ctx.tenantId, ctx.userId]
  )
  return approved.rows[0]
}

/** Marks an approved run as paid. The last transition a run has. */
export async function markRunPaid(
  client: PoolClient,
  ctx: PayrollContext,
  runId: string
): Promise<any> {
  const existing = await client.query(
    `SELECT id, status FROM payroll_runs WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
    [runId, ctx.tenantId]
  )
  if (existing.rowCount === 0) throw new PayrollError('Payroll run not found', 404)
  if (existing.rows[0].status !== 'approved') {
    throw new PayrollError(
      existing.rows[0].status === 'paid'
        ? 'This run has already been marked paid'
        : 'Only an approved run can be marked paid',
      409
    )
  }

  const paid = await client.query(
    `UPDATE payroll_runs
        SET status = 'paid', paid_at = CURRENT_TIMESTAMP, paid_by = $3
      WHERE id = $1 AND tenant_id = $2
      RETURNING *`,
    [runId, ctx.tenantId, ctx.userId]
  )
  return paid.rows[0]
}

/**
 * Cancels a run.
 *
 * Refused once approved: at that point people have been told what they will
 * be paid, and the correction is an adjustment run rather than the
 * disappearance of the original. A cancelled run stays on the record and
 * frees the period for a fresh attempt.
 */
export async function cancelRun(
  client: PoolClient,
  ctx: PayrollContext,
  runId: string,
  reason: string
): Promise<any> {
  if (!reason || !String(reason).trim()) {
    throw new PayrollError('Cancelling a run has to say why')
  }

  const existing = await client.query(
    `SELECT id, status FROM payroll_runs WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
    [runId, ctx.tenantId]
  )
  if (existing.rowCount === 0) throw new PayrollError('Payroll run not found', 404)
  const status = existing.rows[0].status
  if (status === 'cancelled') throw new PayrollError('This run is already cancelled', 409)
  if (status === 'approved' || status === 'paid') {
    throw new PayrollError(
      `This run is ${status}; correct it with an adjustment rather than cancelling it`,
      409
    )
  }

  const cancelled = await client.query(
    `UPDATE payroll_runs
        SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP,
            cancel_reason = $3
      WHERE id = $1 AND tenant_id = $2
      RETURNING *`,
    [runId, ctx.tenantId, String(reason).trim()]
  )
  return cancelled.rows[0]
}
