/**
 * PHASE 6, STEP 6.2: Immutable Correction History Routes
 * Non-destructive corrections with visible audit trail
 */

import { Router, Response } from 'express'
import type { ExtendedRequest } from '../types/auth.js'
import {
  correctSchoolAttendance,
  correctCorporateCheckin,
  getCorrectionHistory,
  revertCorrection,
  getActiveCorrections,
  getCorrectionStatistics,
  getCorrectionsByType,
  getFullCorrectionAuditTrail,
  validateNoSilentCorrections,
  CorrectionType,
} from '../services/immutableCorrectionService.js'

const router = Router()

/**
 * POST /api/corrections/school/:attendanceId
 * Create immutable correction for school attendance
 * REQUIRED: correctionReason (min 10 chars), correctionType, at least one field to correct
 */
router.post(
  '/school/:attendanceId',
  async (req: ExtendedRequest, res: Response) => {
    try {
      const userRole = (req.user as any)?.role || ''
      if (!['admin', 'security_officer', 'faculty', 'superadmin'].includes(userRole)) {
        res.status(403).json({
          success: false,
          error: 'Insufficient permissions to create correction',
        })
        return
      }

      // Validate required fields
      if (!req.body.correctionReason || req.body.correctionReason.trim().length < 10) {
        res.status(400).json({
          success: false,
          error: 'Correction reason required (min 10 characters). Silent corrections prohibited.',
        })
        return
      }

      if (!req.body.correctionType) {
        res.status(400).json({
          success: false,
          error: 'Correction type is required',
        })
        return
      }

      const validTypes = [
        'data_entry_error',
        'biometric_revalidation',
        'system_override',
        'policy_exception',
        'duplicate_entry_removal',
        'time_synchronization_fix',
        'device_malfunction_correction',
        'attendance_appeal_approved',
      ]

      if (!validTypes.includes(req.body.correctionType)) {
        res.status(400).json({
          success: false,
          error: `Invalid correction type. Must be one of: ${validTypes.join(', ')}`,
        })
        return
      }

      const correction = await correctSchoolAttendance(req.params.attendanceId, {
        correctionReason: req.body.correctionReason,
        correctionType: req.body.correctionType as CorrectionType,
        correctedByUserId: (req.user as any)?.id,
        supportingEvidenceUrl: req.body.supportingEvidenceUrl,
        approvalNotes: req.body.approvalNotes,
        newStatus: req.body.newStatus,
        newAttendanceState: req.body.newAttendanceState,
        newFaceVerified: req.body.newFaceVerified,
      })

      res.json({
        success: true,
        message: 'Correction created (immutable, visible to all)',
        data: correction,
      })
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to create correction',
      })
    }
  }
)

/**
 * POST /api/corrections/corporate/:checkinId
 * Create immutable correction for corporate checkin
 */
router.post(
  '/corporate/:checkinId',
  async (req: ExtendedRequest, res: Response) => {
    try {
      const userRole = (req.user as any)?.role || ''
      if (!['admin', 'security_officer', 'superadmin'].includes(userRole)) {
        res.status(403).json({
          success: false,
          error: 'Insufficient permissions to create correction',
        })
        return
      }

      if (!req.body.correctionReason || req.body.correctionReason.trim().length < 10) {
        res.status(400).json({
          success: false,
          error: 'Correction reason required (min 10 characters). Silent corrections prohibited.',
        })
        return
      }

      if (!req.body.correctionType) {
        res.status(400).json({
          success: false,
          error: 'Correction type is required',
        })
        return
      }

      const correction = await correctCorporateCheckin(req.params.checkinId, {
        correctionReason: req.body.correctionReason,
        correctionType: req.body.correctionType as CorrectionType,
        correctedByUserId: (req.user as any)?.id,
        supportingEvidenceUrl: req.body.supportingEvidenceUrl,
        approvalNotes: req.body.approvalNotes,
        newStatus: req.body.newStatus,
        newAttendanceState: req.body.newAttendanceState,
        newFaceVerified: req.body.newFaceVerified,
      })

      res.json({
        success: true,
        message: 'Correction created (immutable, visible to all)',
        data: correction,
      })
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to create correction',
      })
    }
  }
)

/**
 * GET /api/corrections/history/:recordId
 * Get complete correction history for attendance record
 * Shows all corrections in immutable order
 */
router.get(
  '/history/:recordId',
  async (req: ExtendedRequest, res: Response) => {
    try {
      const userRole = (req.user as any)?.role || ''
      if (!['admin', 'security_officer', 'faculty', 'superadmin'].includes(userRole)) {
        res.status(403).json({
          success: false,
          error: 'Insufficient permissions to view history',
        })
        return
      }

      const recordType = (req.query.type as 'school_attendance' | 'corporate_checkins') || 'school_attendance'
      const history = await getCorrectionHistory(req.params.recordId, recordType)

      res.json({
        success: true,
        message: 'Complete immutable correction history',
        data: {
          recordId: req.params.recordId,
          recordType,
          corrections: history,
          count: history.length,
          totalActive: history.filter((c: any) => !c.is_reverted).length,
          totalReverted: history.filter((c: any) => c.is_reverted).length,
        },
      })
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to retrieve history',
      })
    }
  }
)

/**
 * POST /api/corrections/:correctionId/revert
 * Revert a correction (creates an audit trail, never deletes)
 * REQUIRED: revertReason (min 10 chars)
 */
router.post(
  '/:correctionId/revert',
  async (req: ExtendedRequest, res: Response) => {
    try {
      const userRole = (req.user as any)?.role || ''
      if (!['admin', 'superadmin'].includes(userRole)) {
        res.status(403).json({
          success: false,
          error: 'Only administrators can revert corrections',
        })
        return
      }

      if (!req.body.revertReason || req.body.revertReason.trim().length < 10) {
        res.status(400).json({
          success: false,
          error: 'Revert reason required (min 10 characters)',
        })
        return
      }

      await revertCorrection(req.params.correctionId, (req.user as any)?.id, req.body.revertReason)

      res.json({
        success: true,
        message: 'Correction reverted (reversal is also immutable and visible)',
        correctionId: req.params.correctionId,
      })
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to revert correction',
      })
    }
  }
)

/**
 * GET /api/corrections/active
 * Get all active (non-reverted) corrections for date range
 */
router.get(
  '/active',
  async (req: ExtendedRequest, res: Response) => {
    try {
      const userRole = (req.user as any)?.role || ''
      if (!['admin', 'security_officer', 'superadmin'].includes(userRole)) {
        res.status(403).json({
          success: false,
          error: 'Insufficient permissions',
        })
        return
      }

      if (!req.query.startDate || !req.query.endDate) {
        res.status(400).json({
          success: false,
          error: 'startDate and endDate are required',
        })
        return
      }

      const corrections = await getActiveCorrections(
        req.query.startDate as string,
        req.query.endDate as string
      )

      res.json({
        success: true,
        data: {
          dateRange: {
            start: req.query.startDate,
            end: req.query.endDate,
          },
          activeCorrections: corrections,
          count: corrections.length,
        },
      })
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to retrieve active corrections',
      })
    }
  }
)

/**
 * GET /api/corrections/statistics
 * Get correction statistics (visible reporting)
 */
router.get(
  '/statistics',
  async (req: ExtendedRequest, res: Response) => {
    try {
      const userRole = (req.user as any)?.role || ''
      if (!['admin', 'security_officer', 'superadmin'].includes(userRole)) {
        res.status(403).json({
          success: false,
          error: 'Insufficient permissions',
        })
        return
      }

      const stats = await getCorrectionStatistics(req.query.date as string)

      res.json({
        success: true,
        message: 'Immutable correction statistics',
        data: stats,
      })
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to retrieve statistics',
      })
    }
  }
)

/**
 * GET /api/corrections/by-type/:correctionType
 * Get corrections grouped by type
 */
router.get(
  '/by-type/:correctionType',
  async (req: ExtendedRequest, res: Response) => {
    try {
      const userRole = (req.user as any)?.role || ''
      if (!['admin', 'security_officer', 'superadmin'].includes(userRole)) {
        res.status(403).json({
          success: false,
          error: 'Insufficient permissions',
        })
        return
      }

      if (!req.query.startDate || !req.query.endDate) {
        res.status(400).json({
          success: false,
          error: 'startDate and endDate are required',
        })
        return
      }

      const corrections = await getCorrectionsByType(
        req.params.correctionType as CorrectionType,
        req.query.startDate as string,
        req.query.endDate as string
      )

      res.json({
        success: true,
        data: {
          correctionType: req.params.correctionType,
          corrections,
          count: corrections.length,
        },
      })
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to retrieve corrections',
      })
    }
  }
)

/**
 * GET /api/corrections/audit-trail
 * Full immutable audit trail - all corrections visible with reasons
 */
router.get(
  '/audit-trail',
  async (req: ExtendedRequest, res: Response) => {
    try {
      const userRole = (req.user as any)?.role || ''
      if (!['admin', 'security_officer', 'superadmin'].includes(userRole)) {
        res.status(403).json({
          success: false,
          error: 'Insufficient permissions',
        })
        return
      }

      if (!req.query.startDate || !req.query.endDate) {
        res.status(400).json({
          success: false,
          error: 'startDate and endDate are required',
        })
        return
      }

      const trail = await getFullCorrectionAuditTrail(
        req.query.startDate as string,
        req.query.endDate as string
      )

      res.json({
        success: true,
        message: 'Full immutable correction audit trail - all corrections visible with reasons',
        data: {
          dateRange: {
            start: req.query.startDate,
            end: req.query.endDate,
          },
          auditTrail: trail,
          count: trail.length,
          activeCount: trail.filter((c: any) => c.status === 'ACTIVE').length,
          revertedCount: trail.filter((c: any) => c.status === 'REVERTED').length,
        },
      })
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to retrieve audit trail',
      })
    }
  }
)

/**
 * GET /api/corrections/compliance/silent-corrections
 * Validate no silent corrections exist (compliance check)
 */
router.get(
  '/compliance/silent-corrections',
  async (req: ExtendedRequest, res: Response) => {
    try {
      const userRole = (req.user as any)?.role || ''
      if (!['admin', 'superadmin'].includes(userRole)) {
        res.status(403).json({
          success: false,
          error: 'Insufficient permissions',
        })
        return
      }

      if (!req.query.startDate || !req.query.endDate) {
        res.status(400).json({
          success: false,
          error: 'startDate and endDate are required',
        })
        return
      }

      const validation = await validateNoSilentCorrections(
        req.query.startDate as string,
        req.query.endDate as string
      )

      res.json({
        success: true,
        message: validation.isSilentCorrectionFree
          ? 'Compliance: All corrections have visible reasons'
          : 'ALERT: Silent corrections detected',
        data: validation,
      })
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to validate compliance',
      })
    }
  }
)

export default router
