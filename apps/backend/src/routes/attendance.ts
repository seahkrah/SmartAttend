/**
 * Session attendance.
 *
 * Endpoints:
 * - POST /sessions - Create a course session
 * - PUT /sessions/:id - Update session
 * - GET /sessions/:id - Get session details
 * - GET /courses/:courseId/sessions - Get all sessions for course
 *
 * - POST /mark-with-face - Mark a student in a session. MANUAL marks present;
 *   FACE_RECOGNITION needs faceMatchId, a match /api/biometrics/identify made
 *   for this student moments earlier.
 * - GET /sessions/:sessionId/attendance - Get attendance for session
 * - GET /students/:studentId/courses/:courseId/attendance - Get student attendance for course
 */
import { Router, Response } from 'express'
import { query } from '../db/connection.js'
import { authenticateToken, requireRole } from '../auth/middleware.js'
import {
  resolveTenantContext,
  requireTenant,
  requirePlatform,
  requireRoles,
  type TenantRequest,
} from '../auth/tenantContextMiddleware.js'
import {
  createSession,
  updateSession,
  getSession,
  getCourseSessions,
  markAttendanceWithFace,
  getSessionAttendance,
  getStudentCourseAttendance,
  AttendanceScopeError,
  type ServiceContext,
} from '../services/attendanceService.js'
import { CreateSessionRequest, UpdateSessionRequest, MarkAttendanceWithFaceRequest } from '@jjelotech/types'

const router = Router()

/**
 * These routes took ids straight from the request and handed them to services
 * that queried on the id alone. A session id, student id or course id from
 * another school was served exactly as readily as one's own. The tenant is now
 * resolved once for the router and every service call carries it.
 */
router.use(authenticateToken, resolveTenantContext, requireTenant, requirePlatform('school'))

/** The service context, built from the server-resolved request context. */
function svc(req: TenantRequest): ServiceContext {
  const ctx = req.ctx!
  return { tenantId: ctx.tenantId!, userId: ctx.userId, platformId: ctx.platformId }
}

/**
 * The caller's faculty row in this tenant.
 *
 * school_attendance.marked_by_id references faculty(id). The previous code
 * passed `user.id`, a property the JWT payload does not even carry, so the
 * value was undefined.
 */
async function callerFacultyId(req: TenantRequest): Promise<string | null> {
  const ctx = req.ctx!
  const r = await query(`SELECT id FROM faculty WHERE user_id = $1 AND tenant_id = $2 LIMIT 1`, [
    ctx.userId,
    ctx.tenantId,
  ])
  return r.rows[0]?.id ?? null
}

/**
 * Whether a lecturer teaches a course in this tenant. The faculty role alone
 * let any lecturer open, change and mark sessions of any course in the
 * school (audit phase 3, F2).
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function teaches(req: TenantRequest, facultyId: string, courseId: string): Promise<boolean> {
  const r = await query(
    `SELECT 1 FROM faculty_courses WHERE faculty_id = $1 AND course_id = $2 AND tenant_id = $3
     UNION ALL
     SELECT 1 FROM class_schedules WHERE faculty_id = $1 AND course_id = $2 AND tenant_id = $3
     LIMIT 1`,
    [facultyId, courseId, req.ctx!.tenantId]
  )
  return r.rows.length > 0
}

/**
 * The caller's faculty record, if they teach this session's course; otherwise
 * answers and returns null. An unknown session answers `missing` (marking has
 * always said 400 there, updating 404).
 */
async function lecturerOfSession(req: TenantRequest, res: Response, sessionId: string, missing = 404): Promise<string | null> {
  const facultyId = await callerFacultyId(req)
  if (!facultyId) {
    res.status(403).json({ error: 'This needs a faculty record in this tenant' })
    return null
  }
  const session = await getSession(svc(req), sessionId)
  if (!session) {
    res.status(missing).json({ success: false, error: 'Session not found' })
    return null
  }
  if (session.lecturerId !== facultyId && !(await teaches(req, facultyId, session.courseId))) {
    res.status(403).json({ error: 'You do not teach this course' })
    return null
  }
  return facultyId
}

function failScope(res: Response, e: unknown, label: string): boolean {
  if (e instanceof AttendanceScopeError) {
    res.status(e.status).json({ error: e.message })
    return true
  }
  return false
}

// ===========================
// SESSION MANAGEMENT ENDPOINTS
// ===========================

/**
 * POST /api/attendance/sessions
 * Create a course session (Faculty only)
 */
// Reading a class's sessions and anyone's attendance is for the school's
// administrators and lecturers. These routes checked no role before, so a
// student could read any classmate's attendance (findings #32); a student
// reads their own under /api/attendance/me.
const attendanceReaders = requireRoles('admin', 'faculty')

router.post('/sessions', requireRole('faculty'), async (req: TenantRequest, res: Response) => {
  try {
    const { courseId, ...sessionData } = req.body as CreateSessionRequest & { courseId: string }

    if (!courseId || !sessionData.sessionNumber || !sessionData.sessionDate) {
      res.status(400).json({
        error: 'Missing required fields: courseId, sessionNumber, sessionDate',
      })
      return
    }

    const facultyId = await callerFacultyId(req)
    if (!facultyId) {
      res.status(403).json({ error: 'This needs a faculty record in this tenant' })
      return
    }
    // Another tenant's course reads as absent, as one that does not exist.
    const course = await query(`SELECT 1 FROM courses WHERE id = $1 AND tenant_id = $2`, [String(courseId), req.ctx!.tenantId])
    if (!UUID_RE.test(String(courseId)) || course.rows.length === 0) {
      res.status(404).json({ error: 'Course not found' })
      return
    }
    if (!(await teaches(req, facultyId, String(courseId)))) {
      res.status(403).json({ error: 'You do not teach this course' })
      return
    }
    // A lecturer opens their own sessions. Naming anyone else is refused:
    // someone outside this tenant reads as absent.
    const named = (sessionData as any).lecturerId
    if (named && named !== facultyId && named !== req.ctx!.userId) {
      const there = await query(
        `SELECT 1 FROM faculty WHERE tenant_id = $2 AND (id::text = $1 OR user_id::text = $1)`,
        [String(named), req.ctx!.tenantId]
      )
      if (there.rows.length === 0) {
        res.status(404).json({ error: 'Faculty member not found' })
      } else {
        res.status(403).json({ error: 'A lecturer opens their own sessions' })
      }
      return
    }
    const session = await createSession(svc(req), courseId, { ...sessionData, lecturerId: facultyId } as CreateSessionRequest)

    res.status(201).json({
      success: true,
      data: session,
      message: 'Session created successfully',
    })
  } catch (error: any) {
    if (failScope(res, error, 'create session')) return
    console.error('[attendanceRoutes] Create session error:', error)
    res.status(500).json({
      error: 'Failed to create session',
      details: error.message,
    })
  }
})

/**
 * PUT /api/attendance/sessions/:sessionId
 * Update session (Faculty only)
 */
router.put('/sessions/:sessionId', requireRole('faculty'), async (req: TenantRequest, res: Response) => {
  try {
    const { sessionId } = req.params
    const updates = req.body as UpdateSessionRequest

    if (!(await lecturerOfSession(req, res, sessionId))) return
    const session = await updateSession(svc(req), sessionId, updates)

    if (!session) {
      res.status(404).json({ error: 'Session not found' })
      return
    }

    res.json({
      success: true,
      data: session,
      message: 'Session updated successfully',
    })
  } catch (error: any) {
    if (failScope(res, error, 'update session')) return
    console.error('[attendanceRoutes] Update session error:', error)
    res.status(500).json({
      error: 'Failed to update session',
      details: error.message,
    })
  }
})

/**
 * GET /api/attendance/sessions/:sessionId
 * Get session details
 */
router.get('/sessions/:sessionId', attendanceReaders, async (req: TenantRequest, res: Response) => {
  try {
    const { sessionId } = req.params

    const session = await getSession(svc(req), sessionId)

    if (!session) {
      res.status(404).json({ error: 'Session not found' })
      return
    }

    res.json({
      success: true,
      data: session,
    })
  } catch (error: any) {
    console.error('[attendanceRoutes] Get session error:', error)
    res.status(500).json({
      error: 'Failed to get session',
      details: error.message,
    })
  }
})

/**
 * GET /api/attendance/courses/:courseId/sessions
 * Get all sessions for a course
 */
router.get('/courses/:courseId/sessions', attendanceReaders, async (req: TenantRequest, res: Response) => {
  try {
    const { courseId } = req.params
    const { status } = req.query

    const sessions = await getCourseSessions(svc(req), courseId, status as string | undefined)

    res.json({
      success: true,
      data: sessions,
      total: sessions.length,
    })
  } catch (error: any) {
    console.error('[attendanceRoutes] Get course sessions error:', error)
    res.status(500).json({
      error: 'Failed to get sessions',
      details: error.message,
    })
  }
})

// ===========================
// FACE ENROLMENT — moved to /api/biometrics
// ===========================
//
// /face/enroll, /face/verify and /face/enrollment-status accepted a list of
// numbers from the client as a "face encoding". They are replaced by
// /api/biometrics, where the server derives the face from camera images.

// ===========================
// ATTENDANCE MARKING ENDPOINTS
// ===========================

/**
 * POST /api/attendance/mark-with-face
 * Mark attendance with face verification
 */
router.post('/mark-with-face', requireRole('faculty'), async (req: TenantRequest, res: Response) => {
  try {
    const attendanceReq = req.body as MarkAttendanceWithFaceRequest

    if (!attendanceReq.studentId || !attendanceReq.sessionId || !attendanceReq.verificationMethod) {
      res.status(400).json({
        error: 'Missing required fields: studentId, sessionId, verificationMethod',
      })
      return
    }

    // Marking requires a faculty record in this tenant, not merely the
    // faculty role somewhere.
    const facultyId = await lecturerOfSession(req, res, String(attendanceReq.sessionId), 400)
    if (!facultyId) return

    const markResult = await markAttendanceWithFace(svc(req), attendanceReq, facultyId)

    if (!markResult.success) {
      res.status(400).json(markResult)
      return
    }

    res.status(201).json({
      success: true,
      data: {
        attendanceId: markResult.attendanceId,
        status: markResult.status,
        verificationMethod: markResult.verificationMethod,
        faceVerified: markResult.faceVerified,
      },
      message: markResult.message,
    })
  } catch (error: any) {
    console.error('[attendanceRoutes] Mark attendance error:', error)
    res.status(500).json({
      error: 'Failed to mark attendance',
      details: error.message,
    })
  }
})

// ===========================
// ATTENDANCE REPORT ENDPOINTS
// ===========================

/**
 * GET /api/attendance/sessions/:sessionId/attendance
 * Get attendance report for a session
 */
router.get('/sessions/:sessionId/attendance', attendanceReaders, async (req: TenantRequest, res: Response) => {
  try {
    const { sessionId } = req.params

    const attendance = await getSessionAttendance(svc(req), sessionId)

    res.json({
      success: true,
      data: attendance,
      total: attendance.length,
    })
  } catch (error: any) {
    console.error('[attendanceRoutes] Get session attendance error:', error)
    res.status(500).json({
      error: 'Failed to get attendance',
      details: error.message,
    })
  }
})

/**
 * GET /api/attendance/students/:studentId/courses/:courseId/attendance
 * Get student attendance for a course
 */
router.get(
  '/students/:studentId/courses/:courseId/attendance',
  attendanceReaders,
  async (req: TenantRequest, res: Response) => {
    try {
      const { studentId, courseId } = req.params

      const attendance = await getStudentCourseAttendance(svc(req), studentId, courseId)

      res.json({
        success: true,
        data: attendance,
        total: attendance.length,
      })
    } catch (error: any) {
      console.error('[attendanceRoutes] Get student course attendance error:', error)
      res.status(500).json({
        error: 'Failed to get attendance',
        details: error.message,
      })
    }
  }
)

export default router

