import { Router, Response } from 'express'
import bcrypt from 'bcryptjs'
import { query } from '../db/connection.js'
import { authenticateToken } from '../auth/middleware.js'
import {
  resolveTenantContext,
  requireTenant,
  requireRoles,
  type TenantRequest,
} from '../auth/tenantContextMiddleware.js'
import {
  listScoped,
  countScoped,
  findScoped,
  insertScoped,
  updateScoped,
  assertAllInTenant,
  TenantScopeError,
} from '../db/tenantScoped.js'

/**
 * Tenant administration — the per-tenant admin API the frontend's
 * adminService expects at /api/admin.
 *
 * Every handler here operates inside one tenant, resolved server-side. The
 * tenant is never taken from the path, body or query; ids that arrive from
 * the client are only ever checked against the resolved tenant, never
 * trusted to select it.
 *
 * Users are a shared-infrastructure concern (one identity, one platform) but
 * their membership of a tenant is what this API administers, so listing and
 * creating users here always goes through the association tables.
 */

const router = Router()

// Everything below is authenticated, tenant-resolved and admin-only.
router.use(authenticateToken, resolveTenantContext, requireTenant, requireRoles('admin'))

/** Maps the frontend's role vocabulary onto the seeded role names. */
const ROLE_TO_DB: Record<string, string> = {
  STUDENT: 'student',
  FACULTY: 'faculty',
  EMPLOYEE: 'employee',
  HR: 'hr',
  ADMIN: 'admin',
}
const DB_TO_ROLE: Record<string, string> = Object.fromEntries(
  Object.entries(ROLE_TO_DB).map(([k, v]) => [v, k])
)

function fail(res: Response, e: unknown) {
  if (e instanceof TenantScopeError) {
    return res.status(e.status).json({ error: 'Request refused', message: e.message })
  }
  console.error('[ADMIN]', e)
  return res.status(500).json({ error: 'Internal error' })
}

/** The association table for the caller's platform. */
function membershipTable(kind: 'school' | 'corporate') {
  return kind === 'school'
    ? { table: 'school_user_associations', fk: 'school_entity_id', approvals: 'school_user_approvals', approvalFk: 'school_entity_id' }
    : { table: 'corporate_user_associations', fk: 'corporate_entity_id', approvals: 'corporate_user_approvals', approvalFk: 'corporate_entity_id' }
}

// ---------------------------------------------------------------------------
// GET /api/admin/analytics
// ---------------------------------------------------------------------------
router.get('/analytics', async (req: TenantRequest, res: Response) => {
  const ctx = req.ctx!
  try {
    const m = membershipTable(ctx.platformKind as 'school' | 'corporate')

    // Counted inside the tenant, in the database. Every figure below is a
    // tenant-scoped aggregate rather than a global count filtered afterwards.
    const [users, courses, attendance, approvals, recent] = await Promise.all([
      query(
        `SELECT r.name AS role, COUNT(*)::int AS n
           FROM ${m.table} a
           JOIN users u ON u.id = a.user_id
           JOIN roles r ON r.id = u.role_id
          WHERE a.${m.fk} = $1 AND a.status = 'active' AND u.is_active = TRUE
          GROUP BY r.name`,
        [ctx.tenantId]
      ),
      ctx.platformKind === 'school'
        ? countScoped('courses', ctx)
        : Promise.resolve(0),
      ctx.platformKind === 'school'
        ? query(
            `SELECT COUNT(*) FILTER (WHERE status = 'present')::int AS present,
                    COUNT(*)::int AS total
               FROM school_attendance WHERE tenant_id = $1`,
            [ctx.tenantId]
          )
        : Promise.resolve({ rows: [{ present: 0, total: 0 }] } as any),
      query(
        `SELECT COUNT(*)::int AS n FROM ${m.approvals}
          WHERE ${m.approvalFk} = $1 AND status = 'pending'`,
        [ctx.tenantId]
      ),
      query(
        `SELECT COUNT(*)::int AS n
           FROM ${m.table} a
           JOIN users u ON u.id = a.user_id
          WHERE a.${m.fk} = $1 AND u.created_at > NOW() - INTERVAL '7 days'`,
        [ctx.tenantId]
      ),
    ])

    const byRole: Record<string, number> = {}
    for (const r of users.rows) byRole[r.role] = r.n
    const totalUsers = Object.values(byRole).reduce((a, b) => a + b, 0)

    const att = (attendance as any).rows[0] ?? { present: 0, total: 0 }
    const avg = att.total > 0 ? Math.round((att.present / att.total) * 1000) / 10 : 0

    // "At risk" is a tenant-configurable idea; the threshold below matches the
    // 75% minimum-attendance rule the settings screen exposes.
    const atRisk =
      ctx.platformKind === 'school'
        ? (
            await query(
              `SELECT COUNT(*)::int AS n FROM (
                 SELECT student_id,
                        AVG(CASE WHEN status = 'present' THEN 1.0 ELSE 0.0 END) AS rate
                   FROM school_attendance
                  WHERE tenant_id = $1
                  GROUP BY student_id
                 HAVING AVG(CASE WHEN status = 'present' THEN 1.0 ELSE 0.0 END) < 0.75
               ) x`,
              [ctx.tenantId]
            )
          ).rows[0].n
        : 0

    res.json({
      total_users: totalUsers,
      faculty_count: byRole.faculty ?? 0,
      student_count: byRole.student ?? 0,
      employee_count: byRole.employee ?? 0,
      total_courses: typeof courses === 'number' ? courses : 0,
      active_sessions: 0,
      average_attendance_percent: avg,
      users_at_risk: atRisk,
      pending_approvals: approvals.rows[0].n,
      last_week_new_users: recent.rows[0].n,
    })
  } catch (e) {
    fail(res, e)
  }
})

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

router.get('/users', async (req: TenantRequest, res: Response) => {
  const ctx = req.ctx!
  try {
    const m = membershipTable(ctx.platformKind as 'school' | 'corporate')
    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1)
    const pageSize = Math.min(200, Math.max(1, parseInt(String(req.query.page_size ?? '50'), 10) || 50))
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : ''
    const roleFilter = typeof req.query.role === 'string' ? ROLE_TO_DB[req.query.role] : undefined

    // Membership is the join that bounds this query to one tenant. Search runs
    // inside that bound rather than across all users.
    const params: unknown[] = [ctx.tenantId]
    let where = `a.${m.fk} = $1 AND a.status <> 'removed'`
    if (search) {
      params.push(`%${search}%`)
      where += ` AND (u.email ILIKE $${params.length} OR u.full_name ILIKE $${params.length})`
    }
    if (roleFilter) {
      params.push(roleFilter)
      where += ` AND r.name = $${params.length}`
    }

    const total = await query(
      `SELECT COUNT(*)::int AS n FROM ${m.table} a
         JOIN users u ON u.id = a.user_id
         JOIN roles r ON r.id = u.role_id
        WHERE ${where}`,
      params
    )

    params.push(pageSize, (page - 1) * pageSize)
    const rows = await query(
      `SELECT u.id, u.email, u.full_name, u.is_active, u.created_at,
              r.name AS role_name, a.status AS membership_status
         FROM ${m.table} a
         JOIN users u ON u.id = a.user_id
         JOIN roles r ON r.id = u.role_id
        WHERE ${where}
        ORDER BY u.created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    )

    res.json({
      data: rows.rows.map((u: any) => ({
        id: u.id,
        email: u.email,
        name: u.full_name,
        role: DB_TO_ROLE[u.role_name] ?? u.role_name.toUpperCase(),
        status: !u.is_active
          ? 'INACTIVE'
          : u.membership_status === 'pending'
          ? 'PENDING_APPROVAL'
          : 'ACTIVE',
        created_at: u.created_at,
      })),
      page,
      page_size: pageSize,
      total: total.rows[0].n,
    })
  } catch (e) {
    fail(res, e)
  }
})

router.post('/users', async (req: TenantRequest, res: Response) => {
  const ctx = req.ctx!
  const { email, name, role, password } = req.body ?? {}

  if (!email || typeof email !== 'string' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ error: 'Validation failed', message: 'A valid email is required' })
  }
  if (!name || typeof name !== 'string' || name.trim().length < 2) {
    return res.status(400).json({ error: 'Validation failed', message: 'name is required' })
  }
  const dbRole = ROLE_TO_DB[String(role)]
  if (!dbRole) {
    return res.status(400).json({ error: 'Validation failed', message: `role must be one of ${Object.keys(ROLE_TO_DB).join(', ')}` })
  }
  // An admin creating another admin is a privilege escalation path; it is not
  // available through ordinary user creation.
  if (dbRole === 'admin') {
    return res.status(403).json({ error: 'Forbidden', message: 'Admin accounts cannot be created through this endpoint' })
  }

  const client = await (await import('../db/connection.js')).default.connect()
  try {
    await client.query('BEGIN')

    const roleRow = await client.query(
      `SELECT id FROM roles WHERE platform_id = $1 AND name = $2`,
      [ctx.platformId, dbRole]
    )
    if (roleRow.rows.length === 0) {
      await client.query('ROLLBACK')
      return res.status(400).json({ error: 'Validation failed', message: `Role ${role} does not exist on this platform` })
    }

    const existing = await client.query(
      `SELECT id FROM users WHERE platform_id = $1 AND email = $2`,
      [ctx.platformId, email.toLowerCase()]
    )
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK')
      return res.status(409).json({ error: 'Conflict', message: 'A user with that email already exists on this platform' })
    }

    // A generated password is returned once and must be changed at first sign-in.
    const initialPassword =
      typeof password === 'string' && password.length >= 8
        ? password
        : (await import('crypto')).randomBytes(12).toString('base64url')
    const hash = await bcrypt.hash(initialPassword, 10)

    const created = await client.query(
      `INSERT INTO users (platform_id, email, full_name, role_id, password_hash, is_active, must_reset_password)
       VALUES ($1, $2, $3, $4, $5, TRUE, TRUE)
       RETURNING id, email, full_name, created_at`,
      [ctx.platformId, email.toLowerCase(), name.trim(), roleRow.rows[0].id, hash]
    )
    const user = created.rows[0]

    // Tenant membership is written by the server from the resolved context.
    const m = membershipTable(ctx.platformKind as 'school' | 'corporate')
    await client.query(
      `INSERT INTO ${m.table} (user_id, ${m.fk}, status) VALUES ($1, $2, 'active')`,
      [user.id, ctx.tenantId]
    )

    await client.query('COMMIT')

    res.status(201).json({
      id: user.id,
      email: user.email,
      name: user.full_name,
      role: DB_TO_ROLE[dbRole] ?? dbRole.toUpperCase(),
      status: 'ACTIVE',
      created_at: user.created_at,
      // Present only when the server generated it.
      ...(typeof password === 'string' && password.length >= 8
        ? {}
        : { temporary_password: initialPassword }),
    })
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    fail(res, e)
  } finally {
    client.release()
  }
})

/** Confirms a user is a member of the caller's tenant before touching them. */
async function memberOfTenant(ctx: any, userId: string): Promise<boolean> {
  const m = membershipTable(ctx.platformKind)
  const r = await query(
    `SELECT 1 FROM ${m.table} WHERE user_id = $1 AND ${m.fk} = $2 AND status <> 'removed'`,
    [userId, ctx.tenantId]
  )
  return r.rows.length > 0
}

router.put('/users/:userId', async (req: TenantRequest, res: Response) => {
  const ctx = req.ctx!
  const { userId } = req.params
  try {
    // Not a member of this tenant reads as not found, so an id cannot be
    // probed to learn whether it exists elsewhere.
    if (!(await memberOfTenant(ctx, userId))) {
      return res.status(404).json({ error: 'Not found', message: 'No such user in this tenant' })
    }

    const { name, role, is_active } = req.body ?? {}
    const sets: string[] = []
    const params: unknown[] = []

    if (typeof name === 'string' && name.trim().length >= 2) {
      params.push(name.trim())
      sets.push(`full_name = $${params.length}`)
    }
    if (typeof is_active === 'boolean') {
      params.push(is_active)
      sets.push(`is_active = $${params.length}`)
    }
    if (role !== undefined) {
      const dbRole = ROLE_TO_DB[String(role)]
      if (!dbRole) {
        return res.status(400).json({ error: 'Validation failed', message: 'Unknown role' })
      }
      if (dbRole === 'admin') {
        return res.status(403).json({ error: 'Forbidden', message: 'Cannot grant admin through this endpoint' })
      }
      const roleRow = await query(`SELECT id FROM roles WHERE platform_id = $1 AND name = $2`, [ctx.platformId, dbRole])
      if (roleRow.rows.length === 0) {
        return res.status(400).json({ error: 'Validation failed', message: 'Role does not exist on this platform' })
      }
      params.push(roleRow.rows[0].id)
      sets.push(`role_id = $${params.length}`)
    }

    if (sets.length === 0) {
      return res.status(400).json({ error: 'Validation failed', message: 'No updatable fields supplied' })
    }

    // platform_id and email are deliberately not updatable here: moving an
    // identity between platforms is not an ordinary edit.
    params.push(userId)
    const updated = await query(
      `UPDATE users SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP
        WHERE id = $${params.length}
        RETURNING id, email, full_name, is_active, created_at,
                  (SELECT name FROM roles WHERE id = users.role_id) AS role_name`,
      params
    )
    const u = updated.rows[0]
    res.json({
      id: u.id,
      email: u.email,
      name: u.full_name,
      role: DB_TO_ROLE[u.role_name] ?? u.role_name.toUpperCase(),
      status: u.is_active ? 'ACTIVE' : 'INACTIVE',
      created_at: u.created_at,
    })
  } catch (e) {
    fail(res, e)
  }
})

router.delete('/users/:userId', async (req: TenantRequest, res: Response) => {
  const ctx = req.ctx!
  const { userId } = req.params
  try {
    if (userId === ctx.userId) {
      return res.status(400).json({ error: 'Validation failed', message: 'You cannot remove your own account' })
    }
    if (!(await memberOfTenant(ctx, userId))) {
      return res.status(404).json({ error: 'Not found', message: 'No such user in this tenant' })
    }

    // Removal is from the tenant, not from the platform: the identity may hold
    // memberships elsewhere, and attendance history must remain attributable.
    const m = membershipTable(ctx.platformKind as 'school' | 'corporate')
    await query(
      `UPDATE ${m.table} SET status = 'removed' WHERE user_id = $1 AND ${m.fk} = $2`,
      [userId, ctx.tenantId]
    )

    const remaining = await query(
      `SELECT COUNT(*)::int AS n FROM ${m.table} WHERE user_id = $1 AND status <> 'removed'`,
      [userId]
    )
    if (remaining.rows[0].n === 0) {
      await query(`UPDATE users SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [userId])
    }

    res.json({ success: true })
  } catch (e) {
    fail(res, e)
  }
})

router.post('/users/bulk-import', async (req: TenantRequest, res: Response) => {
  const ctx = req.ctx!
  // Accepts the CSV as text: either a raw body or { csv: "..." }. Keeping the
  // parser here rather than adding an upload dependency keeps the tenant
  // boundary in one place.
  const csv: string =
    typeof req.body === 'string'
      ? req.body
      : typeof req.body?.csv === 'string'
      ? req.body.csv
      : ''

  if (!csv.trim()) {
    return res.status(400).json({
      error: 'Validation failed',
      message: 'Supply CSV content as the request body or as { "csv": "..." } with columns email,name,role',
    })
  }

  const lines = csv.split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) {
    return res.status(400).json({ error: 'Validation failed', message: 'CSV needs a header row and at least one record' })
  }

  const header = lines[0].split(',').map(h => h.trim().toLowerCase())
  const iEmail = header.indexOf('email')
  const iName = header.indexOf('name')
  const iRole = header.indexOf('role')
  if (iEmail === -1 || iName === -1 || iRole === -1) {
    return res.status(400).json({ error: 'Validation failed', message: 'CSV must have email, name and role columns' })
  }

  const errors: Array<{ row: number; error: string }> = []
  let imported = 0

  const client = await (await import('../db/connection.js')).default.connect()
  try {
    await client.query('BEGIN')
    const m = membershipTable(ctx.platformKind as 'school' | 'corporate')

    for (let i = 1; i < lines.length; i++) {
      const cells = lines[i].split(',').map(c => c.trim())
      const email = (cells[iEmail] ?? '').toLowerCase()
      const name = cells[iName] ?? ''
      const dbRole = ROLE_TO_DB[(cells[iRole] ?? '').toUpperCase()]

      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { errors.push({ row: i + 1, error: 'Invalid email' }); continue }
      if (name.length < 2) { errors.push({ row: i + 1, error: 'Name is required' }); continue }
      if (!dbRole || dbRole === 'admin') { errors.push({ row: i + 1, error: 'Invalid or disallowed role' }); continue }

      const roleRow = await client.query(`SELECT id FROM roles WHERE platform_id = $1 AND name = $2`, [ctx.platformId, dbRole])
      if (roleRow.rows.length === 0) { errors.push({ row: i + 1, error: 'Role not available on this platform' }); continue }

      const existing = await client.query(`SELECT id FROM users WHERE platform_id = $1 AND email = $2`, [ctx.platformId, email])
      let userId: string
      if (existing.rows.length > 0) {
        userId = existing.rows[0].id
      } else {
        const hash = await bcrypt.hash((await import('crypto')).randomBytes(12).toString('base64url'), 10)
        const created = await client.query(
          `INSERT INTO users (platform_id, email, full_name, role_id, password_hash, is_active, must_reset_password)
           VALUES ($1,$2,$3,$4,$5,TRUE,TRUE) RETURNING id`,
          [ctx.platformId, email, name, roleRow.rows[0].id, hash]
        )
        userId = created.rows[0].id
      }

      await client.query(
        `INSERT INTO ${m.table} (user_id, ${m.fk}, status) VALUES ($1,$2,'active')
         ON CONFLICT DO NOTHING`,
        [userId, ctx.tenantId]
      )
      imported++
    }

    await client.query('COMMIT')
    res.status(errors.length > 0 ? 207 : 201).json({ imported, failed: errors.length, errors })
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    fail(res, e)
  } finally {
    client.release()
  }
})

// ---------------------------------------------------------------------------
// Courses — SMS only
// ---------------------------------------------------------------------------

function schoolOnly(req: TenantRequest, res: Response): boolean {
  if (req.ctx!.platformKind !== 'school' && !req.ctx!.isSuperadmin) {
    res.status(403).json({ error: 'Forbidden', message: 'Courses belong to the school platform' })
    return false
  }
  return true
}

router.get('/courses', async (req: TenantRequest, res: Response) => {
  if (!schoolOnly(req, res)) return
  const ctx = req.ctx!
  try {
    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1)
    const pageSize = Math.min(200, Math.max(1, parseInt(String(req.query.page_size ?? '50'), 10) || 50))
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : ''

    const where = search ? 'code ILIKE $2 OR name ILIKE $2' : undefined
    const params = search ? [`%${search}%`] : []

    const [rows, total] = await Promise.all([
      listScoped<any>('courses', ctx, {
        where,
        params,
        orderBy: 'created_at desc',
        limit: pageSize,
        offset: (page - 1) * pageSize,
      }),
      countScoped('courses', ctx, where, params),
    ])

    // Enrichment stays inside the tenant: both subqueries are bounded by
    // tenant_id, so a count cannot reveal another tenant's enrolment.
    const ids = rows.map(r => r.id)
    const counts = ids.length
      ? await query(
          `SELECT c.id AS course_id,
                  (SELECT COUNT(*)::int FROM student_courses sc
                     JOIN class_schedules cs ON cs.id = sc.schedule_id
                    WHERE cs.course_id = c.id AND sc.tenant_id = $1 AND sc.is_active) AS students_count,
                  (SELECT f.first_name || ' ' || f.last_name FROM faculty_courses fc
                     JOIN faculty f ON f.id = fc.faculty_id
                    WHERE fc.course_id = c.id AND fc.tenant_id = $1 LIMIT 1) AS instructor_name,
                  (SELECT fc.faculty_id FROM faculty_courses fc
                    WHERE fc.course_id = c.id AND fc.tenant_id = $1 LIMIT 1) AS instructor_id
             FROM courses c
            WHERE c.tenant_id = $1 AND c.id = ANY($2::uuid[])`,
          [ctx.tenantId, ids]
        )
      : { rows: [] }
    const byId = new Map(counts.rows.map((r: any) => [r.course_id, r]))

    res.json({
      data: rows.map(c => ({
        id: c.id,
        name: c.name,
        code: c.code,
        semester: c.semester_id,
        instructor_id: byId.get(c.id)?.instructor_id ?? null,
        instructor_name: byId.get(c.id)?.instructor_name ?? null,
        students_count: byId.get(c.id)?.students_count ?? 0,
        created_at: c.created_at,
      })),
      page,
      page_size: pageSize,
      total,
    })
  } catch (e) {
    fail(res, e)
  }
})

router.post('/courses', async (req: TenantRequest, res: Response) => {
  if (!schoolOnly(req, res)) return
  const ctx = req.ctx!
  const { name, code, semester, department_id, credits, description, max_capacity } = req.body ?? {}

  if (!name || typeof name !== 'string' || name.trim().length < 2) {
    return res.status(400).json({ error: 'Validation failed', message: 'name is required' })
  }
  if (!code || typeof code !== 'string' || code.trim().length < 2) {
    return res.status(400).json({ error: 'Validation failed', message: 'code is required' })
  }
  if (!semester) {
    return res.status(400).json({ error: 'Validation failed', message: 'semester is required' })
  }

  try {
    // Both referenced rows must belong to this tenant. Without these checks a
    // crafted body could attach a course to another tenant's semester.
    const sem = await query(
      `SELECT id, department_id FROM semesters WHERE id = $1 AND tenant_id = $2`,
      [semester, ctx.tenantId]
    )
    if (sem.rows.length === 0) {
      return res.status(404).json({ error: 'Not found', message: 'No such semester in this tenant' })
    }
    const deptId = department_id ?? sem.rows[0].department_id
    if (department_id) {
      const d = await query(`SELECT id FROM school_departments WHERE id = $1 AND tenant_id = $2`, [department_id, ctx.tenantId])
      if (d.rows.length === 0) {
        return res.status(404).json({ error: 'Not found', message: 'No such department in this tenant' })
      }
    }

    const dup = await query(
      `SELECT id FROM courses WHERE tenant_id = $1 AND semester_id = $2 AND code = $3`,
      [ctx.tenantId, semester, code.trim()]
    )
    if (dup.rows.length > 0) {
      return res.status(409).json({ error: 'Conflict', message: 'A course with that code already exists in this semester' })
    }

    const created = await insertScoped<any>('courses', ctx, {
      department_id: deptId,
      semester_id: semester,
      code: code.trim(),
      name: name.trim(),
      credits: Number.isInteger(credits) ? credits : null,
      description: typeof description === 'string' ? description : null,
      max_capacity: Number.isInteger(max_capacity) ? max_capacity : null,
    })

    res.status(201).json({
      id: created.id,
      name: created.name,
      code: created.code,
      semester: created.semester_id,
      students_count: 0,
      created_at: created.created_at,
    })
  } catch (e) {
    fail(res, e)
  }
})

router.put('/courses/:courseId', async (req: TenantRequest, res: Response) => {
  if (!schoolOnly(req, res)) return
  const ctx = req.ctx!
  const { name, code, semester, credits, description, max_capacity } = req.body ?? {}
  try {
    const patch: Record<string, unknown> = {}
    if (typeof name === 'string' && name.trim()) patch.name = name.trim()
    if (typeof code === 'string' && code.trim()) patch.code = code.trim()
    if (typeof description === 'string') patch.description = description
    if (Number.isInteger(credits)) patch.credits = credits
    if (Number.isInteger(max_capacity)) patch.max_capacity = max_capacity
    if (semester) {
      const sem = await query(`SELECT id FROM semesters WHERE id = $1 AND tenant_id = $2`, [semester, ctx.tenantId])
      if (sem.rows.length === 0) {
        return res.status(404).json({ error: 'Not found', message: 'No such semester in this tenant' })
      }
      patch.semester_id = semester
    }

    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: 'Validation failed', message: 'No updatable fields supplied' })
    }

    const updated = await updateScoped<any>('courses', ctx, req.params.courseId, patch)
    if (!updated) {
      return res.status(404).json({ error: 'Not found', message: 'No such course in this tenant' })
    }
    res.json({
      id: updated.id,
      name: updated.name,
      code: updated.code,
      semester: updated.semester_id,
      created_at: updated.created_at,
    })
  } catch (e) {
    fail(res, e)
  }
})

router.put('/courses/:courseId/assign-faculty', async (req: TenantRequest, res: Response) => {
  if (!schoolOnly(req, res)) return
  const ctx = req.ctx!
  const { faculty_id } = req.body ?? {}
  if (!faculty_id) {
    return res.status(400).json({ error: 'Validation failed', message: 'faculty_id is required' })
  }
  try {
    // Course and faculty member must both be in this tenant. Checking each
    // separately is what stops a valid course id being paired with another
    // tenant's faculty id.
    const course = await findScoped<any>('courses', ctx, req.params.courseId)
    if (!course) {
      return res.status(404).json({ error: 'Not found', message: 'No such course in this tenant' })
    }
    await assertAllInTenant('faculty', ctx, [String(faculty_id)])

    await query(
      `INSERT INTO faculty_courses (faculty_id, course_id, tenant_id)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [faculty_id, course.id, ctx.tenantId]
    )

    const instructor = await query(
      `SELECT f.id, f.first_name || ' ' || f.last_name AS name
         FROM faculty f WHERE f.id = $1 AND f.tenant_id = $2`,
      [faculty_id, ctx.tenantId]
    )

    res.json({
      id: course.id,
      name: course.name,
      code: course.code,
      semester: course.semester_id,
      instructor_id: instructor.rows[0]?.id ?? null,
      instructor_name: instructor.rows[0]?.name ?? null,
      created_at: course.created_at,
    })
  } catch (e) {
    fail(res, e)
  }
})

// ---------------------------------------------------------------------------
// Approvals
// ---------------------------------------------------------------------------

router.get('/approvals/pending', async (req: TenantRequest, res: Response) => {
  const ctx = req.ctx!
  try {
    const m = membershipTable(ctx.platformKind as 'school' | 'corporate')
    const rows = await query(
      `SELECT ap.id, u.email AS user_email, u.full_name AS user_name,
              ap.requested_role AS role, ap.requested_at
         FROM ${m.approvals} ap
         JOIN users u ON u.id = ap.user_id
        WHERE ap.${m.approvalFk} = $1 AND ap.status = 'pending'
        ORDER BY ap.requested_at DESC`,
      [ctx.tenantId]
    )
    res.json(rows.rows)
  } catch (e) {
    fail(res, e)
  }
})

/** Shared body for approve and reject, so both enforce the same boundary. */
async function decideApproval(
  req: TenantRequest,
  res: Response,
  decision: 'approved' | 'rejected'
) {
  const ctx = req.ctx!
  const approvalId = req.body?.approval_id
  if (!approvalId) {
    return res.status(400).json({ error: 'Validation failed', message: 'approval_id is required' })
  }
  if (decision === 'rejected' && !req.body?.reason) {
    return res.status(400).json({ error: 'Validation failed', message: 'reason is required when rejecting' })
  }

  const client = await (await import('../db/connection.js')).default.connect()
  try {
    await client.query('BEGIN')
    const m = membershipTable(ctx.platformKind as 'school' | 'corporate')

    // The tenant predicate is part of the lookup, so an approval id belonging
    // to another tenant is simply not found.
    const found = await client.query(
      `SELECT id, user_id, requested_role FROM ${m.approvals}
        WHERE id = $1 AND ${m.approvalFk} = $2 AND status = 'pending'
        FOR UPDATE`,
      [approvalId, ctx.tenantId]
    )
    if (found.rows.length === 0) {
      await client.query('ROLLBACK')
      return res.status(404).json({ error: 'Not found', message: 'No pending approval with that id in this tenant' })
    }
    const approval = found.rows[0]

    await client.query(
      `UPDATE ${m.approvals}
          SET status = $1, approved_by_user_id = $2, approved_at = CURRENT_TIMESTAMP,
              rejection_reason = $3
        WHERE id = $4`,
      [decision, ctx.userId, decision === 'rejected' ? String(req.body.reason) : null, approvalId]
    )

    if (decision === 'approved') {
      await client.query(
        `INSERT INTO ${m.table} (user_id, ${m.fk}, status) VALUES ($1, $2, 'active')
         ON CONFLICT DO NOTHING`,
        [approval.user_id, ctx.tenantId]
      )
      await client.query(`UPDATE users SET is_active = TRUE WHERE id = $1`, [approval.user_id])
    }

    await client.query('COMMIT')
    res.json({ success: true })
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    fail(res, e)
  } finally {
    client.release()
  }
}

router.post('/approvals/approve', (req: TenantRequest, res: Response) => decideApproval(req, res, 'approved'))
router.post('/approvals/reject', (req: TenantRequest, res: Response) => decideApproval(req, res, 'rejected'))

// ---------------------------------------------------------------------------
// GET /api/admin/export/tenant-report
// ---------------------------------------------------------------------------
router.get('/export/tenant-report', async (req: TenantRequest, res: Response) => {
  const ctx = req.ctx!
  const format = String(req.query.format ?? 'CSV').toUpperCase()
  try {
    const m = membershipTable(ctx.platformKind as 'school' | 'corporate')
    const rows = await query(
      `SELECT u.email, u.full_name, r.name AS role, u.is_active, u.created_at, a.status AS membership
         FROM ${m.table} a
         JOIN users u ON u.id = a.user_id
         JOIN roles r ON r.id = u.role_id
        WHERE a.${m.fk} = $1
        ORDER BY r.name, u.full_name`,
      [ctx.tenantId]
    )

    // CSV is produced here; PDF and XLSX would need a rendering dependency, so
    // they are refused explicitly rather than silently returning the wrong
    // content type.
    if (format !== 'CSV') {
      return res.status(415).json({
        error: 'Unsupported format',
        message: `${format} export is not implemented; request format=CSV`,
      })
    }

    const escape = (v: unknown) => {
      const s = v === null || v === undefined ? '' : String(v)
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const csv = [
      ['email', 'name', 'role', 'active', 'membership', 'created_at'].join(','),
      ...rows.rows.map((r: any) =>
        [r.email, r.full_name, r.role, r.is_active, r.membership, r.created_at].map(escape).join(',')
      ),
    ].join('\n')

    const safeName = (ctx.tenantName ?? 'tenant').replace(/[^a-z0-9]+/gi, '-').toLowerCase()
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}-report.csv"`)
    res.send(csv)
  } catch (e) {
    fail(res, e)
  }
})

export default router
