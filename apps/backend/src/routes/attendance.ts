/**
 * PHASE 6, STEP 6.1: Attendance State Machine Routes
 * Manage attendance/checkin state transitions with full audit trail
 */

import { Router, Response } from 'express'
import type { ExtendedRequest } from '../types/auth.js'
import {
  changeSchoolAttendanceState,
  changeCorporateCheckinState,
  getAttendanceStateHistory,
  getFlaggedAttendanceByStudent,
  getFlaggedAttendanceByEmployee,
  getStateStatistics,
  auditStateCompliance,
  isValidTransition,
  getValidTransitions,
  AttendanceState,
} from '../services/attendanceStateService.js'
import { recordAttendanceFailure } from '../services/metricsService.js'

const router = Router()

// Helper to get tenant ID from request
function getTenantId(req: ExtendedRequest): string {
  return req.tenantId || (req.headers['x-tenant-id'] as string) || 'system'
}

/**
 * POST /api/attendance/:attendanceId/verify
 * Verify school attendance record
 */
router.post(
  '/:attendanceId/verify',
  async (req: ExtendedRequest, res: Response) => {
    try {
      const userRole = (req.user as any)?.role || ''
      if (!['admin', 'security_officer', 'faculty', 'superadmin'].includes(userRole)) {
        res.status(403).json({
          success: false,
          error: 'Insufficient permissions to verify attendance',
        })
        return
      }

      await changeSchoolAttendanceState(req.params.attendanceId, {
        newState: 'VERIFIED',
        reason: req.body.reason || 'Manual verification',
        changedByUserId: (req.user as any)?.id,
        auditNotes: req.body.auditNotes,
      })

      res.json({
        success: true,
        message: 'Attendance verified',
        recordId: req.params.attendanceId,
      })
    } catch (error: any) {
      // Record failure metric
      recordAttendanceFailure({
        tenant_id: getTenantId(req),
        platform_type: 'school',
        attendance_record_id: req.params.attendanceId,
        student_or_employee_id: req.query.student_id as string || 'unknown',
        failure_reason: error.message || 'Verification failed',
        created_by_user_id: (req.user as any)?.id,
      }).catch((err) => console.error('Failed to record metric:', err));

      res.status(400).json({
        success: false,
        error: error.message || 'Failed to verify attendance',
      })
    }
  }
)

/**
 * POST /api/attendance/:attendanceId/flag
 * Flag school attendance record as suspicious
 */
router.post(
  '/:attendanceId/flag',
  async (req: ExtendedRequest, res: Response) => {
    try {
      const userRole = (req.user as any)?.role || ''
      if (!['admin', 'security_officer', 'superadmin'].includes(userRole)) {
        res.status(403).json({
          success: false,
          error: 'Insufficient permissions to flag attendance',
        })
        return
      }

      if (!req.body.reason) {
        res.status(400).json({
          success: false,
          error: 'Reason is required to flag attendance',
        })
        return
      }

      await changeSchoolAttendanceState(req.params.attendanceId, {
        newState: 'FLAGGED',
        reason: req.body.reason,
        changedByUserId: (req.user as any)?.id,
        auditNotes: req.body.auditNotes,
      })

      res.json({
        success: true,
        message: 'Attendance flagged for review',
        recordId: req.params.attendanceId,
      })
    } catch (error: any) {
      // Record failure metric
      recordAttendanceFailure({
        tenant_id: getTenantId(req),
        platform_type: 'school',
        attendance_record_id: req.params.attendanceId,
        student_or_employee_id: req.query.student_id as string || 'unknown',
        failure_reason: error.message || 'Flag attendance failed',
        created_by_user_id: (req.user as any)?.id,
      }).catch((err) => console.error('Failed to record metric:', err));

      res.status(400).json({
        success: false,
        error: error.message || 'Failed to flag attendance',
      })
    }
  }
)

/**
 * POST /api/attendance/:attendanceId/revoke
 * Revoke school attendance record
 */
router.post(
  '/:attendanceId/revoke',
  async (req: ExtendedRequest, res: Response) => {
    try {
      const userRole = (req.user as any)?.role || ''
      if (!['admin', 'superadmin'].includes(userRole)) {
        res.status(403).json({
          success: false,
          error: 'Insufficient permissions to revoke attendance',
        })
        return
      }

      if (!req.body.reason) {
        res.status(400).json({
          success: false,
          error: 'Reason is required to revoke attendance',
        })
        return
      }

      await changeSchoolAttendanceState(req.params.attendanceId, {
        newState: 'REVOKED',
        reason: req.body.reason,
        changedByUserId: (req.user as any)?.id,
        auditNotes: req.body.auditNotes,
      })

      res.json({
        success: true,
        message: 'Attendance revoked',
        recordId: req.params.attendanceId,
      })
    } catch (error: any) {
      // Record failure metric
      recordAttendanceFailure({
        tenant_id: getTenantId(req),
        platform_type: 'school',
        attendance_record_id: req.params.attendanceId,
        student_or_employee_id: req.query.student_id as string || 'unknown',
        failure_reason: error.message || 'Revoke attendance failed',
        created_by_user_id: (req.user as any)?.id,
      }).catch((err) => console.error('Failed to record metric:', err));
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to revoke attendance',
      })
    }
  }
)

/**
 * POST /api/attendance/:attendanceId/override
 * Manual override of attendance state
 */
router.post(
  '/:attendanceId/override',
  async (req: ExtendedRequest, res: Response) => {
    try {
      const userRole = (req.user as any)?.role || ''
      if (!['admin', 'superadmin'].includes(userRole)) {
        res.status(403).json({
          success: false,
          error: 'Only administrators can manually override attendance',
        })
        return
      }

      if (!req.body.reason) {
        res.status(400).json({
          success: false,
          error: 'Reason is required for manual override',
        })
        return
      }

      await changeSchoolAttendanceState(req.params.attendanceId, {
        newState: 'MANUAL_OVERRIDE',
        reason: req.body.reason,
        changedByUserId: (req.user as any)?.id,
        auditNotes: req.body.auditNotes,
      })

      res.json({
        success: true,
        message: 'Attendance manually overridden',
        recordId: req.params.attendanceId,
      })
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to override attendance',
      })
    }
  }
)

/**
 * GET /api/attendance/:attendanceId/history
 * Get state change history for attendance record
 */
router.get(
  '/:attendanceId/history',
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

      const recordType = req.query.type as 'school_attendance' | 'corporate_checkins' || 'school_attendance'
      const history = await getAttendanceStateHistory(req.params.attendanceId, recordType)

      res.json({
        success: true,
        data: {
          recordId: req.params.attendanceId,
          history,
          count: history.length,
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
 * GET /api/attendance/student/:studentId/flagged
 * Get flagged attendance for student
 */
router.get(
  '/student/:studentId/flagged',
  async (req: ExtendedRequest, res: Response) => {
    try {
      const userRole = (req.user as any)?.role || ''
      if (!['admin', 'security_officer', 'faculty', 'superadmin'].includes(userRole)) {
        res.status(403).json({
          success: false,
          error: 'Insufficient permissions',
        })
        return
      }

      const flaggedRecords = await getFlaggedAttendanceByStudent(
        req.params.studentId,
        req.query.startDate as string,
        req.query.endDate as string
      )

      res.json({
        success: true,
        data: {
          studentId: req.params.studentId,
          flaggedRecords,
          count: flaggedRecords.length,
        },
      })
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to retrieve flagged records',
      })
    }
  }
)

/**
 * GET /api/attendance/employee/:employeeId/flagged
 * Get flagged checkins for employee
 */
router.get(
  '/employee/:employeeId/flagged',
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

      const flaggedRecords = await getFlaggedAttendanceByEmployee(
        req.params.employeeId,
        req.query.startDate as string,
        req.query.endDate as string
      )

      res.json({
        success: true,
        data: {
          employeeId: req.params.employeeId,
          flaggedRecords,
          count: flaggedRecords.length,
        },
      })
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to retrieve flagged records',
      })
    }
  }
)

/**
 * GET /api/attendance/statistics
 * Get state statistics for date range
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

      if (!req.query.startDate || !req.query.endDate) {
        res.status(400).json({
          success: false,
          error: 'startDate and endDate are required',
        })
        return
      }

      const stats = await getStateStatistics(
        req.query.startDate as string,
        req.query.endDate as string
      )

      res.json({
        success: true,
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
 * GET /api/attendance/compliance
 * Audit state compliance for date range
 */
router.get(
  '/compliance',
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

      const compliance = await auditStateCompliance(
        req.query.startDate as string,
        req.query.endDate as string
      )

      res.json({
        success: true,
        data: compliance,
      })
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to audit compliance',
      })
    }
  }
)

/**
 * GET /api/attendance/states/valid-transitions/:currentState
 * Get valid state transitions for current state
 */
router.get(
  '/states/valid-transitions/:currentState',
  async (req: ExtendedRequest, res: Response) => {
    try {
      const currentState = req.params.currentState as AttendanceState
      const validStates = ['VERIFIED', 'FLAGGED', 'REVOKED', 'MANUAL_OVERRIDE']

      if (!validStates.includes(currentState)) {
        res.status(400).json({
          success: false,
          error: `Invalid state. Must be one of: ${validStates.join(', ')}`,
        })
        return
      }

      const transitions = getValidTransitions(currentState)

      res.json({
        success: true,
        data: {
          currentState,
          validTransitions: transitions,
        },
      })
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to retrieve transitions',
      })
    }
  }
)

export default router
