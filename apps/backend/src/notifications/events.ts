import { query } from '../db/connection.js'
import { notifyQuietly, type NotifyContext, type Recipient } from './service.js'

/**
 * The bridge between domain modules and delivery.
 *
 * Each function here knows one thing: which people an event concerns, and
 * what a template needs to describe it. Keeping that out of the routers means
 * the admissions router does not grow a second job, and changing what an
 * offer letter says does not involve touching admissions at all.
 *
 * Every one of these is best-effort. An enrolment must not fail because a
 * mail template has a typo in it, so they all go through notifyQuietly, which
 * logs and returns rather than throwing. The message itself is durable once
 * queued — the outbox survives the request — so "best effort" applies to the
 * queueing, not to the delivery.
 *
 * They are called AFTER the domain transaction commits, deliberately. Queuing
 * inside the transaction would be tidier, but it also means an offer letter
 * queued against a transaction that then rolls back, and telling somebody
 * they have a place they do not have is the worst failure this module can
 * produce.
 */

type Runner = { query: (text: string, params?: any[]) => Promise<any> }

/** An applicant has no account, so they are addressed by their own details. */
function applicantRecipient(applicant: any): Recipient {
  return {
    userId: null,
    name: [applicant.first_name, applicant.last_name].filter(Boolean).join(' '),
    email: applicant.email,
    phone: applicant.phone,
    data: {
      firstName: applicant.first_name,
      lastName: applicant.last_name,
      fullName: [applicant.first_name, applicant.last_name].filter(Boolean).join(' '),
    },
  }
}

// ---------------------------------------------------------------------------
// Admissions
// ---------------------------------------------------------------------------

const STATUS_EVENT: Record<string, string> = {
  submitted: 'admission.submitted',
  offer: 'admission.offer',
  rejected: 'admission.rejected',
  waitlisted: 'admission.waitlisted',
}

/**
 * Tells an applicant what has happened to their application.
 *
 * Only the transitions an applicant should hear about: there is no message
 * for under_review, because "we have started looking at it" is noise, and
 * none for withdrawn, because they are the ones who withdrew it.
 */
export async function applicationChanged(
  ctx: NotifyContext,
  applicationId: string,
  status: string
): Promise<void> {
  const eventKey = STATUS_EVENT[status]
  if (!eventKey) return

  const r = await query(
    `SELECT a.reference, a.offer_expires_at,
            ap.first_name, ap.last_name, ap.email, ap.phone,
            i.name AS intake_name,
            p.name AS programme_name
       FROM applications a
       JOIN applicants ap ON ap.id = a.applicant_id AND ap.tenant_id = a.tenant_id
       JOIN admission_intakes i ON i.id = a.intake_id AND i.tenant_id = a.tenant_id
       LEFT JOIN programmes p ON p.id = a.offered_programme_id AND p.tenant_id = a.tenant_id
      WHERE a.id = $1 AND a.tenant_id = $2`,
    [applicationId, ctx.tenantId]
  )
  if (r.rowCount === 0) return
  const row = r.rows[0]

  // An offer with no programme on it would render "a place on " — the
  // renderer refuses that, but there is no reason to queue it at all.
  if (eventKey === 'admission.offer' && !row.programme_name) return

  await notifyQuietly({ query }, ctx, {
    eventKey,
    recipients: [applicantRecipient(row)],
    relatedType: 'application',
    relatedId: applicationId,
    // One message per application per status. A registrar who moves an
    // application to offer, back to under_review and to offer again has
    // changed their mind, not made the applicant a second offer.
    dedupeKey: `application:${applicationId}:${status}`,
    data: {
      reference: row.reference,
      intakeName: row.intake_name,
      programmeName: row.programme_name,
      offerDeadline: row.offer_expires_at
        ? `Please reply by ${String(row.offer_expires_at).slice(0, 10)}.`
        : 'Please reply at your earliest convenience.',
    },
  })
}

/** Welcomes a newly enrolled student to the account that now exists. */
export async function studentEnrolled(
  ctx: NotifyContext,
  applicationId: string,
  studentId: string
): Promise<void> {
  const r = await query(
    `SELECT s.first_name, s.last_name, s.email, s.phone, s.student_id AS student_number,
            s.user_id, p.name AS programme_name
       FROM students s
       LEFT JOIN student_programmes sp
              ON sp.student_id = s.id AND sp.tenant_id = s.tenant_id AND sp.status = 'active'
       LEFT JOIN programmes p ON p.id = sp.programme_id AND p.tenant_id = s.tenant_id
      WHERE s.id = $1 AND s.tenant_id = $2
      LIMIT 1`,
    [studentId, ctx.tenantId]
  )
  if (r.rowCount === 0) return
  const row = r.rows[0]
  if (!row.programme_name) return

  await notifyQuietly({ query }, ctx, {
    eventKey: 'admission.enrolled',
    recipients: [{
      userId: row.user_id,
      name: [row.first_name, row.last_name].filter(Boolean).join(' '),
      email: row.email,
      phone: row.phone,
      data: { firstName: row.first_name, lastName: row.last_name },
    }],
    relatedType: 'application',
    relatedId: applicationId,
    dedupeKey: `application:${applicationId}:enrolled`,
    data: {
      programmeName: row.programme_name,
      studentNumber: row.student_number,
    },
  })
}

// ---------------------------------------------------------------------------
// Fees
// ---------------------------------------------------------------------------

function amountWithCurrency(amount: unknown, currency: string): string {
  return `${currency} ${Number(amount ?? 0).toFixed(2)}`
}

/** A student's own details as a recipient, or null if they have no account. */
async function studentRecipient(
  runner: Runner,
  tenantId: string,
  studentId: string
): Promise<Recipient | null> {
  const r = await runner.query(
    `SELECT user_id, first_name, last_name, email, phone
       FROM students WHERE id = $1 AND tenant_id = $2`,
    [studentId, tenantId]
  )
  if (r.rowCount === 0) return null
  const row = r.rows[0]
  return {
    userId: row.user_id,
    name: [row.first_name, row.last_name].filter(Boolean).join(' '),
    email: row.email,
    phone: row.phone,
    data: { firstName: row.first_name, lastName: row.last_name },
  }
}

export async function invoiceIssued(ctx: NotifyContext, invoiceId: string): Promise<void> {
  const r = await query(
    `SELECT i.number, i.total, i.currency, i.due_date, i.student_id
       FROM invoices i WHERE i.id = $1 AND i.tenant_id = $2`,
    [invoiceId, ctx.tenantId]
  )
  if (r.rowCount === 0) return
  const row = r.rows[0]

  const recipient = await studentRecipient({ query }, ctx.tenantId, row.student_id)
  if (!recipient) return

  await notifyQuietly({ query }, ctx, {
    eventKey: 'fees.invoice_issued',
    recipients: [recipient],
    relatedType: 'invoice',
    relatedId: invoiceId,
    dedupeKey: `invoice:${invoiceId}:issued`,
    data: {
      invoiceNumber: row.number,
      amount: amountWithCurrency(row.total, row.currency),
      dueLine: row.due_date
        ? `It is due on ${String(row.due_date).slice(0, 10)}.`
        : 'No due date has been set.',
    },
  })
}

export async function paymentReceived(
  ctx: NotifyContext,
  invoiceId: string,
  amount: string,
  balance: string
): Promise<void> {
  const r = await query(
    `SELECT number, currency, student_id FROM invoices WHERE id = $1 AND tenant_id = $2`,
    [invoiceId, ctx.tenantId]
  )
  if (r.rowCount === 0) return
  const row = r.rows[0]

  const recipient = await studentRecipient({ query }, ctx.tenantId, row.student_id)
  if (!recipient) return

  await notifyQuietly({ query }, ctx, {
    eventKey: 'fees.payment_received',
    recipients: [recipient],
    relatedType: 'invoice',
    relatedId: invoiceId,
    data: {
      invoiceNumber: row.number,
      amount: amountWithCurrency(amount, row.currency),
      balance: amountWithCurrency(balance, row.currency),
    },
  })
}

/**
 * Writes to everyone whose issued invoice is past its due date.
 *
 * Meant to be run on a schedule. The dedupe key carries the current month, so
 * running it twice on the same morning writes once while running it next
 * month writes again — which is the behaviour a finance office wants and is
 * very easy to get wrong in either direction.
 */
export async function sweepOverdueInvoices(ctx: NotifyContext): Promise<number> {
  const period = new Date().toISOString().slice(0, 7)

  const due = await query(
    `SELECT b.invoice_id, b.number, b.currency, b.balance, b.due_date, b.student_id
       FROM invoice_balances b
      WHERE b.tenant_id = $1 AND b.is_overdue IS TRUE
      ORDER BY b.due_date
      LIMIT 500`,
    [ctx.tenantId]
  )

  let queued = 0
  for (const row of due.rows) {
    const recipient = await studentRecipient({ query }, ctx.tenantId, row.student_id)
    if (!recipient) continue

    const summary = await notifyQuietly({ query }, ctx, {
      eventKey: 'fees.invoice_overdue',
      recipients: [recipient],
      relatedType: 'invoice',
      relatedId: row.invoice_id,
      dedupeKey: `invoice:${row.invoice_id}:overdue:${period}`,
      priority: 4,
      data: {
        invoiceNumber: row.number,
        dueDate: String(row.due_date).slice(0, 10),
        balance: amountWithCurrency(row.balance, row.currency),
      },
    })
    queued += summary?.queued.length ?? 0
  }

  return queued
}

// ---------------------------------------------------------------------------
// Leave
// ---------------------------------------------------------------------------

/** Tells the people who can decide a leave request that one is waiting. */
export async function leaveRequested(ctx: NotifyContext, requestId: string): Promise<void> {
  const r = await query(
    `SELECT r.start_date, r.end_date, r.total_days,
            t.name AS leave_type,
            e.first_name, e.last_name
       FROM leave_requests r
       JOIN leave_types t ON t.id = r.leave_type_id AND t.tenant_id = r.tenant_id
       JOIN employees e ON e.id = r.employee_id AND e.tenant_id = r.tenant_id
      WHERE r.id = $1 AND r.tenant_id = $2`,
    [requestId, ctx.tenantId]
  )
  if (r.rowCount === 0) return
  const row = r.rows[0]

  // Whoever in this tenant can approve. Resolved from roles rather than from
  // a manager field, because a request with no manager set still has to reach
  // somebody.
  const approvers = await query(
    `SELECT DISTINCT u.id
       FROM users u
       JOIN user_tenant_memberships m ON m.user_id = u.id
       JOIN roles ro ON ro.id = u.role_id
      WHERE m.tenant_id = $1 AND u.is_active = TRUE
        AND ro.name IN ('hr', 'hr_director', 'admin', 'manager')`,
    [ctx.tenantId]
  )
  if (approvers.rowCount === 0) return

  const { resolveRecipients } = await import('./service.js')
  const recipients = await resolveRecipients(
    { query }, ctx.tenantId, approvers.rows.map((x: any) => x.id)
  )

  await notifyQuietly({ query }, ctx, {
    eventKey: 'leave.requested',
    recipients,
    relatedType: 'leave_request',
    relatedId: requestId,
    dedupeKey: `leave:${requestId}:requested`,
    data: {
      employeeName: [row.first_name, row.last_name].filter(Boolean).join(' '),
      leaveType: row.leave_type,
      startDate: String(row.start_date).slice(0, 10),
      endDate: String(row.end_date).slice(0, 10),
      days: row.total_days,
    },
  })
}

/** Tells the employee what was decided. */
export async function leaveDecided(
  ctx: NotifyContext,
  requestId: string,
  decision: string,
  note?: string | null
): Promise<void> {
  const r = await query(
    `SELECT r.start_date, r.end_date,
            t.name AS leave_type,
            e.user_id, e.first_name, e.last_name, e.email
       FROM leave_requests r
       JOIN leave_types t ON t.id = r.leave_type_id AND t.tenant_id = r.tenant_id
       JOIN employees e ON e.id = r.employee_id AND e.tenant_id = r.tenant_id
      WHERE r.id = $1 AND r.tenant_id = $2`,
    [requestId, ctx.tenantId]
  )
  if (r.rowCount === 0) return
  const row = r.rows[0]

  await notifyQuietly({ query }, ctx, {
    eventKey: 'leave.decided',
    recipients: [{
      userId: row.user_id,
      name: [row.first_name, row.last_name].filter(Boolean).join(' '),
      email: row.email,
      data: { firstName: row.first_name, lastName: row.last_name },
    }],
    relatedType: 'leave_request',
    relatedId: requestId,
    dedupeKey: `leave:${requestId}:${decision}`,
    data: {
      leaveType: row.leave_type,
      startDate: String(row.start_date).slice(0, 10),
      endDate: String(row.end_date).slice(0, 10),
      decision,
      noteLine: note ? `\n\nNote: ${note}` : '',
    },
  })
}

// ---------------------------------------------------------------------------
// Payroll
// ---------------------------------------------------------------------------

/**
 * Tells everyone in an approved run that their payslip is ready.
 *
 * Only on approval, never on calculation: a calculated run is a draft that
 * may still be recalculated, and telling somebody what they are being paid
 * and then changing it is worse than telling them a day later.
 *
 * No amount goes in the message. The figure is behind the link.
 */
export async function payrollApproved(ctx: NotifyContext, runId: string): Promise<void> {
  const run = await query(
    `SELECT p.name AS period_name, p.pay_date
       FROM payroll_runs r
       JOIN payroll_periods p ON p.id = r.period_id AND p.tenant_id = r.tenant_id
      WHERE r.id = $1 AND r.tenant_id = $2`,
    [runId, ctx.tenantId]
  )
  if (run.rowCount === 0) return
  const period = run.rows[0]

  const slips = await query(
    `SELECT ps.id, e.user_id, e.first_name, e.last_name, e.email, e.phone
       FROM payslips ps
       JOIN employees e ON e.id = ps.employee_id AND e.tenant_id = ps.tenant_id
      WHERE ps.run_id = $1 AND ps.tenant_id = $2`,
    [runId, ctx.tenantId]
  )
  if (slips.rowCount === 0) return

  // One message per person, keyed on their own payslip rather than the run,
  // so a retry cannot fan a second copy out to everybody.
  for (const row of slips.rows) {
    await notifyQuietly({ query }, ctx, {
      eventKey: 'payroll.payslip_ready',
      recipients: [{
        userId: row.user_id,
        name: [row.first_name, row.last_name].filter(Boolean).join(' '),
        email: row.email,
        phone: row.phone,
        data: { firstName: row.first_name, lastName: row.last_name },
      }],
      relatedType: 'payslip',
      relatedId: row.id,
      dedupeKey: `payslip:${row.id}:ready`,
      data: {
        periodName: period.period_name,
        payDate: isoDayOf(period.pay_date),
      },
    })
  }
}

/** A DATE column as YYYY-MM-DD; see payrollService.isoDay for why. */
function isoDayOf(value: unknown): string {
  if (value instanceof Date) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}`
      + `-${String(value.getDate()).padStart(2, '0')}`
  }
  const s = String(value ?? '')
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : s
}

// ---------------------------------------------------------------------------
// Academic
// ---------------------------------------------------------------------------

/** Tells the students on a course that their results are out. */
export async function resultsPublished(ctx: NotifyContext, courseId: string): Promise<void> {
  const course = await query(
    `SELECT name FROM courses WHERE id = $1 AND tenant_id = $2`,
    [courseId, ctx.tenantId]
  )
  if (course.rowCount === 0) return

  const students = await query(
    `SELECT DISTINCT s.user_id, s.first_name, s.last_name, s.email, s.phone
       FROM course_results cr
       JOIN students s ON s.id = cr.student_id AND s.tenant_id = cr.tenant_id
      WHERE cr.course_id = $1 AND cr.tenant_id = $2 AND cr.status = 'published'`,
    [courseId, ctx.tenantId]
  )
  if (students.rowCount === 0) return

  await notifyQuietly({ query }, ctx, {
    eventKey: 'results.published',
    recipients: students.rows.map((row: any) => ({
      userId: row.user_id,
      name: [row.first_name, row.last_name].filter(Boolean).join(' '),
      email: row.email,
      phone: row.phone,
      data: { firstName: row.first_name, lastName: row.last_name },
    })),
    relatedType: 'course',
    relatedId: courseId,
    data: { courseName: course.rows[0].name },
  })
}
