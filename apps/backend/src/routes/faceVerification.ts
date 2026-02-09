/**
 * Face Verification API Routes
 * 
 * Endpoints:
 * - POST /api/face/verify - Verify student face against enrollment
 * - POST /api/face/enroll - Enroll new student face
 * - GET /api/face/enrollment-status/:studentId - Check if student is enrolled
 * - GET /api/face/audit-trail/:sessionId/:studentId - Get verification audit trail
 */

import { Router, Request, Response } from 'express'
import { authenticateToken, requireRole } from '../auth/middleware.js'
import {
  verifyStudentFace,
  enrollNewFace,
  getEnrollmentStatusAPI,
  getVerificationAuditTrail,
} from '../services/faceVerificationAPIService.js'

const router = Router()

/**
 * POST /api/face/verify
 * Verify student face against enrolled face
 * 
 * Request body:
 * {
 *   sessionId: string
 *   studentId: string
 *   embedding: number[] (128-dimensional)
 *   imageMetadata: { brightness, contrast, edges, texture }
 * }
 */
router.post('/verify', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { sessionId, studentId, embedding, imageMetadata } = req.body

    if (!sessionId || !studentId || !embedding) {
      res.status(400).json({
        error: 'Missing required fields: sessionId, studentId, embedding',
      })
      return
    }

    if (!Array.isArray(embedding) || embedding.length !== 128) {
      res.status(400).json({
        error: 'Embedding must be a 128-dimensional array',
      })
      return
    }

    // Get enrollment status first
    const enrollmentStatus = await getEnrollmentStatusAPI(studentId)

    if (!enrollmentStatus.enrolled) {
      // First face - enroll it
      const enrollment = await enrollNewFace(studentId, sessionId, embedding)

      res.status(200).json({
        success: true,
        data: {
          verified: true,
          confidence: 100,
          livenessScore: 85,
          distance: 0,
          message: 'Face enrolled successfully',
          isFirstEnrollment: true,
          enrollmentId: enrollment.enrollmentId,
        },
      })
      return
    }

    // Verify against existing enrollment
    const result = await verifyStudentFace({
      sessionId,
      studentId,
      embedding,
      imageMetadata,
    })

    res.status(200).json({
      success: true,
      data: result,
    })
  } catch (error: any) {
    console.error('[faceVerifyRoute] Error:', error)
    res.status(500).json({
      error: 'Face verification failed',
      details: error.message,
    })
  }
})

/**
 * POST /api/face/enroll
 * Enroll a new face for a student (Faculty-initiated)
 * 
 * Request body:
 * {
 *   studentId: string
 *   sessionId: string
 *   embedding: number[] (128-dimensional)
 * }
 */
router.post('/enroll', authenticateToken, requireRole('faculty'), async (req: Request, res: Response) => {
  try {
    const { studentId, sessionId, embedding } = req.body

    if (!studentId || !sessionId || !embedding) {
      res.status(400).json({
        error: 'Missing required fields: studentId, sessionId, embedding',
      })
      return
    }

    if (!Array.isArray(embedding) || embedding.length !== 128) {
      res.status(400).json({
        error: 'Embedding must be a 128-dimensional array',
      })
      return
    }

    const result = await enrollNewFace(studentId, sessionId, embedding)

    res.status(201).json({
      success: true,
      data: {
        enrolled: result.enrolled,
        enrollmentId: result.enrollmentId,
        message: 'Face enrolled successfully',
      },
    })
  } catch (error: any) {
    console.error('[faceEnrollRoute] Error:', error)
    res.status(500).json({
      error: 'Face enrollment failed',
      details: error.message,
    })
  }
})

/**
 * GET /api/face/enrollment-status/:studentId
 * Check if student has enrolled face
 */
router.get('/enrollment-status/:studentId', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { studentId } = req.params

    const status = await getEnrollmentStatusAPI(studentId)

    res.status(200).json({
      success: true,
      data: status,
    })
  } catch (error: any) {
    console.error('[enrollmentStatusRoute] Error:', error)
    res.status(500).json({
      error: 'Failed to get enrollment status',
      details: error.message,
    })
  }
})

/**
 * GET /api/face/audit-trail/:sessionId/:studentId
 * Get verification audit trail (teacher/admin only)
 */
router.get(
  '/audit-trail/:sessionId/:studentId',
  authenticateToken,
  requireRole('faculty', 'admin', 'superadmin'),
  async (req: Request, res: Response) => {
    try {
      const { sessionId, studentId } = req.params

      const trail = await getVerificationAuditTrail(studentId, sessionId)

      res.status(200).json({
        success: true,
        data: trail,
        count: trail.length,
      })
    } catch (error: any) {
      console.error('[auditTrailRoute] Error:', error)
      res.status(500).json({
        error: 'Failed to get audit trail',
        details: error.message,
      })
    }
  }
)

export default router
