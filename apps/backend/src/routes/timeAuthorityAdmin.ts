/**
 * ===========================
 * TIME AUTHORITY ADMIN ROUTES  
 * ===========================
 * 
 * Superadmin endpoints for viewing drift statistics and incidents.
 * These endpoints are read-only and audit the auditors.
 */

import { Router, Request, Response } from 'express'
import { query } from '../db/connection'
import { authenticate, authorizeRole } from '../auth/middleware'
import {
  getOpenIncidents,
  getTenantClockDriftStats,
  getUserClockDriftHistory,
  getCriticalDriftEvents,
} from '../services/timeAuthorityService'

const router = Router()

// All endpoints require superadmin authentication
router.use(authenticate)
router.use(authorizeRole(['superadmin']))

/**
 * GET /api/admin/drift/summary
 * Get overall drift statistics for entire system
 */
router.get('/api/admin/drift/summary', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId // From auth token

    const result = await query(
      `SELECT 
        COUNT(*) as total_events,
        COUNT(*) FILTER (WHERE drift_category = 'ACCEPTABLE') as acceptable_count,
        COUNT(*) FILTER (WHERE drift_category = 'WARNING') as warning_count,
        COUNT(*) FILTER (WHERE drift_category = 'BLOCKED') as blocked_count,
        COUNT(*) FILTER (WHERE drift_category = 'CRITICAL') as critical_count,
        AVG(ABS(drift_seconds)) as avg_drift_seconds,
        MAX(ABS(drift_seconds)) as max_drift_seconds,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY ABS(drift_seconds)) as p95_drift_seconds,
        PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY ABS(drift_seconds)) as p99_drift_seconds,
        COUNT(*) FILTER (WHERE was_accepted = FALSE) as rejected_events
       FROM drift_audit_log
       WHERE user_id IN (SELECT id FROM users WHERE tenant_id = $1)`,
      [tenantId]
    )

    const summary = result.rows[0]

    // Get most common devices with high drift
    const deviceResult = await query(
      `SELECT 
        device_id,
        device_model,
        COUNT(*) as event_count,
        AVG(ABS(drift_seconds)) as avg_drift,
        COUNT(*) FILTER (WHERE drift_category = 'CRITICAL') as critical_count
       FROM drift_audit_log
       WHERE user_id IN (SELECT id FROM users WHERE tenant_id = $1)
       GROUP BY device_id, device_model
       ORDER BY critical_count DESC, avg_drift DESC
       LIMIT 10`,
      [tenantId]
    )

    res.json({
      summary,
      topProblematicDevices: deviceResult.rows,
      generatedAt: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[TIME_ADMIN] Summary error:', error)
    res.status(500).json({ error: 'Failed to get drift summary' })
  }
})

/**
 * GET /api/admin/drift/user/:userId
 * Get drift statistics for specific user
 */
router.get('/api/admin/drift/user/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params
    const tenantId = (req as any).tenantId

    // Verify user belongs to tenant
    const userResult = await query(
      `SELECT id FROM users WHERE id = $1 AND tenant_id = $2`,
      [userId, tenantId]
    )

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' })
    }

    // Get user statistics
    const statsResult = await query(
      `SELECT 
        user_id,
        COUNT(*) as total_events,
        COUNT(*) FILTER (WHERE drift_category = 'ACCEPTABLE') as acceptable_count,
        COUNT(*) FILTER (WHERE drift_category = 'WARNING') as warning_count,
        COUNT(*) FILTER (WHERE drift_category = 'BLOCKED') as blocked_count,
        COUNT(*) FILTER (WHERE drift_category = 'CRITICAL') as critical_count,
        AVG(ABS(drift_seconds)) as avg_drift_seconds,
        MAX(ABS(drift_seconds)) as max_drift_seconds,
        COUNT(DISTINCT device_id) as unique_devices,
        COUNT(*) FILTER (WHERE was_accepted = FALSE) as rejected_events,
        date_trunc('day', MAX(server_time)) as last_event
       FROM drift_audit_log
       WHERE user_id = $1
       GROUP BY user_id`,
      [userId]
    )

    if (statsResult.rows.length === 0) {
      return res.json({ message: 'No drift events for user', userId })
    }

    // Get device breakdown
    const devicesResult = await query(
      `SELECT 
        device_id,
        device_model,
        COUNT(*) as event_count,
        AVG(ABS(drift_seconds)) as avg_drift,
        MAX(ABS(drift_seconds)) as max_drift,
        COUNT(*) FILTER (WHERE drift_category = 'CRITICAL') as critical_events
       FROM drift_audit_log
       WHERE user_id = $1
       GROUP BY device_id, device_model
       ORDER BY event_count DESC`,
      [userId]
    )

    // Get recent events
    const recentResult = await query(
      `SELECT 
        id,
        server_time,
        drift_seconds,
        drift_direction,
        drift_category,
        action_type,
        was_accepted
       FROM drift_audit_log
       WHERE user_id = $1
       ORDER BY server_time DESC
       LIMIT 50`,
      [userId]
    )

    res.json({
      stats: statsResult.rows[0],
      devices: devicesResult.rows,
      recentEvents: recentResult.rows,
      userId,
    })
  } catch (error) {
    console.error('[TIME_ADMIN] User stats error:', error)
    res.status(500).json({ error: 'Failed to get user drift statistics' })
  }
})

/**
 * GET /api/admin/drift/device/:deviceId
 * Get drift statistics for specific device
 */
router.get('/api/admin/drift/device/:deviceId', async (req: Request, res: Response) => {
  try {
    const { deviceId } = req.params
    const tenantId = (req as any).tenantId

    // Get device statistics
    const result = await query(
      `SELECT 
        device_id,
        device_model,
        os_version,
        app_version,
        COUNT(*) as total_events,
        COUNT(DISTINCT user_id) as unique_users,
        AVG(ABS(drift_seconds)) as avg_drift_seconds,
        MAX(ABS(drift_seconds)) as max_drift_seconds,
        STDDEV(drift_seconds) as stddev_drift,
        COUNT(*) FILTER (WHERE drift_category = 'CRITICAL') as critical_count,
        COUNT(*) FILTER (WHERE was_accepted = FALSE) as rejected_events,
        date_trunc('day', MAX(server_time)) as last_seen
       FROM drift_audit_log
       WHERE device_id = $1
         AND user_id IN (SELECT id FROM users WHERE tenant_id = $2)
       GROUP BY device_id, device_model, os_version, app_version`,
      [deviceId, tenantId]
    )

    if (result.rows.length === 0) {
      return res.json({ message: 'No drift events for device', deviceId })
    }

    // Get recent events on this device
    const recentResult = await query(
      `SELECT 
        id,
        user_id,
        server_time,
        drift_seconds,
        drift_category,
        action_type,
        was_accepted
       FROM drift_audit_log
       WHERE device_id = $1
         AND user_id IN (SELECT id FROM users WHERE tenant_id = $2)
       ORDER BY server_time DESC
       LIMIT 30`,
      [deviceId, tenantId]
    )

    res.json({
      stats: result.rows[0],
      recentEvents: recentResult.rows,
      deviceId,
    })
  } catch (error) {
    console.error('[TIME_ADMIN] Device stats error:', error)
    res.status(500).json({ error: 'Failed to get device drift statistics' })
  }
})

/**
 * GET /api/admin/drift/incidents
 * Get drift-related incidents
 */
router.get('/api/admin/drift/incidents', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId
    const status = req.query.status as string
    const severity = req.query.severity as string
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 500)

    let whereClause = `
      WHERE i.drift_audit_id IN (
        SELECT id FROM drift_audit_log
        WHERE user_id IN (SELECT id FROM users WHERE tenant_id = $1)
      )
    `
    const params: any[] = [tenantId]

    if (status) {
      whereClause += ` AND i.status = $${params.length + 1}`
      params.push(status)
    }

    if (severity) {
      whereClause += ` AND i.severity = $${params.length + 1}`
      params.push(severity)
    }

    const result = await query(
      `SELECT 
        i.id,
        i.incident_type,
        i.severity,
        i.status,
        i.drift_seconds,
        i.created_at,
        i.resolved_at,
        d.user_id,
        d.device_id,
        d.action_type
       FROM time_authority_incidents i
       JOIN drift_audit_log d ON i.drift_audit_id = d.id
       ${whereClause}
       ORDER BY i.created_at DESC
       LIMIT $${params.length + 1}`,
      [...params, limit]
    )

    res.json({
      incidents: result.rows,
      count: result.rows.length,
      limit,
    })
  } catch (error) {
    console.error('[TIME_ADMIN] Incidents error:', error)
    res.status(500).json({ error: 'Failed to get incidents' })
  }
})

/**
 * GET /api/admin/drift/anomalies
 * Get potential fraud indicators
 */
router.get('/api/admin/drift/anomalies', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId

    const result = await query(
      `SELECT 
        user_id,
        device_id,
        COUNT(*) as event_count,
        AVG(drift_seconds) as avg_drift_seconds,
        STDDEV(drift_seconds) as stddev_drift_seconds,
        COUNT(*) FILTER (WHERE ABS(drift_seconds) > 300) as high_drift_count,
        COUNT(*) FILTER (WHERE drift_direction = 'AHEAD') as ahead_count,
        COUNT(*) FILTER (WHERE action_taken IN ('BLOCKED', 'ESCALATED')) as rejection_count,
        date_trunc('day', MAX(server_time)) as most_recent
       FROM drift_audit_log
       WHERE user_id IN (SELECT id FROM users WHERE tenant_id = $1)
         AND created_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'
       GROUP BY user_id, device_id
       HAVING 
         COUNT(*) >= 5 
         AND (
           STDDEV(drift_seconds) > 100
           OR COUNT(*) FILTER (WHERE action_taken IN ('BLOCKED', 'ESCALATED')) > 0
         )
       ORDER BY rejection_count DESC, stddev_drift_seconds DESC`,
      [tenantId]
    )

    res.json({
      anomalies: result.rows,
      count: result.rows.length,
      description: 'User-device combinations showing potential fraud patterns',
    })
  } catch (error) {
    console.error('[TIME_ADMIN] Anomalies error:', error)
    res.status(500).json({ error: 'Failed to get anomalies' })
  }
})

/**
 * POST /api/admin/drift/incidents/:incidentId/resolve
 * Resolve a drift incident
 */
router.post('/api/admin/drift/incidents/:incidentId/resolve', async (req: Request, res: Response) => {
  try {
    const { incidentId } = req.params
    const { resolution, notes } = req.body
    const superadminId = (req as any).userId

    // Validate resolution
    if (!['LEGITIMATE', 'FRAUD', 'DEVICE_ISSUE', 'FALSE_ALARM'].includes(resolution)) {
      return res.status(400).json({ error: 'Invalid resolution' })
    }

    const result = await query(
      `UPDATE time_authority_incidents
       SET 
        status = 'RESOLVED_' || $1,
        resolution_notes = $2,
        resolved_by_id = $3,
        resolved_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = $4
       RETURNING *`,
      [resolution, notes || null, superadminId, incidentId]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Incident not found' })
    }

    res.json({
      message: 'Incident resolved',
      incident: result.rows[0],
    })
  } catch (error) {
    console.error('[TIME_ADMIN] Resolve incident error:', error)
    res.status(500).json({ error: 'Failed to resolve incident' })
  }
})

/**
 * GET /api/admin/drift/access-log
 * Audit who accessed drift data
 */
router.get('/api/admin/drift/access-log', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 1000)

    const result = await query(
      `SELECT 
        accessed_by_id,
        accessed_resource,
        accessed_at,
        ip_address
       FROM audit_access_log
       WHERE accessed_by_id IN (SELECT id FROM users WHERE tenant_id = $1)
         AND accessed_resource LIKE '%drift%'
       ORDER BY accessed_at DESC
       LIMIT $2`,
      [tenantId, limit]
    )

    res.json({
      accessLog: result.rows,
      count: result.rows.length,
      description: 'Audit trail of who accessed time authority data',
    })
  } catch (error) {
    console.error('[TIME_ADMIN] Access log error:', error)
    res.status(500).json({ error: 'Failed to get access log' })
  }
})

export default router
