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

import { Router, Request, Response } from 'express'
import { authenticateToken, requireRole } from '../auth/middleware.js'
import {
  createSession,
  updateSession,
  getSession,
  getCourseSessions,
  markAttendanceWithFace,
  getSessionAttendance,
  getStudentCourseAttendance,
} from '../services/attendanceService.js'
import {
  enrollStudentFace,
  verifyEnrollment,
  getEnrollmentStatus,
} from '../services/faceRecognitionService.js'
import { CreateSessionRequest, UpdateSessionRequest, MarkAttendanceWithFaceRequest } from '@smartattend/types'

const router = Router()

// ===========================
// SESSION MANAGEMENT ENDPOINTS
// ===========================

/**
 * POST /api/attendance/sessions
 * Create a course session (Faculty only)
 */
router.post('/sessions', authenticateToken, requireRole('faculty'), async (req: Request, res: Response) => {
  try {
    const { courseId, ...sessionData } = req.body as CreateSessionRequest & { courseId: string }

    if (!courseId || !sessionData.sessionNumber || !sessionData.sessionDate) {
      res.status(400).json({
        error: 'Missing required fields: courseId, sessionNumber, sessionDate',
      })
      return
    }

    const session = await createSession(courseId, sessionData as CreateSessionRequest)

    res.status(201).json({
      success: true,
      data: session,
      message: 'Session created successfully',
    })
  } catch (error: any) {
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
router.put('/sessions/:sessionId', authenticateToken, requireRole('faculty'), async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params
    const updates = req.body as UpdateSessionRequest

    const session = await updateSession(sessionId, updates)

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
router.get('/sessions/:sessionId', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params

    const session = await getSession(sessionId)

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
router.get('/courses/:courseId/sessions', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { courseId } = req.params
    const { status } = req.query

    const sessions = await getCourseSessions(courseId, status as string | undefined)

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
router.post('/face/enroll', authenticateToken, requireRole('faculty'), async (req: Request, res: Response) => {
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

    const user = (req as any).user
    const platformId = user.platformId || user.platform_id

    const enrollResult = await enrollStudentFace(
      studentId,
      platformId,
      faceEncoding,
      encodingDimension,
      faceConfidence,
      user.id,
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
 * Verify an enrollment (Faculty-initiated)
 */
router.post('/face/verify', authenticateToken, requireRole('faculty'), async (req: Request, res: Response) => {
  try {
    const { enrollmentId } = req.body

    if (!enrollmentId) {
      res.status(400).json({ error: 'Missing required field: enrollmentId' })
      return
    }

    const user = (req as any).user

    const verifyResult = await verifyEnrollment(enrollmentId, user.id)

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
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const { studentId } = req.params
      const user = (req as any).user
      const platformId = user.platformId || user.platform_id

      const status = await getEnrollmentStatus(studentId, platformId)

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
router.post('/mark-with-face', authenticateToken, requireRole('faculty'), async (req: Request, res: Response) => {
  try {
    const attendanceReq = req.body as MarkAttendanceWithFaceRequest

    if (!attendanceReq.studentId || !attendanceReq.sessionId || !attendanceReq.verificationMethod) {
      res.status(400).json({
        error: 'Missing required fields: studentId, sessionId, verificationMethod',
      })
      return
    }

    const user = (req as any).user

    const markResult = await markAttendanceWithFace(attendanceReq, user.id)

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
router.get('/sessions/:sessionId/attendance', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params

    const attendance = await getSessionAttendance(sessionId)

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
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const { studentId, courseId } = req.params

      const attendance = await getStudentCourseAttendance(studentId, courseId)

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

