/**
 * ===========================
 * ROLE MANAGEMENT ADMIN ROUTES
 * ===========================
 * 
 * Admin-only endpoints for investigating role anomalies and privilege escalation.
 * All access is superadmin-only and fully audited.
 * 
 * Endpoints:
 * - GET /api/admin/roles/history - All role changes (immutable log)
 * - GET /api/admin/roles/user/:userId - User's role history
 * - GET /api/admin/escalation-events - Detected anomalies
 * - POST /api/admin/escalation-events/:eventId/investigate - Mark as investigating
 * - GET /api/admin/role-violations - Permission violations
 */

import { Router, Response, NextFunction } from 'express'
import { query } from '../db/connection.js'

interface AuthRequest {
  user?: {
    id: string
    email: string
    role?: string
  }
}

// ===========================
// MIDDLEWARE
// ===========================

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
      return res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Authentication required',
      })
    }

    // Check if user is superadmin
    const result = await query(
      `SELECT r.name FROM users u
       JOIN roles r ON u.role_id = r.id
       WHERE u.id = $1`,
      [req.user.id]
    )

    if (result.rows.length === 0 || result.rows[0].name !== 'superadmin') {
      console.warn(`[ADMIN_ACCESS_DENIED] Non-superadmin ${req.user.id} attempted admin access`)

      return res.status(403).json({
        error: 'FORBIDDEN',
        message: 'Only superadmins can access this endpoint',
      })
    }

    next()
  } catch (error) {
    console.error('[ADMIN_ROUTES] Error verifying superadmin access:', error)
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'Error verifying access',
    })
  }
}

/**
 * Audit all admin access to audit_access_log
 */
async function auditAdminAccess(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (req.user?.id) {
      // Log the access (non-blocking)
      query(
        `INSERT INTO audit_access_log (
          admin_user_id, action, endpoint, method, query_params, accessed_user_id, ip_address, user_agent
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          req.user.id,
          `ADMIN_${req.method}`,
          req.path,
          req.method,
          JSON.stringify(req.query),
          (req.query.userId as string) || null,
          req.ip || req.socket?.remoteAddress || null,
          req.get('user-agent') || null,
        ]
      ).catch((err: Error) => {
        console.error('[ADMIN_ROUTES] Error logging access:', err)
      })
    }

    next()
  } catch (error) {
    console.error('[ADMIN_ROUTES] Error in audit middleware:', error)
    next(error)
  }
}

// ===========================
// ROUTES
// ===========================

const router = Router()

// Apply middleware to all routes
router.use(verifySuperadminAccess)
router.use(auditAdminAccess)

// ===========================
// GET /api/admin/roles/history
// ===========================
/**
 * Get all role assignment history (paginated)
 * Query params:
 * - limit: number (default 50, max 500)
 * - offset: number (default 0)
 * - severity: LOW|MEDIUM|HIGH|CRITICAL (filter)
 * - is_verified: true|false (filter)
 */
router.get('/roles/history', async (req: AuthRequest, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 500)
    const offset = parseInt(req.query.offset as string) || 0
    const severity = req.query.severity as string
    const isVerified = req.query.is_verified as string

    let sql = `SELECT 
      rah.id, rah.user_id, rah.role_id, rah.assigned_by_user_id, 
      rah.assigned_at, rah.revoked_at, rah.reason, rah.severity,
      rah.detection_flags, rah.anomaly_score, rah.is_verified,
      r.name as role_name,
      u.email as assigned_to_email,
      admin_u.email as assigned_by_email
     FROM role_assignment_history rah
     JOIN roles r ON rah.role_id = r.id
     JOIN users u ON rah.user_id = u.id
     LEFT JOIN users admin_u ON rah.assigned_by_user_id = admin_u.id
     WHERE 1=1`

    const params: any[] = []

    // Add filters
    if (severity) {
      sql += ` AND rah.severity = $${params.length + 1}`
      params.push(severity)
    }

    if (isVerified !== undefined) {
      sql += ` AND rah.is_verified = $${params.length + 1}`
      params.push(isVerified === 'true')
    }

    sql += ` ORDER BY rah.assigned_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`
    params.push(limit)
    params.push(offset)

    const result = await query(sql, params)

    // Get total count
    let countSql = `SELECT COUNT(*) as total FROM role_assignment_history WHERE 1=1`
    const countParams: any[] = []

    if (severity) {
      countSql += ` AND severity = $${countParams.length + 1}`
      countParams.push(severity)
    }

    if (isVerified !== undefined) {
      countSql += ` AND is_verified = $${countParams.length + 1}`
      countParams.push(isVerified === 'true')
    }

    const countResult = await query(countSql, countParams)
    const total = parseInt(countResult.rows[0].total)

    res.json({
      data: result.rows,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
    })
  } catch (error) {
    console.error('[ADMIN_ROUTES] Error getting role history:', error)
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'Error retrieving role history',
    })
  }
})

// ===========================
// GET /api/admin/roles/user/:userId
// ===========================
/**
 * Get specific user's role change history
 */
router.get('/roles/user/:userId', async (req: AuthRequest, res: Response) => {
  try {
    const { userId } = req.params
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 500)

    const result = await query(
      `SELECT 
        rah.id, rah.user_id, rah.role_id, rah.assigned_by_user_id,
        rah.assigned_at, rah.revoked_at, rah.reason, rah.severity,
        rah.detection_flags, rah.anomaly_score, rah.is_verified, rah.checksum,
        r.name as role_name,
        admin_u.email as assigned_by_email
       FROM role_assignment_history rah
       JOIN roles r ON rah.role_id = r.id
       LEFT JOIN users admin_u ON rah.assigned_by_user_id = admin_u.id
       WHERE rah.user_id = $1
       ORDER BY rah.assigned_at DESC
       LIMIT $2`,
      [userId, limit]
    )

    // Get user info
    const userResult = await query(
      `SELECT id, email, first_name, last_name, role_may_be_compromised, total_role_changes
       FROM users WHERE id = $1`,
      [userId]
    )

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        error: 'USER_NOT_FOUND',
        message: 'User not found',
      })
    }

    res.json({
      user: userResult.rows[0],
      roleHistory: result.rows,
      summary: {
        totalChanges: result.rows.length,
        averageAnomalyScore: result.rows.length > 0 
          ? Math.round(
              result.rows.reduce((sum: number, row: any) => sum + (row.anomaly_score || 0), 0) /
              result.rows.length
            )
          : 0,
        suspiciousChanges: result.rows.filter((r: any) => r.anomaly_score > 50).length,
      },
    })
  } catch (error) {
    console.error('[ADMIN_ROUTES] Error getting user role history:', error)
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'Error retrieving user role history',
    })
  }
})

// ===========================
// GET /api/admin/escalation-events
// ===========================
/**
 * Get detected privilege escalation events
 * Query params:
 * - severity: LOW|MEDIUM|HIGH|CRITICAL
 * - status: OPEN|INVESTIGATING|RESOLVED
 * - limit: number
 * - offset: number
 */
router.get('/escalation-events', async (req: AuthRequest, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 500)
    const offset = parseInt(req.query.offset as string) || 0
    const severity = req.query.severity as string
    const status = req.query.status as string

    let sql = `SELECT 
      pee.id, pee.role_assignment_id, pee.affected_user_id, pee.triggered_by_user_id,
      pee.event_type, pee.severity, pee.anomaly_score, pee.correlation_flags,
      pee.status, pee.investigation_notes, pee.created_at, pee.resolved_at,
      au.email as affected_user_email,
      tu.email as triggered_by_email
     FROM privilege_escalation_events pee
     JOIN users au ON pee.affected_user_id = au.id
     LEFT JOIN users tu ON pee.triggered_by_user_id = tu.id
     WHERE 1=1`

    const params: any[] = []

    if (severity) {
      sql += ` AND pee.severity = $${params.length + 1}`
      params.push(severity)
    }

    if (status) {
      sql += ` AND pee.status = $${params.length + 1}`
      params.push(status)
    }

    sql += ` ORDER BY pee.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`
    params.push(limit)
    params.push(offset)

    const result = await query(sql, params)

    // Get count
    let countSql = `SELECT COUNT(*) as total FROM privilege_escalation_events WHERE 1=1`
    const countParams: any[] = []

    if (severity) {
      countSql += ` AND severity = $${countParams.length + 1}`
      countParams.push(severity)
    }

    if (status) {
      countSql += ` AND status = $${countParams.length + 1}`
      countParams.push(status)
    }

    const countResult = await query(countSql, countParams)
    const total = parseInt(countResult.rows[0].total)

    res.json({
      data: result.rows,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
    })
  } catch (error) {
    console.error('[ADMIN_ROUTES] Error getting escalation events:', error)
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'Error retrieving escalation events',
    })
  }
})

// ===========================
// POST /api/admin/escalation-events/:eventId/investigate
// ===========================
/**
 * Mark escalation event as under investigation / add investigation notes
 */
router.post('/escalation-events/:eventId/investigate', async (req: AuthRequest, res: Response) => {
  try {
    const { eventId } = req.params
    const { notes } = req.body

    if (!notes || typeof notes !== 'string') {
      return res.status(400).json({
        error: 'INVALID_REQUEST',
        message: 'Investigation notes are required',
      })
    }

    // Verify event exists
    const eventResult = await query(`SELECT id FROM privilege_escalation_events WHERE id = $1`, [
      eventId,
    ])

    if (eventResult.rows.length === 0) {
      return res.status(404).json({
        error: 'EVENT_NOT_FOUND',
        message: 'Escalation event not found',
      })
    }

    // Update event
    await query(
      `UPDATE privilege_escalation_events 
       SET status = 'INVESTIGATING', investigation_notes = $1, investigated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [notes, eventId]
    )

    res.json({
      success: true,
      message: 'Event marked as investigating',
    })
  } catch (error) {
    console.error('[ADMIN_ROUTES] Error updating investigation:', error)
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'Error updating investigation',
    })
  }
})

// ===========================
// POST /api/admin/escalation-events/:eventId/resolve
// ===========================
/**
 * Resolve escalation event
 */
router.post('/escalation-events/:eventId/resolve', async (req: AuthRequest, res: Response) => {
  try {
    const { eventId } = req.params
    const { resolution, unmarkUserRole } = req.body

    if (!resolution || typeof resolution !== 'string') {
      return res.status(400).json({
        error: 'INVALID_REQUEST',
        message: 'Resolution notes are required',
      })
    }

    // Get event and affected user
    const eventResult = await query(
      `SELECT affected_user_id FROM privilege_escalation_events WHERE id = $1`,
      [eventId]
    )

    if (eventResult.rows.length === 0) {
      return res.status(404).json({
        error: 'EVENT_NOT_FOUND',
        message: 'Escalation event not found',
      })
    }

    const affectedUserId = eventResult.rows[0].affected_user_id

    // Update event
    await query(
      `UPDATE privilege_escalation_events 
       SET status = 'RESOLVED', investigation_notes = $1, resolved_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [resolution, eventId]
    )

    // Optionally unmark user's role as compromised (if investigation cleared them)
    if (unmarkUserRole === true) {
      await query(
        `UPDATE users 
         SET role_may_be_compromised = FALSE
         WHERE id = $1`,
        [affectedUserId]
      )

      console.log(`[ADMIN_ROUTES] User ${affectedUserId}'s role unmarked as compromised by superadmin`)
    }

    res.json({
      success: true,
      message: 'Event resolved',
    })
  } catch (error) {
    console.error('[ADMIN_ROUTES] Error resolving event:', error)
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'Error resolving event',
    })
  }
})

// ===========================
// GET /api/admin/role-violations
// ===========================
/**
 * Get all role boundary violations
 */
router.get('/role-violations', async (req: AuthRequest, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 500)
    const offset = parseInt(req.query.offset as string) || 0
    const severity = req.query.severity as string

    let sql = `SELECT 
      id, user_id, user_role, action_type, target_resource_type,
      target_resource_id, reason, severity, ip_address, user_agent,
      created_at
     FROM role_boundary_violations
     WHERE 1=1`

    const params: any[] = []

    if (severity) {
      sql += ` AND severity = $${params.length + 1}`
      params.push(severity)
    }

    sql += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`
    params.push(limit)
    params.push(offset)

    const result = await query(sql, params)

    res.json({
      data: result.rows,
    })
  } catch (error) {
    console.error('[ADMIN_ROUTES] Error getting role violations:', error)
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'Error retrieving role violations',
    })
  }
})

export default router
