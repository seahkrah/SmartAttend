import express, { Request, Response } from 'express'
import { authenticateToken } from '../auth/middleware.js'
import { query } from '../db/connection.js'
import * as queries from '../db/queries.js'
import type { Employee, WorkAssignment, CorporateCheckin } from '../types/database.js'

const router = express.Router()

// ===========================
// EMPLOYEES ENDPOINTS
// ===========================

// GET all employees
router.get('/employees', authenticateToken, async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20
    const offset = parseInt(req.query.offset as string) || 0
    const departmentId = req.query.departmentId as string

    let sql = 'SELECT e.*, u.email as user_email FROM employees e LEFT JOIN users u ON e.user_id = u.id WHERE 1=1'
    const params: any[] = []

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

// GET single employee
router.get('/employees/:employeeId', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { employeeId } = req.params
    const employee = await queries.getEmployeeById(employeeId)

    if (!employee) {
      return res.status(404).json({ error: 'Employee not found' })
    }

    return res.json({ data: employee })
  } catch (error: any) {
    return res.status(500).json({ error: error.message })
  }
})

// CREATE employee
router.post('/employees', authenticateToken, async (req: Request, res: Response) => {
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

    // Check if employee already exists
    const existing = await query('SELECT id FROM employees WHERE employee_id = $1', [employeeId])
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

// UPDATE employee
router.put('/employees/:employeeId', authenticateToken, async (req: Request, res: Response) => {
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

    values.push(employeeId)
    const sql = `UPDATE employees SET ${updateParts.join(', ')} WHERE id = $${values.length} RETURNING *`

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

// TERMINATE employee
router.patch('/employees/:employeeId/terminate', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { employeeId } = req.params

    const result = await query(
      'UPDATE employees SET is_currently_employed = false WHERE id = $1 RETURNING *',
      [employeeId]
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
