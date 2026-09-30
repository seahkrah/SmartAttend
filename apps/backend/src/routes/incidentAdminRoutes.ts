/**
 * ===========================
 * INCIDENT ADMIN ROUTES
 * ===========================
 *
 * Superadmin endpoints for incident investigation and management, audited to
 * audit_access_log.
 *
 * Endpoints (paths unchanged, so the existing client keeps working):
 * - GET  /api/admin/incidents                  - list open incidents
 * - GET  /api/admin/incidents/stats            - dashboard stats
 * - GET  /api/admin/incidents/:id              - full incident details
 * - POST /api/admin/incidents/:id/acknowledge  - acknowledge
 * - POST /api/admin/incidents/:id/root-cause   - record a root cause
 * - POST /api/admin/incidents/:id/resolve      - resolve
 * - GET  /api/admin/incidents/stats/escalations - escalation history
 *
 * Rewritten. The gate here was sound in shape — authenticate, then confirm
 * superadmin against the database — but it read `req.user.id`, and the JWT
 * payload carries `userId`. The identity was therefore always undefined and
 * every route answered 401.
 *
 * Underneath, it ran on IncidentManagementService, which targets a different
 * incident schema than the one that exists: `incident_acknowledgments` (the
 * real table is spelt `incident_acknowledgements`), `incident_root_causes`
 * (`incident_root_cause_analyses`), an `open_incidents` view, and columns
 * such as `created_from_error_id`. Not one of its queries could run. The
 * routes now use incidentService and incidentLifecycleService, which are
 * written against the real tables and are what /api/incidents uses.
 *
 * The audit middleware wrote to audit_access_log naming columns that do not
 * exist (`admin_user_id`, `endpoint`, `method`, `query_params`) inside a
 * `.catch()`, so the audit of who looked at incidents silently never
 * happened. It now writes the columns the table has, and a failure to audit
 * refuses the request rather than passing it through unrecorded.
 */

import { Router, Response, NextFunction, Request } from 'express'
import { authenticateToken } from '../auth/middleware.js'
import {
  resolveTenantContext,
  type TenantRequest,
} from '../auth/tenantContextMiddleware.js'
import { logAuditAccess } from '../auth/auditAccessControl.js'
import {
  incidentVisibility,
  contextOf,
  type IncidentVisibility,
} from '../auth/incidentVisibility.js'
import {
  getIncident,
  getOpenIncidents,
  getIncidentStatistics,
} from '../services/incidentService.js'
import {
  acknowledgeIncident,
  assignRootCause,
  resolveIncident,
  getIncidentTimeline,
  getEscalationHistory,
  getRootCauseAnalysis,
} from '../services/incidentLifecycleService.js'

const router = Router()

router.use(authenticateToken, resolveTenantContext)

/** Reserves the whole router to superadmins, from the resolved identity. */
function verifySuperadminAccess(req: Request, res: Response, next: NextFunction): void {
  const ctx = (req as TenantRequest).ctx
  if (!ctx) {
    res.status(401).json({ error: 'UNAUTHORIZED', message: 'Authentication required' })
    return
  }
  if (!ctx.isSuperadmin) {
    res.status(403).json({
      error: 'FORBIDDEN',
      message: 'Only superadmins can access incident endpoints',
    })
    return
  }
  next()
}

/**
 * Records who looked at what.
 *
 * Auditing the auditors only counts if it actually writes, so a failure here
 * refuses the request instead of logging a warning and continuing.
 */
async function auditIncidentAccess(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const ctx = contextOf(req)
  try {
    await logAuditAccess({
      actorId: ctx.userId,
      actorRole: 'superadmin',
      accessType: `INCIDENT_ADMIN_${req.method}`,
      filtersApplied: { path: req.path, method: req.method, query: req.query },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      tenantId: ctx.tenantId ?? undefined,
    })
    next()
  } catch (error) {
    console.error('[INCIDENT_ADMIN] Audit log error:', error)
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'Access could not be recorded, so the request was refused',
    })
  }
}

router.use(verifySuperadminAccess)
router.use(auditIncidentAccess)

function visibility(req: Request): IncidentVisibility {
  return incidentVisibility(contextOf(req))
}

/**
 * Resolves :id once for every route that takes one, within the caller's view.
 */
router.param('id', async (req, res, next: NextFunction, id: string) => {
  try {
    const incident = await getIncident(id, visibility(req))
    if (!incident) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Incident not found' })
      return
    }
    ;(req as any).incident = incident
    next()
  } catch (error) {
    next(error)
  }
})

function fail(res: Response, label: string, error: unknown) {
  console.error(`[INCIDENT_ADMIN] Error ${label}:`, error)
  res.status(500).json({ error: 'INTERNAL_ERROR', message: `Error ${label}` })
}

// ===========================
// GET /api/admin/incidents
// ===========================
router.get('/', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(String(req.query.limit)) || 50, 500)
    const offset = Math.max(parseInt(String(req.query.offset)) || 0, 0)
    const status = req.query.status ? String(req.query.status) : undefined

    const all = await getOpenIncidents(visibility(req))
    const filtered = status ? all.filter((i: any) => i.status === status) : all

    res.json({
      data: filtered.slice(offset, offset + limit),
      pagination: { limit, offset, total: filtered.length },
    })
  } catch (error) {
    fail(res, 'retrieving incidents', error)
  }
})

// ===========================
// GET /api/admin/incidents/stats/escalations
// Declared before /:id so the literal path is not captured as an id.
// ===========================
router.get('/stats/escalations', async (req: Request, res: Response) => {
  try {
    const open = await getOpenIncidents(visibility(req))
    const escalated = open.filter((i: any) => i.status === 'escalated')

    const histories = await Promise.all(
      escalated.map(async (incident: any) => ({
        incidentId: incident.id,
        incidentNumber: incident.incident_number,
        title: incident.title,
        severity: incident.severity,
        escalations: await getEscalationHistory(incident.id),
      }))
    )

    res.json({
      data: histories,
      total: histories.length,
    })
  } catch (error) {
    fail(res, 'retrieving escalations', error)
  }
})

// ===========================
// GET /api/admin/incidents/stats
// ===========================
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const view = visibility(req)
    const [stats, open] = await Promise.all([
      getIncidentStatistics(view),
      getOpenIncidents(view),
    ])

    const count = (predicate: (i: any) => boolean) => open.filter(predicate).length
    const HOUR = 60 * 60 * 1000

    res.json({
      totalOpen: open.length,
      byStatus: {
        open: count((i) => i.status === 'OPEN'),
        investigating: count((i) => i.status === 'INVESTIGATING'),
        contained: count((i) => i.status === 'CONTAINED'),
        unacknowledged: count((i) => !i.acknowledged_at),
      },
      bySeverity: {
        critical: count((i) => i.severity === 'CRITICAL'),
        high: count((i) => i.severity === 'HIGH'),
        medium: count((i) => i.severity === 'MEDIUM'),
        low: count((i) => i.severity === 'LOW'),
      },
      // Unacknowledged for more than an hour.
      overdue: count(
        (i) => !i.acknowledged_at && Date.now() - new Date(i.created_at).getTime() > HOUR
      ),
      totals: stats,
    })
  } catch (error) {
    fail(res, 'retrieving stats', error)
  }
})

// ===========================
// GET /api/admin/incidents/:id
// ===========================
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const incident = (req as any).incident
    const [timeline, escalations, rootCauses] = await Promise.all([
      getIncidentTimeline(incident.id),
      getEscalationHistory(incident.id),
      getRootCauseAnalysis(incident.id),
    ])

    res.json({ ...incident, timeline, escalations, rootCauses })
  } catch (error) {
    fail(res, 'retrieving incident', error)
  }
})

// ===========================
// POST /api/admin/incidents/:id/acknowledge
// ===========================
router.post('/:id/acknowledge', async (req: Request, res: Response) => {
  try {
    const incident = (req as any).incident
    await acknowledgeIncident(incident.id, {
      acknowledgedByUserId: contextOf(req).userId,
      acknowledgementNote: req.body?.notes,
    })

    res.json({ success: true, message: 'Incident acknowledged', incidentId: incident.id })
  } catch (error: any) {
    // A refused state transition is the caller's error, not the server's.
    res.status(400).json({ error: 'BAD_REQUEST', message: error.message })
  }
})

// ===========================
// POST /api/admin/incidents/:id/root-cause
// ===========================
router.post('/:id/root-cause', async (req: Request, res: Response) => {
  try {
    const incident = (req as any).incident
    const { summary, confidence, analysisNotes } = req.body ?? {}

    if (!summary || String(summary).trim().length === 0) {
      res.status(400).json({ error: 'BAD_REQUEST', message: 'A root cause summary is required' })
      return
    }

    const level = ['low', 'medium', 'high'].includes(confidence) ? confidence : 'medium'

    await assignRootCause(incident.id, {
      rootCause: String(summary),
      assignedByUserId: contextOf(req).userId,
      confidence: level,
      analysisNotes,
    })

    res.json({ success: true, message: 'Root cause recorded', incidentId: incident.id })
  } catch (error: any) {
    res.status(400).json({ error: 'BAD_REQUEST', message: error.message })
  }
})

// ===========================
// POST /api/admin/incidents/:id/resolve
// ===========================
router.post('/:id/resolve', async (req: Request, res: Response) => {
  try {
    const incident = (req as any).incident
    const { rootCause, remediationSteps, preventionMeasures, estimatedImpact, postMortemUrl } =
      req.body ?? {}

    if (!rootCause || !remediationSteps || !preventionMeasures) {
      res.status(400).json({
        error: 'BAD_REQUEST',
        message:
          'rootCause, remediationSteps and preventionMeasures are all required to resolve an incident',
      })
      return
    }

    await resolveIncident(
      incident.id,
      { rootCause, remediationSteps, preventionMeasures, estimatedImpact, postMortemUrl },
      contextOf(req).userId
    )

    res.json({ success: true, message: 'Incident resolved', incidentId: incident.id })
  } catch (error: any) {
    res.status(400).json({ error: 'BAD_REQUEST', message: error.message })
  }
})

export default router
