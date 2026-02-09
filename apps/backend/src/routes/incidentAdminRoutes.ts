/**
 * ===========================
 * INCIDENT ADMIN ROUTES
 * ===========================
 * 
 * Superadmin-only endpoints for incident investigation and management.
 * All access is fully audited to audit_access_log.
 * 
 * Endpoints:
 * - GET /api/admin/incidents - List open incidents
 * - GET /api/admin/incidents/stats - Dashboard stats
 * - GET /api/admin/incidents/:id - Full incident details
 * - POST /api/admin/incidents/:id/acknowledge - ACK incident
 * - POST /api/admin/incidents/:id/root-cause - Record root cause
 * - POST /api/admin/incidents/:id/resolve - Resolve and close
 * - GET /api/admin/incidents/stats/escalations - Escalation tracking
 */

import { Router, Response, NextFunction } from 'express'
import { query } from '../db/connection.js'
import { authenticateToken } from '../auth/middleware.js'
import IncidentManagementService from '../services/incidentManagementService.js'

interface AuthRequest {
  user?: {
    id?: string
    email?: string
    role?: string
  }
  method?: string
  path?: string
  query?: any
  ip?: string
  socket?: { remoteAddress?: string }
  get?: (key: string) => string | undefined
}

// ===========================
// MIDDLEWARE
// ===========================

const incidentService = new IncidentManagementService()

/**
 * Verify superadmin access
 */
async function verifySuperadminAccess(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user?.id) {
      res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Authentication required',
      })
      return
    }

    // Check if user is superadmin
    const result = await query(
      `SELECT r.name FROM users u
       JOIN roles r ON u.role_id = r.id
       WHERE u.id = $1`,
      [req.user.id]
    )

    if (result.rows.length === 0 || result.rows[0].name !== 'superadmin') {
      res.status(403).json({
        error: 'FORBIDDEN',
        message: 'Only superadmins can access incident endpoints',
      })
      return
    }

    next()
  } catch (error) {
    console.error('[INCIDENT_ADMIN] Error verifying access:', error)
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'Error verifying access',
    })
  }
}

/**
 * Audit all incident admin access
 */
async function auditIncidentAccess(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (req.user?.id) {
      query(
        `INSERT INTO audit_access_log (
          admin_user_id, action, endpoint, method, query_params,
          ip_address, user_agent
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          req.user.id,
          `INCIDENT_ADMIN_${req.method}`,
          req.path,
          req.method,
          JSON.stringify(req.query),
          req.ip || req.socket?.remoteAddress || null,
          req.get('user-agent') || null,
        ]
      ).catch((err: Error) => {
        console.error('[INCIDENT_ADMIN] Audit log error:', err)
      })
    }

    next()
  } catch (error) {
    console.error('[INCIDENT_ADMIN] Audit middleware error:', error)
    next(error)
  }
}

// ===========================
// ROUTES
// ===========================

const router = Router()

// Apply middleware to all routes
router.use(authenticateToken)
router.use(verifySuperadminAccess)
router.use(auditIncidentAccess)

// ===========================
// GET /api/admin/incidents
// ===========================
/**
 * List open incidents (paginated)
 */
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 500)
    const offset = parseInt(req.query.offset as string) || 0
    const status = req.query.status as string

    let sql = `SELECT * FROM open_incidents WHERE 1=1`
    const params: any[] = []

    if (status) {
      sql += ` AND current_status = $${params.length + 1}`
      params.push(status)
    }

    sql += ` LIMIT $${params.length + 1} OFFSET $${params.length + 2}`
    params.push(limit)
    params.push(offset)

    const result = await query(sql, params)

    res.json({
      data: result.rows,
      pagination: {
        limit,
        offset,
        total: result.rows.length,
      },
    })
  } catch (error) {
    console.error('[INCIDENT_ADMIN] Error listing incidents:', error)
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'Error retrieving incidents',
    })
  }
})

// ===========================
// GET /api/admin/incidents/stats
// ===========================
/**
 * Dashboard stats
 */
router.get('/stats', async (req: AuthRequest, res: Response) => {
  try {
    const stats = await incidentService.getOpenIncidents()

    const summary = {
      totalOpen: stats.length,
      byStatus: {
        reported: stats.filter((i: any) => i.current_status === 'REPORTED').length,
        acknowledged: stats.filter((i: any) => i.current_status === 'ACKNOWLEDGED').length,
        investigating: stats.filter((i: any) => i.current_status === 'INVESTIGATING').length,
      },
      bySeverity: {
        critical: stats.filter((i: any) => i.severity === 'CRITICAL').length,
        high: stats.filter((i: any) => i.severity === 'HIGH').length,
        medium: stats.filter((i: any) => i.severity === 'MEDIUM').length,
      },
      overdue: stats.filter((i: any) => i.hours_open > 1 && i.current_status === 'REPORTED')
        .length,
    }

    res.json(summary)
  } catch (error) {
    console.error('[INCIDENT_ADMIN] Error getting stats:', error)
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'Error retrieving stats',
    })
  }
})

// ===========================
// GET /api/admin/incidents/:id
// ===========================
/**
 * Get full incident details
 */
router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params

    const details = await incidentService.getIncidentDetails(id)

    if (!details) {
      return res.status(404).json({
        error: 'NOT_FOUND',
        message: 'Incident not found',
      })
    }

    res.json(details)
  } catch (error) {
    console.error('[INCIDENT_ADMIN] Error getting incident details:', error)
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'Error retrieving incident',
    })
  }
})

// ===========================
// POST /api/admin/incidents/:id/acknowledge
// ===========================
/**
 * Acknowledge incident (required workflow step)
 */
router.post('/:id/acknowledge', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params
    const { notes } = req.body

    if (!notes || typeof notes !== 'string') {
      return res.status(400).json({
        error: 'INVALID_REQUEST',
        message: 'Acknowledgment notes are required',
      })
    }

    await incidentService.acknowledgeIncident({
      incidentId: id,
      userId: req.user!.id,
      notes,
      context: {
        userId: req.user!.id,
        role: req.user?.role || 'SUPERADMIN',
        ipAddress: req.ip || req.socket?.remoteAddress || undefined,
        userAgent: req.get('user-agent') || undefined,
      },
    })

    res.json({
      success: true,
      message: 'Incident acknowledged',
    })
  } catch (error: any) {
    console.error('[INCIDENT_ADMIN] Error acknowledging incident:', error)

    // Check for already acknowledged
    if (error.message && error.message.includes('already acknowledged')) {
      return res.status(400).json({
        error: 'ALREADY_ACKNOWLEDGED',
        message: error.message,
      })
    }

    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: error.message || 'Error acknowledging incident',
    })
  }
})

// ===========================
// POST /api/admin/incidents/:id/root-cause
// ===========================
/**
 * Record root cause (required before resolution)
 */
router.post('/:id/root-cause', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params
    const { summary, category, remediationSteps } = req.body

    if (!summary || !category || !remediationSteps) {
      return res.status(400).json({
        error: 'INVALID_REQUEST',
        message: 'Summary, category, and remediation steps are required',
      })
    }

    const rcId = await incidentService.recordRootCause({
      incidentId: id,
      userId: req.user!.id,
      rootCauseSummary: summary,
      category: category as any,
      remediationSteps,
      context: {
        userId: req.user!.id,
        role: req.user?.role || 'SUPERADMIN',
      },
    })

    res.json({
      success: true,
      message: 'Root cause recorded',
      rootCauseId: rcId,
    })
  } catch (error: any) {
    console.error('[INCIDENT_ADMIN] Error recording root cause:', error)

    if (error.message && error.message.includes('must be acknowledged')) {
      return res.status(400).json({
        error: 'NOT_ACKNOWLEDGED',
        message: error.message,
      })
    }

    if (error.message && error.message.includes('already recorded')) {
      return res.status(400).json({
        error: 'ALREADY_RECORDED',
        message: error.message,
      })
    }

    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: error.message || 'Error recording root cause',
    })
  }
})

// ===========================
// POST /api/admin/incidents/:id/resolve
// ===========================
/**
 * Resolve incident and close
 * Requires: ACK + Root Cause
 */
router.post('/:id/resolve', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params
    const { resolutionSummary, resolutionNotes, impactAssessment, lessonsLearned, followUpActions } =
      req.body

    if (!resolutionSummary) {
      return res.status(400).json({
        error: 'INVALID_REQUEST',
        message: 'Resolution summary is required',
      })
    }

    await incidentService.resolveIncident({
      incidentId: id,
      userId: req.user!.id,
      resolutionSummary,
      resolutionNotes: resolutionNotes || '',
      impactAssessment,
      lessonsLearned,
      followUpActions,
      context: {
        userId: req.user!.id,
        role: req.user?.role || 'SUPERADMIN',
      },
    })

    res.json({
      success: true,
      message: 'Incident resolved and closed',
    })
  } catch (error: any) {
    console.error('[INCIDENT_ADMIN] Error resolving incident:', error)

    if (error.message && error.message.includes('must be acknowledged')) {
      return res.status(400).json({
        error: 'NOT_ACKNOWLEDGED',
        message: error.message,
      })
    }

    if (error.message && error.message.includes('must be recorded')) {
      return res.status(400).json({
        error: 'NO_ROOT_CAUSE',
        message: error.message,
      })
    }

    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: error.message || 'Error resolving incident',
    })
  }
})

// ===========================
// GET /api/admin/incidents/stats/escalations
// ===========================
/**
 * Get escalation stats
 */
router.get('/stats/escalations', async (req: AuthRequest, res: Response) => {
  try {
    // Get escalations in last 24 hours
    const result = await query(
      `SELECT escalation_reason, COUNT(*) as count
       FROM incident_escalations
       WHERE escalated_at > CURRENT_TIMESTAMP - INTERVAL '24 hours'
       GROUP BY escalation_reason
       ORDER BY count DESC`
    )

    res.json({
      escalations: result.rows,
    })
  } catch (error) {
    console.error('[INCIDENT_ADMIN] Error getting escalation stats:', error)
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'Error retrieving escalation stats',
    })
  }
})

export default router
