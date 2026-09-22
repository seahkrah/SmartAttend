/**
 * Attendance API Routes (Face Recognition Enabled)
 * 
 * Endpoints:
 * - POST /sessions - Create a course session
 * - PUT /sessions/:id - Update session
 * - GET /sessions/:id - Get session details
 * - GET /courses/:courseId/sessions - Get all sessions for course
 * 
 * - POST /face/enroll - Enroll student face (faculty-initiated)
 * - POST /face/verify - Faculty verifies enrollment
 * - GET /face/enrollment-status/:studentId - Check enrollment status
 * 
 * - POST /attendance/mark-with-face - Mark attendance with face verification
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
import {
  enrollStudentFace,
  verifyEnrollment,
  getEnrollmentStatus,
} from '../services/faceRecognitionService.js'
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
// FACE ENROLLMENT ENDPOINTS
// ===========================

/**
 * POST /api/attendance/face/enroll
 * Enroll a student's face (Faculty-initiated)
 */
router.post('/face/enroll', requireRole('faculty'), async (req: TenantRequest, res: Response) => {
  try {
    const { studentId, faceEncoding, encodingDimension, faceConfidence, enrollmentQualityScore } = req.body

    if (!studentId || !faceEncoding || !encodingDimension || faceConfidence === undefined) {
      res.status(400).json({
        error: 'Missing required fields: studentId, faceEncoding, encodingDimension, faceConfidence',
      })
      return
    }

    if (!Array.isArray(faceEncoding) || faceEncoding.length !== encodingDimension) {
      res.status(400).json({
        error: `Face encoding must be an array of length ${encodingDimension}`,
      })
      return
    }

    const enrollResult = await enrollStudentFace(
      svc(req),
      studentId,
      faceEncoding,
      encodingDimension,
      faceConfidence,
      req.ctx!.userId,
      enrollmentQualityScore
    )

    if (!enrollResult.success) {
      res.status(400).json(enrollResult)
      return
    }

    res.status(201).json({
      success: true,
      data: {
        enrollmentId: enrollResult.enrollmentId,
        requiresVerification: enrollResult.requiresVerification,
      },
      message: enrollResult.message,
    })
  } catch (error: any) {
    console.error('[attendanceRoutes] Enroll face error:', error)
    res.status(500).json({
      error: 'Failed to enroll face',
      details: error.message,
    })
  }
})

/**
 * POST /api/attendance/face/verify
 * Confirm an enrolment's quality so it may be used to mark attendance.
 *
 * Open to faculty and to the school's administrators. The service refuses
 * self-verification, so the check is always a second pair of eyes; restricting
 * it to faculty alone left a school with one lecturer unable to approve any
 * enrolment at all.
 */
router.post('/face/verify', requireRoles('faculty', 'admin'), async (req: TenantRequest, res: Response) => {
  try {
    const { enrollmentId } = req.body

    if (!enrollmentId) {
      res.status(400).json({ error: 'Missing required field: enrollmentId' })
      return
    }

    const verifyResult = await verifyEnrollment(svc(req), enrollmentId, req.ctx!.userId)

    if (!verifyResult.success) {
      res.status(400).json(verifyResult)
      return
    }

    res.json({
      success: true,
      message: verifyResult.message,
    })
  } catch (error: any) {
    console.error('[attendanceRoutes] Verify enrollment error:', error)
    res.status(500).json({
      error: 'Failed to verify enrollment',
      details: error.message,
    })
  }
})

/**
 * GET /api/attendance/face/enrollment-status/:studentId
 * Get student face enrollment status
 */
router.get(
  '/face/enrollment-status/:studentId',
  async (req: TenantRequest, res: Response) => {
    try {
      const { studentId } = req.params

      const status = await getEnrollmentStatus(svc(req), studentId)

      if (!status) {
        res.status(404).json({ error: 'Student not found' })
        return
      }

      res.json({
        success: true,
        data: status,
      })
    } catch (error: any) {
      console.error('[attendanceRoutes] Get enrollment status error:', error)
      res.status(500).json({
        error: 'Failed to get enrollment status',
        details: error.message,
      })
    }
  }
)

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

