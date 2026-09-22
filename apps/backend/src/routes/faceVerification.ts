/**
 * Face Verification API Routes
 *
 * Endpoints (paths unchanged, so the existing client keeps working):
 * - POST /api/face/verify                          - match a capture against the enrolment
 * - POST /api/face/enroll                          - enrol a student's face
 * - GET  /api/face/enrollment-status/:studentId    - whether a student is enrolled
 * - GET  /api/face/audit-trail/:sessionId/:studentId - every verification attempt
 *
 * Rewritten. Three things were wrong with what was here:
 *
 *   1. /verify enrolled on first use. Any authenticated caller could post an
 *      embedding for any studentId and, if that student had no enrolment yet,
 *      have it stored as their face — and the response said "verified: true,
 *      confidence: 100". A student could enrol their own face as a classmate's
 *      and then be marked present as them. Enrolment is now only ever the
 *      deliberate, staff-initiated act on /enroll, which still requires a
 *      second person to confirm it before it can verify anything.
 *
 *   2. Nothing was tenant-scoped. studentId and sessionId went straight to the
 *      database, so one school's biometric templates and verification history
 *      were reachable from another's.
 *
 *   3. It ran on a third implementation of face matching whose queries named
 *      columns that do not exist, so none of it had ever worked. These routes
 *      now use faceRecognitionService, which is scoped and has one storage
 *      shape; the scoring arithmetic is still the same code.
 */

import { Router, Response } from 'express'
import { authenticateToken } from '../auth/middleware.js'
import {
  resolveTenantContext,
  requireTenant,
  requirePlatform,
  requireRoles,
  type TenantRequest,
} from '../auth/tenantContextMiddleware.js'
import {
  enrollStudentFace,
  verifyStudentFace,
  getEnrollmentStatus,
  getVerificationHistory,
  type FaceServiceContext,
} from '../services/faceRecognitionService.js'
import { detectLiveness } from '../services/faceVerificationAPIService.js'

const router = Router()

router.use(authenticateToken, resolveTenantContext, requireTenant, requirePlatform('school'))

function svc(req: TenantRequest): FaceServiceContext {
  const ctx = req.ctx!
  return { tenantId: ctx.tenantId!, userId: ctx.userId, platformId: ctx.platformId }
}

const ENCODING_DIMENSION = 128

function badEmbedding(embedding: unknown): boolean {
  return (
    !Array.isArray(embedding) ||
    embedding.length !== ENCODING_DIMENSION ||
    embedding.some((n) => typeof n !== 'number' || !Number.isFinite(n))
  )
}

/**
 * POST /api/face/verify
 *
 * Marking someone present by their face is a staff action, so this is not
 * open to every authenticated identity as it was before.
 */
router.post('/verify', requireRoles('faculty', 'admin'), async (req: TenantRequest, res: Response) => {
  try {
    const { sessionId, studentId, embedding, imageMetadata } = req.body

    if (!sessionId || !studentId || !embedding) {
      res.status(400).json({ error: 'Missing required fields: sessionId, studentId, embedding' })
      return
    }
    if (badEmbedding(embedding)) {
      res.status(400).json({ error: `Embedding must be ${ENCODING_DIMENSION} finite numbers` })
      return
    }

    const result = await verifyStudentFace(
      svc(req),
      studentId,
      sessionId,
      embedding,
      ENCODING_DIMENSION,
      req.ip
    )

    // Liveness is scored from the capture's own image statistics, independently
    // of whether the face matched, so a still photograph of the right person
    // is still caught.
    const liveness = detectLiveness(imageMetadata)

    const warnings: string[] = []
    if (liveness.score < 60) {
      warnings.push(`Low liveness score: ${liveness.score}% - may be spoofing attempt`)
    }
    if (result.matchDistance > 2.5) {
      warnings.push(
        `High distance score: ${result.matchDistance.toFixed(2)} - face mismatch suspected`
      )
    }
    if (!result.success) {
      warnings.push(result.message)
    }

    res.status(200).json({
      success: true,
      data: {
        verified: result.isVerified && liveness.score >= 60,
        confidence: Math.round(result.verificationConfidence * 100),
        livenessScore: liveness.score,
        distance: result.matchDistance,
        enrolledFaceId: result.verificationId || undefined,
        // A face is never enrolled as a side effect of verifying it.
        isFirstEnrollment: false,
        requiresManualReview: result.requiresManualReview,
        warnings: warnings.length > 0 ? warnings : undefined,
      },
    })
  } catch (error: any) {
    console.error('[faceVerifyRoute] Error:', error)
    res.status(500).json({ error: 'Face verification failed', details: error.message })
  }
})

/**
 * POST /api/face/enroll
 *
 * Creates a pending enrolment. It cannot be used to verify anyone until a
 * second member of staff confirms it through /api/attendance/face/verify.
 */
router.post('/enroll', requireRoles('faculty', 'admin'), async (req: TenantRequest, res: Response) => {
  try {
    const { studentId, embedding } = req.body

    if (!studentId || !embedding) {
      res.status(400).json({ error: 'Missing required fields: studentId, embedding' })
      return
    }
    if (badEmbedding(embedding)) {
      res.status(400).json({ error: `Embedding must be ${ENCODING_DIMENSION} finite numbers` })
      return
    }

    const result = await enrollStudentFace(
      svc(req),
      studentId,
      embedding,
      ENCODING_DIMENSION,
      1.0,
      req.ctx!.userId
    )

    if (!result.success) {
      res.status(404).json({ error: result.message })
      return
    }

    res.status(201).json({
      success: true,
      data: {
        enrolled: true,
        enrollmentId: result.enrollmentId,
        requiresVerification: result.requiresVerification,
        message: 'Face enrolled. A second member of staff must confirm it before use.',
      },
    })
  } catch (error: any) {
    console.error('[faceEnrollRoute] Error:', error)
    res.status(500).json({ error: 'Face enrollment failed', details: error.message })
  }
})

/** GET /api/face/enrollment-status/:studentId */
router.get('/enrollment-status/:studentId', async (req: TenantRequest, res: Response) => {
  try {
    const status = await getEnrollmentStatus(svc(req), req.params.studentId)

    if (!status) {
      res.status(404).json({ error: 'Student not found' })
      return
    }

    res.status(200).json({
      success: true,
      data: {
        enrolled: status.hasActiveEnrollment,
        enrollmentCount: status.hasActiveEnrollment ? 1 : 0,
        lastEnrolledAt: status.enrolledAt,
        isVerified: status.isVerified,
        verificationAttempts: status.verificationAttempts,
        successfulVerifications: status.successfulVerifications,
      },
    })
  } catch (error: any) {
    console.error('[enrollmentStatusRoute] Error:', error)
    res.status(500).json({ error: 'Failed to get enrollment status', details: error.message })
  }
})

/** GET /api/face/audit-trail/:sessionId/:studentId */
router.get(
  '/audit-trail/:sessionId/:studentId',
  requireRoles('faculty', 'admin'),
  async (req: TenantRequest, res: Response) => {
    try {
      const { sessionId, studentId } = req.params
      const trail = await getVerificationHistory(svc(req), studentId, sessionId)

      res.status(200).json({
        success: true,
        data: trail.map((entry) => ({
          verificationId: entry.id,
          attemptNumber: entry.attemptNumber,
          distance: entry.matchDistance,
          confidence: entry.verificationConfidence,
          isMatch: entry.isVerified,
          verifiedAt: entry.verifiedAt ?? entry.createdAt,
        })),
        count: trail.length,
      })
    } catch (error: any) {
      console.error('[auditTrailRoute] Error:', error)
      res.status(500).json({ error: 'Failed to get audit trail', details: error.message })
    }
  }
)

export default router
