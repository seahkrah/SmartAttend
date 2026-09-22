/**
 * PHASE 5, STEP 5.3: Platform Validation Routes
 * API endpoints for triggering validation scenarios, simulations, and recovery drills
 */

import { Router, Response, NextFunction } from 'express'
import type { ExtendedRequest } from '../types/auth.js'
import { authenticateToken } from '../auth/middleware.js'
import {
  resolveTenantContext,
  type TenantRequest,
} from '../auth/tenantContextMiddleware.js'
import { withIncidentTracking } from '../middleware/errorToIncidentMiddleware.js'
// Only the scenario runner is backed by real storage — it writes to the
// incidents table. The readiness, simulation, export and handoff services
// write to tables that do not exist in this schema, so their routes refuse
// rather than import them.
import { runAllScenarios } from '../services/incidentScenarioService.js'

const router = Router()

/**
 * This router had no authentication middleware at all. Every route below read
 * a role off req.user, which was therefore always undefined, so the role
 * checks compared against undefined and refused everyone — except
 * /handoff/:sessionId/accept and /handoff/:sessionId/briefing, which had no
 * role check either and were open to anyone who could reach the port.
 *
 * These are platform operations: running scenarios and simulations, exporting
 * and replaying incidents, handing administration from one person to another.
 * They are not tenant-scoped because they are not tenant-owned; they are
 * reserved to superadmins, and that is now enforced from the server-resolved
 * identity rather than from a JWT claim a token need not carry.
 */
router.use(authenticateToken, resolveTenantContext)

function isSuperadmin(req: ExtendedRequest): boolean {
  return (req as unknown as TenantRequest).ctx?.isSuperadmin === true
}

/** Reserves a route to superadmins, using the resolved identity. */
function superadminOnly(req: ExtendedRequest, res: Response, next: NextFunction): void {
  if (!isSuperadmin(req)) {
    res.status(403).json({ success: false, error: 'Superadmin access required' })
    return
  }
  next()
}

/**
 * Refuses a route whose storage was never created.
 *
 * admin_handoff_sessions, handoff_audit, platform_readiness_reports and
 * validation_reports do not exist in the schema. The services wrote to them
 * inside `.catch(() => {})`, so every call reported success while storing
 * nothing — /handoff/:sessionId/accept in particular answered
 * "Handoff accepted" to an unauthenticated caller and did nothing at all.
 *
 * Answering 501 is not a placeholder: it states plainly that the feature has
 * no persistence yet, instead of fabricating a result the caller cannot
 * distinguish from a real one. Building the subsystem is its own piece of
 * work; reporting fake successes in the meantime is not.
 */
function notImplemented(feature: string, missing: string[]) {
  return (_req: ExtendedRequest, res: Response): void => {
    res.status(501).json({
      success: false,
      error: 'Not implemented',
      message: `${feature} has no storage in this schema, so it cannot record anything. ` +
        `Missing tables: ${missing.join(', ')}.`,
    })
  }
}

/**
 * POST /api/validation/platform-readiness
 * Run comprehensive platform readiness validation
 * Executes all scenarios, simulations, and recovery drills
 * Superadmin only
 */
router.post(
  '/platform-readiness',
  superadminOnly,
  notImplemented('Platform readiness validation', ['platform_readiness_reports', 'validation_reports'])
)

/**
 * GET /api/validation/platform-readiness/latest
 * Get the latest validation report
 */
router.get(
  '/platform-readiness/latest',
  superadminOnly,
  notImplemented('Platform readiness reporting', ['platform_readiness_reports'])
)

/**
 * POST /api/validation/scenarios
 * Run end-to-end scenario testing only
 */
router.post(
  '/scenarios',
  withIncidentTracking(async (req: ExtendedRequest, res: Response) => {
    // An operational action on the platform, so it is reserved to
    // superadmins rather than to any tenant administrator.
    if (!isSuperadmin(req)) {
      res.status(403).json({ success: false, error: 'Insufficient permissions' })
      return
    }

    try {
      console.log('[SCENARIOS] Running end-to-end scenarios...')
      const result = await runAllScenarios((req.user as any)?.id, req.platformId!)

      res.json({
        success: true,
        data: {
          totalScenarios: result.totalScenarios,
          passed: result.passed,
          failed: result.failed,
          duration: result.duration,
          platformReady: result.platformReady,
          results: result.results.map((r) => ({
            name: r.name,
            status: r.status,
            duration: r.duration,
            assertions: r.assertions,
          })),
        },
      })
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
      })
    }
  })
)

/**
 * POST /api/validation/simulations
 * Run time-based incident simulations
 */
router.post(
  '/simulations',
  superadminOnly,
  notImplemented('Time-based simulations', ['simulation_events', 'simulation_runs'])
)

/**
 * POST /api/validation/incidents/:incidentId/export
 * Export an incident for forensic analysis or replay
 */
router.post(
  '/incidents/:incidentId/export',
  superadminOnly,
  notImplemented('Incident export', ['incident_exports'])
)

/**
 * POST /api/validation/handoff/initiate
 * Initiate admin handoff session
 */
router.post(
  '/handoff/initiate',
  superadminOnly,
  notImplemented('Administrator handoff', ['admin_handoff_sessions', 'handoff_audit'])
)

/**
 * POST /api/validation/handoff/:sessionId/accept
 * Accept handoff session
 */
router.post(
  '/handoff/:sessionId/accept',
  superadminOnly,
  notImplemented('Administrator handoff', ['admin_handoff_sessions', 'handoff_audit'])
)

/**
 * GET /api/validation/handoff/:sessionId/briefing
 * Get handoff briefing document
 */
router.get(
  '/handoff/:sessionId/briefing',
  superadminOnly,
  notImplemented('Administrator handoff', ['admin_handoff_sessions', 'handoff_audit'])
)

/**
 * GET /api/validation/health
 * Quick health check for validation systems
 */
router.get(
  '/health',
  withIncidentTracking(async (req: ExtendedRequest, res: Response) => {
    res.json({
      success: true,
      data: {
        validationSystemStatus: 'operational',
        availableTests: [
          'scenarios',
          'simulations',
          'recovery-drills',
          'incident-replay',
          'admin-handoff',
          'full-readiness-validation',
        ],
        timestamp: new Date().toISOString(),
      },
    })
  })
)

export default router
