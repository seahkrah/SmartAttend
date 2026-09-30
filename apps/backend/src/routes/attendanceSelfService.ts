import { Router, Response } from 'express'
import { query } from '../db/connection.js'
import { authenticateToken } from '../auth/middleware.js'
import {
  resolveTenantContext,
  requireTenant,
  requireRoles,
  type TenantRequest,
} from '../auth/tenantContextMiddleware.js'
import { TenantScopeError } from '../db/tenantScoped.js'

/**
 * Attendance self-service and department views.
 *
 * Two audiences share this router because they share the underlying records:
 *
 *   /me/*          a student or employee reading their own attendance
 *   /department/*  a manager or HR reading their department's
 *
 * The /me routes are scoped twice over: to the tenant, and within it to the
 * authenticated user. Someone reading their own record cannot widen it to a
 * colleague's by changing a parameter, because no parameter selects the
 * subject — the identity does.
 *
 * Works on both platforms: a student's attendance lives in school_attendance,
 * an employee's in corporate_checkins, and the handler picks by the platform
 * resolved from the identity rather than by anything the client sends.
 */

const router = Router()

router.use(authenticateToken, resolveTenantContext, requireTenant)

function fail(res: Response, e: unknown) {
  if (e instanceof TenantScopeError) {
    return res.status(e.status).json({ error: 'Request refused', message: e.message })
  }
  console.error('[ATTENDANCE]', e)
  return res.status(500).json({ error: 'Internal error' })
}

function ratingFor(pct: number): 'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR' {
  if (pct >= 90) return 'EXCELLENT'
  if (pct >= 75) return 'GOOD'
  if (pct >= 60) return 'FAIR'
  return 'POOR'
}

function windowDays(req: TenantRequest, fallback = 90): number {
  const raw = parseInt(String(req.query.days ?? fallback), 10)
  return Number.isFinite(raw) && raw > 0 && raw <= 365 ? raw : fallback
}

/** The caller's own student or employee record within this tenant. */
async function selfRecord(ctx: any): Promise<{ kind: 'student' | 'employee'; row: any } | null> {
  if (ctx.platformKind === 'school') {
    const r = await query(
      `SELECT * FROM students WHERE tenant_id = $1 AND user_id = $2 LIMIT 1`,
      [ctx.tenantId, ctx.userId]
    )
    return r.rows[0] ? { kind: 'student', row: r.rows[0] } : null
  }
  const r = await query(
    `SELECT * FROM employees WHERE tenant_id = $1 AND user_id = $2 LIMIT 1`,
    [ctx.tenantId, ctx.userId]
  )
  return r.rows[0] ? { kind: 'employee', row: r.rows[0] } : null
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

router.get('/profile', async (req: TenantRequest, res: Response) => {
  const ctx = req.ctx!
  try {
    const self = await selfRecord(ctx)
    const user = await query(
      `SELECT id, email, full_name, phone, profile_image_url, created_at
         FROM users WHERE id = $1`,
      [ctx.userId]
    )
    if (user.rows.length === 0) {
      return res.status(404).json({ error: 'Not found', message: 'Profile unavailable' })
    }
    const u = user.rows[0]

    let department: string | undefined
    if (self?.row.department_id) {
      const table = self.kind === 'student' ? 'school_departments' : 'corporate_departments'
      const d = await query(`SELECT name FROM ${table} WHERE id = $1 AND tenant_id = $2`,
        [self.row.department_id, ctx.tenantId])
      department = d.rows[0]?.name
    }

    res.json({
      id: u.id,
      name: u.full_name,
      email: u.email,
      phone: u.phone ?? undefined,
      role: self?.kind === 'employee' ? 'EMPLOYEE' : 'STUDENT',
      enrollment_id: self?.row.student_id ?? self?.row.employee_id ?? undefined,
      department,
      joined_date: self?.row.created_at ?? u.created_at,
      avatar_url: u.profile_image_url ?? undefined,
      tenant: ctx.tenantName,
    })
  } catch (e) {
    fail(res, e)
  }
})

router.put('/profile', async (req: TenantRequest, res: Response) => {
  const ctx = req.ctx!
  const { name, phone, avatar_url } = req.body ?? {}
  try {
    // Deliberately narrow: a member may change how they are contacted, not
    // who they are. email, role, platform and tenant are not editable here,
    // so self-service cannot become a privilege-escalation path.
    const sets: string[] = []
    const params: unknown[] = []
    if (typeof name === 'string' && name.trim().length >= 2) {
      params.push(name.trim()); sets.push(`full_name = $${params.length}`)
    }
    if (typeof phone === 'string') {
      params.push(phone.trim() || null); sets.push(`phone = $${params.length}`)
    }
    if (typeof avatar_url === 'string') {
      params.push(avatar_url.trim() || null); sets.push(`profile_image_url = $${params.length}`)
    }
    if (sets.length === 0) {
      return res.status(400).json({ error: 'Validation failed', message: 'Supply name, phone or avatar_url' })
    }

    params.push(ctx.userId)
    const r = await query(
      `UPDATE users SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP
        WHERE id = $${params.length}
        RETURNING id, email, full_name, phone, profile_image_url, created_at`,
      params
    )
    const u = r.rows[0]
    const self = await selfRecord(ctx)
    res.json({
      id: u.id,
      name: u.full_name,
      email: u.email,
      phone: u.phone ?? undefined,
      role: self?.kind === 'employee' ? 'EMPLOYEE' : 'STUDENT',
      joined_date: u.created_at,
      avatar_url: u.profile_image_url ?? undefined,
    })
  } catch (e) {
    fail(res, e)
  }
})

// ---------------------------------------------------------------------------
// My attendance
// ---------------------------------------------------------------------------

router.get('/me/metrics', async (req: TenantRequest, res: Response) => {
  const ctx = req.ctx!
  try {
    const self = await selfRecord(ctx)
    if (!self) {
      return res.status(404).json({ error: 'Not found', message: 'You have no attendance record in this tenant' })
    }
    const days = windowDays(req)

    if (self.kind === 'student') {
      const r = await query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE status = 'present')::int AS present,
                COUNT(*) FILTER (WHERE status = 'absent')::int AS absent,
                COUNT(*) FILTER (WHERE status = 'late')::int AS late,
                COUNT(*) FILTER (WHERE status = 'excused')::int AS excused,
                MAX(marked_at) AS last_updated
           FROM school_attendance
          WHERE tenant_id = $1 AND student_id = $2
            AND attendance_date > CURRENT_DATE - $3::int`,
        [ctx.tenantId, self.row.id, days]
      )
      const x = r.rows[0]
      const pct = x.total > 0 ? Math.round(((x.present + x.late) / x.total) * 1000) / 10 : 0
      return res.json({
        attendance_percent: pct,
        rating: ratingFor(pct),
        sessions_total: x.total,
        present: x.present,
        absent: x.absent,
        late: x.late,
        excused: x.excused,
        last_updated: x.last_updated ?? new Date().toISOString(),
      })
    }

    const r = await query(
      `SELECT COUNT(*)::int AS present, MAX(check_in_time) AS last_updated
         FROM corporate_checkins
        WHERE tenant_id = $1 AND employee_id = $2
          AND check_in_time > NOW() - ($3 || ' days')::interval`,
      [ctx.tenantId, self.row.id, days]
    )
    const present = r.rows[0].present
    const pct = days > 0 ? Math.round((present / days) * 1000) / 10 : 0
    res.json({
      attendance_percent: pct,
      rating: ratingFor(pct),
      sessions_total: days,
      present,
      absent: Math.max(0, days - present),
      late: 0,
      excused: 0,
      last_updated: r.rows[0].last_updated ?? new Date().toISOString(),
    })
  } catch (e) {
    fail(res, e)
  }
})

router.get('/me/courses', async (req: TenantRequest, res: Response) => {
  const ctx = req.ctx!
  try {
    if (ctx.platformKind !== 'school') {
      return res.status(403).json({ error: 'Forbidden', message: 'Courses belong to the school platform' })
    }
    const self = await selfRecord(ctx)
    if (!self) return res.json([])

    // Both the attendance rows and the course rows are bounded by tenant_id,
    // so a shared schedule id could not pull in another tenant's course.
    const r = await query(
      `SELECT c.id AS course_id, c.name AS course_name, c.code,
              s.name AS semester,
              COUNT(sa.id)::int AS sessions_total,
              COUNT(sa.id) FILTER (WHERE sa.status = 'present')::int AS present,
              COUNT(sa.id) FILTER (WHERE sa.status = 'absent')::int AS absent,
              COUNT(sa.id) FILTER (WHERE sa.status = 'late')::int AS late,
              COUNT(sa.id) FILTER (WHERE sa.status = 'excused')::int AS excused,
              (SELECT f.first_name || ' ' || f.last_name FROM faculty_courses fc
                 JOIN faculty f ON f.id = fc.faculty_id
                WHERE fc.course_id = c.id AND fc.tenant_id = $1 LIMIT 1) AS instructor_name
         FROM student_courses sc
         JOIN class_schedules cs ON cs.id = sc.schedule_id AND cs.tenant_id = $1
         JOIN courses c ON c.id = cs.course_id AND c.tenant_id = $1
         LEFT JOIN semesters s ON s.id = c.semester_id AND s.tenant_id = $1
         LEFT JOIN school_attendance sa
           ON sa.schedule_id = cs.id AND sa.student_id = sc.student_id AND sa.tenant_id = $1
        WHERE sc.tenant_id = $1 AND sc.student_id = $2 AND sc.is_active
        GROUP BY c.id, c.name, c.code, s.name
        ORDER BY c.code`,
      [ctx.tenantId, self.row.id]
    )

    res.json(
      r.rows.map((x: any) => {
        const pct = x.sessions_total > 0
          ? Math.round(((x.present + x.late) / x.sessions_total) * 1000) / 10
          : 0
        return { ...x, attendance_percent: pct }
      })
    )
  } catch (e) {
    fail(res, e)
  }
})

router.get('/me/discrepancies', async (req: TenantRequest, res: Response) => {
  const ctx = req.ctx!
  try {
    const status = typeof req.query.status === 'string' ? req.query.status.toUpperCase() : ''
    const params: unknown[] = [ctx.tenantId, ctx.userId]
    let where = 'd.tenant_id = $1 AND d.reporter_user_id = $2'
    if (status) { params.push(status); where += ` AND d.status = $${params.length}` }

    const r = await query(
      `SELECT d.*, c.name AS course_name,
              u.full_name AS resolved_by_name
         FROM attendance_discrepancy_reports d
         LEFT JOIN courses c ON c.id = d.course_id AND c.tenant_id = $1
         LEFT JOIN users u ON u.id = d.resolved_by_user_id
        WHERE ${where}
        ORDER BY d.created_at DESC`,
      params
    )
    res.json(
      r.rows.map((x: any) => ({
        id: x.id,
        course_id: x.course_id ?? undefined,
        course_name: x.course_name ?? undefined,
        date_of_class: x.date_of_class,
        date_reported: x.created_at,
        reported_status: x.reported_status,
        current_status: x.current_status ?? x.reported_status,
        description: x.description,
        status: x.status,
        resolved_by: x.resolved_by_name ?? undefined,
        resolution_notes: x.resolution_notes ?? undefined,
      }))
    )
  } catch (e) {
    fail(res, e)
  }
})

router.post('/me/discrepancies', async (req: TenantRequest, res: Response) => {
  const ctx = req.ctx!
  const { course_id, date_of_class, reported_status, description } = req.body ?? {}

  const STATUSES = ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED']
  if (!date_of_class || Number.isNaN(Date.parse(String(date_of_class)))) {
    return res.status(400).json({ error: 'Validation failed', message: 'date_of_class must be a valid date' })
  }
  if (!STATUSES.includes(String(reported_status))) {
    return res.status(400).json({ error: 'Validation failed', message: `reported_status must be one of ${STATUSES.join(', ')}` })
  }
  if (!description || typeof description !== 'string' || description.trim().length < 5) {
    return res.status(400).json({ error: 'Validation failed', message: 'description is required' })
  }

  try {
    // A course id from another tenant is rejected rather than silently stored.
    if (course_id) {
      const c = await query(`SELECT id FROM courses WHERE id = $1 AND tenant_id = $2`, [course_id, ctx.tenantId])
      if (c.rows.length === 0) {
        return res.status(404).json({ error: 'Not found', message: 'No such course in this tenant' })
      }
    }

    // The reporter is the authenticated user, never a body field.
    const r = await query(
      `INSERT INTO attendance_discrepancy_reports
         (tenant_id, platform_id, reporter_user_id, course_id, date_of_class,
          reported_status, description, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'OPEN')
       RETURNING *`,
      [ctx.tenantId, ctx.platformId, ctx.userId, course_id ?? null,
       String(date_of_class), String(reported_status), description.trim()]
    )
    const x = r.rows[0]
    res.status(201).json({
      id: x.id,
      course_id: x.course_id ?? undefined,
      date_of_class: x.date_of_class,
      date_reported: x.created_at,
      reported_status: x.reported_status,
      current_status: x.current_status ?? x.reported_status,
      description: x.description,
      status: x.status,
    })
  } catch (e) {
    fail(res, e)
  }
})

router.get('/me/export', async (req: TenantRequest, res: Response) => {
  const ctx = req.ctx!
  const format = String(req.query.format ?? 'CSV').toUpperCase()
  if (format !== 'CSV') {
    return res.status(415).json({ error: 'Unsupported format', message: `${format} export is not implemented; request format=CSV` })
  }
  try {
    const self = await selfRecord(ctx)
    if (!self) {
      return res.status(404).json({ error: 'Not found', message: 'You have no attendance record in this tenant' })
    }
    const days = windowDays(req, 365)

    const rows = self.kind === 'student'
      ? await query(
          `SELECT sa.attendance_date AS date, c.code AS context, sa.status, sa.face_verified, sa.marked_at
             FROM school_attendance sa
             LEFT JOIN class_schedules cs ON cs.id = sa.schedule_id AND cs.tenant_id = $1
             LEFT JOIN courses c ON c.id = cs.course_id AND c.tenant_id = $1
            WHERE sa.tenant_id = $1 AND sa.student_id = $2
              AND sa.attendance_date > CURRENT_DATE - $3::int
            ORDER BY sa.attendance_date DESC`,
          [ctx.tenantId, self.row.id, days]
        )
      : await query(
          `SELECT cc.check_in_time::date AS date, cc.check_in_type AS context,
                  'present' AS status, cc.face_verified, cc.check_in_time AS marked_at
             FROM corporate_checkins cc
            WHERE cc.tenant_id = $1 AND cc.employee_id = $2
              AND cc.check_in_time > NOW() - ($3 || ' days')::interval
            ORDER BY cc.check_in_time DESC`,
          [ctx.tenantId, self.row.id, days]
        )

    const escape = (v: unknown) => {
      const s = v === null || v === undefined ? '' : String(v)
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const csv = [
      ['date', 'context', 'status', 'face_verified', 'recorded_at'].join(','),
      ...rows.rows.map((x: any) => [x.date, x.context, x.status, x.face_verified, x.marked_at].map(escape).join(',')),
    ].join('\n')

    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', 'attachment; filename="my-attendance.csv"')
    res.send(csv)
  } catch (e) {
    fail(res, e)
  }
})

// ---------------------------------------------------------------------------
// Department views — managers and HR
// ---------------------------------------------------------------------------

const DEPARTMENT_ROLES = ['hr', 'hr_director', 'manager', 'admin'] as const

router.get('/department/all', requireRoles(...DEPARTMENT_ROLES), async (req: TenantRequest, res: Response) => {
  const ctx = req.ctx!
  try {
    if (ctx.platformKind !== 'corporate') {
      return res.status(403).json({ error: 'Forbidden', message: 'Department attendance is an EMS view' })
    }
    const days = windowDays(req, 30)
    const r = await query(
      `SELECT d.name AS department,
              COUNT(DISTINCT e.id)::int AS members,
              SUM(COALESCE(cur.attended, 0))::int AS present,
              (COUNT(DISTINCT e.id) * $2::int)::int AS sessions_total
         FROM corporate_departments d
         LEFT JOIN employees e ON e.department_id = d.id AND e.tenant_id = $1 AND e.is_currently_employed
         LEFT JOIN LATERAL (
           SELECT COUNT(*)::int AS attended FROM corporate_checkins c
            WHERE c.employee_id = e.id AND c.tenant_id = $1
              AND c.check_in_time > NOW() - ($2 || ' days')::interval
         ) cur ON TRUE
        WHERE d.tenant_id = $1
        GROUP BY d.id, d.name
        ORDER BY d.name`,
      [ctx.tenantId, days]
    )
    res.json(
      r.rows.map((x: any) => {
        const total = x.sessions_total ?? 0
        const pct = total > 0 ? Math.round((x.present / total) * 1000) / 10 : 0
        return {
          department: x.department,
          sessions_total: total,
          present: x.present ?? 0,
          absent: Math.max(0, total - (x.present ?? 0)),
          late: 0,
          excused: 0,
          attendance_percent: pct,
        }
      })
    )
  } catch (e) {
    fail(res, e)
  }
})

router.get('/employees/:employeeId', requireRoles(...DEPARTMENT_ROLES), async (req: TenantRequest, res: Response) => {
  const ctx = req.ctx!
  try {
    if (ctx.platformKind !== 'corporate') {
      return res.status(403).json({ error: 'Forbidden', message: 'This is an EMS view' })
    }
    // Scoped lookup: an employee id from another tenant is simply not found.
    const emp = await query(
      `SELECT e.*, d.name AS department
         FROM employees e
         LEFT JOIN corporate_departments d ON d.id = e.department_id AND d.tenant_id = $1
        WHERE e.tenant_id = $1 AND e.id = $2`,
      [ctx.tenantId, req.params.employeeId]
    )
    if (emp.rows.length === 0) {
      return res.status(404).json({ error: 'Not found', message: 'No such employee in this tenant' })
    }
    const days = windowDays(req, 30)
    const stats = await query(
      `SELECT COUNT(*)::int AS present FROM corporate_checkins
        WHERE tenant_id = $1 AND employee_id = $2
          AND check_in_time > NOW() - ($3 || ' days')::interval`,
      [ctx.tenantId, req.params.employeeId, days]
    )
    const present = stats.rows[0].present
    const pct = days > 0 ? Math.round((present / days) * 1000) / 10 : 0
    res.json({
      department: emp.rows[0].department ?? 'Unassigned',
      sessions_total: days,
      present,
      absent: Math.max(0, days - present),
      late: 0,
      excused: 0,
      attendance_percent: pct,
    })
  } catch (e) {
    fail(res, e)
  }
})

router.post('/notifications/send', requireRoles(...DEPARTMENT_ROLES), async (req: TenantRequest, res: Response) => {
  const ctx = req.ctx!
  const { member_ids, subject, message } = req.body ?? {}
  if (!Array.isArray(member_ids) || member_ids.length === 0) {
    return res.status(400).json({ error: 'Validation failed', message: 'member_ids must be a non-empty array' })
  }
  if (!message || typeof message !== 'string' || message.trim().length < 5) {
    return res.status(400).json({ error: 'Validation failed', message: 'message is required' })
  }
  try {
    const table = ctx.platformKind === 'school' ? 'students' : 'employees'
    const resolved = await query(
      `SELECT id, user_id FROM ${table} WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
      [ctx.tenantId, member_ids.map(String)]
    )
    if (resolved.rows.length !== new Set(member_ids.map(String)).size) {
      return res.status(404).json({ error: 'Not found', message: 'One or more recipients are not members of this tenant' })
    }
    for (const r of resolved.rows) {
      await query(
        `INSERT INTO notifications
           (tenant_id, recipient_user_id, category, subject, body, channel, status, sent_by_user_id, sent_at)
         VALUES ($1,$2,'attendance',$3,$4,'in_app','sent',$5,CURRENT_TIMESTAMP)`,
        [ctx.tenantId, r.user_id, String(subject ?? 'Attendance notice'), message.trim(), ctx.userId]
      )
    }
    res.json({ success: true, sent_count: resolved.rows.length })
  } catch (e) {
    fail(res, e)
  }
})

router.get('/department/export', requireRoles(...DEPARTMENT_ROLES), async (req: TenantRequest, res: Response) => {
  const ctx = req.ctx!
  const format = String(req.query.format ?? 'CSV').toUpperCase()
  if (format !== 'CSV') {
    return res.status(415).json({ error: 'Unsupported format', message: `${format} export is not implemented; request format=CSV` })
  }
  try {
    if (ctx.platformKind !== 'corporate') {
      return res.status(403).json({ error: 'Forbidden', message: 'This is an EMS export' })
    }
    const days = windowDays(req, 30)
    const r = await query(
      `SELECT d.name AS department,
              e.first_name || ' ' || e.last_name AS name,
              e.email,
              (SELECT COUNT(*)::int FROM corporate_checkins c
                WHERE c.employee_id = e.id AND c.tenant_id = $1
                  AND c.check_in_time > NOW() - ($2 || ' days')::interval) AS present
         FROM employees e
         LEFT JOIN corporate_departments d ON d.id = e.department_id AND d.tenant_id = $1
        WHERE e.tenant_id = $1 AND e.is_currently_employed
        ORDER BY d.name NULLS LAST, name`,
      [ctx.tenantId, days]
    )
    const escape = (v: unknown) => {
      const s = v === null || v === undefined ? '' : String(v)
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const csv = [
      ['department', 'name', 'email', 'present', 'expected', 'attendance_percent'].join(','),
      ...r.rows.map((x: any) => {
        const pct = days > 0 ? Math.round((x.present / days) * 1000) / 10 : 0
        return [x.department, x.name, x.email, x.present, days, pct].map(escape).join(',')
      }),
    ].join('\n')
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', 'attachment; filename="department-attendance.csv"')
    res.send(csv)
  } catch (e) {
    fail(res, e)
  }
})

export default router
