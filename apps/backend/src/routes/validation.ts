/**
 * PHASE 5, STEP 5.3: Platform Validation Routes
 * API endpoints for triggering validation scenarios, simulations, and recovery drills
 */

import { Router, Response } from 'express'
import type { ExtendedRequest } from '../types/auth.js'
import { withIncidentTracking } from '../middleware/errorToIncidentMiddleware.js'
import {
  validatePlatformReadiness,
  getLatestValidationReport,
} from '../services/platformReadinessService.js'
import { runAllScenarios } from '../services/incidentScenarioService.js'
import { runAllSimulations } from '../services/timeBasedSimulationService.js'
import { exportIncident, replayIncident } from '../services/incidentReplayService.js'
import { initiateHandoffSession, acceptHandoff, generateHandoffBriefing } from '../services/adminHandoffService.js'

const router = Router()

/**
 * POST /api/validation/platform-readiness
 * Run comprehensive platform readiness validation
 * Executes all scenarios, simulations, and recovery drills
 * Superadmin only
 */
router.post(
  '/platform-readiness',
  withIncidentTracking(async (req: ExtendedRequest, res: Response) => {
    // Superadmin only
    if ((req.user as any)?.role !== 'superadmin') {
      res.status(403).json({
        success: false,
        error: 'Platform readiness validation is superadmin only',
      })
      return
    }

    try {
      console.log('[READINESS] Starting platform validation...')
      const report = await validatePlatformReadiness((req.user as any)?.id, req.platformId)

      res.json({
        success: true,
        data: {
          reportId: report.reportId,
          status: report.status,
          timestamp: report.timestamp,
          consensus: report.consensus,
          recommendations: report.recommendations,
          findings: report.findings,
        },
      })
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || 'Platform validation failed',
      })
    }
  })
)

/**
 * GET /api/validation/platform-readiness/latest
 * Get the latest validation report
 */
router.get(
  '/platform-readiness/latest',
  withIncidentTracking(async (req: ExtendedRequest, res: Response) => {
    if ((req.user as any)?.role !== 'superadmin') {
      res.status(403).json({
        success: false,
        error: 'Insufficient permissions',
      })
      return
    }

    try {
      const report = await getLatestValidationReport(req.platformId)

      if (!report) {
        res.json({
          success: true,
          data: null,
          message: 'No validation reports found',
        })
        return
      }

      res.json({
        success: true,
        data: {
          reportId: report.reportId,
          status: report.status,
          timestamp: report.timestamp,
          consensus: report.consensus,
          recommendations: report.recommendations,
          findings: report.findings,
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
 * POST /api/validation/scenarios
 * Run end-to-end scenario testing only
 */
router.post(
  '/scenarios',
  withIncidentTracking(async (req: ExtendedRequest, res: Response) => {
    if (!['admin', 'superadmin'].includes((req.user as any)?.role)) {
      res.status(403).json({
        success: false,
        error: 'Insufficient permissions',
      })
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
  withIncidentTracking(async (req: ExtendedRequest, res: Response) => {
    if ((req.user as any)?.role !== 'superadmin') {
      res.status(403).json({
        success: false,
        error: 'Simulations are superadmin only',
      })
      return
    }

    try {
      console.log('[SIMULATIONS] Running time-based simulations...')
      const result = await runAllSimulations()

      res.json({
        success: true,
        data: {
          totalSimulations: result.totalSimulations,
          completed: result.completed,
          failed: result.failed,
          totalRealDuration: result.totalRealDuration,
          systemStable: result.systemStable,
          results: result.results.map((r) => ({
            name: r.name,
            status: r.status,
            realDuration: r.realDuration,
            simulatedDuration: r.simulatedDuration,
            eventsExecuted: r.eventsExecuted,
            eventsFailed: r.eventsFailed,
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
 * POST /api/validation/incidents/:incidentId/export
 * Export an incident for forensic analysis or replay
 */
router.post(
  '/incidents/:incidentId/export',
  withIncidentTracking(async (req: ExtendedRequest, res: Response) => {
    if (!['admin', 'security_officer', 'superadmin'].includes((req.user as any)?.role)) {
      res.status(403).json({
        success: false,
        error: 'Insufficient permissions',
      })
      return
    }

    try {
      const record = await exportIncident(req.params.incidentId)

      res.json({
        success: true,
        data: {
          exportId: record.id,
          incidentId: record.incidentId,
          title: record.title,
          actionsCount: record.actions.length,
          escalationsCount: record.escalations.length,
          rootCausesCount: record.rootCauseAnalyses.length,
          exportedAt: record.exportedAt,
        },
      })
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message,
      })
    }
  })
)

/**
 * POST /api/validation/handoff/initiate
 * Initiate admin handoff session
 */
router.post(
  '/handoff/initiate',
  withIncidentTracking(async (req: ExtendedRequest, res: Response) => {
    if (!['admin', 'superadmin'].includes((req.user as any)?.role)) {
      res.status(403).json({
        success: false,
        error: 'Insufficient permissions',
      })
      return
    }

    try {
      if (!req.body.toUserId) {
        res.status(400).json({
          success: false,
          error: 'toUserId is required',
        })
        return
      }

      const session = await initiateHandoffSession(
        (req.user as any)?.id,
        req.body.toUserId,
        req.platformId!,
        req.body.briefingNotes || ''
      )

      res.json({
        success: true,
        data: {
          sessionId: session.sessionId,
          fromAdmin: session.fromAdmin,
          toAdmin: session.toAdmin,
          incidentCount: session.incidents.length,
          systemHealth: session.systemHealth,
          startTime: session.startTime,
        },
      })
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message,
      })
    }
  })
)

/**
 * POST /api/validation/handoff/:sessionId/accept
 * Accept handoff session
 */
router.post(
  '/handoff/:sessionId/accept',
  withIncidentTracking(async (req: ExtendedRequest, res: Response) => {
    try {
      await acceptHandoff(req.params.sessionId, (req.user as any)?.id)

      res.json({
        success: true,
        message: 'Handoff accepted',
        sessionId: req.params.sessionId,
      })
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message,
      })
    }
  })
)

/**
 * GET /api/validation/handoff/:sessionId/briefing
 * Get handoff briefing document
 */
router.get(
  '/handoff/:sessionId/briefing',
  withIncidentTracking(async (req: ExtendedRequest, res: Response) => {
    try {
      const briefing = await generateHandoffBriefing(req.params.sessionId)

      res.json({
        success: true,
        data: {
          sessionId: req.params.sessionId,
          briefing,
        },
      })
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message,
      })
    }
  })
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
