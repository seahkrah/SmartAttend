import express, { Response } from 'express'
import { authenticateToken } from '../auth/middleware.js'
import {
  resolveTenantContext,
  requireTenant,
  requirePlatform,
  requireRoles,
  type TenantRequest,
} from '../auth/tenantContextMiddleware.js'
import { query } from '../db/connection.js'

const router = express.Router()

/**
 * The original /api/school surface.
 *
 * The product's school administration runs through /api/auth/admin/school/*;
 * this router predates it and is kept because it is a documented API. Every
 * route here now runs the whole chain: an authenticated identity, the tenant
 * resolved from that identity, the school platform, a role, and then the
 * resource looked up inside the tenant.
 *
 * Before this, the router resolved a tenant but asked nothing else. Any
 * signed-in identity on either platform reached it, so a corporate employee
 * could list a school's students; any role could write, so a student could
 * create, edit and unenrol other students; and four routes went through
 * helpers that took an id and nothing more, so a caller holding another
 * school's student or faculty id read that school's timetable, attendance and
 * course assignments, and could assign another school's lecturer to another
 * school's course. Creation inserted rows without a tenant and took the user
 * and department from the body unchecked.
 */
router.use(authenticateToken, resolveTenantContext, requireTenant, requirePlatform('school'))

/** Reading records about other people is staff work. */
const staff = requireRoles('admin', 'faculty')
/** Changing them is the school administrator's. */
const admin = requireRoles('admin')

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function tenantOf(req: TenantRequest): string {
  return req.ctx!.tenantId!
}

function fail(res: Response, label: string, e: unknown) {
  const err = e as { code?: string }
  if (err.code === '23505') return res.status(409).json({ error: 'That value is already in use at your school' })
  if (err.code === '23503') return res.status(409).json({ error: 'This record is referenced by other records' })
  console.error(`[SCHOOL] ${label}:`, e)
  return res.status(500).json({ error: `Failed to ${label}` })
}

/**
 * Ids in the path are resolved inside the tenant before any handler runs.
 * Absent and another school's read the same, so an id cannot be probed.
 */
router.param('studentId', async (req: TenantRequest, res: Response, next, id: string) => {
  try {
    if (!UUID.test(id)) return res.status(404).json({ error: 'Student not found' })
    const r = await query(`SELECT id FROM students WHERE id = $1 AND tenant_id = $2`, [id, tenantOf(req)])
    if (r.rows.length === 0) return res.status(404).json({ error: 'Student not found' })
    next()
  } catch (e) {
    fail(res, 'load student', e)
  }
})

router.param('facultyId', async (req: TenantRequest, res: Response, next, id: string) => {
  try {
    if (!UUID.test(id)) return res.status(404).json({ error: 'Faculty not found' })
    const r = await query(`SELECT id FROM faculty WHERE id = $1 AND tenant_id = $2`, [id, tenantOf(req)])
    if (r.rows.length === 0) return res.status(404).json({ error: 'Faculty not found' })
    next()
  } catch (e) {
    fail(res, 'load faculty member', e)
  }
})

router.param('courseId', async (req: TenantRequest, res: Response, next, id: string) => {
  try {
    if (!UUID.test(id)) return res.status(404).json({ error: 'Course not found' })
    const r = await query(`SELECT id FROM courses WHERE id = $1 AND tenant_id = $2`, [id, tenantOf(req)])
    if (r.rows.length === 0) return res.status(404).json({ error: 'Course not found' })
    next()
  } catch (e) {
    fail(res, 'load course', e)
  }
})

/** A referenced department must be this school's. Null clears it. */
async function departmentInTenant(departmentId: unknown, tenantId: string): Promise<boolean> {
  if (departmentId === null || departmentId === undefined || departmentId === '') return true
  if (!UUID.test(String(departmentId))) return false
  const r = await query(
    `SELECT 1 FROM school_departments WHERE id = $1 AND tenant_id = $2`,
    [departmentId, tenantId]
  )
  return r.rows.length > 0
}

/** The account a record is created for must be a member of this school. */
async function memberOfTenant(userId: unknown, tenantId: string): Promise<boolean> {
  if (!UUID.test(String(userId ?? ''))) return false
  const r = await query(
    `SELECT 1 FROM user_tenant_memberships WHERE user_id = $1 AND tenant_id = $2 AND status = 'active'`,
    [userId, tenantId]
  )
  return r.rows.length > 0
}

function pageOf(req: TenantRequest) {
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 20))
  const offset = Math.max(0, parseInt(req.query.offset as string) || 0)
  return { limit, offset }
}

// ===========================
// STUDENTS
// ===========================

router.get('/students', staff, async (req: TenantRequest, res: Response) => {
  try {
    const { limit, offset } = pageOf(req)
    const departmentId = req.query.departmentId as string | undefined

    let sql =
      'SELECT s.*, u.email AS user_email, u.full_name FROM students s LEFT JOIN users u ON s.user_id = u.id WHERE s.tenant_id = $1'
    const params: any[] = [tenantOf(req)]
    if (departmentId) {
      if (!UUID.test(departmentId)) return res.json({ data: [], total: 0, limit, offset })
      params.push(departmentId)
      sql += ` AND s.department_id = $${params.length}`
    }
    params.push(limit, offset)
    sql += ` ORDER BY s.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`

    const result = await query(sql, params)
    return res.json({ data: result.rows, total: result.rowCount, limit, offset })
  } catch (e) {
    return fail(res, 'load students', e)
  }
})

router.get('/students/:studentId', staff, async (req: TenantRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT s.*, u.email AS user_email, u.full_name
         FROM students s
         LEFT JOIN users u ON u.id = s.user_id
        WHERE s.id = $1 AND s.tenant_id = $2`,
      [req.params.studentId, tenantOf(req)]
    )
    return res.json({ data: result.rows[0] })
  } catch (e) {
    return fail(res, 'load student', e)
  }
})

router.post('/students', admin, async (req: TenantRequest, res: Response) => {
  try {
    const {
      userId, studentId, firstName, lastName, college, email,
      status, enrollmentYear, departmentId, middleName,
    } = req.body ?? {}

    if (!userId || !studentId || !firstName || !lastName || !college || !email || !status || !enrollmentYear) {
      return res.status(400).json({ error: 'Missing required fields' })
    }
    if (!['Freshman', 'Sophomore', 'Junior', 'Senior'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' })
    }

    const tenantId = tenantOf(req)
    // The account and the department are both references, and each is its
    // own way across the boundary if taken on trust.
    if (!(await memberOfTenant(userId, tenantId))) {
      return res.status(404).json({ error: 'No such user in this school' })
    }
    if (!(await departmentInTenant(departmentId, tenantId))) {
      return res.status(404).json({ error: 'No such department in this school' })
    }

    const existing = await query(
      'SELECT id FROM students WHERE student_id = $1 AND tenant_id = $2',
      [studentId, tenantId]
    )
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Student ID already exists' })
    }

    // Tenant and platform come from the resolved context, never the body.
    const result = await query(
      `INSERT INTO students (user_id, student_id, first_name, middle_name, last_name, college, email,
                             status, enrollment_year, department_id, platform_id, tenant_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [userId, studentId, firstName, middleName || null, lastName, college, email, status,
       enrollmentYear, departmentId || null, req.ctx!.platformId, tenantId]
    )

    return res.status(201).json({ message: 'Student created successfully', data: result.rows[0] })
  } catch (e) {
    return fail(res, 'create student', e)
  }
})

router.put('/students/:studentId', admin, async (req: TenantRequest, res: Response) => {
  try {
    const updates = req.body ?? {}
    const validFields = ['first_name', 'middle_name', 'last_name', 'college', 'email', 'status', 'department_id']
    const updateParts: string[] = []
    const values: any[] = []

    for (const [key, value] of Object.entries(updates)) {
      if (validFields.includes(key)) {
        values.push(value)
        updateParts.push(`${key} = $${values.length}`)
      }
    }
    if (updateParts.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' })
    }

    const tenantId = tenantOf(req)
    if ('department_id' in updates && !(await departmentInTenant(updates.department_id, tenantId))) {
      return res.status(404).json({ error: 'No such department in this school' })
    }

    values.push(req.params.studentId, tenantId)
    const result = await query(
      `UPDATE students SET ${updateParts.join(', ')}
        WHERE id = $${values.length - 1} AND tenant_id = $${values.length}
        RETURNING *`,
      values
    )
    return res.json({ message: 'Student updated successfully', data: result.rows[0] })
  } catch (e) {
    return fail(res, 'update student', e)
  }
})

// Unenrols rather than deletes: attendance history must outlive the record.
router.delete('/students/:studentId', admin, async (req: TenantRequest, res: Response) => {
  try {
    const result = await query(
      'UPDATE students SET is_currently_enrolled = false WHERE id = $1 AND tenant_id = $2 RETURNING *',
      [req.params.studentId, tenantOf(req)]
    )
    return res.json({ message: 'Student deleted successfully', data: result.rows[0] })
  } catch (e) {
    return fail(res, 'unenrol student', e)
  }
})

router.get('/students/:studentId/schedules', staff, async (req: TenantRequest, res: Response) => {
  try {
    // Every table in the join is held to the same tenant, so a row that
    // somehow referenced another school's schedule would not surface here.
    const result = await query(
      `SELECT cs.*, c.name AS course_name, c.code AS course_code,
              f.first_name, f.last_name, r.room_number
         FROM student_courses sc
         JOIN class_schedules cs ON cs.id = sc.schedule_id AND cs.tenant_id = sc.tenant_id
         JOIN courses c ON c.id = cs.course_id AND c.tenant_id = sc.tenant_id
         LEFT JOIN faculty f ON f.id = cs.faculty_id AND f.tenant_id = sc.tenant_id
         LEFT JOIN rooms r ON r.id = cs.room_id AND r.tenant_id = sc.tenant_id
        WHERE sc.student_id = $1 AND sc.tenant_id = $2
        ORDER BY cs.day_of_week, cs.start_time`,
      [req.params.studentId, tenantOf(req)]
    )
    return res.json({ data: result.rows })
  } catch (e) {
    return fail(res, 'load schedules', e)
  }
})

router.get('/students/:studentId/attendance', staff, async (req: TenantRequest, res: Response) => {
  try {
    const today = new Date().toISOString().slice(0, 10)
    const yearAgo = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10)
    const startDate = (req.query.startDate as string) || yearAgo
    const endDate = (req.query.endDate as string) || today
    if (!ISO_DATE.test(startDate) || !ISO_DATE.test(endDate)) {
      return res.status(400).json({ error: 'startDate and endDate must be YYYY-MM-DD' })
    }

    const result = await query(
      `SELECT * FROM school_attendance
        WHERE student_id = $1 AND tenant_id = $2
          AND attendance_date BETWEEN $3 AND $4
        ORDER BY attendance_date DESC`,
      [req.params.studentId, tenantOf(req), startDate, endDate]
    )
    return res.json({ data: result.rows })
  } catch (e) {
    return fail(res, 'load attendance', e)
  }
})

// ===========================
// FACULTY
// ===========================

router.get('/faculty', staff, async (req: TenantRequest, res: Response) => {
  try {
    const { limit, offset } = pageOf(req)
    const departmentId = req.query.departmentId as string | undefined

    let sql =
      'SELECT f.*, u.email AS user_email FROM faculty f LEFT JOIN users u ON f.user_id = u.id WHERE f.tenant_id = $1'
    const params: any[] = [tenantOf(req)]
    if (departmentId) {
      if (!UUID.test(departmentId)) return res.json({ data: [], total: 0, limit, offset })
      params.push(departmentId)
      sql += ` AND f.department_id = $${params.length}`
    }
    params.push(limit, offset)
    sql += ` ORDER BY f.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`

    const result = await query(sql, params)
    return res.json({ data: result.rows, total: result.rowCount, limit, offset })
  } catch (e) {
    return fail(res, 'load faculty', e)
  }
})

router.get('/faculty/:facultyId', staff, async (req: TenantRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT f.*, u.email AS user_email, u.full_name
         FROM faculty f
         LEFT JOIN users u ON u.id = f.user_id
        WHERE f.id = $1 AND f.tenant_id = $2`,
      [req.params.facultyId, tenantOf(req)]
    )
    return res.json({ data: result.rows[0] })
  } catch (e) {
    return fail(res, 'load faculty member', e)
  }
})

router.post('/faculty', admin, async (req: TenantRequest, res: Response) => {
  try {
    const {
      userId, employeeId, firstName, lastName, college, email,
      departmentId, specialization, officeLocation, middleName,
    } = req.body ?? {}

    if (!userId || !employeeId || !firstName || !lastName || !college || !email) {
      return res.status(400).json({ error: 'Missing required fields' })
    }

    const tenantId = tenantOf(req)
    if (!(await memberOfTenant(userId, tenantId))) {
      return res.status(404).json({ error: 'No such user in this school' })
    }
    if (!(await departmentInTenant(departmentId, tenantId))) {
      return res.status(404).json({ error: 'No such department in this school' })
    }

    const existing = await query(
      `SELECT id FROM faculty WHERE employee_id = $1 AND tenant_id = $2`,
      [employeeId, tenantId]
    )
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Employee ID already exists' })
    }

    const result = await query(
      `INSERT INTO faculty (user_id, employee_id, first_name, middle_name, last_name, college, email,
                            department_id, specialization, office_location, tenant_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [userId, employeeId, firstName, middleName || null, lastName, college, email,
       departmentId || null, specialization || null, officeLocation || null, tenantId]
    )

    return res.status(201).json({ message: 'Faculty created successfully', data: result.rows[0] })
  } catch (e) {
    return fail(res, 'create faculty member', e)
  }
})

router.put('/faculty/:facultyId', admin, async (req: TenantRequest, res: Response) => {
  try {
    const updates = req.body ?? {}
    const validFields = ['first_name', 'middle_name', 'last_name', 'college', 'email', 'specialization',
                         'office_location', 'office_hours', 'department_id']
    const updateParts: string[] = []
    const values: any[] = []

    for (const [key, value] of Object.entries(updates)) {
      if (validFields.includes(key)) {
        values.push(value)
        updateParts.push(`${key} = $${values.length}`)
      }
    }
    if (updateParts.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' })
    }

    const tenantId = tenantOf(req)
    if ('department_id' in updates && !(await departmentInTenant(updates.department_id, tenantId))) {
      return res.status(404).json({ error: 'No such department in this school' })
    }

    values.push(req.params.facultyId, tenantId)
    const result = await query(
      `UPDATE faculty SET ${updateParts.join(', ')}
        WHERE id = $${values.length - 1} AND tenant_id = $${values.length}
        RETURNING *`,
      values
    )
    return res.json({ message: 'Faculty updated successfully', data: result.rows[0] })
  } catch (e) {
    return fail(res, 'update faculty member', e)
  }
})

router.get('/faculty/:facultyId/courses', staff, async (req: TenantRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT fc.* FROM faculty_courses fc
        WHERE fc.faculty_id = $1 AND fc.tenant_id = $2
        ORDER BY fc.assigned_at DESC`,
      [req.params.facultyId, tenantOf(req)]
    )
    return res.json({ data: result.rows })
  } catch (e) {
    return fail(res, 'load courses', e)
  }
})

// Both ids have been resolved inside the tenant by router.param above, so a
// lecturer can only be paired with a course of the same school.
router.post('/faculty/:facultyId/courses/:courseId', admin, async (req: TenantRequest, res: Response) => {
  try {
    const result = await query(
      `INSERT INTO faculty_courses (faculty_id, course_id, tenant_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (faculty_id, course_id) DO NOTHING
       RETURNING *`,
      [req.params.facultyId, req.params.courseId, tenantOf(req)]
    )
    return res.status(201).json({ message: 'Faculty assigned to course', data: result.rows[0] ?? null })
  } catch (e) {
    return fail(res, 'assign faculty to course', e)
  }
})

export default router
