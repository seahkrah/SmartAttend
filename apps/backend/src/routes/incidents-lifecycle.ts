/**
 * PHASE 5, STEP 5.2: Incident Lifecycle Routes
 * Enforces incident state transitions and operational requirements
 */

import { Router, Response } from 'express'
import type { ExtendedRequest } from '../types/auth.js'
import { withIncidentTracking } from '../middleware/errorToIncidentMiddleware.js'
import {
  acknowledgeIncident,
  escalateIncident,
  assignRootCause,
  startInvestigation,
  beginMitigation,
  resolveIncident,
  closeIncident,
  getIncidentTimeline,
  getEscalationHistory,
  getRootCauseAnalysis,
  type IncidentAcknowledgement,
  type IncidentEscalation,
  type RootCauseAssignment,
  type ResolutionSummary,
} from '../services/incidentLifecycleService.js'
import { getIncident } from '../services/incidentService.js'

const router = Router()

/**
 * POST /api/incidents/:incidentId/acknowledge
 * Acknowledge an incident (transition to acknowledged state)
 * Required: acknowledged incident not in terminal state
 */
router.post(
  '/:incidentId/acknowledge',
  withIncidentTracking(async (req: ExtendedRequest, res: Response) => {
    // Authorization check
    const userRole = (req.user as any)?.role || ''
    if (!['admin', 'security_officer', 'superadmin'].includes(userRole)) {
      res.status(403).json({
        success: false,
        error: 'Insufficient permissions to acknowledge incidents',
      })
      return
    }

    try {
      const acknowledgement: IncidentAcknowledgement = {
        acknowledgedByUserId: (req.user as any)?.id,
        acknowledgementNote: req.body.acknowledgementNote,
      }

      await acknowledgeIncident(req.params.incidentId, acknowledgement)

      res.json({
        success: true,
        message: 'Incident acknowledged successfully',
        incidentId: req.params.incidentId,
      })
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to acknowledge incident',
      })
    }
  })
)

/**
 * POST /api/incidents/:incidentId/escalate
 * Escalate an incident to higher severity level
 * Required: escalation level and reason
 */
router.post(
  '/:incidentId/escalate',
  withIncidentTracking(async (req: ExtendedRequest, res: Response) => {
    // Authorization check
    const userRole = (req.user as any)?.role || ''
    if (!['admin', 'security_officer', 'superadmin'].includes(userRole)) {
      res.status(403).json({
        success: false,
        error: 'Insufficient permissions to escalate incidents',
      })
      return
    }

    try {
      // Validate required fields
      if (!req.body.escalationLevel) {
        res.status(400).json({
          success: false,
          error: 'escalationLevel is required',
        })
        return
      }

      if (!req.body.escalationReason) {
        res.status(400).json({
          success: false,
          error: 'escalationReason is required',
        })
        return
      }

      const escalation: IncidentEscalation = {
        escalationLevel: req.body.escalationLevel,
        escalationReason: req.body.escalationReason,
        escalatedByUserId: (req.user as any)?.id,
        escalationNote: req.body.escalationNote,
      }

      await escalateIncident(req.params.incidentId, escalation)

      res.json({
        success: true,
        message: 'Incident escalated successfully',
        incidentId: req.params.incidentId,
        escalationLevel: escalation.escalationLevel,
      })
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to escalate incident',
      })
    }
  })
)

/**
 * POST /api/incidents/:incidentId/assign-root-cause
 * Assign root cause analysis to incident
 * Required: root cause description (min 10 chars), confidence level
 */
router.post(
  '/:incidentId/assign-root-cause',
  withIncidentTracking(async (req: ExtendedRequest, res: Response) => {
    // Authorization check
    const userRole = (req.user as any)?.role || ''
    if (!['admin', 'security_officer', 'superadmin'].includes(userRole)) {
      res.status(403).json({
        success: false,
        error: 'Insufficient permissions to assign root causes',
      })
      return
    }

    try {
      // Validate required fields
      if (!req.body.rootCause || req.body.rootCause.trim().length < 10) {
        res.status(400).json({
          success: false,
          error: 'rootCause is required and must be at least 10 characters',
        })
        return
      }

      if (!['low', 'medium', 'high'].includes(req.body.confidence)) {
        res.status(400).json({
          success: false,
          error: 'confidence must be one of: low, medium, high',
        })
        return
      }

      const rootCause: RootCauseAssignment = {
        rootCause: req.body.rootCause,
        assignedByUserId: (req.user as any)?.id,
        confidence: req.body.confidence,
        analysisNotes: req.body.analysisNotes,
      }

      await assignRootCause(req.params.incidentId, rootCause)

      res.json({
        success: true,
        message: 'Root cause assigned successfully',
        incidentId: req.params.incidentId,
        confidence: rootCause.confidence,
      })
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to assign root cause',
      })
    }
  })
)

/**
 * POST /api/incidents/:incidentId/start-investigation
 * Begin investigation of incident
 */
router.post(
  '/:incidentId/start-investigation',
  withIncidentTracking(async (req: ExtendedRequest, res: Response) => {
    // Authorization check
    const userRole = (req.user as any)?.role || ''
    if (!['admin', 'security_officer', 'superadmin'].includes(userRole)) {
      res.status(403).json({
        success: false,
        error: 'Insufficient permissions to manage investigations',
      })
      return
    }

    try {
      await startInvestigation(
        req.params.incidentId,
        (req.user as any)?.id,
        req.body.investigationNote
      )

      res.json({
        success: true,
        message: 'Investigation started successfully',
        incidentId: req.params.incidentId,
      })
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to start investigation',
      })
    }
  })
)

/**
 * POST /api/incidents/:incidentId/begin-mitigation
 * Begin mitigation efforts for incident
 */
router.post(
  '/:incidentId/begin-mitigation',
  withIncidentTracking(async (req: ExtendedRequest, res: Response) => {
    // Authorization check
    const userRole = (req.user as any)?.role || ''
    if (!['admin', 'security_officer', 'superadmin'].includes(userRole)) {
      res.status(403).json({
        success: false,
        error: 'Insufficient permissions to manage mitigation',
      })
      return
    }

    try {
      await beginMitigation(req.params.incidentId, (req.user as any)?.id, req.body.mitigationPlan)

      res.json({
        success: true,
        message: 'Mitigation started successfully',
        incidentId: req.params.incidentId,
      })
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to begin mitigation',
      })
    }
  })
)

/**
 * POST /api/incidents/:incidentId/resolve
 * Resolve incident with complete summary
 * Required: root cause, remediation steps, prevention measures
 */
router.post(
  '/:incidentId/resolve',
  withIncidentTracking(async (req: ExtendedRequest, res: Response) => {
    // Authorization check
    const userRole = (req.user as any)?.role || ''
    if (!['admin', 'security_officer', 'superadmin'].includes(userRole)) {
      res.status(403).json({
        success: false,
        error: 'Insufficient permissions to resolve incidents',
      })
      return
    }

    try {
      // Validate required resolution fields
      if (!req.body.rootCause || req.body.rootCause.trim().length === 0) {
        res.status(400).json({
          success: false,
          error: 'rootCause is required for resolution',
        })
        return
      }

      if (!req.body.remediationSteps || req.body.remediationSteps.trim().length === 0) {
        res.status(400).json({
          success: false,
          error: 'remediationSteps is required for resolution',
        })
        return
      }

      if (!req.body.preventionMeasures || req.body.preventionMeasures.trim().length === 0) {
        res.status(400).json({
          success: false,
          error: 'preventionMeasures is required for resolution',
        })
        return
      }

      const resolution: ResolutionSummary = {
        rootCause: req.body.rootCause,
        remediationSteps: req.body.remediationSteps,
        preventionMeasures: req.body.preventionMeasures,
        estimatedImpact: req.body.estimatedImpact,
        postMortemUrl: req.body.postMortemUrl,
      }

      await resolveIncident(req.params.incidentId, resolution, (req.user as any)?.id)

      res.json({
        success: true,
        message: 'Incident resolved successfully',
        incidentId: req.params.incidentId,
        status: 'resolved',
      })
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to resolve incident',
      })
    }
  })
)

/**
 * POST /api/incidents/:incidentId/close
 * Close a resolved incident
 * Can only close incidents with status 'resolved' and complete summary
 */
router.post(
  '/:incidentId/close',
  withIncidentTracking(async (req: ExtendedRequest, res: Response) => {
    // Authorization check
    const userRole = (req.user as any)?.role || ''
    if (!['admin', 'security_officer', 'superadmin'].includes(userRole)) {
      res.status(403).json({
        success: false,
        error: 'Insufficient permissions to close incidents',
      })
      return
    }

    try {
      await closeIncident(req.params.incidentId, (req.user as any)?.id, req.body.closureNote)

      res.json({
        success: true,
        message: 'Incident closed successfully',
        incidentId: req.params.incidentId,
        status: 'closed',
      })
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to close incident',
      })
    }
  })
)

/**
 * GET /api/incidents/:incidentId/timeline
 * Get the complete lifecycle timeline of an incident
 */
router.get(
  '/:incidentId/timeline',
  withIncidentTracking(async (req: ExtendedRequest, res: Response) => {
    // Authorization check
    const userRole = (req.user as any)?.role || ''
    if (!['admin', 'security_officer', 'superadmin'].includes(userRole)) {
      res.status(403).json({
        success: false,
        error: 'Insufficient permissions to view incident timeline',
      })
      return
    }

    try {
      const incident = await getIncident(req.params.incidentId)
      if (!incident) {
        res.status(404).json({
          success: false,
          error: 'Incident not found',
        })
        return
      }

      if (incident.platform_id !== req.platformId) {
        res.status(403).json({
          success: false,
          error: 'Incident not found',
        })
        return
      }

      const timeline = await getIncidentTimeline(req.params.incidentId)

      res.json({
        success: true,
        data: {
          incidentId: req.params.incidentId,
          currentStatus: incident.status,
          timeline,
          eventCount: timeline.length,
        },
      })
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to retrieve incident timeline',
      })
    }
  })
)

/**
 * GET /api/incidents/:incidentId/escalations
 * Get escalation history for incident
 */
router.get(
  '/:incidentId/escalations',
  withIncidentTracking(async (req: ExtendedRequest, res: Response) => {
    // Authorization check
    const userRole = (req.user as any)?.role || ''
    if (!['admin', 'security_officer', 'superadmin'].includes(userRole)) {
      res.status(403).json({
        success: false,
        error: 'Insufficient permissions to view escalation history',
      })
      return
    }

    try {
      const incident = await getIncident(req.params.incidentId)
      if (!incident) {
        res.status(404).json({
          success: false,
          error: 'Incident not found',
        })
        return
      }

      if (incident.platform_id !== req.platformId) {
        res.status(403).json({
          success: false,
          error: 'Incident not found',
        })
        return
      }

      const escalations = await getEscalationHistory(req.params.incidentId)

      res.json({
        success: true,
        data: {
          incidentId: req.params.incidentId,
          escalations,
          escalationCount: escalations.length,
        },
      })
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to retrieve escalation history',
      })
    }
  })
)

/**
 * GET /api/incidents/:incidentId/root-cause
 * Get root cause analysis for incident
 */
router.get(
  '/:incidentId/root-cause',
  withIncidentTracking(async (req: ExtendedRequest, res: Response) => {
    // Authorization check
    const userRole = (req.user as any)?.role || ''
    if (!['admin', 'security_officer', 'superadmin'].includes(userRole)) {
      res.status(403).json({
        success: false,
        error: 'Insufficient permissions to view root cause analysis',
      })
      return
    }

    try {
      const incident = await getIncident(req.params.incidentId)
      if (!incident) {
        res.status(404).json({
          success: false,
          error: 'Incident not found',
        })
        return
      }

      if (incident.platform_id !== req.platformId) {
        res.status(403).json({
          success: false,
          error: 'Incident not found',
        })
        return
      }

      const rootCauseAnalysis = await getRootCauseAnalysis(req.params.incidentId)

      res.json({
        success: true,
        data: {
          incidentId: req.params.incidentId,
          rootCauseAnalysis,
          analysisCount: rootCauseAnalysis.length,
        },
      })
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to retrieve root cause analysis',
      })
    }
  })
)

export default router
