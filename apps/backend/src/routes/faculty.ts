import express, { Request, Response } from 'express'
import { query } from '../db/connection.js'
import { authenticateToken, requireRole } from '../auth/middleware.js'

const router = express.Router()

// ===========================
// FACULTY ROUTES
// Routes for faculty-role users: courses, schedules, attendance
// ===========================

// Helper: resolve faculty ID from user ID
async function resolveFacultyId(userId: string): Promise<string | null> {
  const result = await query('SELECT id FROM faculty WHERE user_id = $1 LIMIT 1', [userId])
  return result.rows.length > 0 ? result.rows[0].id : null
}

// Helper: verify faculty owns a schedule
async function verifyScheduleOwnership(scheduleId: string, facultyId: string): Promise<boolean> {
  const result = await query(
    'SELECT id FROM class_schedules WHERE id = $1 AND faculty_id = $2',
    [scheduleId, facultyId]
  )
  return result.rows.length > 0
}

// ===========================
// DASHBOARD
// ===========================

/**
 * GET /faculty/dashboard
 * Aggregated stats for the faculty sidebar and dashboard page
 */
router.get('/dashboard', authenticateToken, requireRole('faculty'), async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })

    const facultyId = await resolveFacultyId(userId)
    if (!facultyId) return res.json({
      total_students: 0, total_courses: 0, total_schedules: 0,
      today_classes: [], attendance_rate: 0, recent_sessions: 0, course_breakdown: []
    })

    // Total distinct students across all schedules
    const studentsResult = await query(
      `SELECT COUNT(DISTINCT ss.student_id) as total
       FROM student_schedules ss
       JOIN class_schedules cs ON ss.schedule_id = cs.id
       WHERE cs.faculty_id = $1 AND ss.status = 'enrolled'`,
      [facultyId]
    )
    const total_students = parseInt(studentsResult.rows[0]?.total || '0')

    // Total courses & schedules
    const schedulesResult = await query(
      `SELECT COUNT(*) as schedule_count, COUNT(DISTINCT course_id) as course_count
       FROM class_schedules WHERE faculty_id = $1`,
      [facultyId]
    )
    const total_courses = parseInt(schedulesResult.rows[0]?.course_count || '0')
    const total_schedules = parseInt(schedulesResult.rows[0]?.schedule_count || '0')

    // Today's classes (match day_of_week: 0=Sun..6=Sat)
    const today = new Date()
    const dayOfWeek = today.getDay() // JS: 0=Sun
    const todayClasses = await query(
      `SELECT cs.id, c.name as course_name, c.code as course_code,
              r.room_number as room_name, cs.start_time, cs.end_time, cs.section,
              (SELECT COUNT(*) FROM student_schedules ss WHERE ss.schedule_id = cs.id AND ss.status = 'enrolled') as student_count
       FROM class_schedules cs
       JOIN courses c ON cs.course_id = c.id
       LEFT JOIN rooms r ON cs.room_id = r.id
       WHERE cs.faculty_id = $1
         AND (cs.days_of_week LIKE '%' || $2 || '%')
       ORDER BY cs.start_time`,
      [facultyId, String(dayOfWeek)]
    )

    // Overall attendance rate (from all time)
    const rateResult = await query(
      `SELECT
         COUNT(*) as total,
         COUNT(*) FILTER (WHERE sa.status IN ('present','late')) as attended
       FROM school_attendance sa
       JOIN class_schedules cs ON sa.schedule_id = cs.id
       WHERE cs.faculty_id = $1`,
      [facultyId]
    )
    const rateTotal = parseInt(rateResult.rows[0]?.total || '0')
    const rateAttended = parseInt(rateResult.rows[0]?.attended || '0')
    const attendance_rate = rateTotal > 0 ? Math.round((rateAttended / rateTotal) * 100) : 0

    // Recent sessions count (last 7 days)
    const recentResult = await query(
      `SELECT COUNT(DISTINCT attendance_date) as cnt
       FROM school_attendance sa
       JOIN class_schedules cs ON sa.schedule_id = cs.id
       WHERE cs.faculty_id = $1 AND sa.attendance_date >= CURRENT_DATE - INTERVAL '7 days'`,
      [facultyId]
    )
    const recent_sessions = parseInt(recentResult.rows[0]?.cnt || '0')

    // Course breakdown: per-course student count
    const breakdownResult = await query(
      `SELECT c.code as course_code, c.name as course_name,
              COUNT(DISTINCT ss.student_id) as student_count
       FROM class_schedules cs
       JOIN courses c ON cs.course_id = c.id
       JOIN student_schedules ss ON ss.schedule_id = cs.id AND ss.status = 'enrolled'
       WHERE cs.faculty_id = $1
       GROUP BY c.id, c.code, c.name
       ORDER BY c.name`,
      [facultyId]
    )

    return res.json({
      total_students,
      total_courses,
      total_schedules,
      today_classes: todayClasses.rows,
      attendance_rate,
      recent_sessions,
      course_breakdown: breakdownResult.rows.map((r: any) => ({
        courseCode: r.course_code,
        courseName: r.course_name,
        studentCount: parseInt(r.student_count),
      })),
    })
  } catch (error: any) {
    console.error('[faculty/dashboard] Error:', error)
    return res.status(500).json({ error: 'Failed to load dashboard' })
  }
})

// ===========================
// ALL STUDENTS (across schedules)
// ===========================

/**
 * GET /faculty/students
 * Returns all students enrolled in faculty's schedules with attendance stats
 */
router.get('/students', authenticateToken, requireRole('faculty'), async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })

    const facultyId = await resolveFacultyId(userId)
    if (!facultyId) return res.json([])

    const result = await query(
      `SELECT
         s.id as student_id,
         s.student_id as student_code,
         s.first_name,
         s.last_name,
         s.email,
         c.code as course_code,
         c.name as course_name,
         cs.section as schedule_section,
         COUNT(DISTINCT sa_all.attendance_date) as total_classes,
         COUNT(DISTINCT sa_all.attendance_date) FILTER (WHERE sa_all.status = 'present') as present_count,
         COUNT(DISTINCT sa_all.attendance_date) FILTER (WHERE sa_all.status = 'absent') as absent_count
       FROM student_schedules ss
       JOIN class_schedules cs ON ss.schedule_id = cs.id
       JOIN courses c ON cs.course_id = c.id
       JOIN students s ON ss.student_id = s.id
       LEFT JOIN school_attendance sa_all
         ON sa_all.student_id = s.id AND sa_all.schedule_id = cs.id
       WHERE cs.faculty_id = $1 AND ss.status = 'enrolled'
       GROUP BY s.id, s.student_id, s.first_name, s.last_name, s.email,
                c.code, c.name, cs.section
       ORDER BY s.last_name, s.first_name, c.code`,
      [facultyId]
    )

    return res.json(result.rows)
  } catch (error: any) {
    console.error('[faculty/students] Error:', error)
    return res.status(500).json({ error: 'Failed to fetch students' })
  }
})

// ===========================
// ENROLLMENT MANAGEMENT
// ===========================

/**
 * GET /faculty/enrollment/enrolled?schedule_id=X
 * Students currently enrolled in a specific schedule
 */
router.get('/enrollment/enrolled', authenticateToken, requireRole('faculty'), async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId
    const scheduleId = req.query.schedule_id as string
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })
    if (!scheduleId) return res.status(400).json({ error: 'schedule_id required' })

    const facultyId = await resolveFacultyId(userId)
    if (!facultyId) return res.status(403).json({ error: 'Not a faculty member' })

    const owns = await verifyScheduleOwnership(scheduleId, facultyId)
    if (!owns) return res.status(403).json({ error: 'Schedule not assigned to you' })

    const result = await query(
      `SELECT s.id as student_id, s.student_id as student_code,
              s.first_name, s.last_name, s.email, ss.enrolled_at
       FROM student_schedules ss
       JOIN students s ON ss.student_id = s.id
       WHERE ss.schedule_id = $1 AND ss.status = 'enrolled'
       ORDER BY s.last_name, s.first_name`,
      [scheduleId]
    )

    return res.json(result.rows)
  } catch (error: any) {
    console.error('[faculty/enrollment/enrolled] Error:', error)
    return res.status(500).json({ error: 'Failed to fetch enrolled students' })
  }
})

/**
 * GET /faculty/enrollment/available?schedule_id=X
 * Students in the same platform/tenant who are NOT in this schedule
 */
router.get('/enrollment/available', authenticateToken, requireRole('faculty'), async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId
    const scheduleId = req.query.schedule_id as string
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })
    if (!scheduleId) return res.status(400).json({ error: 'schedule_id required' })

    const facultyId = await resolveFacultyId(userId)
    if (!facultyId) return res.status(403).json({ error: 'Not a faculty member' })

    const owns = await verifyScheduleOwnership(scheduleId, facultyId)
    if (!owns) return res.status(403).json({ error: 'Schedule not assigned to you' })

    // Get the platform_id from the faculty user to scope students
    const platformResult = await query(
      `SELECT u.platform_id FROM users u WHERE u.id = $1`,
      [userId]
    )
    const platformId = platformResult.rows[0]?.platform_id

    const result = await query(
      `SELECT s.id, s.student_id, s.first_name, s.last_name, s.email
       FROM students s
       JOIN users u ON s.user_id = u.id
       WHERE u.platform_id = $1
         AND s.id NOT IN (
           SELECT ss.student_id FROM student_schedules ss
           WHERE ss.schedule_id = $2 AND ss.status = 'enrolled'
         )
       ORDER BY s.last_name, s.first_name`,
      [platformId, scheduleId]
    )

    return res.json(result.rows)
  } catch (error: any) {
    console.error('[faculty/enrollment/available] Error:', error)
    return res.status(500).json({ error: 'Failed to fetch available students' })
  }
})

/**
 * POST /faculty/enrollment/add
 * Enroll a student into a faculty-owned schedule
 * Body: { schedule_id, student_id }
 */
router.post('/enrollment/add', authenticateToken, requireRole('faculty'), async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })

    const { schedule_id, student_id } = req.body
    if (!schedule_id || !student_id) {
      return res.status(400).json({ error: 'schedule_id and student_id required' })
    }

    const facultyId = await resolveFacultyId(userId)
    if (!facultyId) return res.status(403).json({ error: 'Not a faculty member' })

    const owns = await verifyScheduleOwnership(schedule_id, facultyId)
    if (!owns) return res.status(403).json({ error: 'Schedule not assigned to you' })

    // Check not already enrolled
    const existing = await query(
      `SELECT id FROM student_schedules WHERE schedule_id = $1 AND student_id = $2 AND status = 'enrolled'`,
      [schedule_id, student_id]
    )
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Student already enrolled in this schedule' })
    }

    await query(
      `INSERT INTO student_schedules (schedule_id, student_id, status, enrolled_at)
       VALUES ($1, $2, 'enrolled', NOW())
       ON CONFLICT (schedule_id, student_id)
       DO UPDATE SET status = 'enrolled', enrolled_at = NOW()`,
      [schedule_id, student_id]
    )

    return res.json({ success: true })
  } catch (error: any) {
    console.error('[faculty/enrollment/add] Error:', error)
    return res.status(500).json({ error: 'Failed to enroll student' })
  }
})

/**
 * POST /faculty/enrollment/remove
 * Remove (unenroll) a student from a faculty-owned schedule
 * Body: { schedule_id, student_id }
 */
router.post('/enrollment/remove', authenticateToken, requireRole('faculty'), async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })

    const { schedule_id, student_id } = req.body
    if (!schedule_id || !student_id) {
      return res.status(400).json({ error: 'schedule_id and student_id required' })
    }

    const facultyId = await resolveFacultyId(userId)
    if (!facultyId) return res.status(403).json({ error: 'Not a faculty member' })

    const owns = await verifyScheduleOwnership(schedule_id, facultyId)
    if (!owns) return res.status(403).json({ error: 'Schedule not assigned to you' })

    await query(
      `DELETE FROM student_schedules WHERE schedule_id = $1 AND student_id = $2`,
      [schedule_id, student_id]
    )

    return res.json({ success: true })
  } catch (error: any) {
    console.error('[faculty/enrollment/remove] Error:', error)
    return res.status(500).json({ error: 'Failed to remove student' })
  }
})

// ===========================
// REPORTS
// ===========================

/**
 * GET /faculty/reports?course_id=X&schedule_id=X&date_from=YYYY-MM-DD&date_to=YYYY-MM-DD
 * Returns per-student attendance breakdown for report generation
 */
router.get('/reports', authenticateToken, requireRole('faculty'), async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })

    const facultyId = await resolveFacultyId(userId)
    if (!facultyId) return res.json([])

    const courseId = req.query.course_id as string | undefined
    const scheduleId = req.query.schedule_id as string | undefined
    const dateFrom = req.query.date_from as string | undefined
    const dateTo = req.query.date_to as string | undefined

    // Build dynamic WHERE clauses
    const conditions: string[] = ['cs.faculty_id = $1', 'ss.status = \'enrolled\'']
    const params: any[] = [facultyId]
    let paramIdx = 2

    if (scheduleId && scheduleId !== 'all') {
      conditions.push(`cs.id = $${paramIdx}`)
      params.push(scheduleId)
      paramIdx++
    } else if (courseId && courseId !== 'all') {
      conditions.push(`cs.course_id = $${paramIdx}`)
      params.push(courseId)
      paramIdx++
    }

    // Date filters on attendance records
    const dateConditions: string[] = []
    if (dateFrom) {
      dateConditions.push(`sa.attendance_date >= $${paramIdx}`)
      params.push(dateFrom)
      paramIdx++
    }
    if (dateTo) {
      dateConditions.push(`sa.attendance_date <= $${paramIdx}`)
      params.push(dateTo)
      paramIdx++
    }

    const dateFilter = dateConditions.length > 0 ? ` AND ${dateConditions.join(' AND ')}` : ''

    const sql = `
      SELECT
        s.id as student_id,
        s.student_id as student_code,
        s.first_name,
        s.last_name,
        s.email,
        COUNT(DISTINCT sa.attendance_date) as total_sessions,
        COUNT(DISTINCT sa.attendance_date) FILTER (WHERE sa.status = 'present') as present,
        COUNT(DISTINCT sa.attendance_date) FILTER (WHERE sa.status = 'absent') as absent,
        COUNT(DISTINCT sa.attendance_date) FILTER (WHERE sa.status = 'late') as late,
        COUNT(DISTINCT sa.attendance_date) FILTER (WHERE sa.status = 'excused') as excused
      FROM student_schedules ss
      JOIN class_schedules cs ON ss.schedule_id = cs.id
      JOIN students s ON ss.student_id = s.id
      LEFT JOIN school_attendance sa
        ON sa.student_id = s.id AND sa.schedule_id = cs.id${dateFilter}
      WHERE ${conditions.join(' AND ')}
      GROUP BY s.id, s.student_id, s.first_name, s.last_name, s.email
      ORDER BY s.last_name, s.first_name
    `

    const result = await query(sql, params)

    const rows = result.rows.map((r: any) => {
      const total = parseInt(r.total_sessions) || 0
      const present = parseInt(r.present) || 0
      const late = parseInt(r.late) || 0
      return {
        ...r,
        total_sessions: total,
        present: present,
        absent: parseInt(r.absent) || 0,
        late: late,
        excused: parseInt(r.excused) || 0,
        rate: total > 0 ? Math.round(((present + late) / total) * 100) : 0,
      }
    })

    return res.json(rows)
  } catch (error: any) {
    console.error('[faculty/reports] Error:', error)
    return res.status(500).json({ error: 'Failed to generate report' })
  }
})

// ===========================
// COURSES
// ===========================

/**
 * GET /faculty/courses
 * Returns courses assigned to the logged-in faculty member
 */
router.get('/courses', authenticateToken, requireRole('faculty'), async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })

    const facultyId = await resolveFacultyId(userId)
    if (!facultyId) return res.json([])

    const coursesResult = await query(
      `SELECT DISTINCT c.id, c.name, c.code, c.description, c.credits
       FROM courses c
       JOIN class_schedules cs ON cs.course_id = c.id
       WHERE cs.faculty_id = $1
       ORDER BY c.name`,
      [facultyId]
    )

    return res.json(coursesResult.rows)
  } catch (error: any) {
    return res.status(500).json({ error: 'Failed to fetch courses' })
  }
})

/**
 * GET /faculty/courses/:courseId/roster
 * Returns student roster for a specific course (uses student_schedules)
 */
router.get('/courses/:courseId/roster', authenticateToken, requireRole('faculty'), async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId
    const { courseId } = req.params
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })

    const facultyId = await resolveFacultyId(userId)
    if (!facultyId) return res.status(403).json({ error: 'Not a faculty member' })

    const courseResult = await query('SELECT id, name, code FROM courses WHERE id = $1', [courseId])
    if (courseResult.rows.length === 0) return res.status(404).json({ error: 'Course not found' })

    // Get students enrolled via student_schedules -> class_schedules
    const studentsResult = await query(
      `SELECT DISTINCT s.id,
              CONCAT(s.first_name, ' ', COALESCE(s.middle_name || ' ', ''), s.last_name) as name,
              s.email,
              ss.id as enrollment_id
       FROM student_schedules ss
       JOIN class_schedules cs ON ss.schedule_id = cs.id
       JOIN students s ON ss.student_id = s.id
       WHERE cs.course_id = $1 AND cs.faculty_id = $2 AND ss.status = 'enrolled'
       ORDER BY name`,
      [courseId, facultyId]
    )

    return res.json({
      course_id: courseResult.rows[0].id,
      course_name: courseResult.rows[0].name,
      code: courseResult.rows[0].code,
      students: studentsResult.rows
    })
  } catch (error: any) {
    return res.status(500).json({ error: 'Failed to fetch roster' })
  }
})

/**
 * GET /faculty/courses/:courseId/attendance-summary
 * Returns per-student attendance summary for a course
 */
router.get('/courses/:courseId/attendance-summary', authenticateToken, requireRole('faculty'), async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId
    const { courseId } = req.params
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })

    const facultyId = await resolveFacultyId(userId)
    if (!facultyId) return res.status(403).json({ error: 'Not a faculty member' })

    // Get all schedules for this course + faculty
    const schedules = await query(
      'SELECT id FROM class_schedules WHERE course_id = $1 AND faculty_id = $2',
      [courseId, facultyId]
    )
    if (schedules.rows.length === 0) return res.json([])

    const scheduleIds = schedules.rows.map((r: any) => r.id)

    const summaryResult = await query(
      `SELECT
        s.id as student_id,
        CONCAT(s.first_name, ' ', COALESCE(s.middle_name || ' ', ''), s.last_name) as student_name,
        COUNT(sa.id) as classes_total,
        COUNT(*) FILTER (WHERE sa.status = 'present') as present,
        COUNT(*) FILTER (WHERE sa.status = 'absent') as absent,
        COUNT(*) FILTER (WHERE sa.status = 'late') as late,
        COUNT(*) FILTER (WHERE sa.status = 'excused') as excused
       FROM student_schedules ss
       JOIN students s ON ss.student_id = s.id
       LEFT JOIN school_attendance sa ON sa.student_id = s.id AND sa.schedule_id = ANY($1)
       WHERE ss.schedule_id = ANY($1) AND ss.status = 'enrolled'
       GROUP BY s.id, s.first_name, s.middle_name, s.last_name
       ORDER BY s.last_name, s.first_name`,
      [scheduleIds]
    )

    const summary = summaryResult.rows.map((row: any) => ({
      ...row,
      attendance_percent: parseInt(row.classes_total) > 0
        ? Math.round((parseInt(row.present) + parseInt(row.late)) / parseInt(row.classes_total) * 100)
        : 0
    }))

    return res.json(summary)
  } catch (error: any) {
    return res.status(500).json({ error: 'Failed to fetch attendance summary' })
  }
})

// ===========================
// SCHEDULES
// ===========================

/**
 * GET /faculty/schedules
 * Returns all class schedules assigned to this faculty with course/room/enrollment info
 */
router.get('/schedules', authenticateToken, requireRole('faculty'), async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })

    const facultyId = await resolveFacultyId(userId)
    if (!facultyId) return res.json([])

    const schedulesResult = await query(
      `SELECT
        cs.id,
        cs.course_id,
        c.name as course_name,
        c.code as course_code,
        cs.room_id,
        r.room_number as room_name,
        cs.days_of_week,
        cs.start_time,
        cs.end_time,
        cs.section,
        (SELECT COUNT(*) FROM student_schedules ss WHERE ss.schedule_id = cs.id AND ss.status = 'enrolled') as student_count
       FROM class_schedules cs
       JOIN courses c ON cs.course_id = c.id
       LEFT JOIN rooms r ON cs.room_id = r.id
       WHERE cs.faculty_id = $1
       ORDER BY c.name, cs.section`,
      [facultyId]
    )

    return res.json(schedulesResult.rows)
  } catch (error: any) {
    return res.status(500).json({ error: 'Failed to fetch schedules' })
  }
})

/**
 * GET /faculty/schedules/:scheduleId/students?date=YYYY-MM-DD
 * Returns enrolled students with their attendance status for a given date
 */
router.get('/schedules/:scheduleId/students', authenticateToken, requireRole('faculty'), async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId
    const { scheduleId } = req.params
    const date = (req.query.date as string) || new Date().toISOString().split('T')[0]
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })

    const facultyId = await resolveFacultyId(userId)
    if (!facultyId) return res.status(403).json({ error: 'Not a faculty member' })

    const owns = await verifyScheduleOwnership(scheduleId, facultyId)
    if (!owns) return res.status(403).json({ error: 'Schedule not assigned to you' })

    // Enrolled students LEFT JOIN attendance for this date
    const studentsResult = await query(
      `SELECT
        s.id as student_id,
        s.student_id as student_code,
        s.first_name,
        s.last_name,
        s.email,
        sa.status as attendance_status,
        sa.remarks,
        sa.marked_at,
        sa.face_verified,
        CASE WHEN sfe.id IS NOT NULL THEN true ELSE false END as has_face_enrolled
       FROM student_schedules ss
       JOIN students s ON ss.student_id = s.id
       LEFT JOIN school_attendance sa
         ON sa.schedule_id = $1 AND sa.student_id = s.id AND sa.attendance_date = $2
       LEFT JOIN student_face_embeddings sfe ON sfe.student_id = s.id AND sfe.is_verified = true
       WHERE ss.schedule_id = $1 AND ss.status = 'enrolled'
       ORDER BY s.last_name, s.first_name`,
      [scheduleId, date]
    )

    return res.json({
      schedule_id: scheduleId,
      date,
      students: studentsResult.rows
    })
  } catch (error: any) {
    return res.status(500).json({ error: 'Failed to fetch students' })
  }
})

// ===========================
// ATTENDANCE MARKING
// ===========================

/**
 * POST /faculty/attendance/mark
 * Mark/update attendance for students in a schedule on a given date.
 * Body: { schedule_id, date, entries: [{ student_id, status, remarks? }] }
 */
router.post('/attendance/mark', authenticateToken, requireRole('faculty'), async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })

    const { schedule_id, date, entries } = req.body
    if (!schedule_id || !date || !Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({ error: 'Required: schedule_id, date, entries[]' })
    }

    const facultyId = await resolveFacultyId(userId)
    if (!facultyId) return res.status(403).json({ error: 'Not a faculty member' })

    const owns = await verifyScheduleOwnership(schedule_id, facultyId)
    if (!owns) return res.status(403).json({ error: 'Schedule not assigned to you' })

    // Validate status values
    const validStatuses = ['present', 'absent', 'late', 'excused']
    for (const entry of entries) {
      if (!entry.student_id || !entry.status) {
        return res.status(400).json({ error: 'Each entry requires student_id and status' })
      }
      if (!validStatuses.includes(entry.status.toLowerCase())) {
        return res.status(400).json({ error: `Invalid status "${entry.status}". Must be: ${validStatuses.join(', ')}` })
      }
    }

    // Validate all students are enrolled
    const studentIds = entries.map((e: any) => e.student_id)
    const enrolledCheck = await query(
      `SELECT student_id FROM student_schedules
       WHERE schedule_id = $1 AND student_id = ANY($2) AND status = 'enrolled'`,
      [schedule_id, studentIds]
    )
    const enrolledIds = new Set(enrolledCheck.rows.map((r: any) => r.student_id))
    const notEnrolled = studentIds.filter((id: string) => !enrolledIds.has(id))
    if (notEnrolled.length > 0) {
      return res.status(400).json({ error: `Students not enrolled: ${notEnrolled.length} student(s)` })
    }

    // Upsert attendance records
    let markedCount = 0
    for (const entry of entries) {
      const faceVerified = entry.face_verified === true
      await query(
        `INSERT INTO school_attendance (schedule_id, student_id, marked_by_id, attendance_date, status, remarks, face_verified, marked_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         ON CONFLICT (schedule_id, student_id, attendance_date)
         DO UPDATE SET status = $5, remarks = $6, face_verified = $7, marked_by_id = $3, marked_at = NOW()`,
        [schedule_id, entry.student_id, facultyId, date, entry.status.toLowerCase(), entry.remarks || null, faceVerified]
      )
      markedCount++
    }

    return res.json({ success: true, marked_count: markedCount })
  } catch (error: any) {
    return res.status(500).json({ error: 'Failed to mark attendance' })
  }
})

/**
 * GET /faculty/attendance/history?schedule_id=X
 * Returns attendance dates with tallies for a schedule (last 30 sessions)
 */
router.get('/attendance/history', authenticateToken, requireRole('faculty'), async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId
    const scheduleId = req.query.schedule_id as string
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })
    if (!scheduleId) return res.status(400).json({ error: 'schedule_id required' })

    const facultyId = await resolveFacultyId(userId)
    if (!facultyId) return res.status(403).json({ error: 'Not a faculty member' })

    const owns = await verifyScheduleOwnership(scheduleId, facultyId)
    if (!owns) return res.status(403).json({ error: 'Schedule not assigned to you' })

    const historyResult = await query(
      `SELECT
        attendance_date,
        COUNT(*) as total_marked,
        COUNT(*) FILTER (WHERE status = 'present') as present_count,
        COUNT(*) FILTER (WHERE status = 'absent') as absent_count,
        COUNT(*) FILTER (WHERE status = 'late') as late_count,
        COUNT(*) FILTER (WHERE status = 'excused') as excused_count
       FROM school_attendance
       WHERE schedule_id = $1
       GROUP BY attendance_date
       ORDER BY attendance_date DESC
       LIMIT 30`,
      [scheduleId]
    )

    return res.json(historyResult.rows)
  } catch (error: any) {
    return res.status(500).json({ error: 'Failed to fetch attendance history' })
  }
})

// ===========================
// FACE RECOGNITION
// ===========================

/**
 * GET /faculty/face-status?schedule_id=X
 * Returns which students in a schedule have enrolled face embeddings
 */
router.get('/face-status', authenticateToken, requireRole('faculty'), async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId
    const scheduleId = req.query.schedule_id as string
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })
    if (!scheduleId) return res.status(400).json({ error: 'schedule_id required' })

    const facultyId = await resolveFacultyId(userId)
    if (!facultyId) return res.status(403).json({ error: 'Not a faculty member' })

    const owns = await verifyScheduleOwnership(scheduleId, facultyId)
    if (!owns) return res.status(403).json({ error: 'Schedule not assigned to you' })

    // Get enrolled students with face enrollment status
    const result = await query(
      `SELECT
        s.id as student_id,
        s.student_id as student_code,
        s.first_name,
        s.last_name,
        CASE WHEN sfe.id IS NOT NULL THEN true ELSE false END as has_face
       FROM student_schedules ss
       JOIN students s ON ss.student_id = s.id
       LEFT JOIN student_face_embeddings sfe ON sfe.student_id = s.id AND sfe.is_verified = true
       WHERE ss.schedule_id = $1 AND ss.status = 'enrolled'
       ORDER BY s.last_name, s.first_name`,
      [scheduleId]
    )

    return res.json(result.rows)
  } catch (error: any) {
    console.error('[faculty/face-status] Error:', error)
    return res.status(500).json({ error: 'Failed to fetch face status' })
  }
})

/**
 * POST /faculty/face-enroll
 * Enroll a student's face embedding for future recognition
 * Body: { student_id, embedding (number[128]), liveness_score? }
 */
router.post('/face-enroll', authenticateToken, requireRole('faculty'), async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })

    const { student_id, embedding, liveness_score } = req.body
    if (!student_id || !embedding || !Array.isArray(embedding)) {
      return res.status(400).json({ error: 'student_id and embedding[] required' })
    }
    if (embedding.length !== 128) {
      return res.status(400).json({ error: 'Embedding must be 128 dimensions' })
    }

    const facultyId = await resolveFacultyId(userId)
    if (!facultyId) return res.status(403).json({ error: 'Not a faculty member' })

    // Serialize embedding as JSON string for storage/hash
    const embeddingJson = JSON.stringify(embedding)
    const crypto = await import('crypto')
    const embeddingHash = crypto.createHash('sha256').update(embeddingJson).digest('hex')

    // Upsert: replace existing embedding for this student
    await query(
      `INSERT INTO student_face_embeddings (student_id, embedding_url, embedding_hash, liveness_score, is_verified, captured_at)
       VALUES ($1, $2, $3, $4, true, NOW())
       ON CONFLICT (student_id)
       DO UPDATE SET embedding_url = $2, embedding_hash = $3, liveness_score = $4, is_verified = true, captured_at = NOW()`,
      [student_id, embeddingJson, embeddingHash, liveness_score || 0.9]
    )

    return res.json({ success: true, message: 'Face enrolled successfully' })
  } catch (error: any) {
    // If unique constraint doesn't exist on student_id, try without ON CONFLICT
    if (error.code === '42P10' || error.message?.includes('ON CONFLICT')) {
      try {
        const { student_id, embedding, liveness_score } = req.body
        const embeddingJson = JSON.stringify(embedding)
        const crypto = await import('crypto')
        const embeddingHash = crypto.createHash('sha256').update(embeddingJson).digest('hex')

        // Delete existing and insert
        await query('DELETE FROM student_face_embeddings WHERE student_id = $1', [student_id])
        await query(
          `INSERT INTO student_face_embeddings (student_id, embedding_url, embedding_hash, liveness_score, is_verified, captured_at)
           VALUES ($1, $2, $3, $4, true, NOW())`,
          [student_id, embeddingJson, embeddingHash, liveness_score || 0.9]
        )
        return res.json({ success: true, message: 'Face enrolled successfully' })
      } catch (innerErr: any) {
        console.error('[faculty/face-enroll] Fallback error:', innerErr)
        return res.status(500).json({ error: 'Failed to enroll face' })
      }
    }
    console.error('[faculty/face-enroll] Error:', error)
    return res.status(500).json({ error: 'Failed to enroll face' })
  }
})

/**
 * POST /faculty/attendance/face-scan
 * Scan a captured face against all enrolled students in a schedule.
 * Returns the best matching student (if any).
 * Body: { schedule_id, embedding (number[128]) }
 */
router.post('/attendance/face-scan', authenticateToken, requireRole('faculty'), async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })

    const { schedule_id, embedding } = req.body
    if (!schedule_id || !embedding || !Array.isArray(embedding)) {
      return res.status(400).json({ error: 'schedule_id and embedding[] required' })
    }

    const facultyId = await resolveFacultyId(userId)
    if (!facultyId) return res.status(403).json({ error: 'Not a faculty member' })

    const owns = await verifyScheduleOwnership(schedule_id, facultyId)
    if (!owns) return res.status(403).json({ error: 'Schedule not assigned to you' })

    // Get all enrolled students with face embeddings for this schedule
    const result = await query(
      `SELECT s.id as student_id, s.student_id as student_code,
              s.first_name, s.last_name,
              sfe.embedding_url
       FROM student_schedules ss
       JOIN students s ON ss.student_id = s.id
       JOIN student_face_embeddings sfe ON sfe.student_id = s.id AND sfe.is_verified = true
       WHERE ss.schedule_id = $1 AND ss.status = 'enrolled'`,
      [schedule_id]
    )

    if (result.rows.length === 0) {
      return res.json({ matched: false, message: 'No students with enrolled faces in this schedule' })
    }

    // Compare against each enrolled face
    let bestMatch: any = null
    let bestConfidence = 0

    for (const row of result.rows) {
      try {
        const storedEmbedding: number[] = JSON.parse(row.embedding_url)
        if (!Array.isArray(storedEmbedding) || storedEmbedding.length !== 128) continue

        // Compute Euclidean distance
        let sum = 0
        for (let i = 0; i < 128; i++) {
          const diff = embedding[i] - storedEmbedding[i]
          sum += diff * diff
        }
        const distance = Math.sqrt(sum)

        // Convert to confidence (0-100)
        const confidence = Math.max(0, Math.round(100 - (distance / 3) * 100))

        if (confidence > bestConfidence) {
          bestConfidence = confidence
          bestMatch = {
            student_id: row.student_id,
            student_code: row.student_code,
            first_name: row.first_name,
            last_name: row.last_name,
            confidence,
            distance: Math.round(distance * 1000) / 1000,
          }
        }
      } catch {
        // Skip malformed embeddings
      }
    }

    const MATCH_THRESHOLD = 60 // 60% confidence threshold

    if (bestMatch && bestMatch.confidence >= MATCH_THRESHOLD) {
      return res.json({
        matched: true,
        student: bestMatch,
      })
    }

    return res.json({
      matched: false,
      message: 'No matching face found',
      best_confidence: bestConfidence,
    })
  } catch (error: any) {
    console.error('[faculty/attendance/face-scan] Error:', error)
    return res.status(500).json({ error: 'Failed to scan face' })
  }
})

export default router
