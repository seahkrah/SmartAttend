import { Router, Request, Response } from 'express'
import { authenticateToken } from '../auth/middleware.js'
import { isSuperadmin } from '../auth/authService.js'
import {
  getServerTime,
  getServerTimeISO,
  getServerTimeMS,
  getUserClockDriftHistory,
  getTenantClockDriftStats,
  getCriticalDriftEvents
} from '../services/timeAuthorityService.js'

const router = Router()

/**
 * TIME AUTHORITY API ROUTES (PHASE 2, STEP 2.2)
 * 
 * Endpoints for:
 * - Time synchronization (client can get server time)
 * - Drift history and statistics
 * - Critical event review (superadmin only)
 */

/**
 * GET /api/time/sync
 * Get current server time for client clock synchronization
 * 
 * Public endpoint - helps clients adjust for drift
 */
router.get('/sync', async (req: Request, res: Response) => {
  try {
    const serverTime = getServerTime()
    const timestamp = serverTime.getTime()

    res.json({
      timestamp,
      iso: serverTime.toISOString(),
      unix: Math.floor(timestamp / 1000),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
    })
  } catch (error) {
    console.error('[TIME_API] /sync error:', error)
    res.status(500).json({ error: 'Failed to get server time' })
  }
})

/**
 * GET /api/time/sync/precise
 * Get precise server time with minimal latency
 * 
 * Returns both request receipt time and response time
 * for client-side latency compensation
 */
router.get('/sync/precise', async (req: Request, res: Response) => {
  const requestTime = getServerTime()

  try {
    // Simulate slight delay to measure network latency
    // In practice, client measures: response_time - request_time = 2 * network_latency
    const responseTime = getServerTime()

    res.json({
      requestTime: {
        timestamp: requestTime.getTime(),
        iso: requestTime.toISOString()
      },
      responseTime: {
        timestamp: responseTime.getTime(),
        iso: responseTime.toISOString()
      },
      estimatedLatencyMs: Math.ceil((responseTime.getTime() - requestTime.getTime()) / 2)
    })
  } catch (error) {
    console.error('[TIME_API] /sync/precise error:', error)
    res.status(500).json({ error: 'Failed to get precise server time' })
  }
})

/**
 * GET /api/time/validate
 * Validate client time against server time
 * 
 * Query params:
 * - clientTimestamp: Client's current timestamp (ISO string or ms)
 */
router.get('/validate', async (req: Request, res: Response) => {
  try {
    const clientTimeString = req.query.clientTimestamp as string

    if (!clientTimeString) {
      return res.status(400).json({ error: 'clientTimestamp query parameter required' })
    }

    let clientTime: Date
    try {
      // Try parsing as ms first
      const ms = parseInt(clientTimeString, 10)
      if (!isNaN(ms) && ms > 1000000000000) {
        // Looks like milliseconds
        clientTime = new Date(ms)
      } else {
        // Try ISO format
        clientTime = new Date(clientTimeString)
      }
    } catch (e) {
      return res.status(400).json({ error: 'Invalid clientTimestamp format' })
    }

    if (isNaN(clientTime.getTime())) {
      return res.status(400).json({ error: 'Invalid clientTimestamp value' })
    }

    const serverTime = getServerTime()
    const driftMs = clientTime.getTime() - serverTime.getTime()
    const driftSeconds = Math.round(driftMs / 1000)

    res.json({
      serverTime: serverTime.toISOString(),
      clientTime: clientTime.toISOString(),
      driftSeconds,
      driftMs,
      isValid: Math.abs(driftSeconds) <= 300,
      recommendation:
        Math.abs(driftSeconds) > 5
          ? `Adjust device clock by ${driftSeconds}s`
          : 'Clock is synchronized'
    })
  } catch (error) {
    console.error('[TIME_API] /validate error:', error)
    res.status(500).json({ error: 'Validation failed' })
  }
})

/**
 * GET /api/time/drift/history
 * Get user's recent clock drift history
 * 
 * Authenticated - users can see their own history
 */
router.get('/drift/history', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = (req.user as any)?.id
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' })
    }

    const limit = Math.min(parseInt((req.query.limit as string) || '50'), 100)
    const history = await getUserClockDriftHistory(userId, limit)

    res.json({
      userId,
      count: history.length,
      drift: history.map(record => ({
        id: record.id,
        timestamp: record.timestamp,
        driftSeconds: record.drift_seconds,
        severity: record.severity,
        attendanceAffected: record.attendance_affected
      }))
    })
  } catch (error) {
    console.error('[TIME_API] /drift/history error:', error)
    res.status(500).json({ error: 'Failed to get drift history' })
  }
})

/**
 * GET /api/time/drift/stats
 * Get tenant clock drift statistics
 * 
 * Superadmin only - aggregated tenant statistics
 */
router.get('/drift/stats', authenticateToken, async (req: Request, res: Response) => {
  try {
    const user = req.user as any
    if (!user?.id) {
      return res.status(401).json({ error: 'Not authenticated' })
    }

    const isSuperAdmin = await isSuperadmin(user.id)
    if (!isSuperAdmin) {
      return res.status(403).json({ error: 'Superadmin access required' })
    }

    const tenantId = req.query.tenantId as string
    if (!tenantId) {
      return res.status(400).json({ error: 'tenantId query parameter required' })
    }

    const stats = await getTenantClockDriftStats(tenantId)

    res.json({
      tenantId,
      timestamp: getServerTimeISO(),
      overall: stats.overall,
      topDrifters: stats.topDrifters
    })
  } catch (error) {
    console.error('[TIME_API] /drift/stats error:', error)
    res.status(500).json({ error: 'Failed to get drift statistics' })
  }
})

/**
 * GET /api/time/drift/critical
 * Get critical clock drift events requiring investigation
 * 
 * Superadmin only - events that affected attendance
 */
router.get('/drift/critical', authenticateToken, async (req: Request, res: Response) => {
  try {
    const user = req.user as any
    if (!user?.id) {
      return res.status(401).json({ error: 'Not authenticated' })
    }

    const isSuperAdmin = await isSuperadmin(user.id)
    if (!isSuperAdmin) {
      return res.status(403).json({ error: 'Superadmin access required' })
    }

    const limit = Math.min(parseInt((req.query.limit as string) || '100'), 500)
    const events = await getCriticalDriftEvents(limit)

    res.json({
      count: events.length,
      events: events.map(event => ({
        id: event.id,
        userId: event.user_id,
        tenantId: event.tenant_id,
        timestamp: event.timestamp,
        driftSeconds: event.drift_seconds,
        severity: event.severity,
        attendanceAffected: event.attendance_affected,
        clientTime: event.client_timestamp,
        serverTime: event.server_timestamp
      }))
    })
  } catch (error) {
    console.error('[TIME_API] /drift/critical error:', error)
    res.status(500).json({ error: 'Failed to get critical events' })
  }
})

/**
 * POST /api/time/drift/investigate
 * Investigate and take action on drift event
 * 
 * Superadmin only - mark events as reviewed
 * 
 * Body:
 * - driftEventId: ID of clock_drift_log entry
 * - action: 'reviewed' | 'resolved' | 'flagged'
 * - notes: Investigation notes
 */
router.post('/drift/investigate', authenticateToken, async (req: Request, res: Response) => {
  try {
    const user = req.user as any
    if (!user?.id) {
      return res.status(401).json({ error: 'Not authenticated' })
    }

    const isSuperAdmin = await isSuperadmin(user.id)
    if (!isSuperAdmin) {
      return res.status(403).json({ error: 'Superadmin access required' })
    }

    const { driftEventId, action, notes } = req.body

    if (!driftEventId) {
      return res.status(400).json({ error: 'driftEventId required' })
    }

    if (!['reviewed', 'resolved', 'flagged'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action' })
    }

    // TODO: Update drift event with investigation status
    // This would be stored in a separate investigation table or added to clock_drift_log

    res.json({
      driftEventId,
      action,
      investigatedBy: user.id,
      timestamp: getServerTimeISO(),
      notes
    })
  } catch (error) {
    console.error('[TIME_API] /drift/investigate error:', error)
    res.status(500).json({ error: 'Investigation failed' })
  }
})

/**
 * GET /api/time/status
 * Get overall time authority system status
 * 
 * Superadmin only
 */
router.get('/status', authenticateToken, async (req: Request, res: Response) => {
  try {
    const user = req.user as any
    if (!user?.id) {
      return res.status(401).json({ error: 'Not authenticated' })
    }

    const isSuperAdmin = await isSuperadmin(user.id)
    if (!isSuperAdmin) {
      return res.status(403).json({ error: 'Superadmin access required' })
    }

    const serverTime = getServerTime()

    res.json({
      status: 'operational',
      serverTime: serverTime.toISOString(),
      serverTimeMs: serverTime.getTime(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      authority: 'SERVER',
      features: {
        clockDriftDetection: 'enabled',
        clockDriftLogging: 'enabled',
        attendanceValidation: 'enabled',
        driftAffectedFlagging: 'enabled'
      }
    })
  } catch (error) {
    console.error('[TIME_API] /status error:', error)
    res.status(500).json({ error: 'Status check failed' })
  }
})

export default router
