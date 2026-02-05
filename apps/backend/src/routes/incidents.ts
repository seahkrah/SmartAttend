/**
 * PHASE 5, STEP 5.1: Incidents API Routes
 * PHASE 5, STEP 5.2: Incident Lifecycle Enforcement Routes
 */

import { Router, Response } from 'express'
import type { ExtendedRequest } from '../types/auth.js'
import { withIncidentTracking } from '../middleware/errorToIncidentMiddleware.js'
import {
  getIncident,
  getOpenIncidents,
  getCriticalIncidents,
  getIncidentStatistics,
  updateIncident,
  createTimelineEvent,
} from '../services/incidentService.js'
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
} from '../services/incidentLifecycleService.js'

const router = Router()

/**
 * GET /api/incidents/critical
 * Get all critical open incidents for platform
 */
router.get(
  '/critical',
  withIncidentTracking(async (req: ExtendedRequest, res: Response) => {
    // Verify user has admin or security role
    const userRole = (req.user as any)?.role || ''
    if (!['admin', 'security_officer', 'superadmin'].includes(userRole)) {
      res.status(403).json({
        success: false,
        error: 'Insufficient permissions to view critical incidents',
      })
      return
    }

    const incidents = await getCriticalIncidents(req.platformId!)

    res.json({
      success: true,
      data: {
        incidents,
        count: incidents.length,
        timestamp: new Date().toISOString(),
      },
    })
  })
)

/**
 * GET /api/incidents/open
 * Get all open incidents for platform
 */
router.get(
  '/open',
  withIncidentTracking(async (req: ExtendedRequest, res: Response) => {
    // Verify user has admin role
    const userRole = (req.user as any)?.role || ''
    if (!['admin', 'security_officer', 'superadmin'].includes(userRole)) {
      res.status(403).json({
        success: false,
        error: 'Insufficient permissions to view incidents',
      })
      return
    }

    const incidents = await getOpenIncidents(req.platformId!)

    res.json({
      success: true,
      data: {
        incidents,
        count: incidents.length,
        timestamp: new Date().toISOString(),
      },
    })
  })
)

/**
 * GET /api/incidents/:incidentId
 * Get incident details
 */
router.get(
  '/:incidentId',
  withIncidentTracking(async (req: ExtendedRequest, res: Response) => {
    // Verify user has admin role
    const userRole = (req.user as any)?.role || ''
    if (!['admin', 'security_officer', 'superadmin'].includes(userRole)) {
      res.status(403).json({
        success: false,
        error: 'Insufficient permissions to view incident',
      })
      return
    }

    const incident = await getIncident(req.params.incidentId)

    if (!incident) {
      res.status(404).json({
        success: false,
        error: 'Incident not found',
      })
      return
    }

    // Verify incident belongs to user's platform
    if (incident.platform_id !== req.platformId) {
      res.status(403).json({
        success: false,
        error: 'Incident not found',
      })
      return
    }

    res.json({
      success: true,
      data: incident,
    })
  })
)

/**
 * PATCH /api/incidents/:incidentId
 * Update incident
 */
router.patch(
  '/:incidentId',
  withIncidentTracking(async (req: ExtendedRequest, res: Response) => {
    // Verify user has admin role
    const userRole = (req.user as any)?.role || ''
    if (!['admin', 'security_officer', 'superadmin'].includes(userRole)) {
      res.status(403).json({
        success: false,
        error: 'Insufficient permissions to update incident',
      })
      return
    }

    // Get current incident for comparison
    const incident = await getIncident(req.params.incidentId)
    if (!incident) {
      res.status(404).json({
        success: false,
        error: 'Incident not found',
      })
      return
    }

    // Verify incident belongs to user's platform
    if (incident.platform_id !== req.platformId) {
      res.status(403).json({
        success: false,
        error: 'Incident not found',
      })
      return
    }

    const updates = {
      status: req.body.status,
      severity: req.body.severity,
      acknowledgedByUserId: req.body.acknowledgedByUserId || (req.user as any)?.id,
      resolvedByUserId: req.body.resolvedByUserId,
      rootCause: req.body.rootCause,
      remediationSteps: req.body.remediationSteps,
      preventionMeasures: req.body.preventionMeasures,
      postMortemUrl: req.body.postMortemUrl,
    }

    // Remove undefined values
    Object.keys(updates).forEach((key) => {
      if ((updates as any)[key] === undefined) {
        delete (updates as any)[key]
      }
    })

    // Update incident
    await updateIncident(req.params.incidentId, updates)

    // Create timeline event for status change
    if (req.body.status && req.body.status !== incident.status) {
      await createTimelineEvent(
        req.params.incidentId,
        'status_changed',
        incident.status,
        req.body.status,
        `Status changed from ${incident.status} to ${req.body.status}`,
        (req.user as any)?.id
      )
    }

    // Create timeline event for severity change
    if (req.body.severity && req.body.severity !== incident.severity) {
      await createTimelineEvent(
        req.params.incidentId,
        'severity_updated',
        incident.severity,
        req.body.severity,
        `Severity updated from ${incident.severity} to ${req.body.severity}`,
        (req.user as any)?.id
      )
    }

    res.json({
      success: true,
      message: 'Incident updated successfully',
      incidentId: req.params.incidentId,
    })
  })
)

/**
 * POST /api/incidents/:incidentId/acknowledge
 * Acknowledge an incident (required before investigation)
 */
router.post(
  '/:incidentId/acknowledge',
  withIncidentTracking(async (req: ExtendedRequest, res: Response) => {
    const userRole = (req.user as any)?.role || ''
    if (!['admin', 'security_officer', 'superadmin'].includes(userRole)) {
      res.status(403).json({
        success: false,
        error: 'Insufficient permissions to acknowledge incident',
      })
      return
    }

    try {
      const incident = await getIncident(req.params.incidentId)
      if (!incident || incident.platform_id !== req.platformId) {
        res.status(404).json({ success: false, error: 'Incident not found' })
        return
      }

      await acknowledgeIncident(req.params.incidentId, {
        acknowledgedByUserId: (req.user as any)?.id,
        acknowledgementNote: req.body.acknowledgementNote,
      })

      res.json({
        success: true,
        message: 'Incident acknowledged',
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
 * Escalate an incident to higher management levels
 */
router.post(
  '/:incidentId/escalate',
  withIncidentTracking(async (req: ExtendedRequest, res: Response) => {
    const userRole = (req.user as any)?.role || ''
    if (!['admin', 'security_officer', 'superadmin'].includes(userRole)) {
      res.status(403).json({
        success: false,
        error: 'Insufficient permissions to escalate incident',
      })
      return
    }

    try {
      const incident = await getIncident(req.params.incidentId)
      if (!incident || incident.platform_id !== req.platformId) {
        res.status(404).json({ success: false, error: 'Incident not found' })
        return
      }

      await escalateIncident(req.params.incidentId, {
        escalationLevel: req.body.escalationLevel,
        escalationReason: req.body.escalationReason,
        escalatedByUserId: (req.user as any)?.id,
        escalationNote: req.body.escalationNote,
      })

      res.json({
        success: true,
        message: 'Incident escalated',
        incidentId: req.params.incidentId,
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
 * POST /api/incidents/:incidentId/investigate
 * Start investigation phase
 */
router.post(
  '/:incidentId/investigate',
  withIncidentTracking(async (req: ExtendedRequest, res: Response) => {
    const userRole = (req.user as any)?.role || ''
    if (!['admin', 'security_officer', 'superadmin'].includes(userRole)) {
      res.status(403).json({
        success: false,
        error: 'Insufficient permissions to start investigation',
      })
      return
    }

    try {
      const incident = await getIncident(req.params.incidentId)
      if (!incident || incident.platform_id !== req.platformId) {
        res.status(404).json({ success: false, error: 'Incident not found' })
        return
      }

      await startInvestigation(
        req.params.incidentId,
        (req.user as any)?.id,
        req.body.investigationNote
      )

      res.json({
        success: true,
        message: 'Investigation started',
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
 * POST /api/incidents/:incidentId/root-cause
 * Assign root cause analysis
 */
router.post(
  '/:incidentId/root-cause',
  withIncidentTracking(async (req: ExtendedRequest, res: Response) => {
    const userRole = (req.user as any)?.role || ''
    if (!['admin', 'security_officer', 'superadmin'].includes(userRole)) {
      res.status(403).json({
        success: false,
        error: 'Insufficient permissions to assign root cause',
      })
      return
    }

    try {
      const incident = await getIncident(req.params.incidentId)
      if (!incident || incident.platform_id !== req.platformId) {
        res.status(404).json({ success: false, error: 'Incident not found' })
        return
      }

      await assignRootCause(req.params.incidentId, {
        rootCause: req.body.rootCause,
        assignedByUserId: (req.user as any)?.id,
        confidence: req.body.confidence || 'medium',
        analysisNotes: req.body.analysisNotes,
      })

      res.json({
        success: true,
        message: 'Root cause assigned',
        incidentId: req.params.incidentId,
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
 * POST /api/incidents/:incidentId/mitigate
 * Begin mitigation phase
 */
router.post(
  '/:incidentId/mitigate',
  withIncidentTracking(async (req: ExtendedRequest, res: Response) => {
    const userRole = (req.user as any)?.role || ''
    if (!['admin', 'security_officer', 'superadmin'].includes(userRole)) {
      res.status(403).json({
        success: false,
        error: 'Insufficient permissions to begin mitigation',
      })
      return
    }

    try {
      const incident = await getIncident(req.params.incidentId)
      if (!incident || incident.platform_id !== req.platformId) {
        res.status(404).json({ success: false, error: 'Incident not found' })
        return
      }

      await beginMitigation(
        req.params.incidentId,
        (req.user as any)?.id,
        req.body.mitigationPlan
      )

      res.json({
        success: true,
        message: 'Mitigation started',
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
 * Resolve incident with complete resolution summary
 * REQUIRED FIELDS: rootCause, remediationSteps, preventionMeasures
 */
router.post(
  '/:incidentId/resolve',
  withIncidentTracking(async (req: ExtendedRequest, res: Response) => {
    const userRole = (req.user as any)?.role || ''
    if (!['admin', 'security_officer', 'superadmin'].includes(userRole)) {
      res.status(403).json({
        success: false,
        error: 'Insufficient permissions to resolve incident',
      })
      return
    }

    try {
      const incident = await getIncident(req.params.incidentId)
      if (!incident || incident.platform_id !== req.platformId) {
        res.status(404).json({ success: false, error: 'Incident not found' })
        return
      }

      await resolveIncident(
        req.params.incidentId,
        {
          rootCause: req.body.rootCause,
          remediationSteps: req.body.remediationSteps,
          preventionMeasures: req.body.preventionMeasures,
          postMortemUrl: req.body.postMortemUrl,
          estimatedImpact: req.body.estimatedImpact,
        },
        (req.user as any)?.id
      )

      res.json({
        success: true,
        message: 'Incident resolved',
        incidentId: req.params.incidentId,
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
 * Close a resolved incident (only for 'resolved' status)
 */
router.post(
  '/:incidentId/close',
  withIncidentTracking(async (req: ExtendedRequest, res: Response) => {
    const userRole = (req.user as any)?.role || ''
    if (!['admin', 'security_officer', 'superadmin'].includes(userRole)) {
      res.status(403).json({
        success: false,
        error: 'Insufficient permissions to close incident',
      })
      return
    }

    try {
      const incident = await getIncident(req.params.incidentId)
      if (!incident || incident.platform_id !== req.platformId) {
        res.status(404).json({ success: false, error: 'Incident not found' })
        return
      }

      await closeIncident(req.params.incidentId, (req.user as any)?.id, req.body.closureNote)

      res.json({
        success: true,
        message: 'Incident closed',
        incidentId: req.params.incidentId,
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
 * Get incident lifecycle timeline
 */
router.get(
  '/:incidentId/timeline',
  withIncidentTracking(async (req: ExtendedRequest, res: Response) => {
    const userRole = (req.user as any)?.role || ''
    if (!['admin', 'security_officer', 'superadmin'].includes(userRole)) {
      res.status(403).json({
        success: false,
        error: 'Insufficient permissions to view timeline',
      })
      return
    }

    try {
      const incident = await getIncident(req.params.incidentId)
      if (!incident || incident.platform_id !== req.platformId) {
        res.status(404).json({ success: false, error: 'Incident not found' })
        return
      }

      const timeline = await getIncidentTimeline(req.params.incidentId)

      res.json({
        success: true,
        data: {
          timeline,
          count: timeline.length,
        },
      })
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to retrieve timeline',
      })
    }
  })
)

/**
 * GET /api/incidents/:incidentId/escalations
 * Get incident escalation history
 */
router.get(
  '/:incidentId/escalations',
  withIncidentTracking(async (req: ExtendedRequest, res: Response) => {
    const userRole = (req.user as any)?.role || ''
    if (!['admin', 'security_officer', 'superadmin'].includes(userRole)) {
      res.status(403).json({
        success: false,
        error: 'Insufficient permissions to view escalations',
      })
      return
    }

    try {
      const incident = await getIncident(req.params.incidentId)
      if (!incident || incident.platform_id !== req.platformId) {
        res.status(404).json({ success: false, error: 'Incident not found' })
        return
      }

      const escalations = await getEscalationHistory(req.params.incidentId)

      res.json({
        success: true,
        data: {
          escalations,
          count: escalations.length,
        },
      })
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to retrieve escalations',
      })
    }
  })
)

/**
 * GET /api/incidents/:incidentId/root-causes
 * Get root cause analysis history
 */
router.get(
  '/:incidentId/root-causes',
  withIncidentTracking(async (req: ExtendedRequest, res: Response) => {
    const userRole = (req.user as any)?.role || ''
    if (!['admin', 'security_officer', 'superadmin'].includes(userRole)) {
      res.status(403).json({
        success: false,
        error: 'Insufficient permissions to view root causes',
      })
      return
    }

    try {
      const incident = await getIncident(req.params.incidentId)
      if (!incident || incident.platform_id !== req.platformId) {
        res.status(404).json({ success: false, error: 'Incident not found' })
        return
      }

      const rootCauses = await getRootCauseAnalysis(req.params.incidentId)

      res.json({
        success: true,
        data: {
          rootCauses,
          count: rootCauses.length,
        },
      })
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to retrieve root causes',
      })
    }
  })
)

/**
 * GET /api/incidents/stats
 * Get incident statistics for platform
 */
router.get(
  '/stats',
  withIncidentTracking(async (req: ExtendedRequest, res: Response) => {
    // Verify user has admin role
    const userRole = (req.user as any)?.role || ''
    if (!['admin', 'security_officer', 'superadmin'].includes(userRole)) {
      res.status(403).json({
        success: false,
        error: 'Insufficient permissions to view statistics',
      })
      return
    }

    const stats = await getIncidentStatistics(req.platformId!)

    res.json({
      success: true,
      data: {
        statistics: stats,
        timestamp: new Date().toISOString(),
      },
    })
  })
)

export default router
