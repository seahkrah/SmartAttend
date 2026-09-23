import type { PoolClient } from 'pg'
import { query } from '../db/connection.js'

/**
 * SMS — fees, invoices and payments.
 *
 * The rules that matter are the ones about what may change after the fact:
 *
 *   - An invoice's lines are copies of fee items, taken at the moment it is
 *     raised. Repricing a fee structure changes what the next invoice will
 *     say and nothing about the ones already sent.
 *   - Amounts are frozen at issue. A correction is a void and a re-issue, or
 *     a credit note, never an edit.
 *   - Payments are never edited or deleted. A mistake is reversed, which
 *     leaves both the error and the correction visible.
 *   - Nothing derived is stored. Amount paid, balance, settlement and overdue
 *     are computed from the payments and today's date on every read.
 *
 * The database enforces all four with triggers, because a rule that lives
 * only in a service is a rule that the next caller forgets.
 *
 * Arithmetic is done in integer minor units — cents — and converted back at
 * the edges. Adding 0.1 and 0.2 in binary floating point is 0.30000000000000004,
 * and a bursar's reconciliation is not the place to find that out.
 */

export class FeesError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.name = 'FeesError'
    this.status = status
  }
}

export interface FeesContext {
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
  if (!Number.isFinite(n)) throw new FeesError('That is not an amount')
  // Rounding half away from zero, which is what an invoice does; Math.round
  // rounds -0.5 towards zero and would quietly lose a cent on a credit.
  const scaled = n * 100
  return scaled < 0 ? -Math.round(-scaled) : Math.round(scaled)
}

/** Minor units back to the two-decimal string the database column holds. */
export function fromMinor(minor: number): string {
  const sign = minor < 0 ? '-' : ''
  const abs = Math.abs(Math.trunc(minor))
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

const CURRENCY = /^[A-Z]{3}$/

export function normaliseCurrency(value: unknown, fallback = 'USD'): string {
  if (value === undefined || value === null || value === '') return fallback
  const code = String(value).toUpperCase()
  if (!CURRENCY.test(code)) throw new FeesError('Currency must be a three-letter code')
  return code
}

// ---------------------------------------------------------------------------
// Numbering
// ---------------------------------------------------------------------------

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function randomSuffix(length: number): string {
  let out = ''
  for (let i = 0; i < length; i += 1) out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
  return out
}

/**
 * An invoice number.
 *
 * Shaped INV-YYYY-XXXXXX and unique per tenant. The unique index is the real
 * guard; the retry only keeps a collision from surfacing to the bursar as a
 * conflict on something they did not choose.
 */
export async function allocateInvoiceNumber(runner: Runner, tenantId: string): Promise<string> {
  const year = new Date().getFullYear()
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const candidate = `INV-${year}-${randomSuffix(6)}`
    const clash = await runner.query(
      `SELECT 1 FROM invoices WHERE tenant_id = $1 AND UPPER(number) = UPPER($2) LIMIT 1`,
      [tenantId, candidate]
    )
    if (clash.rowCount === 0) return candidate
  }
  throw new FeesError('Could not allocate an invoice number; please retry', 503)
}

// ---------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------

export interface LineInput {
  code: string
  description: string
  category?: string
  quantity?: number
  unitAmount: number | string
  lineType?: 'charge' | 'discount'
  feeItemId?: string | null
}

export interface PreparedLine extends LineInput {
  quantity: number
  /** Whole minor units, so the totals add up exactly. */
  amountMinor: number
  lineType: 'charge' | 'discount'
  sequence: number
}

/**
 * Turns requested lines into the rows an invoice will hold, and the totals
 * that go on its face.
 *
 * Each line's amount is rounded once, at the line, and the totals are the sum
 * of those rounded lines. Rounding the total separately from the lines is how
 * an invoice ends up not adding up to itself.
 */
export function prepareLines(lines: LineInput[]): {
  prepared: PreparedLine[]
  subtotalMinor: number
  discountMinor: number
  totalMinor: number
} {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new FeesError('An invoice needs at least one line')
  }

  const prepared: PreparedLine[] = []
  let subtotalMinor = 0
  let discountMinor = 0

  lines.forEach((line, index) => {
    if (!line || !line.code || !line.description) {
      throw new FeesError('Every line needs a code and a description')
    }
    const quantity = line.quantity === undefined || line.quantity === null
      ? 1
      : Number(line.quantity)
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new FeesError(`Line ${line.code} has an impossible quantity`)
    }

    const unitMinor = toMinor(line.unitAmount)
    if (unitMinor < 0) throw new FeesError(`Line ${line.code} has a negative amount`)

    // The generated-column check in the database is amount = round(q * u, 2)
    // in NUMERIC; doing the same rounding here keeps the two in step.
    const amountMinor = Math.round(unitMinor * quantity)
    const lineType = line.lineType === 'discount' ? 'discount' : 'charge'

    if (lineType === 'discount') discountMinor += amountMinor
    else subtotalMinor += amountMinor

    prepared.push({
      ...line,
      quantity,
      amountMinor,
      lineType,
      sequence: index,
      category: line.category ?? 'tuition',
    })
  })

  if (discountMinor > subtotalMinor) {
    throw new FeesError('The discounts on this invoice exceed what is being charged')
  }

  return {
    prepared,
    subtotalMinor,
    discountMinor,
    totalMinor: subtotalMinor - discountMinor,
  }
}

// ---------------------------------------------------------------------------
// Raising an invoice
// ---------------------------------------------------------------------------

export interface RaiseInput {
  studentId: string
  lines: LineInput[]
  structureId?: string | null
  academicYearId?: string | null
  semesterId?: string | null
  currency?: string
  dueDate?: string | null
  note?: string | null
  /** Raise it already issued rather than as a draft. */
  issue?: boolean
  number?: string
}

/**
 * Creates an invoice and its lines in one transaction.
 *
 * The caller owns BEGIN and COMMIT. tenant_id comes from the context on every
 * row; nothing here reads a tenant from the input.
 */
export async function raiseInvoice(
  client: PoolClient,
  ctx: FeesContext,
  input: RaiseInput
): Promise<{ invoice: any; lines: any[] }> {
  const student = await client.query(
    `SELECT id FROM students WHERE id = $1 AND tenant_id = $2`,
    [input.studentId, ctx.tenantId]
  )
  if (student.rowCount === 0) throw new FeesError('Student not found', 404)

  if (input.structureId) {
    const structure = await client.query(
      `SELECT id FROM fee_structures WHERE id = $1 AND tenant_id = $2`,
      [input.structureId, ctx.tenantId]
    )
    if (structure.rowCount === 0) throw new FeesError('Fee structure not found', 404)
  }
  if (input.academicYearId) {
    const year = await client.query(
      `SELECT id FROM academic_years WHERE id = $1 AND tenant_id = $2`,
      [input.academicYearId, ctx.tenantId]
    )
    if (year.rowCount === 0) throw new FeesError('Academic year not found', 404)
  }
  if (input.semesterId) {
    const term = await client.query(
      `SELECT id FROM semesters WHERE id = $1 AND tenant_id = $2`,
      [input.semesterId, ctx.tenantId]
    )
    if (term.rowCount === 0) throw new FeesError('Term not found', 404)
  }

  const currency = normaliseCurrency(input.currency)
  const { prepared, subtotalMinor, discountMinor, totalMinor } = prepareLines(input.lines)

  const number = input.number || (await allocateInvoiceNumber(client, ctx.tenantId))
  const issue = input.issue === true

  // Always created as a draft, whatever was asked for. The guard trigger
  // refuses to touch the lines of an issued invoice — which is the whole
  // point of it — so the lines go on while it is still a draft and the status
  // moves afterwards, inside the same transaction.
  const invoice = await client.query(
    `INSERT INTO invoices
       (tenant_id, student_id, structure_id, academic_year_id, semester_id, number,
        status, currency, subtotal, discount_total, total, due_date, note)
     VALUES ($1,$2,$3,$4,$5,$6,'draft',$7,$8,$9,$10,$11,$12)
     RETURNING *`,
    [
      ctx.tenantId, input.studentId, input.structureId ?? null,
      input.academicYearId ?? null, input.semesterId ?? null, number, currency,
      fromMinor(subtotalMinor), fromMinor(discountMinor), fromMinor(totalMinor),
      input.dueDate ?? null, input.note ?? null,
    ]
  )
  const invoiceId = invoice.rows[0].id as string

  const lines: any[] = []
  for (const line of prepared) {
    const created = await client.query(
      `INSERT INTO invoice_lines
         (tenant_id, invoice_id, fee_item_id, line_type, code, description, category,
          quantity, unit_amount, amount, sequence)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [
        ctx.tenantId, invoiceId, line.feeItemId ?? null, line.lineType, line.code,
        line.description, line.category, line.quantity,
        fromMinor(toMinor(line.unitAmount)), fromMinor(line.amountMinor), line.sequence,
      ]
    )
    lines.push(created.rows[0])
  }

  if (!issue) return { invoice: invoice.rows[0], lines }

  const issued = await client.query(
    `UPDATE invoices
        SET status = 'issued', issued_at = CURRENT_TIMESTAMP, issued_by = $3,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND tenant_id = $2 AND status = 'draft'
      RETURNING *`,
    [invoiceId, ctx.tenantId, ctx.userId]
  )
  return { invoice: issued.rows[0], lines }
}

/**
 * Moves a draft invoice to issued.
 *
 * Separate from raising it because a bursar usually builds an invoice, checks
 * it, and only then sends it. Once issued the amounts and the lines are fixed
 * — the triggers see to that — so this is the point of no return.
 */
export async function issueInvoice(
  client: PoolClient,
  ctx: FeesContext,
  invoiceId: string
): Promise<any> {
  const existing = await client.query(
    `SELECT id, status FROM invoices WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
    [invoiceId, ctx.tenantId]
  )
  if (existing.rowCount === 0) throw new FeesError('Invoice not found', 404)
  if (existing.rows[0].status !== 'draft') {
    throw new FeesError(`This invoice is already ${existing.rows[0].status}`, 409)
  }

  const lines = await client.query(
    `SELECT 1 FROM invoice_lines WHERE invoice_id = $1 AND tenant_id = $2 LIMIT 1`,
    [invoiceId, ctx.tenantId]
  )
  if (lines.rowCount === 0) {
    throw new FeesError('An invoice with no lines cannot be issued', 409)
  }

  const issued = await client.query(
    `UPDATE invoices
        SET status = 'issued', issued_at = CURRENT_TIMESTAMP, issued_by = $3,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND tenant_id = $2
      RETURNING *`,
    [invoiceId, ctx.tenantId, ctx.userId]
  )
  return issued.rows[0]
}

/**
 * Voids an invoice.
 *
 * Refused once money has been taken against it: a paid invoice that vanishes
 * leaves a payment pointing at nothing. Reverse the payments first, which
 * keeps both facts on the record.
 */
export async function voidInvoice(
  client: PoolClient,
  ctx: FeesContext,
  invoiceId: string,
  reason: string
): Promise<any> {
  if (!reason || !String(reason).trim()) {
    throw new FeesError('Voiding an invoice has to say why')
  }

  const existing = await client.query(
    `SELECT id, status FROM invoices WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
    [invoiceId, ctx.tenantId]
  )
  if (existing.rowCount === 0) throw new FeesError('Invoice not found', 404)
  if (existing.rows[0].status === 'void') {
    throw new FeesError('This invoice is already void', 409)
  }

  const taken = await client.query(
    `SELECT COALESCE(SUM(amount), 0) AS paid
       FROM payments WHERE invoice_id = $1 AND tenant_id = $2 AND reversed_at IS NULL`,
    [invoiceId, ctx.tenantId]
  )
  if (toMinor(taken.rows[0].paid) > 0) {
    throw new FeesError(
      'Money has been taken against this invoice; reverse the payments before voiding it',
      409
    )
  }

  const voided = await client.query(
    `UPDATE invoices
        SET status = 'void', voided_at = CURRENT_TIMESTAMP, voided_by = $3,
            void_reason = $4, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND tenant_id = $2
      RETURNING *`,
    [invoiceId, ctx.tenantId, ctx.userId, String(reason).trim()]
  )
  return voided.rows[0]
}

/**
 * Builds the lines an invoice should carry from a fee structure.
 *
 * Optional items are left out unless the caller names them, because a student
 * who is not in hall should not be billed for a hall place.
 */
export async function linesFromStructure(
  runner: Runner,
  ctx: FeesContext,
  structureId: string,
  includeOptionalItemIds: string[] = []
): Promise<{ lines: LineInput[]; currency: string }> {
  const structure = await runner.query(
    `SELECT id, currency FROM fee_structures WHERE id = $1 AND tenant_id = $2`,
    [structureId, ctx.tenantId]
  )
  if (structure.rowCount === 0) throw new FeesError('Fee structure not found', 404)

  const items = await runner.query(
    `SELECT * FROM fee_items
      WHERE structure_id = $1 AND tenant_id = $2
        AND (is_mandatory = TRUE OR id = ANY($3::uuid[]))
      ORDER BY sequence, name`,
    [structureId, ctx.tenantId, includeOptionalItemIds]
  )
  if (items.rowCount === 0) {
    throw new FeesError('That fee structure has no items to charge', 409)
  }

  return {
    currency: structure.rows[0].currency,
    lines: items.rows.map((item: any) => ({
      feeItemId: item.id,
      code: item.code,
      description: item.name,
      category: item.category,
      quantity: 1,
      unitAmount: item.amount,
      lineType: 'charge' as const,
    })),
  }
}

// ---------------------------------------------------------------------------
// Payment
// ---------------------------------------------------------------------------

export interface PaymentInput {
  amount: number | string
  method?: string
  reference?: string | null
  paidAt?: string | null
  note?: string | null
  /** Accept money beyond the outstanding balance, creating a credit. */
  allowOverpayment?: boolean
}

/**
 * Posts a payment against an issued invoice.
 *
 * The balance is read inside the transaction with FOR UPDATE on the invoice,
 * so two cashiers taking the last instalment at the same moment cannot both
 * be told there was room for it.
 */
export async function recordPayment(
  client: PoolClient,
  ctx: FeesContext,
  invoiceId: string,
  input: PaymentInput
): Promise<{ payment: any; balance: string; settlement: string }> {
  const locked = await client.query(
    `SELECT id, student_id, status, currency, total
       FROM invoices WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
    [invoiceId, ctx.tenantId]
  )
  if (locked.rowCount === 0) throw new FeesError('Invoice not found', 404)
  const invoice = locked.rows[0]

  if (invoice.status !== 'issued') {
    throw new FeesError(
      `This invoice is ${invoice.status}; payment can only be taken against an issued invoice`,
      409
    )
  }

  const amountMinor = toMinor(input.amount)
  if (amountMinor <= 0) throw new FeesError('A payment must be more than nothing')

  const paidSoFar = await client.query(
    `SELECT COALESCE(SUM(amount), 0) AS paid
       FROM payments WHERE invoice_id = $1 AND tenant_id = $2 AND reversed_at IS NULL`,
    [invoiceId, ctx.tenantId]
  )
  const paidMinor = toMinor(paidSoFar.rows[0].paid)
  const totalMinor = toMinor(invoice.total)
  const outstandingMinor = totalMinor - paidMinor

  if (outstandingMinor <= 0 && input.allowOverpayment !== true) {
    throw new FeesError('This invoice is already settled', 409)
  }
  if (amountMinor > outstandingMinor && input.allowOverpayment !== true) {
    throw new FeesError(
      `That is more than the ${fromMinor(outstandingMinor)} outstanding on this invoice`,
      409
    )
  }

  const payment = await client.query(
    `INSERT INTO payments
       (tenant_id, invoice_id, student_id, amount, currency, method, reference,
        paid_at, recorded_by, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7, COALESCE($8::timestamptz, CURRENT_TIMESTAMP), $9, $10)
     RETURNING *`,
    [
      ctx.tenantId, invoiceId, invoice.student_id, fromMinor(amountMinor),
      invoice.currency, input.method ?? 'cash', input.reference || null,
      input.paidAt ?? null, ctx.userId, input.note ?? null,
    ]
  )

  const nowPaidMinor = paidMinor + amountMinor
  const balanceMinor = totalMinor - nowPaidMinor

  return {
    payment: payment.rows[0],
    balance: fromMinor(balanceMinor),
    settlement:
      balanceMinor > 0 ? 'part_paid' : balanceMinor === 0 ? 'paid' : 'overpaid',
  }
}

/**
 * Reverses a payment.
 *
 * The row stays; the reversal fields are filled in. Nothing about the original
 * amount, date or invoice changes, which is what makes the trail worth having.
 */
export async function reversePayment(
  client: PoolClient,
  ctx: FeesContext,
  paymentId: string,
  reason: string
): Promise<any> {
  if (!reason || !String(reason).trim()) {
    throw new FeesError('A reversal has to say why')
  }

  const existing = await client.query(
    `SELECT * FROM payments WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
    [paymentId, ctx.tenantId]
  )
  if (existing.rowCount === 0) throw new FeesError('Payment not found', 404)
  if (existing.rows[0].reversed_at) throw new FeesError('This payment is already reversed', 409)

  const reversed = await client.query(
    `UPDATE payments
        SET reversed_at = CURRENT_TIMESTAMP, reversed_by = $3, reversal_reason = $4
      WHERE id = $1 AND tenant_id = $2
      RETURNING *`,
    [paymentId, ctx.tenantId, ctx.userId, String(reason).trim()]
  )
  return reversed.rows[0]
}

// ---------------------------------------------------------------------------
// Clearance
// ---------------------------------------------------------------------------

export interface Clearance {
  studentId: string
  cleared: boolean
  currency: string | null
  billed: string
  paid: string
  balance: string
  overdueCount: number
}

/**
 * Whether a student owes anything on issued invoices.
 *
 * This is what a school means by "cleared" — the answer given at the
 * examination hall door and before a transcript is released. Drafts do not
 * count, because nobody has been told to pay them yet.
 *
 * A student with no invoices at all is cleared, not blocked: owing nothing is
 * not the same as being in arrears, and a school that has not yet billed
 * anybody must not lock its whole cohort out.
 */
export async function clearance(tenantId: string, studentId: string): Promise<Clearance> {
  const r = await query(
    `SELECT currency, billed, paid, balance, overdue_count, is_cleared
       FROM student_fee_summary
      WHERE tenant_id = $1 AND student_id = $2`,
    [tenantId, studentId]
  )

  if (r.rowCount === 0) {
    return {
      studentId, cleared: true, currency: null,
      billed: '0.00', paid: '0.00', balance: '0.00', overdueCount: 0,
    }
  }

  // Several currencies on one student is unusual but possible; the strictest
  // reading is the honest one, so any outstanding balance in any currency
  // means not cleared.
  let billed = 0, paid = 0, balance = 0, overdue = 0
  for (const row of r.rows) {
    billed += toMinor(row.billed)
    paid += toMinor(row.paid)
    balance += toMinor(row.balance)
    overdue += Number(row.overdue_count ?? 0)
  }

  return {
    studentId,
    cleared: balance <= 0,
    currency: r.rows.length === 1 ? r.rows[0].currency : null,
    billed: fromMinor(billed),
    paid: fromMinor(paid),
    balance: fromMinor(balance),
    overdueCount: overdue,
  }
}
