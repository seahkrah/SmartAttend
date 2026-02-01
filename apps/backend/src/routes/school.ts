import express, { Request, Response } from 'express'
import { authenticateToken } from '../auth/middleware.js'
import { query } from '../db/connection.js'
import * as queries from '../db/queries.js'
import type { Student } from '../types/database.js'

const router = express.Router()

// ===========================
// STUDENTS ENDPOINTS
// ===========================

// GET all students with pagination
router.get('/students', authenticateToken, async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20
    const offset = parseInt(req.query.offset as string) || 0
    const departmentId = req.query.departmentId as string

    let sql = 'SELECT s.*, u.email as user_email, u.full_name FROM students s LEFT JOIN users u ON s.user_id = u.id WHERE 1=1'
    const params: any[] = []

    if (departmentId) {
      sql += ` AND s.department_id = $${params.length + 1}`
      params.push(departmentId)
    }

    sql += ` ORDER BY s.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`
    params.push(limit, offset)

    const result = await query(sql, params)
    return res.json({
      data: result.rows,
      total: result.rowCount,
      limit,
      offset
    })
  } catch (error: any) {
    console.error('Get students error:', error)
    return res.status(500).json({ error: error.message })
  }
})

// GET single student
router.get('/students/:studentId', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { studentId } = req.params
    const student = await queries.getStudentById(studentId)

    if (!student) {
      return res.status(404).json({ error: 'Student not found' })
    }

    return res.json({ data: student })
  } catch (error: any) {
    return res.status(500).json({ error: error.message })
  }
})

// CREATE student
router.post('/students', authenticateToken, async (req: Request, res: Response) => {
  try {
    const {
      userId,
      studentId,
      firstName,
      lastName,
      college,
      email,
      status,
      enrollmentYear,
      departmentId,
      middleName
    } = req.body

    if (!userId || !studentId || !firstName || !lastName || !college || !email || !status || !enrollmentYear) {
      return res.status(400).json({ error: 'Missing required fields' })
    }

    if (!['Freshman', 'Sophomore', 'Junior', 'Senior'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' })
    }

    // Check if student already exists
    const existing = await query('SELECT id FROM students WHERE student_id = $1', [studentId])
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Student ID already exists' })
    }

    // Insert with middle name if provided
    const result = await query(
      `INSERT INTO students (user_id, student_id, first_name, middle_name, last_name, college, email, status, enrollment_year, department_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [userId, studentId, firstName, middleName || null, lastName, college, email, status, enrollmentYear, departmentId || null]
    )

    return res.status(201).json({
      message: 'Student created successfully',
      data: result.rows[0]
    })
  } catch (error: any) {
    console.error('Create student error:', error)
    return res.status(500).json({ error: error.message })
  }
})

// UPDATE student
router.put('/students/:studentId', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { studentId } = req.params
    const updates = req.body

    // Build update query dynamically
    const validFields = ['first_name', 'middle_name', 'last_name', 'college', 'email', 'status', 'department_id']
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

    values.push(studentId)
    const sql = `UPDATE students SET ${updateParts.join(', ')} WHERE id = $${values.length} RETURNING *`

    const result = await query(sql, values)

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Student not found' })
    }

    return res.json({
      message: 'Student updated successfully',
      data: result.rows[0]
    })
  } catch (error: any) {
    return res.status(500).json({ error: error.message })
  }
})

// DELETE student
router.delete('/students/:studentId', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { studentId } = req.params

    // Soft delete or actual delete - choose based on requirements
    const result = await query(
      'UPDATE students SET is_currently_enrolled = false WHERE id = $1 RETURNING *',
      [studentId]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Student not found' })
    }

    return res.json({
      message: 'Student deleted successfully',
      data: result.rows[0]
    })
  } catch (error: any) {
    return res.status(500).json({ error: error.message })
  }
})

// GET student schedules
router.get('/students/:studentId/schedules', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { studentId } = req.params
    const schedules = await queries.getStudentSchedules(studentId)
    return res.json({ data: schedules })
  } catch (error: any) {
    return res.status(500).json({ error: error.message })
  }
})

// GET student attendance
router.get('/students/:studentId/attendance', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { studentId } = req.params
    const startDate = (req.query.startDate as string) || '2026-01-01'
    const endDate = (req.query.endDate as string) || '2026-12-31'

    const attendance = await queries.getStudentAttendance(studentId, startDate, endDate)
    return res.json({ data: attendance })
  } catch (error: any) {
    return res.status(500).json({ error: error.message })
  }
})

// ===========================
// FACULTY ENDPOINTS
// ===========================

// GET all faculty
router.get('/faculty', authenticateToken, async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20
    const offset = parseInt(req.query.offset as string) || 0
    const departmentId = req.query.departmentId as string

    let sql = 'SELECT f.*, u.email as user_email FROM faculty f LEFT JOIN users u ON f.user_id = u.id WHERE 1=1'
    const params: any[] = []

    if (departmentId) {
      sql += ` AND f.department_id = $${params.length + 1}`
      params.push(departmentId)
    }

    sql += ` ORDER BY f.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`
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

// GET single faculty
router.get('/faculty/:facultyId', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { facultyId } = req.params
    const faculty = await queries.getFacultyById(facultyId)

    if (!faculty) {
      return res.status(404).json({ error: 'Faculty not found' })
    }

    return res.json({ data: faculty })
  } catch (error: any) {
    return res.status(500).json({ error: error.message })
  }
})

// CREATE faculty
router.post('/faculty', authenticateToken, async (req: Request, res: Response) => {
  try {
    const {
      userId,
      employeeId,
      firstName,
      lastName,
      college,
      email,
      departmentId,
      specialization,
      officeLocation,
      middleName
    } = req.body

    if (!userId || !employeeId || !firstName || !lastName || !college || !email) {
      return res.status(400).json({ error: 'Missing required fields' })
    }

    // Check if faculty already exists
    const existing = await query('SELECT id FROM faculty WHERE employee_id = $1', [employeeId])
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Employee ID already exists' })
    }

    const result = await query(
      `INSERT INTO faculty (user_id, employee_id, first_name, middle_name, last_name, college, email, department_id, specialization, office_location)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [userId, employeeId, firstName, middleName || null, lastName, college, email, departmentId || null, specialization || null, officeLocation || null]
    )

    return res.status(201).json({
      message: 'Faculty created successfully',
      data: result.rows[0]
    })
  } catch (error: any) {
    return res.status(500).json({ error: error.message })
  }
})

// UPDATE faculty
router.put('/faculty/:facultyId', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { facultyId } = req.params
    const updates = req.body

    const validFields = ['first_name', 'middle_name', 'last_name', 'college', 'email', 'specialization', 'office_location', 'office_hours', 'department_id']
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

    values.push(facultyId)
    const sql = `UPDATE faculty SET ${updateParts.join(', ')} WHERE id = $${values.length} RETURNING *`

    const result = await query(sql, values)

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Faculty not found' })
    }

    return res.json({
      message: 'Faculty updated successfully',
      data: result.rows[0]
    })
  } catch (error: any) {
    return res.status(500).json({ error: error.message })
  }
})

// GET faculty courses
router.get('/faculty/:facultyId/courses', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { facultyId } = req.params
    const courses = await queries.getFacultyCourses(facultyId)
    return res.json({ data: courses })
  } catch (error: any) {
    return res.status(500).json({ error: error.message })
  }
})

// ASSIGN faculty to course
router.post('/faculty/:facultyId/courses/:courseId', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { facultyId, courseId } = req.params
    const assignment = await queries.assignFacultyToCourse(facultyId, courseId)
    return res.status(201).json({
      message: 'Faculty assigned to course',
      data: assignment
    })
  } catch (error: any) {
    return res.status(500).json({ error: error.message })
  }
})

export default router
