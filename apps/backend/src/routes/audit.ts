import express, { Request, Response } from 'express'
import { authenticateToken } from '../auth/middleware.js'
import { resolveTenantContext } from '../auth/tenantContextMiddleware.js'
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
import {
  queryAuditLogsWithAccessControl,
  enforceAuditAccess,
  logAuditAccess,
  auditVisibilityPredicate,
  contextOf,
  auditRoleOf,
  AUDIT_ACCESS_RULES
} from '../auth/auditAccessControl.js'

const router = express.Router()

/**
 * Every audit endpoint needs a resolved identity, and the access-control layer
 * needs the caller's real tenant and role rather than whatever the JWT payload
 * happens to carry. Resolving here means a handler cannot be reached without
 * one.
 *
 * requireTenant is deliberately not applied: a superadmin reads the audit
 * trail across tenants, and that is the one identity for which no tenant is
 * the correct answer. The access-control layer refuses a tenant administrator
 * who has no tenant, so the unscoped case stays closed for everyone else.
 */
router.use(authenticateToken, resolveTenantContext)

/**
 * What this caller may see, as a SQL predicate.
 *
 * Only /logs went through access control; the other reads — a log by id, a
 * resource's trail, the summary, the search, the period export — queried
 * audit_logs unfiltered and returned every tenant's history to anyone with a
 * token. Each one now binds this predicate into its own WHERE clause.
 */
function visibility(req: Request) {
  return auditVisibilityPredicate(contextOf(req))
}

/** A refusal from the access layer reads as 403, not as an internal error. */
function denied(res: Response, e: unknown): boolean {
  const message = (e as Error)?.message ?? ''
  if (message.startsWith('Access Denied')) {
    res.status(403).json({ success: false, error: 'Insufficient permissions', message })
    return true
  }
  return false
}

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
 * PHASE 10.2: Role-based access control enforced
 * - Superadmin: Can read all logs (GLOBAL, TENANT, USER)
 * - Tenant admin: Can read TENANT and USER scope logs
 * - User: Can only read their own USER scope logs
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
 * - 200: Array of audit log entries (filtered by role-based access control)
 * - 403: Insufficient permissions to access requested scope
 * - 400: Invalid parameters
 * - 500: Server error
 */
router.get('/logs', async (req: Request, res: Response) => {
  try {
    const requestedScope = req.query.actionScope ? String(req.query.actionScope) : undefined

    // Phase 10.2: Enforce access control
    try {
      await enforceAuditAccess(req, requestedScope as any)
    } catch (accessError: any) {
      return res.status(403).json({
        success: false,
        error: 'Insufficient permissions',
        message: accessError.message
      })
    }

    // Build filters
    const filters = {
      actionType: req.query.actionType ? String(req.query.actionType) : undefined,
      actionScope: requestedScope,
      resourceType: req.query.resourceType ? String(req.query.resourceType) : undefined,
      resourceId: req.query.resourceId ? String(req.query.resourceId) : undefined,
      startTime: req.query.startTime ? new Date(String(req.query.startTime)) : undefined,
      endTime: req.query.endTime ? new Date(String(req.query.endTime)) : undefined,
      limit: req.query.limit ? parseInt(String(req.query.limit)) : 100,
      offset: req.query.offset ? parseInt(String(req.query.offset)) : 0
    }

    // Query with access control enforcement
    const logs = await queryAuditLogsWithAccessControl(req, filters)

    res.json({
      success: true,
      count: logs.length,
      userRole: auditRoleOf(contextOf(req)),
      filters: {
        actionScope: requestedScope,
        actionType: filters.actionType,
        resourceType: filters.resourceType,
        resourceId: filters.resourceId
      },
      logs
    })
  } catch (error: any) {
    if (denied(res, error)) return
    console.error('[AUDIT_API] Failed to query logs:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to query audit logs',
      message: error.message
    })
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
    const auditId = req.params.id

    // The visibility predicate is the check: an entry outside the caller's
    // view comes back empty and reads as absent, so a log id cannot be probed
    // for existence.
    const auditEntry = await getAuditLogById(auditId, visibility(req))

    if (!auditEntry) {
      return res.status(404).json({ error: 'Audit log entry not found' })
    }

    res.json({
      success: true,
      entry: auditEntry
    })
  } catch (error: any) {
    if (denied(res, error)) return
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
    const resourceType = req.params.resourceType
    const resourceId = req.params.resourceId

    // The trail is confined by the same predicate as every other read, so a
    // resource in another tenant simply yields nothing.

    const trail = await getAuditTrailForResource(resourceType, resourceId, visibility(req))

    res.json({
      success: true,
      resourceType,
      resourceId,
      changeCount: trail.length,
      trail
    })
  } catch (error: any) {
    if (denied(res, error)) return
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
    // Scoped by the visibility predicate rather than reserved to superadmins:
    // an administrator is entitled to their own school's history, and that is
    // all this returns.

    const summary = await getAuditSummary(visibility(req))

    res.json({
      success: true,
      summary
    })
  } catch (error: any) {
    if (denied(res, error)) return
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
    const searchQuery = req.query.q ? String(req.query.q) : null

    if (!searchQuery || searchQuery.trim().length === 0) {
      return res.status(400).json({ error: 'Search query required (q parameter)' })
    }

    // Search is no longer superadmin-only: it runs inside the caller's own
    // visibility, so an administrator searches their tenant's justifications
    // and a user searches their own. Refusing everyone but the superadmin was
    // a stand-in for the scoping that now exists.

    const limit = req.query.limit ? Math.min(parseInt(String(req.query.limit)), 10000) : 100
    const results = await searchAuditLogsByJustification(searchQuery, visibility(req), limit)

    res.json({
      success: true,
      query: searchQuery,
      resultCount: results.length,
      results
    })
  } catch (error: any) {
    if (denied(res, error)) return
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
    // Scoped by the visibility predicate rather than reserved to superadmins:
    // an administrator is entitled to their own school's history, and that is
    // all this returns.

    const startTime = req.query.startTime ? new Date(String(req.query.startTime)) : null
    const endTime = req.query.endTime ? new Date(String(req.query.endTime)) : null

    if (!startTime || !endTime || isNaN(startTime.getTime()) || isNaN(endTime.getTime())) {
      return res.status(400).json({
        error: 'Invalid parameters',
        message: 'startTime and endTime are required (ISO 8601 format)'
      })
    }

    const scope = req.query.actionScope as 'GLOBAL' | 'TENANT' | 'USER' | undefined

    const logs = await getAuditLogsForPeriod(startTime, endTime, visibility(req), scope)

    res.json({
      success: true,
      periodStart: startTime,
      periodEnd: endTime,
      actionScope: scope,
      logCount: logs.length,
      logs
    })
  } catch (error: any) {
    if (denied(res, error)) return
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
    // Scoped by the visibility predicate rather than reserved to superadmins:
    // an administrator is entitled to their own school's history, and that is
    // all this returns.

    const auditId = req.params.id
    const verification = await verifyAuditLogIntegrity(auditId, visibility(req))

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
    if (!contextOf(req).isSuperadmin) {
      return res.status(403).json({ error: 'Superadmin access required' })
    }

    const testResult = await testImmutabilityConstraint()

    res.json({
      success: true,
      testResult
    })
  } catch (error: any) {
    if (denied(res, error)) return
    console.error('[AUDIT_API] Failed to test immutability:', error)
    res.status(500).json({ error: 'Failed to test immutability', message: error.message })
  }
})

/**
 * GET /api/audit/access-log
 * Audit the auditors: View who accessed audit logs
 * Superadmin only
 * 
 * Query Parameters:
 * - actorRole: Filter by role (superadmin, tenant_admin, user)
 * - accessType: Filter by access type
 * - startTime: ISO 8601 start timestamp
 * - endTime: ISO 8601 end timestamp
 * - limit: Max results (default 100, max 10000)
 * - offset: Pagination offset (default 0)
 * 
 * Response:
 * - 200: Array of audit access log entries
 * - 403: Insufficient permissions
 * - 500: Server error
 */
router.get('/access-log', async (req: Request, res: Response) => {
  try {
    if (!contextOf(req).isSuperadmin) {
      return res.status(403).json({
        success: false,
        error: 'Superadmin access required',
        message: 'Only superadmin can view audit access logs'
      })
    }

    // Build query filters
    let sql = 'SELECT * FROM audit_access_log WHERE 1=1'
    const params: any[] = []
    let paramNum = 1

    if (req.query.actorRole) {
      sql += ` AND actor_role = $${paramNum}`
      params.push(String(req.query.actorRole))
      paramNum++
    }

    if (req.query.accessType) {
      sql += ` AND access_type = $${paramNum}`
      params.push(String(req.query.accessType))
      paramNum++
    }

    if (req.query.startTime) {
      const startTime = new Date(String(req.query.startTime))
      if (!isNaN(startTime.getTime())) {
        sql += ` AND access_timestamp >= $${paramNum}`
        params.push(startTime)
        paramNum++
      }
    }

    if (req.query.endTime) {
      const endTime = new Date(String(req.query.endTime))
      if (!isNaN(endTime.getTime())) {
        sql += ` AND access_timestamp <= $${paramNum}`
        params.push(endTime)
        paramNum++
      }
    }

    // Pagination
    const limit = Math.min(req.query.limit ? parseInt(String(req.query.limit)) : 100, 10000)
    const offset = req.query.offset ? parseInt(String(req.query.offset)) : 0

    sql += ` ORDER BY access_timestamp DESC LIMIT $${paramNum} OFFSET $${paramNum + 1}`
    params.push(limit, offset)

    // Execute query
    const { query: dbQuery } = await import('../db/connection.js')
    const result = await dbQuery(sql, params)

    res.json({
      success: true,
      count: result.rows.length,
      filters: {
        actorRole: req.query.actorRole,
        accessType: req.query.accessType,
        startTime: req.query.startTime,
        endTime: req.query.endTime
      },
      accessLogs: result.rows
    })
  } catch (error: any) {
    if (denied(res, error)) return
    console.error('[AUDIT_API] Failed to query access logs:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to query audit access logs',
      message: error.message
    })
  }
})

/**
 * GET /api/audit/access-patterns
 * View access patterns: Who accessed what, when
 * Superadmin only
 * Useful for security monitoring and compliance
 * 
 * Response:
 * - 200: Access pattern statistics
 * - 403: Insufficient permissions
 * - 500: Server error
 */
router.get('/access-patterns', async (req: Request, res: Response) => {
  try {
    if (!contextOf(req).isSuperadmin) {
      return res.status(403).json({ error: 'Superadmin access required' })
    }

    const { query: dbQuery } = await import('../db/connection.js')

    // Get access patterns view
    const result = await dbQuery('SELECT * FROM superadmin_access_patterns')

    res.json({
      success: true,
      patternCount: result.rows.length,
      patterns: result.rows
    })
  } catch (error: any) {
    if (denied(res, error)) return
    console.error('[AUDIT_API] Failed to get access patterns:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve access patterns',
      message: error.message
    })
  }
})

export default router
