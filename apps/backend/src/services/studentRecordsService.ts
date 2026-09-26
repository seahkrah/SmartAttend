import { query } from '../db/connection.js'
import { computeGpa } from './gradingService.js'
import { clearance, type Clearance } from './feesService.js'

/**
 * What the school holds about one student, assembled for whoever may read it.
 *
 * The transcript and the fee statement used to be built inside the routes
 * that served them — the gradebook and fees routers — which was fine while a
 * student and the school's staff were the only readers. Guardians are a third
 * audience for the same records. Copying those queries into a third router is
 * how two views of one transcript start to disagree, so the records are built
 * here once and every audience asks for them.
 *
 * Nothing here decides who may read what. Callers establish that first; these
 * functions take a tenant and a student row the caller has already resolved
 * inside that tenant.
 */

export interface StudentRow {
  id: string
  student_id: string | null
  first_name: string
  last_name: string
}

export async function transcriptFor(
  tenantId: string,
  student: StudentRow,
  academicYearId: string | null = null
) {
  // student_transcript only ever contains published results; a provisional
  // or withheld mark is not visible to anyone through this.
  const rows = await query(
    `SELECT * FROM student_transcript
      WHERE tenant_id = $1 AND student_id = $2
        AND ($3::uuid IS NULL OR academic_year_id = $3::uuid)
      ORDER BY academic_year NULLS LAST, semester_name NULLS LAST, course_code`,
    [tenantId, student.id, academicYearId]
  )

  const overall = await computeGpa(tenantId, student.id, null)
  const forYear = academicYearId ? await computeGpa(tenantId, student.id, academicYearId) : overall

  const programme = await query(
    `SELECT p.code, p.name, p.award, p.credits_required, sp.current_study_year, sp.status
       FROM student_programmes sp
       JOIN programmes p ON p.id = sp.programme_id
      WHERE sp.student_id = $1 AND sp.tenant_id = $2 AND sp.status = 'active'
      LIMIT 1`,
    [student.id, tenantId]
  )

  return {
    student: {
      id: student.id,
      studentNumber: student.student_id,
      firstName: student.first_name,
      lastName: student.last_name,
    },
    programme: programme.rows[0] ?? null,
    entries: rows.rows,
    cgpa: overall.gpa,
    gpa: forYear.gpa,
    creditsEarned: overall.creditsEarned,
    creditsAttempted: overall.creditsAttempted,
    // Says whether the figures above are credit-weighted or a plain mean,
    // so a transcript does not imply a weighting the school has not set.
    creditWeighted: !overall.unweighted,
  }
}

export interface StatementOptions {
  /**
   * Whether invoices not yet issued are listed. A student sees their own
   * drafts, marked as such; a guardian sees only what the school has actually
   * asked to be paid, because a draft shown to the person paying reads as a
   * bill.
   */
  includeDrafts: boolean
}

export async function statementFor(
  tenantId: string,
  student: StudentRow,
  options: StatementOptions
): Promise<{
  student: { id: string; studentNumber: string | null; name: string }
  summary: Clearance
  invoices: any[]
  payments: any[]
}> {
  const invoices = await query(
    `SELECT i.id, i.number, i.status, i.currency, i.total, i.due_date, i.issued_at,
            b.amount_paid, b.balance, b.settlement, b.is_overdue
       FROM invoices i
       JOIN invoice_balances b ON b.invoice_id = i.id
      WHERE i.student_id = $1 AND i.tenant_id = $2
        AND ($3::boolean OR i.status <> 'draft')
      ORDER BY i.created_at DESC`,
    [student.id, tenantId, options.includeDrafts]
  )

  const payments = await query(
    `SELECT p.id, p.amount, p.currency, p.method, p.reference, p.paid_at,
            p.reversed_at, i.number AS invoice_number
       FROM payments p
       JOIN invoices i ON i.id = p.invoice_id AND i.tenant_id = p.tenant_id
      WHERE p.student_id = $1 AND p.tenant_id = $2
      ORDER BY p.paid_at DESC`,
    [student.id, tenantId]
  )

  return {
    student: {
      id: student.id,
      studentNumber: student.student_id,
      name: `${student.first_name} ${student.last_name}`,
    },
    // Clearance counts issued invoices only, so it is the same figure for
    // every audience whether or not drafts are listed.
    summary: await clearance(tenantId, student.id),
    invoices: invoices.rows,
    payments: payments.rows,
  }
}

export interface AttendanceSummary {
  total: number
  present: number
  late: number
  absent: number
  excused: number
  /** Present or late over all marked sessions; null when nothing is marked. */
  rate: number | null
}

export async function attendanceSummaryFor(
  tenantId: string,
  studentId: string,
  from: string | null = null,
  to: string | null = null
): Promise<AttendanceSummary> {
  const r = await query(
    `SELECT COUNT(*)::int                                   AS total,
            COUNT(*) FILTER (WHERE status = 'present')::int AS present,
            COUNT(*) FILTER (WHERE status = 'late')::int    AS late,
            COUNT(*) FILTER (WHERE status = 'absent')::int  AS absent,
            COUNT(*) FILTER (WHERE status = 'excused')::int AS excused
       FROM school_attendance
      WHERE tenant_id = $1 AND student_id = $2
        AND ($3::date IS NULL OR attendance_date >= $3::date)
        AND ($4::date IS NULL OR attendance_date <= $4::date)`,
    [tenantId, studentId, from, to]
  )
  const row = r.rows[0]
  return {
    total: row.total,
    present: row.present,
    late: row.late,
    absent: row.absent,
    excused: row.excused,
    rate: row.total > 0 ? Math.round(((row.present + row.late) / row.total) * 100) : null,
  }
}

export async function attendanceRecordsFor(
  tenantId: string,
  studentId: string,
  from: string | null,
  to: string | null,
  limit: number
) {
  const r = await query(
    `SELECT sa.id, sa.attendance_date, sa.status, sa.marked_at,
            c.code AS course_code, c.name AS course_name,
            cs.start_time, cs.end_time
       FROM school_attendance sa
       JOIN class_schedules cs ON cs.id = sa.schedule_id AND cs.tenant_id = sa.tenant_id
       JOIN courses c ON c.id = cs.course_id AND c.tenant_id = cs.tenant_id
      WHERE sa.tenant_id = $1 AND sa.student_id = $2
        AND ($3::date IS NULL OR sa.attendance_date >= $3::date)
        AND ($4::date IS NULL OR sa.attendance_date <= $4::date)
      ORDER BY sa.attendance_date DESC, cs.start_time DESC NULLS LAST
      LIMIT $5`,
    [tenantId, studentId, from, to, limit]
  )
  return r.rows
}
