/**
 * PHASE 5, STEP 5.1: Incidents API Routes
 * PHASE 5, STEP 5.2: Incident Lifecycle Enforcement Routes
 */

import { Router, Response, NextFunction } from 'express'
import type { ExtendedRequest } from '../types/auth.js'
import { authenticateToken } from '../auth/middleware.js'
import { resolveTenantContext } from '../auth/tenantContextMiddleware.js'
import {
  incidentVisibility,
  contextOf,
  IncidentAccessError,
  type IncidentVisibility,
} from '../auth/incidentVisibility.js'
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
 * This router carried no authentication middleware at all — not at the mount
 * point, not on any route. Every handler read a role off req.user, which was
 * therefore always undefined, so the role checks compared against the empty
 * string and refused everyone. The whole surface was dead, and looked
 * protected.
 *
 * Reviving it needed the scoping first. The list and statistics queries
 * filtered on platform_id, one value shared by every school, and the by-id
 * reads filtered on nothing; an incident carries a title, a description, the
 * error that produced it and who it affected, so one school's incidents would
 * have been readable and editable by another's administrators.
 */
router.use(authenticateToken, resolveTenantContext)

function visibility(req: ExtendedRequest): IncidentVisibility {
  return incidentVisibility(contextOf(req))
}

/**
 * Resolves :incidentId once, for every route that takes one.
 *
 * Doing it as param middleware rather than in each handler means the check
 * cannot be forgotten when a route is added, and an incident outside the
 * caller's view is refused before any handler runs. It reads as 404 rather
 * than 403, so an id cannot be probed for existence.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

router.param('incidentId', async (req, res, next: NextFunction, incidentId: string) => {
  try {
    // A path segment that is not an id at all reads as absent, rather than
    // reaching the database and coming back as a cast error.
    if (!UUID.test(incidentId)) {
      res.status(404).json({ success: false, error: 'Incident not found' })
      return
    }
    const incident = await getIncident(incidentId, visibility(req as ExtendedRequest))
    if (!incident) {
      res.status(404).json({ success: false, error: 'Incident not found' })
      return
    }
    ;(req as any).incident = incident
    next()
  } catch (error) {
    if (error instanceof IncidentAccessError) {
      res.status(error.status).json({ success: false, error: error.message })
      return
    }
    next(error)
  }
})

/** Restricts a route to roles that may act on incidents. */
function requireIncidentRole(req: ExtendedRequest, res: Response, next: NextFunction): void {
  if (!visibility(req).any) {
    res.status(403).json({ success: false, error: 'Insufficient permissions to view incidents' })
    return
  }
  next()
}

/**
 * GET /api/incidents/critical
 * Get all critical open incidents for platform
 */
router.get(
  '/critical',
  withIncidentTracking(async (req: ExtendedRequest, res: Response) => {
    if (!visibility(req).any) {
      res.status(403).json({ success: false, error: 'Insufficient permissions to view critical incidents' })
      return
    }

    const incidents = await getCriticalIncidents(visibility(req))

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
    if (!visibility(req).any) {
      res.status(403).json({ success: false, error: 'Insufficient permissions to view incidents' })
      return
    }

    const incidents = await getOpenIncidents(visibility(req))

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
 * GET /api/incidents/stats
 * Get incident statistics for platform
 */
router.get(
  '/stats',
  withIncidentTracking(async (req: ExtendedRequest, res: Response) => {
    if (!visibility(req).any) {
      res.status(403).json({ success: false, error: 'Insufficient permissions to view statistics' })
      return
    }

    const stats = await getIncidentStatistics(visibility(req))

    res.json({
      success: true,
      data: {
        statistics: stats,
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
    if (!visibility(req).any) {
      res.status(403).json({ success: false, error: 'Insufficient permissions to view incident' })
      return
    }

    // Resolved and scoped by the :incidentId param middleware above.
    res.json({
      success: true,
      data: (req as any).incident,
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
    if (!visibility(req).any) {
      res.status(403).json({ success: false, error: 'Insufficient permissions to update incident' })
      return
    }

    // Resolved and scoped by the :incidentId param middleware above.
    const incident = (req as any).incident
    const actor = contextOf(req).userId
    // Who acknowledged and who resolved are the signed-in caller, never ids
    // from the body. Taking them from the body let a caller record anyone,
    // including a user of another tenant, as having handled the incident.
    // Acknowledgement is stamped once, by the first person to act on it.
    const resolving =
      String(req.body.status ?? '').toUpperCase() === 'RESOLVED' || req.body.resolvedByUserId !== undefined
    const updates = {
      status: req.body.status,
      severity: req.body.severity,
      acknowledgedByUserId: incident.acknowledged_by_user_id ? undefined : actor,
      resolvedByUserId: resolving ? actor : undefined,
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
        contextOf(req).userId
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
        contextOf(req).userId
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
    if (!visibility(req).any) {
      res.status(403).json({ success: false, error: 'Insufficient permissions to acknowledge incident' })
      return
    }

    try {
      await acknowledgeIncident(req.params.incidentId, {
        acknowledgedByUserId: contextOf(req).userId,
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
    if (!visibility(req).any) {
      res.status(403).json({ success: false, error: 'Insufficient permissions to escalate incident' })
      return
    }

    try {
      await escalateIncident(req.params.incidentId, {
        escalationLevel: req.body.escalationLevel,
        escalationReason: req.body.escalationReason,
        escalatedByUserId: contextOf(req).userId,
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
    if (!visibility(req).any) {
      res.status(403).json({ success: false, error: 'Insufficient permissions to start investigation' })
      return
    }

    try {
      await startInvestigation(
        req.params.incidentId,
        contextOf(req).userId,
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
    if (!visibility(req).any) {
      res.status(403).json({ success: false, error: 'Insufficient permissions to assign root cause' })
      return
    }

    try {
      await assignRootCause(req.params.incidentId, {
        rootCause: req.body.rootCause,
        assignedByUserId: contextOf(req).userId,
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
    if (!visibility(req).any) {
      res.status(403).json({ success: false, error: 'Insufficient permissions to begin mitigation' })
      return
    }

    try {
      await beginMitigation(
        req.params.incidentId,
        contextOf(req).userId,
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
    if (!visibility(req).any) {
      res.status(403).json({ success: false, error: 'Insufficient permissions to resolve incident' })
      return
    }

    try {
      await resolveIncident(
        req.params.incidentId,
        {
          rootCause: req.body.rootCause,
          remediationSteps: req.body.remediationSteps,
          preventionMeasures: req.body.preventionMeasures,
          postMortemUrl: req.body.postMortemUrl,
          estimatedImpact: req.body.estimatedImpact,
        },
        contextOf(req).userId
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
    if (!visibility(req).any) {
      res.status(403).json({ success: false, error: 'Insufficient permissions to close incident' })
      return
    }

    try {
      await closeIncident(req.params.incidentId, contextOf(req).userId, req.body.closureNote)

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
    if (!visibility(req).any) {
      res.status(403).json({ success: false, error: 'Insufficient permissions to view timeline' })
      return
    }

    try {
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
    if (!visibility(req).any) {
      res.status(403).json({ success: false, error: 'Insufficient permissions to view escalations' })
      return
    }

    try {
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
    if (!visibility(req).any) {
      res.status(403).json({ success: false, error: 'Insufficient permissions to view root causes' })
      return
    }

    try {
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


export default router
