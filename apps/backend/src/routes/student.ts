/**
 * Student Portal Routes
 *
 * Endpoints for student-facing features:
 *   GET  /student/dashboard        — summary stats (attendance rate, enrolled courses, upcoming classes)
 *   GET  /student/courses          — list of enrolled courses
 *   GET  /student/schedules        — weekly timetable
 *   GET  /student/attendance       — attendance history with filters
 *   GET  /student/profile          — student profile details
 *   PUT  /student/profile          — update profile (phone, address, profile_photo_url)
 */

import { Router, Request, Response } from 'express'
import { query } from '../db/connection.js'
import { authenticateToken } from '../auth/middleware.js'

const router = Router()

// ── Helper: Get student record from authenticated user ──
async function getStudentFromUser(userId: string) {
  const result = await query(
    `SELECT s.*, u.email AS user_email, u.full_name AS user_full_name
     FROM students s
     JOIN users u ON s.user_id = u.id
     WHERE s.user_id = $1`,
    [userId]
  )
  return result.rows[0] || null
}

// ══════════════════════════════════════
// GET /student/dashboard
// ══════════════════════════════════════
router.get('/dashboard', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' })
    const student = await getStudentFromUser(req.user.userId)
    if (!student) return res.status(404).json({ error: 'Student record not found' })

    // 1. Enrolled courses count
    const coursesResult = await query(
      `SELECT COUNT(DISTINCT sc.id) as course_count
       FROM student_schedules sc
       JOIN class_schedules cs ON sc.schedule_id = cs.id
       WHERE sc.student_id = $1 AND sc.status = 'enrolled'`,
      [student.id]
    )
    const courseCount = parseInt(coursesResult.rows[0]?.course_count || '0')

    // 2. Overall attendance rate
    const attendanceResult = await query(
      `SELECT
         COUNT(*) AS total,
         COUNT(*) FILTER (WHERE sa.status = 'present') AS present,
         COUNT(*) FILTER (WHERE sa.status = 'late')    AS late,
         COUNT(*) FILTER (WHERE sa.status = 'absent')  AS absent,
         COUNT(*) FILTER (WHERE sa.status = 'excused') AS excused
       FROM school_attendance sa
       WHERE sa.student_id = $1`,
      [student.id]
    )
    const att = attendanceResult.rows[0]
    const totalSessions = parseInt(att?.total || '0')
    const presentCount = parseInt(att?.present || '0')
    const lateCount = parseInt(att?.late || '0')
    const absentCount = parseInt(att?.absent || '0')
    const excusedCount = parseInt(att?.excused || '0')
    const attendanceRate = totalSessions > 0
      ? Math.round(((presentCount + lateCount) / totalSessions) * 100)
      : 0

    // 3. Today's schedule
    const today = new Date()
    const dayOfWeek = today.getDay() // 0=Sun … 6=Sat
    const todaySchedule = await query(
      `SELECT cs.id, c.code AS course_code, c.name AS course_name,
              cs.start_time, cs.end_time, cs.section,
              COALESCE(r.building || ' ' || r.room_number, r.room_number) AS room_name
       FROM student_schedules sc
       JOIN class_schedules cs ON sc.schedule_id = cs.id
       JOIN courses c ON cs.course_id = c.id
       LEFT JOIN rooms r ON cs.room_id = r.id
       WHERE sc.student_id = $1
         AND sc.status = 'enrolled'
         AND (cs.day_of_week = $2 OR cs.days_of_week LIKE '%' || $2::text || '%')
       ORDER BY cs.start_time`,
      [student.id, dayOfWeek]
    )

    // 4. Recent attendance (last 5)
    const recentResult = await query(
      `SELECT sa.attendance_date, sa.status, sa.face_verified,
              c.code AS course_code, c.name AS course_name
       FROM school_attendance sa
       JOIN class_schedules cs ON sa.schedule_id = cs.id
       JOIN courses c ON cs.course_id = c.id
       WHERE sa.student_id = $1
       ORDER BY sa.attendance_date DESC, sa.marked_at DESC
       LIMIT 5`,
      [student.id]
    )

    return res.json({
      student_name: `${student.first_name} ${student.last_name}`,
      student_code: student.student_id,
      enrolled_courses: courseCount,
      attendance_summary: {
        total_sessions: totalSessions,
        present: presentCount,
        late: lateCount,
        absent: absentCount,
        excused: excusedCount,
        rate: attendanceRate,
      },
      today_schedule: todaySchedule.rows,
      recent_attendance: recentResult.rows,
    })
  } catch (err: any) {
    console.error('[Student Dashboard]', err.message)
    return res.status(500).json({ error: 'Failed to load dashboard' })
  }
})

// ══════════════════════════════════════
// GET /student/courses
// ══════════════════════════════════════
router.get('/courses', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' })
    const student = await getStudentFromUser(req.user.userId)
    if (!student) return res.status(404).json({ error: 'Student record not found' })

    const result = await query(
      `SELECT c.id AS course_id, c.code, c.name, c.credits, c.description,
              cs.id AS schedule_id, cs.start_time, cs.end_time,
              cs.day_of_week, cs.days_of_week, cs.section,
              COALESCE(r.building || ' ' || r.room_number, r.room_number) AS room_name,
              CONCAT(f.first_name, ' ', COALESCE(f.middle_name || ' ', ''), f.last_name) AS faculty_name,
              sc.enrolled_at
       FROM student_schedules sc
       JOIN class_schedules cs ON sc.schedule_id = cs.id
       JOIN courses c ON cs.course_id = c.id
       LEFT JOIN rooms r ON cs.room_id = r.id
       LEFT JOIN faculty f ON cs.faculty_id = f.id
       WHERE sc.student_id = $1 AND sc.status = 'enrolled'
       ORDER BY c.name`,
      [student.id]
    )

    return res.json(result.rows)
  } catch (err: any) {
    console.error('[Student Courses]', err.message)
    return res.status(500).json({ error: 'Failed to load courses' })
  }
})

// ══════════════════════════════════════
// GET /student/schedules
// ══════════════════════════════════════
router.get('/schedules', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' })
    const student = await getStudentFromUser(req.user.userId)
    if (!student) return res.status(404).json({ error: 'Student record not found' })

    const result = await query(
      `SELECT cs.id AS schedule_id, c.code AS course_code, c.name AS course_name,
              cs.start_time, cs.end_time, cs.day_of_week, cs.days_of_week,
              cs.section, COALESCE(r.building || ' ' || r.room_number, r.room_number) AS room_name,
              CONCAT(f.first_name, ' ', COALESCE(f.middle_name || ' ', ''), f.last_name) AS faculty_name
       FROM student_schedules sc
       JOIN class_schedules cs ON sc.schedule_id = cs.id
       JOIN courses c ON cs.course_id = c.id
       LEFT JOIN rooms r ON cs.room_id = r.id
       LEFT JOIN faculty f ON cs.faculty_id = f.id
       WHERE sc.student_id = $1 AND sc.status = 'enrolled'
       ORDER BY cs.day_of_week, cs.start_time`,
      [student.id]
    )

    return res.json(result.rows)
  } catch (err: any) {
    console.error('[Student Schedules]', err.message)
    return res.status(500).json({ error: 'Failed to load schedules' })
  }
})

// ══════════════════════════════════════
// GET /student/attendance
// ══════════════════════════════════════
router.get('/attendance', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' })
    const student = await getStudentFromUser(req.user.userId)
    if (!student) return res.status(404).json({ error: 'Student record not found' })

    const { course_id, date_from, date_to, status: statusFilter } = req.query

    let sql = `
      SELECT sa.id, sa.attendance_date, sa.status, sa.remarks,
             sa.face_verified, sa.marked_at,
             c.code AS course_code, c.name AS course_name,
             cs.section
      FROM school_attendance sa
      JOIN class_schedules cs ON sa.schedule_id = cs.id
      JOIN courses c ON cs.course_id = c.id
      WHERE sa.student_id = $1
    `
    const params: any[] = [student.id]
    let paramIdx = 2

    if (course_id) {
      sql += ` AND cs.course_id = $${paramIdx++}`
      params.push(course_id)
    }
    if (date_from) {
      sql += ` AND sa.attendance_date >= $${paramIdx++}`
      params.push(date_from)
    }
    if (date_to) {
      sql += ` AND sa.attendance_date <= $${paramIdx++}`
      params.push(date_to)
    }
    if (statusFilter) {
      sql += ` AND sa.status = $${paramIdx++}`
      params.push(statusFilter)
    }

    sql += ` ORDER BY sa.attendance_date DESC, sa.marked_at DESC`

    const result = await query(sql, params)

    // Also return summary
    const summaryResult = await query(
      `SELECT
         COUNT(*) AS total,
         COUNT(*) FILTER (WHERE status = 'present') AS present,
         COUNT(*) FILTER (WHERE status = 'late')    AS late,
         COUNT(*) FILTER (WHERE status = 'absent')  AS absent,
         COUNT(*) FILTER (WHERE status = 'excused') AS excused
       FROM school_attendance
       WHERE student_id = $1`,
      [student.id]
    )

    const s = summaryResult.rows[0]
    const total = parseInt(s?.total || '0')

    return res.json({
      records: result.rows,
      summary: {
        total,
        present: parseInt(s?.present || '0'),
        late: parseInt(s?.late || '0'),
        absent: parseInt(s?.absent || '0'),
        excused: parseInt(s?.excused || '0'),
        rate: total > 0 ? Math.round(((parseInt(s?.present || '0') + parseInt(s?.late || '0')) / total) * 100) : 0,
      },
    })
  } catch (err: any) {
    console.error('[Student Attendance]', err.message)
    return res.status(500).json({ error: 'Failed to load attendance' })
  }
})

// ══════════════════════════════════════
// GET /student/profile
// ══════════════════════════════════════
router.get('/profile', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' })
    const student = await getStudentFromUser(req.user.userId)
    if (!student) return res.status(404).json({ error: 'Student record not found' })

    return res.json({
      student_id: student.student_id,
      first_name: student.first_name,
      middle_name: student.middle_name,
      last_name: student.last_name,
      email: student.email,
      phone: student.phone,
      address: student.address,
      gender: student.gender,
      college: student.college,
      enrollment_year: student.enrollment_year,
      profile_photo_url: student.profile_photo_url,
      is_currently_enrolled: student.is_currently_enrolled,
      created_at: student.created_at,
    })
  } catch (err: any) {
    console.error('[Student Profile]', err.message)
    return res.status(500).json({ error: 'Failed to load profile' })
  }
})

// ══════════════════════════════════════
// PUT /student/profile
// ══════════════════════════════════════
router.put('/profile', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' })
    const student = await getStudentFromUser(req.user.userId)
    if (!student) return res.status(404).json({ error: 'Student record not found' })

    const { phone, address, gender, profile_photo_url } = req.body

    // Update students table
    await query(
      `UPDATE students
       SET phone = COALESCE($1, phone),
           address = COALESCE($2, address),
           gender = COALESCE($3, gender),
           profile_photo_url = COALESCE($4, profile_photo_url)
       WHERE id = $5`,
      [phone, address, gender, profile_photo_url, student.id]
    )

    // Also sync phone on users table
    if (phone) {
      await query(`UPDATE users SET phone = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`, [phone, student.user_id])
    }

    return res.json({ success: true, message: 'Profile updated successfully' })
  } catch (err: any) {
    console.error('[Student Profile Update]', err.message)
    return res.status(500).json({ error: 'Failed to update profile' })
  }
})

export default router
