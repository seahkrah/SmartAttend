import { Router, Response, NextFunction } from 'express'
import { query } from '../db/connection.js'
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
  transcriptFor,
  statementFor,
  attendanceSummaryFor,
  attendanceRecordsFor,
} from '../services/studentRecordsService.js'
import { clearance } from '../services/feesService.js'

/**
 * SMS — the parent portal. What a guardian sees of the students linked to
 * them, and nothing else.
 *
 *   GET /api/guardian/children                          my children, with a summary each
 *   GET /api/guardian/children/:studentId               one child's overview
 *   GET /api/guardian/children/:studentId/attendance    their attendance record
 *   GET /api/guardian/children/:studentId/schedule      their weekly timetable
 *   GET /api/guardian/children/:studentId/results       their published results
 *   GET /api/guardian/children/:studentId/fees          their fee statement
 *
 * Read-only by design. A guardian cannot change a mark, excuse an absence or
 * record a payment here; those remain the school's.
 *
 * Who is whose is decided by the school, per link (migration 062):
 *
 *   * The guardian record is found from the signed-in identity and the
 *     resolved school, never from anything the client sends.
 *   * A student is reachable only through a link to that guardian in the same
 *     school. Any other student id — another family's child, another school's,
 *     or one that does not exist — answers 404, so ids cannot be probed.
 *   * Each area (attendance, results, fees) is also gated by the link's own
 *     permission. A child the guardian can see, but whose fees the school has
 *     not shared with them, answers 403 on /fees: the guardian already knows
 *     the child exists, so saying so leaks nothing and explains the refusal.
 */

const router = Router()

router.use(
  authenticateToken,
  resolveTenantContext,
  requireTenant,
  requirePlatform('school'),
  requireRoles('guardian')
)

type Ctx = ResolvedTenantContext & { tenantId: string }

interface GuardianRequest extends TenantRequest {
  guardian?: any
  link?: any
  student?: any
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE = /^\d{4}-\d{2}-\d{2}$/

function ctxOf(req: TenantRequest): Ctx {
  return req.ctx as Ctx
}

function fail(res: Response, label: string, e: unknown) {
  console.error(`[GUARDIAN_PORTAL] ${label}:`, e)
  return res.status(500).json({ error: `Failed to ${label}` })
}

// A superadmin passes requireRoles, but has no guardian record in any school;
// the lookup below answers them as it answers anyone without one.
router.use(async (req: GuardianRequest, res: Response, next: NextFunction) => {
  try {
    const ctx = ctxOf(req)
    const r = await query(
      `SELECT * FROM guardians WHERE user_id = $1 AND tenant_id = $2`,
      [ctx.userId, ctx.tenantId]
    )
    if (r.rowCount === 0) {
      return res.status(404).json({ error: 'No guardian record at this school for your account' })
    }
    req.guardian = r.rows[0]
    return next()
  } catch (e) {
    return fail(res, 'load your guardian record', e)
  }
})

router.param('studentId', async (req: GuardianRequest, res: Response, next: NextFunction, id: string) => {
  try {
    const ctx = ctxOf(req)
    if (!UUID.test(id)) return res.status(404).json({ error: 'Student not found' })
    const r = await query(
      `SELECT gs.*, s.id AS s_id, s.student_id AS s_number, s.first_name AS s_first_name,
              s.middle_name AS s_middle_name, s.last_name AS s_last_name, s.status AS s_status,
              s.college AS s_college, s.enrollment_year AS s_enrollment_year,
              s.profile_photo_url AS s_photo, d.name AS s_department
         FROM guardian_students gs
         JOIN students s ON s.id = gs.student_id AND s.tenant_id = gs.tenant_id
         LEFT JOIN school_departments d ON d.id = s.department_id AND d.tenant_id = s.tenant_id
        WHERE gs.guardian_id = $1 AND gs.student_id = $2 AND gs.tenant_id = $3`,
      [req.guardian.id, id, ctx.tenantId]
    )
    if (r.rowCount === 0) return res.status(404).json({ error: 'Student not found' })
    const row = r.rows[0]
    req.link = row
    req.student = {
      id: row.s_id,
      student_id: row.s_number,
      first_name: row.s_first_name,
      middle_name: row.s_middle_name,
      last_name: row.s_last_name,
      status: row.s_status,
      college: row.s_college,
      enrollment_year: row.s_enrollment_year,
      profile_photo_url: row.s_photo,
      department: row.s_department,
    }
    return next()
  } catch (e) {
    return fail(res, 'load that student', e)
  }
})

type Permission = 'can_view_attendance' | 'can_view_results' | 'can_view_fees'

const AREA: Record<Permission, string> = {
  can_view_attendance: 'attendance',
  can_view_results: 'results',
  can_view_fees: 'fees',
}

function requireAccess(permission: Permission) {
  return (req: GuardianRequest, res: Response, next: NextFunction) => {
    if (req.link?.[permission]) return next()
    return res.status(403).json({
      error: `The school has not shared this student's ${AREA[permission]} with you`,
    })
  }
}

function permissionsOf(link: any) {
  return {
    attendance: !!link.can_view_attendance,
    results: !!link.can_view_results,
    fees: !!link.can_view_fees,
  }
}

function dateParam(value: unknown): string | null | undefined {
  if (value === undefined || value === '') return null
  if (typeof value !== 'string' || !DATE.test(value) || Number.isNaN(Date.parse(value))) return undefined
  return value
}

// ---------------------------------------------------------------------------

router.get('/children', async (req: GuardianRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const links = await query(
      `SELECT gs.*, s.student_id AS student_number, s.first_name, s.last_name, s.status,
              s.profile_photo_url
         FROM guardian_students gs
         JOIN students s ON s.id = gs.student_id AND s.tenant_id = gs.tenant_id
        WHERE gs.guardian_id = $1 AND gs.tenant_id = $2
        ORDER BY s.first_name, s.last_name`,
      [req.guardian.id, ctx.tenantId]
    )

    // A summary per child, each figure only where the school shares it: the
    // list must not become a way round a per-area permission.
    const children = []
    for (const link of links.rows) {
      const summary: Record<string, unknown> = {}
      if (link.can_view_attendance) {
        summary.attendance = await attendanceSummaryFor(ctx.tenantId, link.student_id)
      }
      if (link.can_view_fees) {
        const c = await clearance(ctx.tenantId, link.student_id)
        summary.fees = { cleared: c.cleared, balance: c.balance, currency: c.currency, overdueCount: c.overdueCount }
      }
      children.push({
        id: link.student_id,
        studentNumber: link.student_number,
        firstName: link.first_name,
        lastName: link.last_name,
        status: link.status,
        photoUrl: link.profile_photo_url,
        relationship: link.relationship,
        isPrimary: link.is_primary,
        permissions: permissionsOf(link),
        summary,
      })
    }

    return res.json({
      guardian: {
        id: req.guardian.id,
        firstName: req.guardian.first_name,
        lastName: req.guardian.last_name,
        email: req.guardian.email,
        phone: req.guardian.phone,
      },
      school: ctx.tenantName,
      children,
    })
  } catch (e) {
    return fail(res, 'load your children', e)
  }
})

router.get('/children/:studentId', async (req: GuardianRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const student = req.student
    const link = req.link

    const programme = await query(
      `SELECT p.code, p.name, p.award, sp.current_study_year, sp.status
         FROM student_programmes sp
         JOIN programmes p ON p.id = sp.programme_id AND p.tenant_id = sp.tenant_id
        WHERE sp.student_id = $1 AND sp.tenant_id = $2 AND sp.status = 'active'
        LIMIT 1`,
      [student.id, ctx.tenantId]
    )

    const overview: Record<string, unknown> = {}
    if (link.can_view_attendance) {
      const last30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
      overview.attendance = {
        overall: await attendanceSummaryFor(ctx.tenantId, student.id),
        last30Days: await attendanceSummaryFor(ctx.tenantId, student.id, last30, null),
        recent: await attendanceRecordsFor(ctx.tenantId, student.id, null, null, 5),
      }
    }
    if (link.can_view_results) {
      const t = await transcriptFor(ctx.tenantId, student)
      overview.results = {
        cgpa: t.cgpa,
        creditsEarned: t.creditsEarned,
        creditsAttempted: t.creditsAttempted,
        creditWeighted: t.creditWeighted,
        latest: t.entries.slice(-5).reverse(),
      }
    }
    if (link.can_view_fees) {
      overview.fees = await clearance(ctx.tenantId, student.id)
    }

    return res.json({
      student: {
        id: student.id,
        studentNumber: student.student_id,
        firstName: student.first_name,
        middleName: student.middle_name,
        lastName: student.last_name,
        status: student.status,
        department: student.department,
        college: student.college,
        enrollmentYear: student.enrollment_year,
        photoUrl: student.profile_photo_url,
      },
      programme: programme.rows[0] ?? null,
      relationship: link.relationship,
      isPrimary: link.is_primary,
      permissions: permissionsOf(link),
      ...overview,
    })
  } catch (e) {
    return fail(res, "load your child's overview", e)
  }
})

router.get('/children/:studentId/attendance', requireAccess('can_view_attendance'),
  async (req: GuardianRequest, res: Response) => {
    try {
      const ctx = ctxOf(req)
      const from = dateParam(req.query.from)
      const to = dateParam(req.query.to)
      if (from === undefined || to === undefined) {
        return res.status(400).json({ error: 'Dates must be YYYY-MM-DD' })
      }
      const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 500)
      return res.json({
        summary: await attendanceSummaryFor(ctx.tenantId, req.student.id, from, to),
        records: await attendanceRecordsFor(ctx.tenantId, req.student.id, from, to, limit),
      })
    } catch (e) {
      return fail(res, 'load attendance', e)
    }
  })

/**
 * The weekly timetable. Not gated by a permission of its own: knowing when a
 * child is meant to be in class is the least a guardian is told, and the
 * school controls it by whether the guardian is linked at all.
 */
router.get('/children/:studentId/schedule', async (req: GuardianRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const r = await query(
      `SELECT cs.id, cs.day_of_week, cs.start_time, cs.end_time, cs.section,
              c.code AS course_code, c.name AS course_name,
              COALESCE(r.building || ' ' || r.room_number, r.room_number) AS room_name,
              u.full_name AS lecturer_name
         FROM student_courses sc
         JOIN class_schedules cs ON cs.id = sc.schedule_id AND cs.tenant_id = sc.tenant_id
         JOIN courses c ON c.id = cs.course_id AND c.tenant_id = cs.tenant_id
         LEFT JOIN rooms r ON r.id = cs.room_id AND r.tenant_id = cs.tenant_id
         LEFT JOIN faculty f ON f.id = cs.faculty_id AND f.tenant_id = cs.tenant_id
         LEFT JOIN users u ON u.id = f.user_id
        WHERE sc.student_id = $1 AND sc.tenant_id = $2 AND sc.status = 'enrolled'
        ORDER BY cs.day_of_week NULLS LAST, cs.start_time`,
      [req.student.id, ctx.tenantId]
    )
    return res.json({ schedule: r.rows })
  } catch (e) {
    return fail(res, 'load the timetable', e)
  }
})

router.get('/children/:studentId/results', requireAccess('can_view_results'),
  async (req: GuardianRequest, res: Response) => {
    try {
      const ctx = ctxOf(req)
      const year = typeof req.query.academicYearId === 'string' ? req.query.academicYearId : null
      if (year && !UUID.test(year)) return res.status(404).json({ error: 'Academic year not found' })
      return res.json(await transcriptFor(ctx.tenantId, req.student, year))
    } catch (e) {
      return fail(res, 'load results', e)
    }
  })

router.get('/children/:studentId/fees', requireAccess('can_view_fees'),
  async (req: GuardianRequest, res: Response) => {
    try {
      const ctx = ctxOf(req)
      // Only what the school has issued: a draft shown to the person paying
      // reads as a bill that has not been sent.
      return res.json(await statementFor(ctx.tenantId, req.student, { includeDrafts: false }))
    } catch (e) {
      return fail(res, 'load fees', e)
    }
  })

export default router
