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
router.post('/sessions', requireRole('faculty'), async (req: TenantRequest, res: Response) => {
  try {
    const { courseId, ...sessionData } = req.body as CreateSessionRequest & { courseId: string }

    if (!courseId || !sessionData.sessionNumber || !sessionData.sessionDate) {
      res.status(400).json({
        error: 'Missing required fields: courseId, sessionNumber, sessionDate',
      })
      return
    }

    const session = await createSession(svc(req), courseId, sessionData as CreateSessionRequest)

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
router.get('/sessions/:sessionId', async (req: TenantRequest, res: Response) => {
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
router.get('/courses/:courseId/sessions', async (req: TenantRequest, res: Response) => {
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
    const facultyId = await callerFacultyId(req)
    if (!facultyId) {
      res.status(403).json({ error: 'Marking attendance requires a faculty record in this tenant' })
      return
    }

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
router.get('/sessions/:sessionId/attendance', async (req: TenantRequest, res: Response) => {
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

