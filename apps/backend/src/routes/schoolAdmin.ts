import { Router, Response } from 'express'
import { query, getConnection } from '../db/connection.js'
import { hashPassword } from '../auth/authService.js'
import { authenticateToken } from '../auth/middleware.js'
import {
  resolveTenantContext,
  requireTenant,
  requirePlatform,
  requireRoles,
  type ResolvedTenantContext,
  type TenantRequest,
} from '../auth/tenantContextMiddleware.js'
import { TenantScopeError } from '../db/tenantScoped.js'

/**
 * SMS — the school administrator's surface.
 *
 * Lifted out of auth.ts, where it had grown to 1,600 lines of CRUD wearing an
 * authentication router's clothes, and rewritten against the tenancy model.
 *
 * What was wrong with it, in the order it mattered:
 *
 *   1. Every query scoped on users.platform_id. That column identifies the
 *      platform — 'school' — not the school. One predicate covered every
 *      institution in the deployment, so any school administrator listed,
 *      edited and deleted every other school's courses, rooms, schedules and
 *      enrolments.
 *
 *   2. The by-id routes did not scope at all. PATCH, suspend and DELETE on a
 *      student or faculty member confirmed only that the caller administered
 *      *some* school, then acted on whatever id arrived in the path. A guessed
 *      id deleted a stranger's account.
 *
 *   3. It referenced columns that were never created — class_schedules.section,
 *      .days_of_week, .platform_id, rooms.floor, a platform_settings table —
 *      so several of these endpoints could only ever return 500. Migration 031
 *      adds the genuine domain concepts; the platform_id scoping is not
 *      reinstated, because tenant_id is what ownership actually means here.
 *
 *   4. The gate itself, school_entities.admin_user_id, is unset for every
 *      school in the database, so in practice the whole surface answered 403.
 *      Authority now comes from the resolved membership, as everywhere else.
 *
 * Paths are unchanged, so the existing frontend keeps working.
 */

const router = Router()

router.use(
  authenticateToken,
  resolveTenantContext,
  requireTenant,
  requirePlatform('school'),
  requireRoles('admin')
)

type Ctx = ResolvedTenantContext & { tenantId: string }

/** requireTenant has already run, so tenantId is present on every route here. */
function ctxOf(req: TenantRequest): Ctx {
  return req.ctx as Ctx
}

function fail(res: Response, label: string, e: unknown) {
  if (e instanceof TenantScopeError) {
    return res.status(e.status).json({ error: e.message })
  }
  const err = e as { code?: string; constraint?: string; message?: string }

  // A duplicate now means duplicate *within this tenant*: the per-tenant
  // unique indexes let two schools use the same course code or room number.
  if (err.code === '23505') {
    return res.status(409).json({ error: 'That value is already in use at your school' })
  }
  if (err.code === '23502') {
    return res.status(400).json({ error: 'A required field is missing' })
  }
  if (err.code === '23503') {
    return res.status(409).json({
      error: 'This record is still referenced by other records and cannot be removed',
    })
  }
  console.error(`[SCHOOL_ADMIN] ${label}:`, e)
  return res.status(500).json({ error: `Failed to ${label}` })
}

/**
 * Finds a row by id within the caller's tenant.
 *
 * Returns null both for an id that does not exist and for one that belongs to
 * another school, so the two are indistinguishable from outside and an id
 * cannot be probed for existence.
 */
async function ownedRow(table: string, ctx: Ctx, id: string): Promise<any | null> {
  if (!/^[a-z_]+$/.test(table)) throw new TenantScopeError('Unsafe table', 500)
  const r = await query(`SELECT * FROM ${table} WHERE id = $1 AND tenant_id = $2`, [id, ctx.tenantId])
  return r.rows[0] ?? null
}

function notFound(res: Response, what: string) {
  return res.status(404).json({ error: `${what} not found` })
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Rejects a malformed id before it reaches the database as a cast error. */
function badId(res: Response, id: string, what: string): boolean {
  if (UUID.test(id)) return false
  notFound(res, what)
  return true
}

/** Resolves a department by name inside the tenant, creating it if new. */
async function departmentIdByName(
  ctx: Ctx,
  name: string | null | undefined,
  client: { query: typeof query } = { query }
): Promise<string | null> {
  const trimmed = (name ?? '').trim()
  if (!trimmed) return null

  const existing = await client.query(
    `SELECT id FROM school_departments
      WHERE LOWER(name) = LOWER($1) AND tenant_id = $2`,
    [trimmed, ctx.tenantId]
  )
  if (existing.rows.length > 0) return existing.rows[0].id

  const created = await client.query(
    `INSERT INTO school_departments (name, tenant_id, platform_id)
     VALUES ($1, $2, $3) RETURNING id`,
    [trimmed, ctx.tenantId, ctx.platformId]
  )
  return created.rows[0].id
}

/** A role on the school platform, by name. */
async function schoolRoleId(ctx: Ctx, name: string): Promise<string | null> {
  const r = await query(`SELECT id FROM roles WHERE name = $1 AND platform_id = $2`, [
    name,
    ctx.platformId,
  ])
  return r.rows[0]?.id ?? null
}

/**
 * Confirms a user account belongs to the caller's school.
 *
 * Used before touching the users row behind a student or faculty member, so
 * that a shared users table cannot be edited across a tenant boundary.
 */
async function userInTenant(ctx: Ctx, userId: string): Promise<boolean> {
  const r = await query(
    `SELECT 1 FROM school_user_associations WHERE user_id = $1 AND school_entity_id = $2`,
    [userId, ctx.tenantId]
  )
  return r.rows.length > 0
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** Normalises dayOfWeek / daysOfWeek input to a sorted list of 0-6. */
function parseDays(body: any): number[] | null {
  const raw = Array.isArray(body.daysOfWeek)
    ? body.daysOfWeek
    : body.dayOfWeek !== undefined
      ? [body.dayOfWeek]
      : []
  const days: number[] = raw.map((d: unknown) => parseInt(String(d), 10))
  if (days.length === 0) return []
  if (days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) return null
  return [...new Set(days)].sort((a, b) => a - b)
}

// ===========================================================================
// Dashboard
// ===========================================================================

router.get('/admin/school/stats', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)

    const [users, active, approvals, attendance] = await Promise.all([
      query(`SELECT COUNT(*)::int AS n FROM school_user_associations WHERE school_entity_id = $1`, [
        ctx.tenantId,
      ]),
      query(
        `SELECT COUNT(*)::int AS n
           FROM school_user_associations sua
           JOIN users u ON u.id = sua.user_id
          WHERE sua.school_entity_id = $1 AND sua.status = 'active' AND u.is_active = TRUE`,
        [ctx.tenantId]
      ),
      query(
        `SELECT COUNT(*)::int AS n FROM user_registration_requests
          WHERE entity_id = $1 AND status = 'pending'`,
        [ctx.tenantId]
      ),
      query(
        `SELECT COUNT(*) FILTER (WHERE attendance_date = CURRENT_DATE)::int AS today,
                COUNT(*) FILTER (WHERE status IN ('present','late'))::int AS attended,
                COUNT(*)::int AS total
           FROM school_attendance
          WHERE tenant_id = $1 AND attendance_date >= CURRENT_DATE - INTERVAL '30 days'`,
        [ctx.tenantId]
      ),
    ])

    const a = attendance.rows[0]
    return res.json({
      stats: {
        totalUsers: users.rows[0].n,
        activeUsers: active.rows[0].n,
        pendingApprovals: approvals.rows[0].n,
        todayAttendance: a.today,
        attendanceRate: a.total > 0 ? Math.round((a.attended / a.total) * 100) : 0,
      },
      recentActivity: [],
      entity: { id: ctx.tenantId, name: ctx.tenantName },
    })
  } catch (e) {
    return fail(res, 'get stats', e)
  }
})

// ===========================================================================
// Users
// ===========================================================================

router.get('/admin/school/users', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const result = await query(
      `SELECT u.id, u.email, u.full_name, u.phone, u.is_active, u.created_at, u.last_login,
              r.name AS role, sua.status AS association_status
         FROM school_user_associations sua
         JOIN users u ON u.id = sua.user_id
         JOIN roles r ON r.id = u.role_id
        WHERE sua.school_entity_id = $1
        ORDER BY u.created_at DESC`,
      [ctx.tenantId]
    )

    return res.json({
      users: result.rows.map((row: any) => ({
        id: row.id,
        email: row.email,
        fullName: row.full_name,
        phone: row.phone,
        role: row.role,
        isActive: row.is_active,
        status: row.association_status,
        createdAt: row.created_at,
        lastLogin: row.last_login,
      })),
    })
  } catch (e) {
    return fail(res, 'get users', e)
  }
})

router.patch('/admin/school/users/:userId', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const { userId } = req.params
    const { action } = req.body

    if (badId(res, userId, 'User')) return
    if (!(await userInTenant(ctx, userId))) return notFound(res, 'User')

    // An administrator must not be able to lock themselves out, nor to
    // suspend the account they are currently acting as.
    if (userId === ctx.userId && action !== 'activate') {
      return res.status(400).json({ error: 'You cannot deactivate your own account' })
    }

    const states: Record<string, { assoc: string; active: boolean | null }> = {
      activate: { assoc: 'active', active: true },
      suspend: { assoc: 'suspended', active: null },
      disable: { assoc: 'inactive', active: false },
    }
    const next = states[action]
    if (!next) return res.status(400).json({ error: 'Invalid action' })

    await query(
      `UPDATE school_user_associations SET status = $1
        WHERE user_id = $2 AND school_entity_id = $3`,
      [next.assoc, userId, ctx.tenantId]
    )
    if (next.active !== null) {
      await query(`UPDATE users SET is_active = $1 WHERE id = $2`, [next.active, userId])
    }

    return res.json({ message: 'User updated successfully' })
  } catch (e) {
    return fail(res, 'update user', e)
  }
})

router.post('/admin/school/users', async (req: TenantRequest, res: Response) => {
  const client = await getConnection()
  try {
    const ctx = ctxOf(req)
    const { email, fullName, phone, role, password } = req.body

    if (!email || !fullName || !role) {
      return res.status(400).json({ error: 'email, fullName and role are required' })
    }

    // An administrator may staff their own school; they may not mint another
    // administrator, which would let one compromised account widen itself.
    const GRANTABLE = ['student', 'faculty', 'staff']
    if (!GRANTABLE.includes(role)) {
      return res.status(403).json({
        error: `Role must be one of: ${GRANTABLE.join(', ')}`,
      })
    }

    const roleId = await schoolRoleId(ctx, role)
    if (!roleId) return res.status(400).json({ error: 'Invalid role' })

    await client.query('BEGIN')

    // A temporary password, flagged for reset, rather than a shared default.
    const temporary = password || `Tmp-${Math.random().toString(36).slice(2, 10)}A1!`
    const hashed = await hashPassword(temporary)

    const user = await client.query(
      `INSERT INTO users (email, full_name, phone, platform_id, role_id, is_active,
                          password_hash, must_reset_password)
       VALUES ($1, $2, $3, $4, $5, TRUE, $6, TRUE) RETURNING id`,
      [email, fullName, phone || null, ctx.platformId, roleId, hashed]
    )

    await client.query(
      `INSERT INTO school_user_associations (user_id, school_entity_id, status)
       VALUES ($1, $2, 'active')`,
      [user.rows[0].id, ctx.tenantId]
    )

    await client.query('COMMIT')
    return res.status(201).json({
      message: 'User created. They must change their password on first login.',
      userId: user.rows[0].id,
      temporaryPassword: password ? undefined : temporary,
    })
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    return fail(res, 'create user', e)
  } finally {
    client.release()
  }
})

// ===========================================================================
// Students
// ===========================================================================

router.get('/admin/school/students', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const result = await query(
      `SELECT s.*, u.email AS account_email, u.full_name, u.is_active,
              sd.name AS department_name
         FROM students s
         JOIN users u ON u.id = s.user_id
         LEFT JOIN school_departments sd ON sd.id = s.department_id
        WHERE s.tenant_id = $1
        ORDER BY s.created_at DESC`,
      [ctx.tenantId]
    )
    return res.json({
      students: result.rows.map((s: any) => ({ ...s, department: s.department_name ?? null })),
    })
  } catch (e) {
    return fail(res, 'load students', e)
  }
})

router.post('/admin/school/students', async (req: TenantRequest, res: Response) => {
  const client = await getConnection()
  try {
    const ctx = ctxOf(req)
    const {
      studentId, firstName, middleName, lastName, email, phone, address,
      college, department, status, gender, profilePhoto, enrollmentYear,
    } = req.body

    if (!studentId || !firstName || !lastName || !email) {
      return res
        .status(400)
        .json({ error: 'studentId, firstName, lastName and email are required' })
    }

    const roleId = await schoolRoleId(ctx, 'student')
    if (!roleId) return res.status(500).json({ error: 'The student role is not configured' })

    await client.query('BEGIN')

    const departmentId = await departmentIdByName(ctx, department, client as any)

    const temporary = `Tmp-${Math.random().toString(36).slice(2, 10)}A1!`
    const hashed = await hashPassword(temporary)
    const fullName = middleName
      ? `${firstName} ${middleName} ${lastName}`
      : `${firstName} ${lastName}`

    const user = await client.query(
      `INSERT INTO users (email, full_name, phone, platform_id, role_id, is_active,
                          password_hash, must_reset_password)
       VALUES ($1, $2, $3, $4, $5, TRUE, $6, TRUE) RETURNING id`,
      [email, fullName, phone || null, ctx.platformId, roleId, hashed]
    )

    // tenant_id comes from the resolved context, never from the request body,
    // so a crafted payload cannot plant a student in another school.
    const student = await client.query(
      `INSERT INTO students (user_id, student_id, first_name, middle_name, last_name, email,
                             phone, address, college, department_id, status, gender,
                             profile_photo_url, enrollment_year, platform_id, tenant_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
      [
        user.rows[0].id, studentId, firstName, middleName || null, lastName, email,
        phone || null, address || null, college || '', departmentId, status || 'freshman',
        gender || null, profilePhoto || null,
        Number.isInteger(enrollmentYear) ? enrollmentYear : new Date().getFullYear(),
        ctx.platformId, ctx.tenantId,
      ]
    )

    await client.query(
      `INSERT INTO school_user_associations (user_id, school_entity_id, status)
       VALUES ($1, $2, 'active')`,
      [user.rows[0].id, ctx.tenantId]
    )

    await client.query('COMMIT')
    return res.status(201).json({
      message: 'Student created. They must change their password on first login.',
      studentId: student.rows[0].id,
      temporaryPassword: temporary,
    })
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    return fail(res, 'create student', e)
  } finally {
    client.release()
  }
})

router.patch('/admin/school/students/:id', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const { id } = req.params
    const u = req.body

    if (badId(res, id, 'Student')) return
    const existing = await ownedRow('students', ctx, id)
    if (!existing) return notFound(res, 'Student')

    const fields: string[] = []
    const values: any[] = []
    const set = (col: string, v: unknown) => {
      fields.push(`${col} = $${fields.length + 1}`)
      values.push(v)
    }

    if (u.studentId?.trim()) {
      // Student numbers are unique per school, so the check is scoped too:
      // another school using the same number is not a conflict.
      const dup = await query(
        `SELECT id FROM students WHERE student_id = $1 AND tenant_id = $2 AND id <> $3`,
        [u.studentId.trim(), ctx.tenantId, id]
      )
      if (dup.rows.length > 0) {
        return res.status(409).json({ error: 'A student with this ID already exists' })
      }
      set('student_id', u.studentId.trim())
    }
    if (u.firstName) set('first_name', u.firstName)
    if (u.middleName !== undefined) set('middle_name', u.middleName || null)
    if (u.lastName) set('last_name', u.lastName)
    if (u.phone !== undefined) set('phone', u.phone || null)
    if (u.address !== undefined) set('address', u.address || null)
    if (u.college !== undefined) set('college', u.college || '')
    if (u.status) set('status', u.status)
    if (u.gender !== undefined) set('gender', u.gender || null)
    if (u.profilePhoto) set('profile_photo_url', u.profilePhoto)
    if (u.department !== undefined) {
      set('department_id', await departmentIdByName(ctx, u.department))
    }

    if (fields.length > 0) {
      values.push(id, ctx.tenantId)
      await query(
        `UPDATE students SET ${fields.join(', ')}
          WHERE id = $${values.length - 1} AND tenant_id = $${values.length}`,
        values
      )
    }

    if (u.firstName || u.lastName || u.middleName !== undefined) {
      const fn = u.firstName || existing.first_name
      const mn = u.middleName !== undefined ? u.middleName : existing.middle_name
      const ln = u.lastName || existing.last_name
      await query(`UPDATE users SET full_name = $1 WHERE id = $2`, [
        mn ? `${fn} ${mn} ${ln}` : `${fn} ${ln}`,
        existing.user_id,
      ])
    }
    if (u.phone !== undefined) {
      await query(`UPDATE users SET phone = $1 WHERE id = $2`, [u.phone || null, existing.user_id])
    }

    return res.json({ message: 'Student updated successfully' })
  } catch (e) {
    return fail(res, 'update student', e)
  }
})

router.patch('/admin/school/students/:id/suspend', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const { id } = req.params
    const { suspended } = req.body

    if (badId(res, id, 'Student')) return
    const student = await ownedRow('students', ctx, id)
    if (!student) return notFound(res, 'Student')

    await query(`UPDATE users SET is_active = $1 WHERE id = $2`, [!suspended, student.user_id])
    await query(
      `UPDATE school_user_associations SET status = $1
        WHERE user_id = $2 AND school_entity_id = $3`,
      [suspended ? 'suspended' : 'active', student.user_id, ctx.tenantId]
    )

    return res.json({
      message: suspended ? 'Student suspended successfully' : 'Student reactivated successfully',
    })
  } catch (e) {
    return fail(res, 'update student status', e)
  }
})

router.delete('/admin/school/students/:id', async (req: TenantRequest, res: Response) => {
  const client = await getConnection()
  try {
    const ctx = ctxOf(req)
    const { id } = req.params

    if (badId(res, id, 'Student')) return
    const student = await ownedRow('students', ctx, id)
    if (!student) return notFound(res, 'Student')

    await client.query('BEGIN')
    // Enrolments go first; attendance is deliberately not deleted, because the
    // audit trail must survive the record it describes. A student with
    // attendance history therefore cannot be removed, only deactivated.
    await client.query(`DELETE FROM student_courses WHERE student_id = $1 AND tenant_id = $2`, [
      id,
      ctx.tenantId,
    ])
    await client.query(`DELETE FROM students WHERE id = $1 AND tenant_id = $2`, [id, ctx.tenantId])
    await client.query(
      `DELETE FROM school_user_associations WHERE user_id = $1 AND school_entity_id = $2`,
      [student.user_id, ctx.tenantId]
    )
    await client.query(`UPDATE users SET is_active = FALSE WHERE id = $1`, [student.user_id])
    await client.query('COMMIT')

    return res.json({ message: 'Student deleted successfully' })
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    return fail(res, 'delete student', e)
  } finally {
    client.release()
  }
})

// ===========================================================================
// Faculty
// ===========================================================================

router.get('/admin/school/faculty', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const result = await query(
      `SELECT f.*, f.employee_id AS faculty_id, u.email AS account_email, u.full_name,
              u.is_active, u.phone, sd.name AS department_name
         FROM faculty f
         JOIN users u ON u.id = f.user_id
         LEFT JOIN school_departments sd ON sd.id = f.department_id
        WHERE f.tenant_id = $1
        ORDER BY f.created_at DESC`,
      [ctx.tenantId]
    )
    return res.json({
      faculty: result.rows.map((f: any) => ({ ...f, department: f.department_name ?? null })),
    })
  } catch (e) {
    return fail(res, 'load faculty members', e)
  }
})

router.post('/admin/school/faculty', async (req: TenantRequest, res: Response) => {
  const client = await getConnection()
  try {
    const ctx = ctxOf(req)
    const {
      facultyId, title, firstName, middleName, lastName, email,
      phone, address, college, department, gender,
    } = req.body

    if (!facultyId || !firstName || !lastName || !email) {
      return res
        .status(400)
        .json({ error: 'facultyId, firstName, lastName and email are required' })
    }

    const roleId = await schoolRoleId(ctx, 'faculty')
    if (!roleId) return res.status(500).json({ error: 'The faculty role is not configured' })

    await client.query('BEGIN')

    const departmentId = await departmentIdByName(ctx, department, client as any)
    const temporary = `Tmp-${Math.random().toString(36).slice(2, 10)}A1!`
    const hashed = await hashPassword(temporary)
    const fullName = middleName
      ? `${firstName} ${middleName} ${lastName}`
      : `${firstName} ${lastName}`

    const user = await client.query(
      `INSERT INTO users (email, full_name, phone, platform_id, role_id, is_active,
                          password_hash, must_reset_password)
       VALUES ($1, $2, $3, $4, $5, TRUE, $6, TRUE) RETURNING id`,
      [email, fullName, phone || null, ctx.platformId, roleId, hashed]
    )

    const faculty = await client.query(
      `INSERT INTO faculty (user_id, employee_id, first_name, middle_name, last_name,
                            college, email, department_id, gender, title, address, tenant_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [
        user.rows[0].id, facultyId, firstName, middleName || null, lastName,
        college || '', email, departmentId, gender || null, title || null,
        address || null, ctx.tenantId,
      ]
    )

    await client.query(
      `INSERT INTO school_user_associations (school_entity_id, user_id, status)
       VALUES ($1, $2, 'active')`,
      [ctx.tenantId, user.rows[0].id]
    )

    await client.query('COMMIT')
    return res.status(201).json({
      message: 'Faculty member created. They must change their password on first login.',
      facultyId: faculty.rows[0].id,
      temporaryPassword: temporary,
    })
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    return fail(res, 'create faculty member', e)
  } finally {
    client.release()
  }
})

router.patch('/admin/school/faculty/:id', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const { id } = req.params
    const u = req.body

    if (badId(res, id, 'Faculty member')) return
    const existing = await ownedRow('faculty', ctx, id)
    if (!existing) return notFound(res, 'Faculty member')

    const fields: string[] = []
    const values: any[] = []
    const set = (col: string, v: unknown) => {
      fields.push(`${col} = $${fields.length + 1}`)
      values.push(v)
    }

    if (u.facultyId?.trim()) {
      const dup = await query(
        `SELECT id FROM faculty WHERE employee_id = $1 AND tenant_id = $2 AND id <> $3`,
        [u.facultyId.trim(), ctx.tenantId, id]
      )
      if (dup.rows.length > 0) {
        return res.status(409).json({ error: 'A faculty member with this ID already exists' })
      }
      set('employee_id', u.facultyId.trim())
    }
    if (u.firstName) set('first_name', u.firstName)
    if (u.middleName !== undefined) set('middle_name', u.middleName || null)
    if (u.lastName) set('last_name', u.lastName)
    if (u.college !== undefined) set('college', u.college || '')
    if (u.gender !== undefined) set('gender', u.gender || null)
    if (u.title !== undefined) set('title', u.title || null)
    if (u.address !== undefined) set('address', u.address || null)
    if (u.department !== undefined) {
      set('department_id', await departmentIdByName(ctx, u.department))
    }

    if (fields.length > 0) {
      values.push(id, ctx.tenantId)
      await query(
        `UPDATE faculty SET ${fields.join(', ')}
          WHERE id = $${values.length - 1} AND tenant_id = $${values.length}`,
        values
      )
    }

    if (u.firstName || u.lastName || u.middleName !== undefined) {
      const fn = u.firstName || existing.first_name
      const mn = u.middleName !== undefined ? u.middleName : existing.middle_name
      const ln = u.lastName || existing.last_name
      await query(`UPDATE users SET full_name = $1 WHERE id = $2`, [
        mn ? `${fn} ${mn} ${ln}` : `${fn} ${ln}`,
        existing.user_id,
      ])
    }
    if (u.phone !== undefined) {
      await query(`UPDATE users SET phone = $1 WHERE id = $2`, [u.phone || null, existing.user_id])
    }

    return res.json({ message: 'Faculty updated successfully' })
  } catch (e) {
    return fail(res, 'update faculty member', e)
  }
})

router.patch('/admin/school/faculty/:id/suspend', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const { id } = req.params
    const { suspended } = req.body

    if (badId(res, id, 'Faculty member')) return
    const faculty = await ownedRow('faculty', ctx, id)
    if (!faculty) return notFound(res, 'Faculty member')

    await query(`UPDATE users SET is_active = $1 WHERE id = $2`, [!suspended, faculty.user_id])
    await query(
      `UPDATE school_user_associations SET status = $1
        WHERE user_id = $2 AND school_entity_id = $3`,
      [suspended ? 'suspended' : 'active', faculty.user_id, ctx.tenantId]
    )

    return res.json({
      message: suspended
        ? 'Faculty member suspended successfully'
        : 'Faculty member reactivated successfully',
    })
  } catch (e) {
    return fail(res, 'update faculty status', e)
  }
})

router.delete('/admin/school/faculty/:id', async (req: TenantRequest, res: Response) => {
  const client = await getConnection()
  try {
    const ctx = ctxOf(req)
    const { id } = req.params

    if (badId(res, id, 'Faculty member')) return
    const faculty = await ownedRow('faculty', ctx, id)
    if (!faculty) return notFound(res, 'Faculty member')

    // A lecturer still teaching is not removable: the schedule would lose its
    // owner and the attendance behind it its author.
    const teaching = await query(
      `SELECT COUNT(*)::int AS n FROM class_schedules WHERE faculty_id = $1 AND tenant_id = $2`,
      [id, ctx.tenantId]
    )
    if (teaching.rows[0].n > 0) {
      return res.status(409).json({
        error:
          'This faculty member is assigned to class schedules. Reassign or delete those first.',
      })
    }

    await client.query('BEGIN')
    await client.query(`DELETE FROM faculty_courses WHERE faculty_id = $1 AND tenant_id = $2`, [
      id,
      ctx.tenantId,
    ])
    await client.query(`DELETE FROM faculty WHERE id = $1 AND tenant_id = $2`, [id, ctx.tenantId])
    await client.query(
      `DELETE FROM school_user_associations WHERE user_id = $1 AND school_entity_id = $2`,
      [faculty.user_id, ctx.tenantId]
    )
    await client.query(`UPDATE users SET is_active = FALSE WHERE id = $1`, [faculty.user_id])
    await client.query('COMMIT')

    return res.json({ message: 'Faculty member deleted successfully' })
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    return fail(res, 'delete faculty member', e)
  } finally {
    client.release()
  }
})

// ===========================================================================
// Courses
// ===========================================================================

router.get('/admin/school/courses', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const result = await query(
      `SELECT c.*, sd.name AS department_name
         FROM courses c
         LEFT JOIN school_departments sd ON sd.id = c.department_id
        WHERE c.tenant_id = $1
        ORDER BY c.created_at DESC`,
      [ctx.tenantId]
    )
    return res.json({ courses: result.rows })
  } catch (e) {
    return fail(res, 'load courses', e)
  }
})

router.post('/admin/school/courses', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const { code, name, description, credits, department } = req.body
    if (!code || !name) return res.status(400).json({ error: 'code and name are required' })

    // courses.department_id is NOT NULL, so a course without a department is
    // a bad request rather than something to discover as a constraint
    // violation at insert time.
    const departmentId = await departmentIdByName(ctx, department)
    if (!departmentId) {
      return res.status(400).json({ error: 'department is required' })
    }
    const created = await query(
      `INSERT INTO courses (code, name, description, credits, department_id, tenant_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        code, name, description || null,
        credits ? parseInt(String(credits), 10) : null,
        departmentId, ctx.tenantId,
      ]
    )
    return res.status(201).json({ message: 'Course created successfully', courseId: created.rows[0].id })
  } catch (e) {
    return fail(res, 'create course', e)
  }
})

router.patch('/admin/school/courses/:id', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const { id } = req.params
    const { code, name, description, credits, department } = req.body

    if (badId(res, id, 'Course')) return
    if (!(await ownedRow('courses', ctx, id))) return notFound(res, 'Course')

    const fields: string[] = []
    const values: any[] = []
    const set = (col: string, v: unknown) => {
      fields.push(`${col} = $${fields.length + 1}`)
      values.push(v)
    }

    if (code !== undefined) set('code', code)
    if (name !== undefined) set('name', name)
    if (description !== undefined) set('description', description)
    if (credits !== undefined) set('credits', credits ? parseInt(String(credits), 10) : null)
    if (department !== undefined) set('department_id', await departmentIdByName(ctx, department))

    if (fields.length === 0) return res.json({ message: 'Nothing to update' })

    values.push(id, ctx.tenantId)
    await query(
      `UPDATE courses SET ${fields.join(', ')}
        WHERE id = $${values.length - 1} AND tenant_id = $${values.length}`,
      values
    )
    return res.json({ message: 'Course updated successfully' })
  } catch (e) {
    return fail(res, 'update course', e)
  }
})

router.delete('/admin/school/courses/:id', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const { id } = req.params

    if (badId(res, id, 'Course')) return
    const deleted = await query(`DELETE FROM courses WHERE id = $1 AND tenant_id = $2 RETURNING id`, [
      id,
      ctx.tenantId,
    ])
    if (deleted.rows.length === 0) return notFound(res, 'Course')
    return res.json({ message: 'Course deleted successfully' })
  } catch (e) {
    return fail(res, 'delete course', e)
  }
})

// ===========================================================================
// Rooms
// ===========================================================================

router.get('/admin/school/rooms', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const result = await query(
      `SELECT * FROM rooms WHERE tenant_id = $1 ORDER BY building, room_number`,
      [ctx.tenantId]
    )
    return res.json({ rooms: result.rows })
  } catch (e) {
    return fail(res, 'load rooms', e)
  }
})

router.post('/admin/school/rooms', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const { building, roomNumber, capacity, floor, roomType } = req.body
    if (!roomNumber) return res.status(400).json({ error: 'roomNumber is required' })

    const created = await query(
      `INSERT INTO rooms (building, room_number, capacity, floor, room_type, tenant_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        building || null, roomNumber,
        capacity ? parseInt(String(capacity), 10) : null,
        floor !== undefined && floor !== null && floor !== '' ? parseInt(String(floor), 10) : null,
        roomType || null, ctx.tenantId,
      ]
    )
    return res.status(201).json({ message: 'Room created successfully', roomId: created.rows[0].id })
  } catch (e) {
    return fail(res, 'create room', e)
  }
})

router.patch('/admin/school/rooms/:id', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const { id } = req.params
    const { building, roomNumber, capacity, floor, roomType } = req.body

    if (badId(res, id, 'Room')) return
    if (!(await ownedRow('rooms', ctx, id))) return notFound(res, 'Room')

    const fields: string[] = []
    const values: any[] = []
    const set = (col: string, v: unknown) => {
      fields.push(`${col} = $${fields.length + 1}`)
      values.push(v)
    }

    if (building !== undefined) set('building', building)
    if (roomNumber !== undefined) set('room_number', roomNumber)
    if (capacity !== undefined) set('capacity', capacity ? parseInt(String(capacity), 10) : null)
    if (floor !== undefined) set('floor', floor === null || floor === '' ? null : parseInt(String(floor), 10))
    if (roomType !== undefined) set('room_type', roomType)

    if (fields.length === 0) return res.json({ message: 'Nothing to update' })

    values.push(id, ctx.tenantId)
    await query(
      `UPDATE rooms SET ${fields.join(', ')}
        WHERE id = $${values.length - 1} AND tenant_id = $${values.length}`,
      values
    )
    return res.json({ message: 'Room updated successfully' })
  } catch (e) {
    return fail(res, 'update room', e)
  }
})

router.delete('/admin/school/rooms/:id', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const { id } = req.params

    if (badId(res, id, 'Room')) return
    const deleted = await query(`DELETE FROM rooms WHERE id = $1 AND tenant_id = $2 RETURNING id`, [
      id,
      ctx.tenantId,
    ])
    if (deleted.rows.length === 0) return notFound(res, 'Room')
    return res.json({ message: 'Room deleted successfully' })
  } catch (e) {
    return fail(res, 'delete room', e)
  }
})

// ===========================================================================
// Schedules
// ===========================================================================

router.get('/admin/school/schedules', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const result = await query(
      `SELECT cs.id, cs.course_id, cs.faculty_id, cs.room_id, cs.day_of_week, cs.days_of_week,
              cs.start_time, cs.end_time, cs.section,
              c.name AS course_name, c.code AS course_code,
              r.building, r.room_number,
              CONCAT(f.first_name, ' ', COALESCE(f.middle_name || ' ', ''), f.last_name) AS faculty_name,
              (SELECT COUNT(*)::int FROM student_courses sc
                WHERE sc.schedule_id = cs.id AND sc.status = 'enrolled') AS student_count
         FROM class_schedules cs
         JOIN courses c ON c.id = cs.course_id
         LEFT JOIN rooms r ON r.id = cs.room_id
         LEFT JOIN faculty f ON f.id = cs.faculty_id
        WHERE cs.tenant_id = $1
        ORDER BY c.code, cs.section`,
      [ctx.tenantId]
    )
    return res.json({ schedules: result.rows })
  } catch (e) {
    return fail(res, 'load schedules', e)
  }
})

/**
 * Finds a clash for a faculty member or a room.
 *
 * Both the times and the days must overlap, and only schedules in the caller's
 * own tenant are considered — another school's timetable is neither visible
 * here nor a reason to refuse.
 */
async function findClash(
  ctx: Ctx,
  column: 'faculty_id' | 'room_id',
  value: string,
  days: number[],
  startTime: string,
  endTime: string,
  excludeScheduleId: string | null
): Promise<{ course_code: string; overlap: number[]; start_time: string; end_time: string } | null> {
  const rows = await query(
    `SELECT cs.days_of_week, cs.day_of_week, cs.start_time, cs.end_time, c.code AS course_code
       FROM class_schedules cs
       JOIN courses c ON c.id = cs.course_id
      WHERE cs.${column} = $1
        AND cs.tenant_id = $2
        AND cs.start_time < $3 AND cs.end_time > $4
        AND ($5::uuid IS NULL OR cs.id <> $5::uuid)`,
    [value, ctx.tenantId, endTime, startTime, excludeScheduleId]
  )

  for (const row of rows.rows) {
    const existing: number[] = row.days_of_week
      ? String(row.days_of_week).split(',').map((d: string) => parseInt(d.trim(), 10))
      : [row.day_of_week]
    const overlap = days.filter((d) => existing.includes(d))
    if (overlap.length > 0) {
      return {
        course_code: row.course_code,
        overlap,
        start_time: row.start_time,
        end_time: row.end_time,
      }
    }
  }
  return null
}

function clashMessage(
  what: 'Faculty' | 'Room',
  clash: { course_code: string; overlap: number[]; start_time: string; end_time: string }
): string {
  const when = clash.overlap.map((d) => DAY_NAMES[d]).join(', ')
  return what === 'Faculty'
    ? `This faculty member already teaches ${clash.course_code} on ${when} at ${clash.start_time}–${clash.end_time}.`
    : `This room is already booked for ${clash.course_code} on ${when} at ${clash.start_time}–${clash.end_time}.`
}

router.post('/admin/school/schedules', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const { courseId, facultyId, roomId, startTime, endTime } = req.body

    const days = parseDays(req.body)
    if (days === null) return res.status(400).json({ error: 'Days must be numbers from 0 to 6' })
    if (!courseId || !facultyId || !roomId || days.length === 0 || !startTime || !endTime) {
      return res.status(400).json({
        error: 'courseId, facultyId, roomId, at least one day, startTime and endTime are required',
      })
    }
    if (startTime >= endTime) {
      return res.status(400).json({ error: 'The end time must be after the start time' })
    }

    // Each referenced id is its own chance to reach across a tenant boundary,
    // so each is confirmed to belong to this school before it is stored.
    for (const [table, id, label] of [
      ['courses', courseId, 'Course'],
      ['faculty', facultyId, 'Faculty member'],
      ['rooms', roomId, 'Room'],
    ] as const) {
      if (badId(res, String(id), label)) return
      if (!(await ownedRow(table, ctx, String(id)))) return notFound(res, label)
    }

    const facultyClash = await findClash(ctx, 'faculty_id', facultyId, days, startTime, endTime, null)
    if (facultyClash) return res.status(409).json({ error: clashMessage('Faculty', facultyClash) })

    const roomClash = await findClash(ctx, 'room_id', roomId, days, startTime, endTime, null)
    if (roomClash) return res.status(409).json({ error: clashMessage('Room', roomClash) })

    const section = await query(
      `SELECT COALESCE(MAX(section), 0) + 1 AS next FROM class_schedules
        WHERE course_id = $1 AND tenant_id = $2`,
      [courseId, ctx.tenantId]
    )

    // day_of_week is kept in step by a trigger, so the two never disagree.
    const created = await query(
      `INSERT INTO class_schedules (course_id, faculty_id, room_id, day_of_week, days_of_week,
                                    start_time, end_time, section, tenant_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, section`,
      [
        courseId, facultyId, roomId, days[0], days.join(','),
        startTime, endTime, section.rows[0].next, ctx.tenantId,
      ]
    )

    return res.status(201).json({
      message: `Schedule created for ${days.length} day(s)`,
      scheduleId: created.rows[0].id,
      section: created.rows[0].section,
    })
  } catch (e) {
    return fail(res, 'create schedule', e)
  }
})

router.patch('/admin/school/schedules/:id', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const { id } = req.params
    const { courseId, facultyId, roomId, startTime, endTime } = req.body

    if (badId(res, id, 'Schedule')) return
    const existing = await ownedRow('class_schedules', ctx, id)
    if (!existing) return notFound(res, 'Schedule')

    const requestedDays = parseDays(req.body)
    if (requestedDays === null) {
      return res.status(400).json({ error: 'Days must be numbers from 0 to 6' })
    }

    for (const [table, value, label] of [
      ['courses', courseId, 'Course'],
      ['faculty', facultyId, 'Faculty member'],
      ['rooms', roomId, 'Room'],
    ] as const) {
      if (value === undefined) continue
      if (badId(res, String(value), label)) return
      if (!(await ownedRow(table, ctx, String(value)))) return notFound(res, label)
    }

    const effFaculty = facultyId ?? existing.faculty_id
    const effRoom = roomId ?? existing.room_id
    const effStart = startTime ?? existing.start_time
    const effEnd = endTime ?? existing.end_time
    const effDays =
      requestedDays.length > 0
        ? requestedDays
        : existing.days_of_week
          ? String(existing.days_of_week).split(',').map((d: string) => parseInt(d.trim(), 10))
          : [existing.day_of_week]

    if (effStart >= effEnd) {
      return res.status(400).json({ error: 'The end time must be after the start time' })
    }

    const facultyClash = await findClash(ctx, 'faculty_id', effFaculty, effDays, effStart, effEnd, id)
    if (facultyClash) return res.status(409).json({ error: clashMessage('Faculty', facultyClash) })

    const roomClash = await findClash(ctx, 'room_id', effRoom, effDays, effStart, effEnd, id)
    if (roomClash) return res.status(409).json({ error: clashMessage('Room', roomClash) })

    const fields: string[] = []
    const values: any[] = []
    const set = (col: string, v: unknown) => {
      fields.push(`${col} = $${fields.length + 1}`)
      values.push(v)
    }

    if (courseId !== undefined) set('course_id', courseId)
    if (facultyId !== undefined) set('faculty_id', facultyId)
    if (roomId !== undefined) set('room_id', roomId)
    if (requestedDays.length > 0) {
      set('day_of_week', requestedDays[0])
      set('days_of_week', requestedDays.join(','))
    }
    if (startTime !== undefined) set('start_time', startTime)
    if (endTime !== undefined) set('end_time', endTime)

    if (fields.length === 0) return res.json({ message: 'Nothing to update' })

    values.push(id, ctx.tenantId)
    await query(
      `UPDATE class_schedules SET ${fields.join(', ')}
        WHERE id = $${values.length - 1} AND tenant_id = $${values.length}`,
      values
    )
    return res.json({ message: 'Schedule updated successfully' })
  } catch (e) {
    return fail(res, 'update schedule', e)
  }
})

router.delete('/admin/school/schedules/:id', async (req: TenantRequest, res: Response) => {
  const client = await getConnection()
  try {
    const ctx = ctxOf(req)
    const { id } = req.params

    if (badId(res, id, 'Schedule')) return
    if (!(await ownedRow('class_schedules', ctx, id))) return notFound(res, 'Schedule')

    await client.query('BEGIN')
    await client.query(`DELETE FROM student_courses WHERE schedule_id = $1 AND tenant_id = $2`, [
      id,
      ctx.tenantId,
    ])
    await client.query(`DELETE FROM class_schedules WHERE id = $1 AND tenant_id = $2`, [
      id,
      ctx.tenantId,
    ])
    await client.query('COMMIT')

    return res.json({ message: 'Schedule deleted successfully' })
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    return fail(res, 'delete schedule', e)
  } finally {
    client.release()
  }
})

// ===========================================================================
// Enrolments
// ===========================================================================

router.get('/admin/school/enrollments', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const result = await query(
      `SELECT sc.*, s.first_name, s.middle_name, s.last_name, s.student_id AS student_code,
              c.name AS course_name, c.code AS course_code,
              cs.day_of_week, cs.days_of_week, cs.start_time, cs.end_time, cs.section,
              r.building, r.room_number,
              CONCAT(f.first_name, ' ', COALESCE(f.middle_name || ' ', ''), f.last_name) AS faculty_name
         FROM student_courses sc
         JOIN students s ON s.id = sc.student_id
         JOIN class_schedules cs ON cs.id = sc.schedule_id
         JOIN courses c ON c.id = cs.course_id
         LEFT JOIN rooms r ON r.id = cs.room_id
         LEFT JOIN faculty f ON f.id = cs.faculty_id
        WHERE sc.tenant_id = $1
        ORDER BY c.code, cs.section, s.last_name, s.first_name`,
      [ctx.tenantId]
    )
    return res.json({ enrollments: result.rows })
  } catch (e) {
    return fail(res, 'get enrollments', e)
  }
})

router.post('/admin/school/enrollments', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const { studentId, scheduleId } = req.body
    if (!studentId || !scheduleId) {
      return res.status(400).json({ error: 'studentId and scheduleId are required' })
    }
    if (badId(res, String(studentId), 'Student')) return
    if (badId(res, String(scheduleId), 'Schedule')) return

    // Both sides must be this school's. Without this, a schedule id from one
    // school and a student id from another enrol a stranger into your class.
    if (!(await ownedRow('students', ctx, String(studentId)))) return notFound(res, 'Student')
    const schedule = await ownedRow('class_schedules', ctx, String(scheduleId))
    if (!schedule) return notFound(res, 'Schedule')

    const course = await query(
      `SELECT c.id, c.code, c.name FROM courses c WHERE c.id = $1 AND c.tenant_id = $2`,
      [schedule.course_id, ctx.tenantId]
    )
    if (course.rows.length === 0) return notFound(res, 'Course')

    // One section of a course per student.
    const duplicate = await query(
      `SELECT cs.section FROM student_courses sc
         JOIN class_schedules cs ON cs.id = sc.schedule_id
        WHERE sc.student_id = $1 AND cs.course_id = $2 AND sc.tenant_id = $3
          AND sc.status = 'enrolled'`,
      [studentId, schedule.course_id, ctx.tenantId]
    )
    if (duplicate.rows.length > 0) {
      return res.status(409).json({
        error: `This student is already enrolled in ${course.rows[0].code} (${course.rows[0].name}) – section ${duplicate.rows[0].section}`,
      })
    }

    const created = await query(
      `INSERT INTO student_courses (student_id, schedule_id, status, tenant_id)
       VALUES ($1, $2, 'enrolled', $3)
       ON CONFLICT (schedule_id, student_id)
       DO UPDATE SET status = 'enrolled', enrolled_at = CURRENT_TIMESTAMP
       RETURNING id`,
      [studentId, scheduleId, ctx.tenantId]
    )

    return res
      .status(201)
      .json({ message: 'Student enrolled successfully', enrollmentId: created.rows[0].id })
  } catch (e) {
    return fail(res, 'enroll student', e)
  }
})

router.delete('/admin/school/enrollments/:id', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const { id } = req.params

    if (badId(res, id, 'Enrollment')) return
    const deleted = await query(
      `DELETE FROM student_courses WHERE id = $1 AND tenant_id = $2 RETURNING id`,
      [id, ctx.tenantId]
    )
    if (deleted.rows.length === 0) return notFound(res, 'Enrollment')
    return res.json({ message: 'Enrollment removed successfully' })
  } catch (e) {
    return fail(res, 'remove enrollment', e)
  }
})

// ===========================================================================
// Attendance overview and reports
// ===========================================================================

router.get('/admin/school/attendance/overview', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const result = await query(
      `SELECT cs.id AS schedule_id,
              c.name AS course_name, c.code AS course_code,
              cs.section, cs.days_of_week, cs.day_of_week, cs.start_time, cs.end_time,
              CONCAT(f.first_name, ' ', f.last_name) AS faculty_name,
              (SELECT COUNT(*)::int FROM student_courses sc
                WHERE sc.schedule_id = cs.id AND sc.status = 'enrolled') AS enrolled_count,
              (SELECT COUNT(DISTINCT sa.attendance_date)::int FROM school_attendance sa
                WHERE sa.schedule_id = cs.id AND sa.tenant_id = $1) AS sessions_taken,
              (SELECT COUNT(*)::int FROM school_attendance sa
                WHERE sa.schedule_id = cs.id AND sa.tenant_id = $1 AND sa.status = 'present') AS total_present,
              (SELECT COUNT(*)::int FROM school_attendance sa
                WHERE sa.schedule_id = cs.id AND sa.tenant_id = $1 AND sa.status = 'absent') AS total_absent,
              (SELECT COUNT(*)::int FROM school_attendance sa
                WHERE sa.schedule_id = cs.id AND sa.tenant_id = $1 AND sa.status = 'late') AS total_late,
              (SELECT MAX(sa.attendance_date) FROM school_attendance sa
                WHERE sa.schedule_id = cs.id AND sa.tenant_id = $1) AS last_attendance_date
         FROM class_schedules cs
         JOIN courses c ON c.id = cs.course_id
         LEFT JOIN faculty f ON f.id = cs.faculty_id
        WHERE cs.tenant_id = $1
        ORDER BY c.name, cs.section`,
      [ctx.tenantId]
    )
    return res.json(result.rows)
  } catch (e) {
    return fail(res, 'get attendance overview', e)
  }
})

router.get('/admin/school/reports/attendance', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const { startDate, endDate, scheduleId, facultyId, studentId } = req.query

    // The tenant predicate is $1 and is written first, so no filter added
    // below can displace it or widen the result past this school.
    const conditions = ['sa.tenant_id = $1']
    const params: any[] = [ctx.tenantId]
    const add = (clause: string, value: unknown) => {
      params.push(value)
      conditions.push(clause.replace('$n', `$${params.length}`))
    }

    if (startDate) add('sa.attendance_date >= $n', startDate)
    if (endDate) add('sa.attendance_date <= $n', endDate)
    if (scheduleId) add('sa.schedule_id = $n::uuid', scheduleId)
    if (facultyId) add('cs.faculty_id = $n::uuid', facultyId)
    if (studentId) add('sa.student_id = $n::uuid', studentId)

    const result = await query(
      `SELECT sa.*, s.first_name, s.last_name, s.student_id,
              c.name AS course_name, c.code AS course_code,
              cs.days_of_week, cs.day_of_week, cs.section,
              CONCAT(f.first_name, ' ', f.last_name) AS faculty_name
         FROM school_attendance sa
         JOIN students s ON s.id = sa.student_id
         JOIN class_schedules cs ON cs.id = sa.schedule_id
         JOIN courses c ON c.id = cs.course_id
         LEFT JOIN faculty f ON f.id = cs.faculty_id
        WHERE ${conditions.join(' AND ')}
        ORDER BY sa.attendance_date DESC, sa.marked_at DESC
        LIMIT 1000`,
      params
    )

    return res.json({
      records: result.rows,
      totalRecords: result.rows.length,
      filters: { startDate, endDate, scheduleId, facultyId, studentId },
    })
  } catch (e) {
    return fail(res, 'get attendance report', e)
  }
})

// ===========================================================================
// Settings
// ===========================================================================

/**
 * Settings belong to the school, not the platform.
 *
 * The previous implementation wrote to a platform_settings table keyed by
 * platform_id. Had that table existed, one school changing its attendance
 * threshold would have changed it for every school in the deployment.
 */
router.get('/admin/school/settings', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const result = await query(
      `SELECT setting_key, setting_value FROM tenant_settings WHERE tenant_id = $1`,
      [ctx.tenantId]
    )
    const settings: Record<string, string> = {}
    for (const row of result.rows) settings[row.setting_key] = row.setting_value
    return res.json({ settings })
  } catch (e) {
    return fail(res, 'get settings', e)
  }
})

router.put('/admin/school/settings', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const { key, value } = req.body
    if (!key || value === undefined) {
      return res.status(400).json({ error: 'Setting key and value are required' })
    }
    if (!/^[a-zA-Z0-9_.-]{1,100}$/.test(String(key))) {
      return res.status(400).json({ error: 'Invalid setting key' })
    }

    await query(
      `INSERT INTO tenant_settings (tenant_id, setting_key, setting_value, updated_at, updated_by)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP, $4)
       ON CONFLICT (tenant_id, setting_key)
       DO UPDATE SET setting_value = EXCLUDED.setting_value,
                     updated_at = CURRENT_TIMESTAMP,
                     updated_by = EXCLUDED.updated_by`,
      [ctx.tenantId, String(key), String(value), ctx.userId]
    )

    return res.json({ message: 'Setting saved', key, value })
  } catch (e) {
    return fail(res, 'save setting', e)
  }
})

export default router
