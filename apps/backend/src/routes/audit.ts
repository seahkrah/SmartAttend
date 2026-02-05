import express, { Request, Response } from 'express'
import { authenticateToken } from '../auth/middleware.js'
import {
  queryAuditLogs,
  getAuditLogById,
  getAuditTrailForResource,
  getAuditSummary,
  verifyAuditLogIntegrity,
  searchAuditLogsByJustification,
  getAuditLogsForPeriod,
  testImmutabilityConstraint
} from '../services/domainAuditService.js'

const router = express.Router()

// All audit endpoints require authentication
router.use(authenticateToken)

/**
 * ===========================
 * AUDIT LOG QUERY ENDPOINTS
 * ===========================
 * All endpoints are READ-ONLY (enforced by database constraints)
 * Superadmin can query all logs; regular users can only query their own
 */

/**
 * GET /api/audit/logs
 * Query audit logs with optional filters
 * 
 * Query Parameters:
 * - actorId: Filter by actor ID
 * - actionType: Filter by action type (e.g., 'CREATE', 'UPDATE', 'DELETE')
 * - actionScope: Filter by scope (GLOBAL, TENANT, USER)
 * - resourceType: Filter by resource type (e.g., 'attendance_record')
 * - resourceId: Filter by specific resource ID
 * - startTime: ISO 8601 timestamp for start of range
 * - endTime: ISO 8601 timestamp for end of range
 * - limit: Max results (default 100, max 10000)
 * - offset: Pagination offset (default 0)
 * 
 * Response:
 * - 200: Array of audit log entries
 * - 403: Insufficient permissions
 * - 500: Server error
 */
router.get('/logs', async (req: Request, res: Response) => {
  try {
    const user = req.user as any
    const isSuperadmin = user?.role === 'superadmin'

    // Non-superadmin users can only view their own audit logs
    const actorIdFilter = isSuperadmin
      ? req.query.actorId ? String(req.query.actorId) : undefined
      : user?.userId

    const filters = {
      actorId: actorIdFilter,
      actionType: req.query.actionType ? String(req.query.actionType) : undefined,
      actionScope: req.query.actionScope as 'GLOBAL' | 'TENANT' | 'USER' | undefined,
      resourceType: req.query.resourceType ? String(req.query.resourceType) : undefined,
      resourceId: req.query.resourceId ? String(req.query.resourceId) : undefined,
      startTime: req.query.startTime ? new Date(String(req.query.startTime)) : undefined,
      endTime: req.query.endTime ? new Date(String(req.query.endTime)) : undefined,
      limit: req.query.limit ? parseInt(String(req.query.limit)) : 100,
      offset: req.query.offset ? parseInt(String(req.query.offset)) : 0
    }

    const logs = await queryAuditLogs(filters, isSuperadmin)

    res.json({
      success: true,
      count: logs.length,
      filters,
      logs
    })
  } catch (error: any) {
    console.error('[AUDIT_API] Failed to query logs:', error)
    res.status(500).json({ error: 'Failed to query audit logs', message: error.message })
  }
})

/**
 * GET /api/audit/logs/:id
 * Retrieve a specific audit log entry by ID
 * 
 * Response:
 * - 200: Audit log entry with checksum
 * - 403: Insufficient permissions
 * - 404: Audit log not found
 * - 500: Server error
 */
router.get('/logs/:id', async (req: Request, res: Response) => {
  try {
    const user = req.user as any
    const auditId = req.params.id

    const auditEntry = await getAuditLogById(auditId)

    if (!auditEntry) {
      return res.status(404).json({ error: 'Audit log entry not found' })
    }

    // Non-superadmin users can only view their own entries
    if (user?.role !== 'superadmin' && auditEntry.actor_id !== user?.userId) {
      return res.status(403).json({ error: 'Insufficient permissions' })
    }

    res.json({
      success: true,
      entry: auditEntry
    })
  } catch (error: any) {
    console.error('[AUDIT_API] Failed to get audit log:', error)
    res.status(500).json({ error: 'Failed to retrieve audit log', message: error.message })
  }
})

/**
 * GET /api/audit/resource/:resourceType/:resourceId/trail
 * Get complete audit trail for a specific resource
 * Shows all changes to that resource in chronological order
 * 
 * Response:
 * - 200: Array of audit entries for resource (oldest first)
 * - 403: Insufficient permissions
 * - 500: Server error
 */
router.get('/resource/:resourceType/:resourceId/trail', async (req: Request, res: Response) => {
  try {
    const user = req.user as any
    const resourceType = req.params.resourceType
    const resourceId = req.params.resourceId

    // Non-superadmin users can only view trails for their own resources
    if (user?.role !== 'superadmin') {
      // Could add tenant-level checks here
      // For now, restrict to own user ID
      if (resourceType === 'user' && resourceId !== user?.userId) {
        return res.status(403).json({ error: 'Insufficient permissions' })
      }
    }

    const trail = await getAuditTrailForResource(resourceType, resourceId)

    res.json({
      success: true,
      resourceType,
      resourceId,
      changeCount: trail.length,
      trail
    })
  } catch (error: any) {
    console.error('[AUDIT_API] Failed to get resource trail:', error)
    res.status(500).json({ error: 'Failed to retrieve resource audit trail', message: error.message })
  }
})

/**
 * GET /api/audit/summary
 * Get aggregated audit log statistics
 * Superadmin only
 * 
 * Response:
 * - 200: Summary statistics
 * - 403: Insufficient permissions (non-superadmin)
 * - 500: Server error
 */
router.get('/summary', async (req: Request, res: Response) => {
  try {
    const user = req.user as any

    if (user?.role !== 'superadmin') {
      return res.status(403).json({ error: 'Superadmin access required' })
    }

    const summary = await getAuditSummary()

    res.json({
      success: true,
      summary
    })
  } catch (error: any) {
    console.error('[AUDIT_API] Failed to get summary:', error)
    res.status(500).json({ error: 'Failed to retrieve audit summary', message: error.message })
  }
})

/**
 * GET /api/audit/search
 * Search audit logs by justification text
 * Full-text search
 * 
 * Query Parameters:
 * - q: Search query (required)
 * - limit: Max results (default 100)
 * 
 * Response:
 * - 200: Array of matching audit entries
 * - 400: Missing search query
 * - 403: Insufficient permissions
 * - 500: Server error
 */
router.get('/search', async (req: Request, res: Response) => {
  try {
    const user = req.user as any
    const searchQuery = req.query.q ? String(req.query.q) : null

    if (!searchQuery || searchQuery.trim().length === 0) {
      return res.status(400).json({ error: 'Search query required (q parameter)' })
    }

    if (user?.role !== 'superadmin') {
      return res.status(403).json({ error: 'Superadmin access required for search' })
    }

    const limit = req.query.limit ? Math.min(parseInt(String(req.query.limit)), 10000) : 100
    const results = await searchAuditLogsByJustification(searchQuery, limit)

    res.json({
      success: true,
      query: searchQuery,
      resultCount: results.length,
      results
    })
  } catch (error: any) {
    console.error('[AUDIT_API] Failed to search logs:', error)
    res.status(500).json({ error: 'Failed to search audit logs', message: error.message })
  }
})

/**
 * GET /api/audit/period
 * Get audit logs for a specific time period
 * Useful for compliance reporting
 * 
 * Query Parameters:
 * - startTime: ISO 8601 start timestamp (required)
 * - endTime: ISO 8601 end timestamp (required)
 * - actionScope: Optional scope filter (GLOBAL, TENANT, USER)
 * 
 * Response:
 * - 200: Array of audit entries for period
 * - 400: Missing required parameters
 * - 403: Insufficient permissions
 * - 500: Server error
 */
router.get('/period', async (req: Request, res: Response) => {
  try {
    const user = req.user as any

    if (user?.role !== 'superadmin') {
      return res.status(403).json({ error: 'Superadmin access required' })
    }

    const startTime = req.query.startTime ? new Date(String(req.query.startTime)) : null
    const endTime = req.query.endTime ? new Date(String(req.query.endTime)) : null

    if (!startTime || !endTime || isNaN(startTime.getTime()) || isNaN(endTime.getTime())) {
      return res.status(400).json({
        error: 'Invalid parameters',
        message: 'startTime and endTime are required (ISO 8601 format)'
      })
    }

    const scope = req.query.actionScope as 'GLOBAL' | 'TENANT' | 'USER' | undefined

    const logs = await getAuditLogsForPeriod(startTime, endTime, scope)

    res.json({
      success: true,
      periodStart: startTime,
      periodEnd: endTime,
      actionScope: scope,
      logCount: logs.length,
      logs
    })
  } catch (error: any) {
    console.error('[AUDIT_API] Failed to get period logs:', error)
    res.status(500).json({ error: 'Failed to retrieve period logs', message: error.message })
  }
})

/**
 * GET /api/audit/logs/:id/verify
 * Verify integrity of a specific audit log entry
 * Recalculates checksum and compares with stored value
 * 
 * Response:
 * - 200: Integrity check result
 * - 403: Insufficient permissions
 * - 404: Audit log not found
 * - 500: Server error
 */
router.get('/logs/:id/verify', async (req: Request, res: Response) => {
  try {
    const user = req.user as any

    if (user?.role !== 'superadmin') {
      return res.status(403).json({ error: 'Superadmin access required' })
    }

    const auditId = req.params.id
    const verification = await verifyAuditLogIntegrity(auditId)

    res.json({
      success: true,
      auditId,
      verification
    })
  } catch (error: any) {
    if (error.message.includes('not found')) {
      return res.status(404).json({ error: 'Audit log not found' })
    }
    console.error('[AUDIT_API] Failed to verify audit log:', error)
    res.status(500).json({ error: 'Failed to verify audit log', message: error.message })
  }
})

/**
 * POST /api/audit/test-immutability
 * Test that immutability constraints are working
 * Superadmin only - runs immutability test
 * 
 * Response:
 * - 200: Test result
 * - 403: Insufficient permissions
 * - 500: Server error
 */
router.post('/test-immutability', async (req: Request, res: Response) => {
  try {
    const user = req.user as any

    if (user?.role !== 'superadmin') {
      return res.status(403).json({ error: 'Superadmin access required' })
    }

    const testResult = await testImmutabilityConstraint()

    res.json({
      success: true,
      testResult
    })
  } catch (error: any) {
    console.error('[AUDIT_API] Failed to test immutability:', error)
    res.status(500).json({ error: 'Failed to test immutability', message: error.message })
  }
})

export default router
