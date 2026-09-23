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
  FeesError,
  type FeesContext,
  clearance,
  fromMinor,
  issueInvoice,
  linesFromStructure,
  normaliseCurrency,
  raiseInvoice,
  recordPayment,
  reversePayment,
  toMinor,
  voidInvoice,
} from '../services/feesService.js'
import { invoiceIssued, paymentReceived } from '../notifications/events.js'

/**
 * SMS — fees, invoices and payments.
 *
 * Who may do what:
 *
 *   fee structures   the school's price list, so admin only
 *   invoices         raised, issued and voided by admin
 *   payments         posted and reversed by admin
 *   a student's own  a student reads their own invoices, lines, payments and
 *                    balance, and nothing else
 *
 * A student's own record is resolved from the authenticated identity, never
 * from a student id in the request. Where staff supply an id it is checked
 * against the caller's tenant before it is used.
 */

const router = Router()

router.use(authenticateToken, resolveTenantContext, requireTenant, requirePlatform('school'))

type Ctx = ResolvedTenantContext & { tenantId: string }

function ctxOf(req: TenantRequest): FeesContext {
  const c = req.ctx as Ctx
  return { tenantId: c.tenantId, platformId: c.platformId, userId: c.userId }
}

function full(req: TenantRequest): Ctx {
  return req.ctx as Ctx
}

const bursar = requireRoles('admin')
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function fail(res: Response, label: string, e: unknown) {
  if (e instanceof FeesError) return res.status(e.status).json({ error: e.message })

  const err = e as { code?: string; constraint?: string; message?: string }

  // The database refuses edits to issued invoices and recorded payments; that
  // is a deliberate rule, not a server fault, so it reads as a 409.
  if (err.code === '2F003' || err.code === 'P0001' || err.code === '23001') {
    return res.status(409).json({ error: err.message ?? 'That record can no longer be changed' })
  }
  if (err.code === '23505') {
    if (err.constraint === 'uq_payments_tenant_reference') {
      return res.status(409).json({ error: 'A payment with that reference has already been recorded' })
    }
    if (err.constraint === 'uq_fee_structures_tenant_code') {
      return res.status(409).json({ error: 'A fee structure with that code already exists' })
    }
    if (err.constraint === 'uq_fee_items_structure_code') {
      return res.status(409).json({ error: 'That item code is already used in this structure' })
    }
    if (err.constraint === 'uq_invoices_tenant_number') {
      return res.status(409).json({ error: 'That invoice number is already in use' })
    }
    return res.status(409).json({ error: 'That record already exists' })
  }
  if (err.code === '23514') {
    return res.status(400).json({ error: 'The values supplied are outside what this record allows' })
  }
  if (err.code === '23503') {
    return res.status(400).json({ error: 'That record refers to something which does not exist' })
  }
  console.error(`[FEES] ${label}:`, e)
  return res.status(500).json({ error: `Failed to ${label}` })
}

function notFound(res: Response, what: string) {
  return res.status(404).json({ error: `${what} not found` })
}

async function owned(table: string, ctx: FeesContext, id: string): Promise<any | null> {
  if (!/^[a-z_]+$/.test(table)) throw new Error('unsafe table')
  if (!UUID.test(id ?? '')) return null
  const r = await query(`SELECT * FROM ${table} WHERE id = $1 AND tenant_id = $2`, [id, ctx.tenantId])
  return r.rows[0] ?? null
}

function isStaff(ctx: Ctx): boolean {
  return ctx.isSuperadmin || ctx.roleName === 'admin'
}

/** The caller's own student record in this tenant, if they have one. */
async function callerStudent(ctx: Ctx): Promise<any | null> {
  const r = await query(
    `SELECT * FROM students WHERE user_id = $1 AND tenant_id = $2 LIMIT 1`,
    [ctx.userId, ctx.tenantId]
  )
  return r.rows[0] ?? null
}

/**
 * Which student a request is about.
 *
 * Without an id it is the caller. With one, only staff may name somebody
 * else; a student asking about another student gets their own record rather
 * than a refusal that would confirm the other id exists.
 */
async function targetStudent(ctx: Ctx, suppliedId?: string): Promise<any | null> {
  if (!suppliedId) return callerStudent(ctx)
  if (!isStaff(ctx)) return callerStudent(ctx)
  return owned('students', { ...ctx, tenantId: ctx.tenantId }, suppliedId)
}

router.param('structureId', async (req: TenantRequest, res: Response, next: NextFunction, id: string) => {
  try {
    const row = await owned('fee_structures', ctxOf(req), id)
    if (!row) return notFound(res, 'Fee structure')
    ;(req as any).structure = row
    return next()
  } catch (e) {
    return fail(res, 'load fee structure', e)
  }
})

/**
 * Loads the path's invoice, and refuses a student who is not its subject.
 *
 * Doing it here rather than per handler means no invoice route can be added
 * that forgets either check.
 */
router.param('invoiceId', async (req: TenantRequest, res: Response, next: NextFunction, id: string) => {
  try {
    const ctx = full(req)
    const row = await owned('invoices', ctxOf(req), id)
    if (!row) return notFound(res, 'Invoice')

    if (!isStaff(ctx)) {
      const mine = await callerStudent(ctx)
      // Someone else's invoice reads as absent to a student, not as
      // forbidden: a 403 would confirm the invoice exists.
      if (mine && mine.id !== row.student_id) return notFound(res, 'Invoice')
      // A caller who is neither staff nor a student — faculty, say — has no
      // invoice of their own to be shielded by. The route's own role guard is
      // the right authority there, and it refuses.
    }

    ;(req as any).invoice = row
    return next()
  } catch (e) {
    return fail(res, 'load invoice', e)
  }
})

// ===========================================================================
// Fee structures
// ===========================================================================

router.get('/structures', bursar, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const result = await query(
      `SELECT s.*,
              y.name AS academic_year_name,
              p.name AS programme_name,
              COUNT(i.id)::int AS item_count,
              COALESCE(SUM(i.amount) FILTER (WHERE i.is_mandatory), 0) AS mandatory_total
         FROM fee_structures s
         LEFT JOIN academic_years y ON y.id = s.academic_year_id AND y.tenant_id = s.tenant_id
         LEFT JOIN programmes p ON p.id = s.programme_id AND p.tenant_id = s.tenant_id
         LEFT JOIN fee_items i ON i.structure_id = s.id AND i.tenant_id = s.tenant_id
        WHERE s.tenant_id = $1
        GROUP BY s.id, y.name, p.name
        ORDER BY s.name`,
      [ctx.tenantId]
    )
    return res.json({ structures: result.rows })
  } catch (e) {
    return fail(res, 'load fee structures', e)
  }
})

router.post('/structures', bursar, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const b = req.body ?? {}
    if (!b.code || !b.name) return res.status(400).json({ error: 'code and name are required' })

    if (b.academicYearId && !(await owned('academic_years', ctx, b.academicYearId))) {
      return notFound(res, 'Academic year')
    }
    if (b.programmeId && !(await owned('programmes', ctx, b.programmeId))) {
      return notFound(res, 'Programme')
    }

    const created = await query(
      `INSERT INTO fee_structures
         (tenant_id, code, name, description, academic_year_id, programme_id,
          study_year, currency, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        ctx.tenantId, b.code, b.name, b.description || null,
        b.academicYearId || null, b.programmeId || null,
        b.studyYear === undefined || b.studyYear === null ? null : Number(b.studyYear),
        normaliseCurrency(b.currency),
        b.isActive !== undefined ? !!b.isActive : true,
      ]
    )
    return res.status(201).json({ structure: created.rows[0] })
  } catch (e) {
    return fail(res, 'create fee structure', e)
  }
})

router.get('/structures/:structureId', bursar, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const structure = (req as any).structure
    const items = await query(
      `SELECT * FROM fee_items WHERE structure_id = $1 AND tenant_id = $2
        ORDER BY sequence, name`,
      [structure.id, ctx.tenantId]
    )
    return res.json({ structure, items: items.rows })
  } catch (e) {
    return fail(res, 'load fee structure', e)
  }
})

router.patch('/structures/:structureId', bursar, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const structure = (req as any).structure
    const b = req.body ?? {}

    if (b.academicYearId && !(await owned('academic_years', ctx, b.academicYearId))) {
      return notFound(res, 'Academic year')
    }
    if (b.programmeId && !(await owned('programmes', ctx, b.programmeId))) {
      return notFound(res, 'Programme')
    }

    const updated = await query(
      `UPDATE fee_structures
          SET name = COALESCE($3, name),
              description = COALESCE($4, description),
              academic_year_id = COALESCE($5, academic_year_id),
              programme_id = COALESCE($6, programme_id),
              study_year = COALESCE($7, study_year),
              currency = COALESCE($8, currency),
              is_active = COALESCE($9, is_active),
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND tenant_id = $2
        RETURNING *`,
      [
        structure.id, ctx.tenantId, b.name || null, b.description ?? null,
        b.academicYearId || null, b.programmeId || null,
        b.studyYear === undefined || b.studyYear === null ? null : Number(b.studyYear),
        b.currency ? normaliseCurrency(b.currency) : null,
        b.isActive === undefined ? null : !!b.isActive,
      ]
    )
    return res.json({ structure: updated.rows[0] })
  } catch (e) {
    return fail(res, 'update fee structure', e)
  }
})

/**
 * Removing a fee structure.
 *
 * Refused once it has raised invoices. Those invoices hold their own copies
 * of the amounts, so deleting the structure would not corrupt them — but it
 * would take away the provenance of how they were priced, which is exactly
 * what somebody querying an old bill wants to see.
 */
router.delete('/structures/:structureId', bursar, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const structure = (req as any).structure
    const used = await query(
      `SELECT 1 FROM invoices WHERE structure_id = $1 AND tenant_id = $2 LIMIT 1`,
      [structure.id, ctx.tenantId]
    )
    if (used.rowCount && used.rowCount > 0) {
      return res.status(409).json({
        error: 'This structure has raised invoices; deactivate it instead of deleting it',
      })
    }
    await query(`DELETE FROM fee_structures WHERE id = $1 AND tenant_id = $2`, [
      structure.id, ctx.tenantId,
    ])
    return res.json({ deleted: true })
  } catch (e) {
    return fail(res, 'delete fee structure', e)
  }
})

// ===========================================================================
// Fee items
// ===========================================================================

router.post('/structures/:structureId/items', bursar, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const structure = (req as any).structure
    const b = req.body ?? {}
    if (!b.code || !b.name) return res.status(400).json({ error: 'code and name are required' })
    if (b.amount === undefined || b.amount === null) {
      return res.status(400).json({ error: 'amount is required' })
    }

    const amountMinor = toMinor(b.amount)
    if (amountMinor < 0) return res.status(400).json({ error: 'An item cannot cost less than nothing' })

    const created = await query(
      `INSERT INTO fee_items
         (tenant_id, structure_id, code, name, category, amount, is_mandatory, sequence)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        ctx.tenantId, structure.id, b.code, b.name, b.category || 'tuition',
        fromMinor(amountMinor),
        b.isMandatory !== undefined ? !!b.isMandatory : true,
        Number.isInteger(b.sequence) ? b.sequence : 0,
      ]
    )
    return res.status(201).json({ item: created.rows[0] })
  } catch (e) {
    return fail(res, 'add fee item', e)
  }
})

router.patch('/structures/:structureId/items/:itemId', bursar, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const structure = (req as any).structure
    const { itemId } = req.params
    if (!UUID.test(itemId)) return notFound(res, 'Fee item')
    const b = req.body ?? {}

    const updated = await query(
      `UPDATE fee_items
          SET name = COALESCE($4, name),
              category = COALESCE($5, category),
              amount = COALESCE($6, amount),
              is_mandatory = COALESCE($7, is_mandatory),
              sequence = COALESCE($8, sequence),
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND structure_id = $2 AND tenant_id = $3
        RETURNING *`,
      [
        itemId, structure.id, ctx.tenantId, b.name || null, b.category || null,
        b.amount === undefined || b.amount === null ? null : fromMinor(toMinor(b.amount)),
        b.isMandatory === undefined ? null : !!b.isMandatory,
        Number.isInteger(b.sequence) ? b.sequence : null,
      ]
    )
    if (updated.rowCount === 0) return notFound(res, 'Fee item')
    return res.json({ item: updated.rows[0] })
  } catch (e) {
    return fail(res, 'update fee item', e)
  }
})

router.delete('/structures/:structureId/items/:itemId', bursar, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const structure = (req as any).structure
    const { itemId } = req.params
    if (!UUID.test(itemId)) return notFound(res, 'Fee item')

    const removed = await query(
      `DELETE FROM fee_items WHERE id = $1 AND structure_id = $2 AND tenant_id = $3 RETURNING id`,
      [itemId, structure.id, ctx.tenantId]
    )
    if (removed.rowCount === 0) return notFound(res, 'Fee item')
    return res.json({ deleted: true })
  } catch (e) {
    return fail(res, 'remove fee item', e)
  }
})

// ===========================================================================
// Invoices
// ===========================================================================

router.get('/invoices', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = full(req)
    const staff = isStaff(ctx)

    // A student sees their own invoices and only their own. The predicate is
    // in the query, not applied to the result.
    let studentId: string | null = null
    if (!staff) {
      const mine = await callerStudent(ctx)
      if (!mine) return res.json({ invoices: [] })
      studentId = mine.id
    } else if (typeof req.query.studentId === 'string' && UUID.test(req.query.studentId)) {
      studentId = req.query.studentId
    }

    const status = typeof req.query.status === 'string' ? req.query.status : null
    const settlement = typeof req.query.settlement === 'string' ? req.query.settlement : null
    const overdueOnly = req.query.overdue === 'true'

    const result = await query(
      `SELECT i.*, b.amount_paid, b.balance, b.settlement, b.is_overdue,
              s.student_id AS student_number, s.first_name, s.last_name
         FROM invoices i
         JOIN invoice_balances b ON b.invoice_id = i.id
         JOIN students s ON s.id = i.student_id AND s.tenant_id = i.tenant_id
        WHERE i.tenant_id = $1
          AND ($2::uuid IS NULL OR i.student_id = $2::uuid)
          AND ($3::text IS NULL OR i.status = $3::text)
          AND ($4::text IS NULL OR b.settlement = $4::text)
          AND ($5::boolean IS FALSE OR b.is_overdue IS TRUE)
        ORDER BY i.created_at DESC
        LIMIT 500`,
      [ctx.tenantId, studentId, status, settlement, overdueOnly]
    )
    return res.json({ invoices: result.rows })
  } catch (e) {
    return fail(res, 'load invoices', e)
  }
})

/**
 * Raising an invoice.
 *
 * Either from a fee structure, which copies its mandatory items plus any
 * optional ones named, or from explicit lines for a one-off charge.
 */
router.post('/invoices', bursar, async (req: TenantRequest, res: Response) => {
  const client = await getConnection()
  try {
    const ctx = ctxOf(req)
    const b = req.body ?? {}
    if (!b.studentId) return res.status(400).json({ error: 'studentId is required' })

    let lines = Array.isArray(b.lines) ? b.lines : []
    let currency = b.currency

    if (b.structureId) {
      const fromStructure = await linesFromStructure(
        { query }, ctx, b.structureId,
        Array.isArray(b.optionalItemIds) ? b.optionalItemIds : []
      )
      // Explicit lines are appended to the structure's, so a bursar can add a
      // late-registration charge or a scholarship discount to a standard bill.
      lines = [...fromStructure.lines, ...lines]
      currency = currency || fromStructure.currency
    }

    if (lines.length === 0) {
      return res.status(400).json({ error: 'An invoice needs a fee structure or explicit lines' })
    }

    await client.query('BEGIN')
    const raised = await raiseInvoice(client, ctx, {
      studentId: b.studentId,
      lines,
      structureId: b.structureId ?? null,
      academicYearId: b.academicYearId ?? null,
      semesterId: b.semesterId ?? null,
      currency,
      dueDate: b.dueDate ?? null,
      note: b.note ?? null,
      issue: b.issue === true,
      number: b.number,
    })
    await client.query('COMMIT')

    if (raised.invoice.status === 'issued') {
      await invoiceIssued({ tenantId: ctx.tenantId, userId: ctx.userId }, raised.invoice.id)
    }

    return res.status(201).json(raised)
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined)
    return fail(res, 'raise invoice', e)
  } finally {
    client.release()
  }
})

router.get('/invoices/:invoiceId', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const invoice = (req as any).invoice

    const detail = await query(
      `SELECT i.*, b.amount_paid, b.balance, b.settlement, b.is_overdue,
              s.student_id AS student_number, s.first_name, s.last_name, s.email,
              y.name AS academic_year_name, t.name AS term_name,
              u.full_name AS issued_by_name
         FROM invoices i
         JOIN invoice_balances b ON b.invoice_id = i.id
         JOIN students s ON s.id = i.student_id AND s.tenant_id = i.tenant_id
         LEFT JOIN academic_years y ON y.id = i.academic_year_id AND y.tenant_id = i.tenant_id
         LEFT JOIN semesters t ON t.id = i.semester_id AND t.tenant_id = i.tenant_id
         LEFT JOIN users u ON u.id = i.issued_by
        WHERE i.id = $1 AND i.tenant_id = $2`,
      [invoice.id, ctx.tenantId]
    )

    const lines = await query(
      `SELECT * FROM invoice_lines WHERE invoice_id = $1 AND tenant_id = $2
        ORDER BY sequence, code`,
      [invoice.id, ctx.tenantId]
    )

    const payments = await query(
      `SELECT p.*, u.full_name AS recorded_by_name, r.full_name AS reversed_by_name
         FROM payments p
         LEFT JOIN users u ON u.id = p.recorded_by
         LEFT JOIN users r ON r.id = p.reversed_by
        WHERE p.invoice_id = $1 AND p.tenant_id = $2
        ORDER BY p.paid_at DESC`,
      [invoice.id, ctx.tenantId]
    )

    return res.json({
      invoice: detail.rows[0],
      lines: lines.rows,
      payments: payments.rows,
    })
  } catch (e) {
    return fail(res, 'load invoice', e)
  }
})

router.post('/invoices/:invoiceId/issue', bursar, async (req: TenantRequest, res: Response) => {
  const client = await getConnection()
  try {
    const ctx = ctxOf(req)
    const invoice = (req as any).invoice
    await client.query('BEGIN')
    const issued = await issueInvoice(client, ctx, invoice.id)
    await client.query('COMMIT')

    await invoiceIssued({ tenantId: ctx.tenantId, userId: ctx.userId }, issued.id)

    return res.json({ invoice: issued })
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined)
    return fail(res, 'issue invoice', e)
  } finally {
    client.release()
  }
})

router.post('/invoices/:invoiceId/void', bursar, async (req: TenantRequest, res: Response) => {
  const client = await getConnection()
  try {
    const ctx = ctxOf(req)
    const invoice = (req as any).invoice
    const reason = (req.body ?? {}).reason
    await client.query('BEGIN')
    const voided = await voidInvoice(client, ctx, invoice.id, reason)
    await client.query('COMMIT')
    return res.json({ invoice: voided })
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined)
    return fail(res, 'void invoice', e)
  } finally {
    client.release()
  }
})

/** Due date and note stay editable after issue; the money does not. */
router.patch('/invoices/:invoiceId', bursar, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const invoice = (req as any).invoice
    const b = req.body ?? {}

    const updated = await query(
      `UPDATE invoices
          SET due_date = COALESCE($3, due_date),
              note = COALESCE($4, note),
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND tenant_id = $2 AND status <> 'void'
        RETURNING *`,
      [invoice.id, ctx.tenantId, b.dueDate || null, b.note ?? null]
    )
    if (updated.rowCount === 0) {
      return res.status(409).json({ error: 'A void invoice cannot be changed' })
    }
    return res.json({ invoice: updated.rows[0] })
  } catch (e) {
    return fail(res, 'update invoice', e)
  }
})

// ===========================================================================
// Payments
// ===========================================================================

router.post('/invoices/:invoiceId/payments', bursar, async (req: TenantRequest, res: Response) => {
  const client = await getConnection()
  try {
    const ctx = ctxOf(req)
    const invoice = (req as any).invoice
    const b = req.body ?? {}
    if (b.amount === undefined || b.amount === null) {
      return res.status(400).json({ error: 'amount is required' })
    }

    await client.query('BEGIN')
    const result = await recordPayment(client, ctx, invoice.id, {
      amount: b.amount,
      method: b.method,
      reference: b.reference ?? null,
      paidAt: b.paidAt ?? null,
      note: b.note ?? null,
      allowOverpayment: b.allowOverpayment === true,
    })
    await client.query('COMMIT')

    // A receipt is worth having even when the payment was taken at a counter
    // with the student standing there: it is what they keep.
    await paymentReceived(
      { tenantId: ctx.tenantId, userId: ctx.userId },
      invoice.id, String(b.amount), result.balance
    )

    return res.status(201).json(result)
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined)
    return fail(res, 'record payment', e)
  } finally {
    client.release()
  }
})

router.post('/payments/:paymentId/reverse', bursar, async (req: TenantRequest, res: Response) => {
  const client = await getConnection()
  try {
    const ctx = ctxOf(req)
    const { paymentId } = req.params
    if (!UUID.test(paymentId)) return notFound(res, 'Payment')

    await client.query('BEGIN')
    const reversed = await reversePayment(client, ctx, paymentId, (req.body ?? {}).reason)
    await client.query('COMMIT')
    return res.json({ payment: reversed })
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined)
    return fail(res, 'reverse payment', e)
  } finally {
    client.release()
  }
})

router.get('/payments', bursar, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const studentId = typeof req.query.studentId === 'string' && UUID.test(req.query.studentId)
      ? req.query.studentId : null
    const from = typeof req.query.from === 'string' ? req.query.from : null
    const to = typeof req.query.to === 'string' ? req.query.to : null

    const result = await query(
      `SELECT p.*, i.number AS invoice_number,
              s.student_id AS student_number, s.first_name, s.last_name,
              u.full_name AS recorded_by_name
         FROM payments p
         JOIN invoices i ON i.id = p.invoice_id AND i.tenant_id = p.tenant_id
         JOIN students s ON s.id = p.student_id AND s.tenant_id = p.tenant_id
         LEFT JOIN users u ON u.id = p.recorded_by
        WHERE p.tenant_id = $1
          AND ($2::uuid IS NULL OR p.student_id = $2::uuid)
          AND ($3::date IS NULL OR p.paid_at >= $3::date)
          AND ($4::date IS NULL OR p.paid_at < ($4::date + INTERVAL '1 day'))
        ORDER BY p.paid_at DESC
        LIMIT 1000`,
      [ctx.tenantId, studentId, from, to]
    )
    return res.json({ payments: result.rows })
  } catch (e) {
    return fail(res, 'load payments', e)
  }
})

// ===========================================================================
// Statements and clearance
// ===========================================================================

/** A student's own statement, or a named student's for staff. */
router.get('/statement', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = full(req)
    const supplied = typeof req.query.studentId === 'string' ? req.query.studentId : undefined
    const student = await targetStudent(ctx, supplied)
    if (!student) return notFound(res, 'Student')

    const invoices = await query(
      `SELECT i.id, i.number, i.status, i.currency, i.total, i.due_date, i.issued_at,
              b.amount_paid, b.balance, b.settlement, b.is_overdue
         FROM invoices i
         JOIN invoice_balances b ON b.invoice_id = i.id
        WHERE i.student_id = $1 AND i.tenant_id = $2
        ORDER BY i.created_at DESC`,
      [student.id, ctx.tenantId]
    )

    const payments = await query(
      `SELECT p.id, p.amount, p.currency, p.method, p.reference, p.paid_at,
              p.reversed_at, i.number AS invoice_number
         FROM payments p
         JOIN invoices i ON i.id = p.invoice_id AND i.tenant_id = p.tenant_id
        WHERE p.student_id = $1 AND p.tenant_id = $2
        ORDER BY p.paid_at DESC`,
      [student.id, ctx.tenantId]
    )

    const summary = await clearance(ctx.tenantId, student.id)

    return res.json({
      student: {
        id: student.id,
        studentNumber: student.student_id,
        name: `${student.first_name} ${student.last_name}`,
      },
      summary,
      invoices: invoices.rows,
      payments: payments.rows,
    })
  } catch (e) {
    return fail(res, 'load statement', e)
  }
})

/**
 * Clearance — whether a student owes anything on issued invoices.
 *
 * This is the answer given at an examination hall door, so it is deliberately
 * a small, fast endpoint rather than something a caller has to derive from a
 * statement.
 */
router.get('/clearance', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = full(req)
    const supplied = typeof req.query.studentId === 'string' ? req.query.studentId : undefined
    const student = await targetStudent(ctx, supplied)
    if (!student) return notFound(res, 'Student')
    return res.json({ clearance: await clearance(ctx.tenantId, student.id) })
  } catch (e) {
    return fail(res, 'check clearance', e)
  }
})

/** What the bursar's office is looking at this morning. */
router.get('/overview', bursar, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)

    const totals = await query(
      `SELECT currency,
              COUNT(*)::int AS invoice_count,
              COALESCE(SUM(total), 0) AS billed,
              COALESCE(SUM(amount_paid), 0) AS collected,
              COALESCE(SUM(balance), 0) AS outstanding,
              COUNT(*) FILTER (WHERE is_overdue)::int AS overdue_count,
              COALESCE(SUM(balance) FILTER (WHERE is_overdue), 0) AS overdue_amount
         FROM invoice_balances
        WHERE tenant_id = $1 AND status = 'issued'
        GROUP BY currency`,
      [ctx.tenantId]
    )

    const bySettlement = await query(
      `SELECT settlement, COUNT(*)::int AS n
         FROM invoice_balances WHERE tenant_id = $1 GROUP BY settlement`,
      [ctx.tenantId]
    )

    const recent = await query(
      `SELECT p.id, p.amount, p.currency, p.method, p.paid_at,
              i.number AS invoice_number, s.first_name, s.last_name
         FROM payments p
         JOIN invoices i ON i.id = p.invoice_id AND i.tenant_id = p.tenant_id
         JOIN students s ON s.id = p.student_id AND s.tenant_id = p.tenant_id
        WHERE p.tenant_id = $1 AND p.reversed_at IS NULL
        ORDER BY p.paid_at DESC
        LIMIT 10`,
      [ctx.tenantId]
    )

    const counts: Record<string, number> = {}
    for (const row of bySettlement.rows) counts[row.settlement] = Number(row.n)

    return res.json({
      totals: totals.rows,
      bySettlement: counts,
      recentPayments: recent.rows,
    })
  } catch (e) {
    return fail(res, 'load fees overview', e)
  }
})

/**
 * Who owes what.
 *
 * The debtors list, which is the report a bursar actually runs. Ordered by
 * what is owed, because that is the order the calls get made in.
 */
router.get('/debtors', bursar, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const overdueOnly = req.query.overdue === 'true'

    const result = await query(
      `SELECT f.student_id, f.currency, f.billed, f.paid, f.balance,
              f.overdue_count, f.is_cleared,
              s.student_id AS student_number, s.first_name, s.last_name, s.email
         FROM student_fee_summary f
         JOIN students s ON s.id = f.student_id AND s.tenant_id = f.tenant_id
        WHERE f.tenant_id = $1
          AND f.balance > 0
          AND ($2::boolean IS FALSE OR f.overdue_count > 0)
        ORDER BY f.balance DESC
        LIMIT 500`,
      [ctx.tenantId, overdueOnly]
    )
    return res.json({ debtors: result.rows })
  } catch (e) {
    return fail(res, 'load debtors', e)
  }
})

export default router
