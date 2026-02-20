import express, { Request, Response } from 'express'
import bcrypt from 'bcryptjs'
import { authenticateToken } from '../auth/middleware.js'
import { query } from '../db/connection.js'
import * as queries from '../db/queries.js'
import type { Employee, WorkAssignment, CorporateCheckin } from '../types/database.js'
import type { TenantAwareRequest } from '../types/tenantContext.js'
import { verifyTenantOwnsResource } from '../auth/tenantEnforcementMiddleware.js'

const router = express.Router()

// ── Helper: Get corporate entity for authenticated admin ──
async function getCorporateEntity(userId: string) {
  const result = await query(
    `SELECT * FROM corporate_entities WHERE admin_user_id = $1`,
    [userId]
  )
  return result.rows[0] || null
}

// ═══════════════════════════════════════
// ADMIN DASHBOARD STATS
// ═══════════════════════════════════════
router.get('/dashboard', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' })
    const entity = await getCorporateEntity(req.user.userId)
    if (!entity) return res.status(403).json({ error: 'No corporate entity assigned' })

    // Total & active employees (via corporate_user_associations)
    const usersResult = await query(
      `SELECT
         COUNT(*) AS total_users,
         COUNT(*) FILTER (WHERE cua.status = 'active' AND u.is_active = true) AS active_users
       FROM corporate_user_associations cua
       JOIN users u ON cua.user_id = u.id
       WHERE cua.corporate_entity_id = $1`,
      [entity.id]
    )

    // Employees in employees table
    const empResult = await query(
      `SELECT
         COUNT(*) AS total_employees,
         COUNT(*) FILTER (WHERE e.is_currently_employed = true) AS active_employees
       FROM employees e
       JOIN users u ON e.user_id = u.id
       JOIN corporate_user_associations cua ON cua.user_id = u.id
       WHERE cua.corporate_entity_id = $1`,
      [entity.id]
    )

    // Department count
    const deptResult = await query(
      `SELECT COUNT(*) AS dept_count FROM corporate_departments WHERE platform_id = $1`,
      [req.user.platformId]
    )

    // Pending approvals
    const approvalResult = await query(
      `SELECT COUNT(*) AS count FROM user_registration_requests WHERE entity_id = $1 AND status = 'pending'`,
      [entity.id]
    ).catch(() => ({ rows: [{ count: '0' }] }))

    // Today's check-ins
    const today = new Date().toISOString().split('T')[0]
    const checkinResult = await query(
      `SELECT
         COUNT(DISTINCT cc.employee_id) AS today_checkins,
         COUNT(*) FILTER (WHERE cc.check_out_time IS NOT NULL) AS completed_checkouts
       FROM corporate_checkins cc
       JOIN employees e ON cc.employee_id = e.id
       JOIN users u ON e.user_id = u.id
       JOIN corporate_user_associations cua ON cua.user_id = u.id
       WHERE cua.corporate_entity_id = $1 AND DATE(cc.check_in_time) = $2`,
      [entity.id, today]
    )

    // Recent check-ins (last 10)
    const recentCheckins = await query(
      `SELECT cc.id, cc.check_in_time, cc.check_out_time, cc.check_in_type, cc.face_verified,
              e.first_name, e.last_name, e.employee_id AS emp_code,
              cd.name AS department_name
       FROM corporate_checkins cc
       JOIN employees e ON cc.employee_id = e.id
       LEFT JOIN corporate_departments cd ON e.department_id = cd.id
       JOIN users u ON e.user_id = u.id
       JOIN corporate_user_associations cua ON cua.user_id = u.id
       WHERE cua.corporate_entity_id = $1
       ORDER BY cc.check_in_time DESC LIMIT 10`,
      [entity.id]
    )

    const totalUsers = parseInt(usersResult.rows[0]?.total_users || '0')
    const activeUsers = parseInt(usersResult.rows[0]?.active_users || '0')
    const totalEmployees = parseInt(empResult.rows[0]?.total_employees || '0')
    const activeEmployees = parseInt(empResult.rows[0]?.active_employees || '0')
    const todayCheckins = parseInt(checkinResult.rows[0]?.today_checkins || '0')
    const attendanceRate = activeEmployees > 0
      ? Math.round((todayCheckins / activeEmployees) * 100)
      : 0

    return res.json({
      entity: { id: entity.id, name: entity.name, code: entity.code, industry: entity.industry },
      stats: {
        totalUsers,
        activeUsers,
        totalEmployees,
        activeEmployees,
        departments: parseInt(deptResult.rows[0]?.dept_count || '0'),
        pendingApprovals: parseInt(approvalResult.rows[0]?.count || '0'),
        todayCheckins,
        completedCheckouts: parseInt(checkinResult.rows[0]?.completed_checkouts || '0'),
        attendanceRate,
      },
      recentCheckins: recentCheckins.rows,
    })
  } catch (err: any) {
    console.error('[Corporate Dashboard]', err.message)
    return res.status(500).json({ error: 'Failed to load dashboard' })
  }
})

// ═══════════════════════════════════════
// DEPARTMENTS CRUD
// ═══════════════════════════════════════
router.get('/departments', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' })
    const platformId = req.user.platformId
    if (!platformId) return res.status(403).json({ error: 'No platform assigned' })

    const result = await query(
      `SELECT cd.*,
              COUNT(DISTINCT e.id) FILTER (WHERE e.is_currently_employed = true) AS employee_count,
              h.full_name AS head_name
       FROM corporate_departments cd
       LEFT JOIN employees e ON e.department_id = cd.id
       LEFT JOIN users h ON cd.head_id = h.id
       WHERE cd.platform_id = $1
       GROUP BY cd.id, h.full_name
       ORDER BY cd.name`,
      [platformId]
    )
    return res.json({ departments: result.rows })
  } catch (err: any) {
    console.error('[Corporate Departments GET]', err.message)
    return res.status(500).json({ error: 'Failed to load departments' })
  }
})

router.post('/departments', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' })
    const platformId = req.user.platformId
    if (!platformId) return res.status(403).json({ error: 'No platform assigned' })

    const { name, code, description, head_id } = req.body
    if (!name) return res.status(400).json({ error: 'Department name is required' })

    // Check duplicate name
    const dup = await query(
      `SELECT id FROM corporate_departments WHERE platform_id = $1 AND LOWER(name) = LOWER($2)`,
      [platformId, name]
    )
    if (dup.rows.length > 0) return res.status(409).json({ error: 'Department name already exists' })

    const result = await query(
      `INSERT INTO corporate_departments (name, code, description, head_id, platform_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [name, code || null, description || null, head_id || null, platformId]
    )
    return res.status(201).json(result.rows[0])
  } catch (err: any) {
    console.error('[Corporate Departments POST]', err.message)
    return res.status(500).json({ error: 'Failed to create department' })
  }
})

router.put('/departments/:id', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' })
    const platformId = req.user.platformId
    if (!platformId) return res.status(403).json({ error: 'No platform assigned' })

    const { id } = req.params
    const { name, code, description, head_id } = req.body

    const result = await query(
      `UPDATE corporate_departments
       SET name = COALESCE($1, name), code = COALESCE($2, code),
           description = COALESCE($3, description), head_id = $4
       WHERE id = $5 AND platform_id = $6
       RETURNING *`,
      [name, code, description, head_id || null, id, platformId]
    )
    if (result.rows.length === 0) return res.status(404).json({ error: 'Department not found' })
    return res.json(result.rows[0])
  } catch (err: any) {
    console.error('[Corporate Departments PUT]', err.message)
    return res.status(500).json({ error: 'Failed to update department' })
  }
})

router.delete('/departments/:id', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' })
    const platformId = req.user.platformId
    if (!platformId) return res.status(403).json({ error: 'No platform assigned' })

    const { id } = req.params

    // Check if department has employees
    const empCheck = await query(
      `SELECT COUNT(*) AS count FROM employees WHERE department_id = $1 AND is_currently_employed = true`,
      [id]
    )
    if (parseInt(empCheck.rows[0].count) > 0) {
      return res.status(400).json({ error: `Cannot delete: ${empCheck.rows[0].count} active employee(s) in this department` })
    }

    const result = await query(
      `DELETE FROM corporate_departments WHERE id = $1 AND platform_id = $2 RETURNING id, name`,
      [id, platformId]
    )
    if (result.rows.length === 0) return res.status(404).json({ error: 'Department not found' })
    return res.json({ success: true, message: `Department "${result.rows[0].name}" deleted` })
  } catch (err: any) {
    console.error('[Corporate Departments DELETE]', err.message)
    return res.status(500).json({ error: 'Failed to delete department' })
  }
})

// ═══════════════════════════════════════
// ADMIN: Employees list (uses entity not tenant middleware)
// ═══════════════════════════════════════
router.get('/admin/employees', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' })
    const entity = await getCorporateEntity(req.user.userId)
    if (!entity) return res.status(403).json({ error: 'No corporate entity assigned' })

    const departmentId = req.query.departmentId as string
    const search = req.query.search as string
    const status = req.query.status as string // 'active', 'terminated', 'all'

    let sql = `
      SELECT e.*, u.email AS user_email, u.is_active AS user_active,
             cd.name AS department_name
      FROM employees e
      JOIN users u ON e.user_id = u.id
      JOIN corporate_user_associations cua ON cua.user_id = u.id
      LEFT JOIN corporate_departments cd ON e.department_id = cd.id
      WHERE cua.corporate_entity_id = $1`
    const params: any[] = [entity.id]

    if (departmentId) {
      params.push(departmentId)
      sql += ` AND e.department_id = $${params.length}`
    }
    if (status === 'active') sql += ` AND e.is_currently_employed = true`
    else if (status === 'terminated') sql += ` AND e.is_currently_employed = false`

    if (search) {
      params.push(`%${search}%`)
      sql += ` AND (e.first_name ILIKE $${params.length} OR e.last_name ILIKE $${params.length} OR e.employee_id ILIKE $${params.length} OR e.email ILIKE $${params.length})`
    }

    sql += ` ORDER BY e.first_name, e.last_name`
    const result = await query(sql, params)
    return res.json({ employees: result.rows, total: result.rows.length })
  } catch (err: any) {
    console.error('[Corporate Admin Employees]', err.message)
    return res.status(500).json({ error: 'Failed to load employees' })
  }
})

// ═══════════════════════════════════════
// ADMIN: Create employee (admin creates user + employee in one go)
// ═══════════════════════════════════════
router.post('/admin/employees', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' })
    const entity = await getCorporateEntity(req.user.userId)
    if (!entity) return res.status(403).json({ error: 'No corporate entity assigned' })

    const { firstName, lastName, email, phone, departmentId, designation, employmentType, dateOfJoining } = req.body
    if (!firstName || !lastName || !email) {
      return res.status(400).json({ error: 'First name, last name, and email are required' })
    }

    const platformId = req.user.platformId

    // Check if email already exists on this platform
    const existingUser = await query(
      `SELECT id FROM users WHERE email = $1 AND platform_id = $2`,
      [email, platformId]
    )
    if (existingUser.rows.length > 0) {
      return res.status(409).json({ error: 'A user with this email already exists' })
    }

    // Employee role ID
    const employeeRole = await query(`SELECT id FROM roles WHERE name = 'employee' LIMIT 1`)
    if (employeeRole.rows.length === 0) {
      return res.status(500).json({ error: 'Employee role not found' })
    }
    const roleId = employeeRole.rows[0].id

    // Default password: first letter of first name (uppercase) + last name (lowercase) + "123"
    const defaultPassword = firstName.charAt(0).toUpperCase() + lastName.toLowerCase() + '123'
    const passwordHash = await bcrypt.hash(defaultPassword, 10)
    const fullName = `${firstName} ${lastName}`

    // Auto-generate employee ID: ENT-CODE-NNN
    const countResult = await query(
      `SELECT COUNT(*) FROM employees e
       JOIN users u ON e.user_id = u.id
       JOIN corporate_user_associations cua ON cua.user_id = u.id
       WHERE cua.corporate_entity_id = $1`,
      [entity.id]
    )
    const nextNum = parseInt(countResult.rows[0].count) + 1
    const employeeIdCode = `${entity.code}-${String(nextNum).padStart(3, '0')}`

    // Create user
    const userResult = await query(
      `INSERT INTO users (platform_id, email, full_name, phone, role_id, password_hash, must_reset_password)
       VALUES ($1, $2, $3, $4, $5, $6, true) RETURNING id`,
      [platformId, email, fullName, phone || null, roleId, passwordHash]
    )
    const newUserId = userResult.rows[0].id

    // Create corporate_user_associations
    await query(
      `INSERT INTO corporate_user_associations (user_id, corporate_entity_id, department_id, status)
       VALUES ($1, $2, $3, 'active')`,
      [newUserId, entity.id, departmentId || null]
    )

    // Create employee record
    const empResult = await query(
      `INSERT INTO employees (user_id, employee_id, first_name, last_name, email, phone, department_id, designation, employment_type, date_of_joining)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [
        newUserId,
        employeeIdCode,
        firstName,
        lastName,
        email,
        phone || null,
        departmentId || null,
        designation || null,
        employmentType || 'full_time',
        dateOfJoining || new Date().toISOString().split('T')[0]
      ]
    )

    return res.status(201).json({
      message: 'Employee created successfully',
      data: empResult.rows[0],
      defaultPassword,
    })
  } catch (err: any) {
    console.error('[Corporate Admin Create Employee]', err.message)
    return res.status(500).json({ error: err.message })
  }
})

// ═══════════════════════════════════════
// ADMIN: Terminate employee
// ═══════════════════════════════════════
router.patch('/admin/employees/:employeeId/terminate', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' })
    const entity = await getCorporateEntity(req.user.userId)
    if (!entity) return res.status(403).json({ error: 'No corporate entity assigned' })

    const { employeeId } = req.params
    const result = await query(
      `UPDATE employees SET is_currently_employed = false
       WHERE id = $1 AND id IN (
         SELECT e.id FROM employees e
         JOIN corporate_user_associations cua ON cua.user_id = e.user_id
         WHERE cua.corporate_entity_id = $2
       ) RETURNING *`,
      [employeeId, entity.id]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Employee not found' })
    }

    // Also deactivate the user account
    await query(`UPDATE users SET is_active = false WHERE id = $1`, [result.rows[0].user_id])

    return res.json({ message: 'Employee terminated', data: result.rows[0] })
  } catch (err: any) {
    console.error('[Corporate Admin Terminate]', err.message)
    return res.status(500).json({ error: err.message })
  }
})

// ═══════════════════════════════════════
// ADMIN: Attendance overview
// ═══════════════════════════════════════
router.get('/admin/attendance', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' })
    const entity = await getCorporateEntity(req.user.userId)
    if (!entity) return res.status(403).json({ error: 'No corporate entity assigned' })

    const dateStr = (req.query.date as string) || new Date().toISOString().split('T')[0]
    const departmentId = req.query.departmentId as string

    let sql = `
      SELECT e.id AS employee_id, e.employee_id AS emp_code,
             e.first_name, e.last_name, e.designation,
             cd.name AS department_name,
             cc.id AS checkin_id, cc.check_in_time, cc.check_out_time,
             cc.check_in_type, cc.face_verified, cc.site_location
      FROM employees e
      JOIN users u ON e.user_id = u.id
      JOIN corporate_user_associations cua ON cua.user_id = u.id
      LEFT JOIN corporate_departments cd ON e.department_id = cd.id
      LEFT JOIN corporate_checkins cc ON cc.employee_id = e.id AND DATE(cc.check_in_time) = $2
      WHERE cua.corporate_entity_id = $1 AND e.is_currently_employed = true`
    const params: any[] = [entity.id, dateStr]

    if (departmentId) {
      params.push(departmentId)
      sql += ` AND e.department_id = $${params.length}`
    }

    sql += ` ORDER BY e.first_name, e.last_name`
    const result = await query(sql, params)

    // Summary
    const total = result.rows.length
    const present = result.rows.filter((r: any) => r.checkin_id).length
    const absent = total - present
    const checkedOut = result.rows.filter((r: any) => r.check_out_time).length

    return res.json({
      date: dateStr,
      summary: { total, present, absent, checkedOut, rate: total > 0 ? Math.round((present / total) * 100) : 0 },
      records: result.rows,
    })
  } catch (err: any) {
    console.error('[Corporate Attendance]', err.message)
    return res.status(500).json({ error: 'Failed to load attendance' })
  }
})

// ═══════════════════════════════════════
// ADMIN: Reports / analytics
// ═══════════════════════════════════════
router.get('/admin/reports', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' })
    const entity = await getCorporateEntity(req.user.userId)
    if (!entity) return res.status(403).json({ error: 'No corporate entity assigned' })

    const days = parseInt(req.query.days as string) || 30
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - days)
    const startStr = startDate.toISOString().split('T')[0]

    // Daily attendance trend
    const trendResult = await query(
      `SELECT DATE(cc.check_in_time) AS date,
              COUNT(*) AS checkins,
              COUNT(DISTINCT cc.employee_id) AS unique_employees
       FROM corporate_checkins cc
       JOIN employees e ON cc.employee_id = e.id
       JOIN users u ON e.user_id = u.id
       JOIN corporate_user_associations cua ON cua.user_id = u.id
       WHERE cua.corporate_entity_id = $1 AND DATE(cc.check_in_time) >= $2
       GROUP BY DATE(cc.check_in_time)
       ORDER BY date`,
      [entity.id, startStr]
    )

    // Department breakdown
    const deptResult = await query(
      `SELECT COALESCE(cd.name, 'Unassigned') AS department_name,
              COUNT(DISTINCT e.id) AS unique_employees,
              COUNT(DISTINCT cc.id) AS total_checkins,
              ROUND(COUNT(DISTINCT cc.id)::numeric / GREATEST($3::numeric, 1), 1) AS avg_checkins_per_day
       FROM employees e
       JOIN users u ON e.user_id = u.id
       JOIN corporate_user_associations cua ON cua.user_id = u.id
       LEFT JOIN corporate_departments cd ON e.department_id = cd.id
       LEFT JOIN corporate_checkins cc ON cc.employee_id = e.id AND DATE(cc.check_in_time) >= $2
       WHERE cua.corporate_entity_id = $1 AND e.is_currently_employed = true
       GROUP BY cd.name
       ORDER BY cd.name`,
      [entity.id, startStr, days]
    )

    // Top late arrivals (check-in after 9:00 AM)
    const lateResult = await query(
      `SELECT e.first_name, e.last_name, e.employee_id AS employee_code,
              cc.check_in_time,
              cd.name AS department_name
       FROM corporate_checkins cc
       JOIN employees e ON cc.employee_id = e.id
       JOIN users u ON e.user_id = u.id
       JOIN corporate_user_associations cua ON cua.user_id = u.id
       LEFT JOIN corporate_departments cd ON e.department_id = cd.id
       WHERE cua.corporate_entity_id = $1
         AND DATE(cc.check_in_time) >= $2
         AND EXTRACT(HOUR FROM cc.check_in_time) >= 9
       ORDER BY cc.check_in_time DESC
       LIMIT 20`,
      [entity.id, startStr]
    )

    return res.json({
      period: { days, startDate: startStr },
      dailyTrend: trendResult.rows,
      departmentBreakdown: deptResult.rows,
      lateArrivals: lateResult.rows,
    })
  } catch (err: any) {
    console.error('[Corporate Reports]', err.message)
    return res.status(500).json({ error: 'Failed to load reports' })
  }
})

// ═══════════════════════════════════════
// ADMIN: Entity settings (read + update)
// ═══════════════════════════════════════
router.get('/admin/settings', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' })
    const entity = await getCorporateEntity(req.user.userId)
    if (!entity) return res.status(403).json({ error: 'No corporate entity assigned' })
    return res.json({ entity })
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to load settings' })
  }
})

router.put('/admin/settings', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' })
    const entity = await getCorporateEntity(req.user.userId)
    if (!entity) return res.status(403).json({ error: 'No corporate entity assigned' })

    const { name, email, phone, headquarters_address, industry } = req.body
    const result = await query(
      `UPDATE corporate_entities
       SET name = COALESCE($1, name), email = COALESCE($2, email),
           phone = COALESCE($3, phone), headquarters_address = COALESCE($4, headquarters_address),
           industry = COALESCE($5, industry), updated_at = NOW()
       WHERE id = $6
       RETURNING *`,
      [name, email, phone, headquarters_address, industry, entity.id]
    )
    return res.json({ success: true, entity: result.rows[0] })
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to update settings' })
  }
})

// ===========================
// EMPLOYEES ENDPOINTS
// ===========================

// GET all employees (tenant-scoped via users.platform_id)
router.get('/employees', authenticateToken, async (req: TenantAwareRequest, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20
    const offset = parseInt(req.query.offset as string) || 0
    const departmentId = req.query.departmentId as string
    const tenantId = req.tenant?.tenantId

    if (!tenantId) {
      return res.status(401).json({ error: 'Tenant context required' })
    }

    let sql =
      'SELECT e.*, u.email as user_email FROM employees e LEFT JOIN users u ON e.user_id = u.id WHERE u.platform_id = $1'
    const params: any[] = [tenantId]

    if (departmentId) {
      sql += ` AND e.department_id = $${params.length + 1}`
      params.push(departmentId)
    }

    sql += ` AND e.is_currently_employed = true ORDER BY e.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`
    params.push(limit, offset)

    const result = await query(sql, params)
    return res.json({
      data: result.rows,
      total: result.rowCount,
      limit,
      offset
    })
  } catch (error: any) {
    return res.status(500).json({ error: error.message })
  }
})

// GET single employee (tenant-scoped)
router.get('/employees/:employeeId', authenticateToken, async (req: TenantAwareRequest, res: Response) => {
  try {
    const { employeeId } = req.params
    const employee = await queries.getEmployeeById(employeeId)

    if (!employee) {
      return res.status(404).json({ error: 'Employee not found' })
    }

    // Enforce tenant ownership via underlying user.platform_id
    await verifyTenantOwnsResource(req.tenant, employee, 'Employee')

    return res.json({ data: employee })
  } catch (error: any) {
    return res.status(500).json({ error: error.message })
  }
})

// CREATE employee (tenant-scoped)
router.post('/employees', authenticateToken, async (req: TenantAwareRequest, res: Response) => {
  try {
    const {
      userId,
      employeeId,
      firstName,
      lastName,
      email,
      phone,
      departmentId,
      designation,
      employmentType,
      dateOfJoining,
      middleName
    } = req.body

    if (!userId || !employeeId || !firstName || !lastName || !email || !phone) {
      return res.status(400).json({ error: 'Missing required fields' })
    }

    const tenantId = req.tenant?.tenantId
    if (!tenantId) {
      return res.status(401).json({ error: 'Tenant context required' })
    }

    // Check if employee already exists in this tenant
    const existing = await query(
      `SELECT e.id
       FROM employees e
       JOIN users u ON e.user_id = u.id
       WHERE e.employee_id = $1 AND u.platform_id = $2`,
      [employeeId, tenantId]
    )
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Employee ID already exists' })
    }

    const result = await query(
      `INSERT INTO employees (user_id, employee_id, first_name, middle_name, last_name, email, phone, department_id, designation, employment_type, date_of_joining)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        userId,
        employeeId,
        firstName,
        middleName || null,
        lastName,
        email,
        phone,
        departmentId || null,
        designation || null,
        employmentType || 'full_time',
        dateOfJoining || new Date().toISOString().split('T')[0]
      ]
    )

    return res.status(201).json({
      message: 'Employee created successfully',
      data: result.rows[0]
    })
  } catch (error: any) {
    console.error('Create employee error:', error)
    return res.status(500).json({ error: error.message })
  }
})

// UPDATE employee (tenant-scoped)
router.put('/employees/:employeeId', authenticateToken, async (req: TenantAwareRequest, res: Response) => {
  try {
    const { employeeId } = req.params
    const updates = req.body

    const validFields = ['first_name', 'middle_name', 'last_name', 'email', 'phone', 'designation', 'department_id', 'employment_type']
    const updateParts: string[] = []
    const values: any[] = []

    Object.entries(updates).forEach(([key, value]) => {
      if (validFields.includes(key)) {
        updateParts.push(`${key} = $${values.length + 1}`)
        values.push(value)
      }
    })

    if (updateParts.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' })
    }

    const tenantId = req.tenant?.tenantId
    if (!tenantId) {
      return res.status(401).json({ error: 'Tenant context required' })
    }

    values.push(employeeId, tenantId)
    const sql = `UPDATE employees SET ${updateParts.join(
      ', '
    )} WHERE id = $${values.length - 1} AND id IN (
      SELECT e.id FROM employees e JOIN users u ON e.user_id = u.id WHERE u.platform_id = $${values.length}
    ) RETURNING *`

    const result = await query(sql, values)

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Employee not found' })
    }

    return res.json({
      message: 'Employee updated successfully',
      data: result.rows[0]
    })
  } catch (error: any) {
    return res.status(500).json({ error: error.message })
  }
})

// TERMINATE employee (tenant-scoped)
router.patch('/employees/:employeeId/terminate', authenticateToken, async (req: TenantAwareRequest, res: Response) => {
  try {
    const { employeeId } = req.params

    const tenantId = req.tenant?.tenantId
    if (!tenantId) {
      return res.status(401).json({ error: 'Tenant context required' })
    }

    const result = await query(
      `UPDATE employees SET is_currently_employed = false WHERE id = $1 AND id IN (
        SELECT e.id FROM employees e JOIN users u ON e.user_id = u.id WHERE u.platform_id = $2
      ) RETURNING *`,
      [employeeId, tenantId]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Employee not found' })
    }

    return res.json({
      message: 'Employee terminated',
      data: result.rows[0]
    })
  } catch (error: any) {
    return res.status(500).json({ error: error.message })
  }
})

// ===========================
// WORK ASSIGNMENTS ENDPOINTS
// ===========================

// GET employee active assignments
router.get('/employees/:employeeId/assignments', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { employeeId } = req.params
    const assignments = await queries.getActiveAssignments(employeeId)
    return res.json({ data: assignments })
  } catch (error: any) {
    return res.status(500).json({ error: error.message })
  }
})

// CREATE work assignment
router.post('/assignments', authenticateToken, async (req: Request, res: Response) => {
  try {
    const {
      employeeId,
      assignmentType,
      assignedDate,
      projectName,
      siteLocation,
      latitude,
      longitude,
      endDate,
      description
    } = req.body

    if (!employeeId || !assignmentType || !assignedDate) {
      return res.status(400).json({ error: 'Missing required fields' })
    }

    if (!['office', 'field', 'remote'].includes(assignmentType)) {
      return res.status(400).json({ error: 'Invalid assignment type' })
    }

    const result = await query(
      `INSERT INTO work_assignments (employee_id, assignment_type, assigned_date, project_name, site_location, latitude, longitude, end_date, description, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)
       RETURNING *`,
      [employeeId, assignmentType, assignedDate, projectName || null, siteLocation || null, latitude || null, longitude || null, endDate || null, description || null]
    )

    return res.status(201).json({
      message: 'Work assignment created',
      data: result.rows[0]
    })
  } catch (error: any) {
    return res.status(500).json({ error: error.message })
  }
})

// END work assignment
router.patch('/assignments/:assignmentId/end', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { assignmentId } = req.params
    const endDate = req.body.endDate || new Date().toISOString().split('T')[0]

    const result = await query(
      `UPDATE work_assignments SET is_active = false, end_date = $1 WHERE id = $2 RETURNING *`,
      [endDate, assignmentId]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Assignment not found' })
    }

    return res.json({
      message: 'Assignment ended',
      data: result.rows[0]
    })
  } catch (error: any) {
    return res.status(500).json({ error: error.message })
  }
})

// ===========================
// CHECK-IN ENDPOINTS
// ===========================

// RECORD check-in
router.post('/checkins', authenticateToken, async (req: Request, res: Response) => {
  try {
    const {
      employeeId,
      checkInType,
      checkInLatitude,
      checkInLongitude,
      siteLocation,
      assignmentId,
      faceVerified
    } = req.body

    if (!employeeId || !checkInType) {
      return res.status(400).json({ error: 'Missing required fields' })
    }

    if (!['office', 'field'].includes(checkInType)) {
      return res.status(400).json({ error: 'Invalid check-in type' })
    }

    const checkin = await queries.recordCheckIn(
      employeeId,
      checkInType,
      checkInLatitude,
      checkInLongitude,
      siteLocation,
      faceVerified || false,
      assignmentId
    )

    return res.status(201).json({
      message: 'Check-in recorded',
      data: checkin
    })
  } catch (error: any) {
    console.error('Check-in error:', error)
    return res.status(500).json({ error: error.message })
  }
})

// RECORD check-out
router.post('/checkins/:checkinId/checkout', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { checkinId } = req.params
    const { checkOutLatitude, checkOutLongitude } = req.body

    const checkout = await queries.recordCheckOut(
      checkinId,
      checkOutLatitude,
      checkOutLongitude
    )

    if (!checkout) {
      return res.status(404).json({ error: 'Check-in not found' })
    }

    return res.json({
      message: 'Check-out recorded',
      data: checkout
    })
  } catch (error: any) {
    return res.status(500).json({ error: error.message })
  }
})

// GET employee check-ins
router.get('/employees/:employeeId/checkins', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { employeeId } = req.params
    const days = parseInt(req.query.days as string) || 30

    const checkins = await queries.getEmployeeCheckIns(employeeId, days)
    return res.json({ data: checkins })
  } catch (error: any) {
    return res.status(500).json({ error: error.message })
  }
})

// GET today's check-ins for department
router.get('/checkins/department/:departmentId', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { departmentId } = req.params
    const today = new Date().toISOString().split('T')[0]

    const result = await query(
      `SELECT e.employee_id, e.first_name, e.last_name, cc.check_in_time, cc.check_out_time, cc.check_in_type, cc.face_verified
       FROM employees e
       LEFT JOIN corporate_checkins cc ON e.id = cc.employee_id AND DATE(cc.check_in_time) = $1
       WHERE e.department_id = $2 AND e.is_currently_employed = true
       ORDER BY e.first_name, e.last_name`,
      [today, departmentId]
    )

    return res.json({ data: result.rows })
  } catch (error: any) {
    return res.status(500).json({ error: error.message })
  }
})

export default router
