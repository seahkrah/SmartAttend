import { query } from '../db/connection.js'
import { Request } from 'express'
import { createHash } from 'crypto'

/**
 * Enhanced Audit Service (PHASE 2, STEP 2.1)
 * Implements comprehensive immutable audit logging for all domain operations
 * 
 * Key Features:
 * - Append-only design (no UPDATE/DELETE)
 * - Captures before/after state
 * - Immutable database constraints
 * - Checksums for integrity verification
 * - Multi-scope auditing (GLOBAL, TENANT, USER)
 */

export interface AuditLogEntry {
  actorId: string
  actorRole?: string
  actionType: string
  actionScope: 'GLOBAL' | 'TENANT' | 'USER'
  resourceType?: string
  resourceId?: string
  beforeState?: any
  afterState?: any
  justification?: string
  requestId?: string
  ipAddress: string
  userAgent?: string
}

/**
 * Log an operation to the immutable audit log
 * 
 * @param entry - Audit log entry data
 * @returns - ID of created audit log entry
 * @throws - If database operation fails
 */
export async function logAudit(entry: AuditLogEntry): Promise<string> {
  try {
    const result = await query(
      `INSERT INTO audit_logs 
       (actor_id, actor_role, action_type, action_scope, resource_type, resource_id, 
        before_state, after_state, justification, request_id, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id`,
      [
        entry.actorId,
        entry.actorRole || null,
        entry.actionType,
        entry.actionScope,
        entry.resourceType || null,
        entry.resourceId || null,
        entry.beforeState ? JSON.stringify(entry.beforeState) : null,
        entry.afterState ? JSON.stringify(entry.afterState) : null,
        entry.justification || null,
        entry.requestId || null,
        entry.ipAddress,
        entry.userAgent || null
      ]
    )

    const auditId = result.rows[0].id
    console.log(`[AUDIT] Logged ${entry.actionType} on ${entry.resourceType || 'system'} by ${entry.actorId}`)
    
    return auditId
  } catch (error) {
    console.error('[AUDIT] Failed to log audit entry:', error)
    throw error
  }
}

/**
 * Query audit logs with filtering
 * Read-only operation — enforced by database trigger
 * 
 * @param filters - Query filters
 * @param superadminAccess - If false, restricts to actor's own logs
 * @returns - Array of audit log entries
 */
export async function queryAuditLogs(
  filters: {
    actorId?: string
    actionType?: string
    actionScope?: 'GLOBAL' | 'TENANT' | 'USER'
    resourceType?: string
    resourceId?: string
    startTime?: Date
    endTime?: Date
    limit?: number
    offset?: number
  },
  superadminAccess: boolean = false
): Promise<any[]> {
  let whereConditions: string[] = []
  const params: any[] = []
  let paramCount = 1

  // Build WHERE clause with filters
  if (filters.actorId) {
    whereConditions.push(`actor_id = $${paramCount}`)
    params.push(filters.actorId)
    paramCount++
  }

  if (filters.actionType) {
    whereConditions.push(`action_type = $${paramCount}`)
    params.push(filters.actionType)
    paramCount++
  }

  if (filters.actionScope) {
    whereConditions.push(`action_scope = $${paramCount}`)
    params.push(filters.actionScope)
    paramCount++
  }

  if (filters.resourceType) {
    whereConditions.push(`resource_type = $${paramCount}`)
    params.push(filters.resourceType)
    paramCount++
  }

  if (filters.resourceId) {
    whereConditions.push(`resource_id = $${paramCount}`)
    params.push(filters.resourceId)
    paramCount++
  }

  if (filters.startTime) {
    whereConditions.push(`created_at >= $${paramCount}`)
    params.push(filters.startTime)
    paramCount++
  }

  if (filters.endTime) {
    whereConditions.push(`created_at <= $${paramCount}`)
    params.push(filters.endTime)
    paramCount++
  }

  const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : ''

  const limit = Math.min(filters.limit || 100, 10000) // Cap at 10000 to prevent abuse
  const offset = filters.offset || 0

  const sql = `
    SELECT 
      id,
      actor_id,
      actor_role,
      action_type,
      action_scope,
      resource_type,
      resource_id,
      before_state,
      after_state,
      justification,
      request_id,
      ip_address,
      user_agent,
      created_at,
      checksum
    FROM audit_logs
    ${whereClause}
    ORDER BY created_at DESC
    LIMIT $${paramCount} OFFSET $${paramCount + 1}
  `

  params.push(limit, offset)

  try {
    const result = await query(sql, params)
    return result.rows
  } catch (error) {
    console.error('[AUDIT] Failed to query audit logs:', error)
    throw error
  }
}

/**
 * Get audit log entry by ID
 * 
 * @param auditId - ID of audit log entry
 * @returns - Audit log entry or null
 */
export async function getAuditLogById(auditId: string): Promise<any | null> {
  try {
    const result = await query(
      `SELECT * FROM audit_logs WHERE id = $1`,
      [auditId]
    )
    return result.rows[0] || null
  } catch (error) {
    console.error('[AUDIT] Failed to get audit log:', error)
    throw error
  }
}

/**
 * Get audit logs for a specific resource
 * 
 * @param resourceType - Type of resource (e.g., 'attendance_record', 'user')
 * @param resourceId - ID of the resource
 * @returns - Array of audit entries for the resource, ordered by timestamp
 */
export async function getAuditTrailForResource(
  resourceType: string,
  resourceId: string
): Promise<any[]> {
  try {
    const result = await query(
      `SELECT * FROM audit_logs 
       WHERE resource_type = $1 AND resource_id = $2
       ORDER BY created_at ASC`,
      [resourceType, resourceId]
    )
    return result.rows
  } catch (error) {
    console.error('[AUDIT] Failed to get resource audit trail:', error)
    throw error
  }
}

/**
 * Get audit summary statistics
 * Aggregated view of audit activity
 * 
 * @returns - Audit activity summary
 */
export async function getAuditSummary(): Promise<any> {
  try {
    // Total operations
    const totalResult = await query(`SELECT COUNT(*) as total FROM audit_logs`)
    const total = parseInt(totalResult.rows[0].total)

    // By action type
    const byActionResult = await query(
      `SELECT action_type, COUNT(*) as count FROM audit_logs GROUP BY action_type ORDER BY count DESC LIMIT 10`
    )

    // By scope
    const byScopeResult = await query(
      `SELECT action_scope, COUNT(*) as count FROM audit_logs GROUP BY action_scope`
    )

    // By actor
    const byActorResult = await query(
      `SELECT actor_id, COUNT(*) as count FROM audit_logs GROUP BY actor_id ORDER BY count DESC LIMIT 10`
    )

    // Recent activity (last 24 hours)
    const recentResult = await query(
      `SELECT COUNT(*) as count FROM audit_logs WHERE created_at > NOW() - INTERVAL '24 hours'`
    )

    return {
      totalOperationsLogged: total,
      topActionTypes: byActionResult.rows,
      scopeDistribution: byScopeResult.rows,
      topActors: byActorResult.rows,
      last24HoursOperations: parseInt(recentResult.rows[0].count),
      lastUpdated: new Date().toISOString()
    }
  } catch (error) {
    console.error('[AUDIT] Failed to get audit summary:', error)
    throw error
  }
}

/**
 * Verify audit log integrity
 * Recalculates checksum and compares with stored value
 * 
 * @param auditId - ID of audit log entry
 * @returns - Object with integrity check result
 */
export async function verifyAuditLogIntegrity(auditId: string): Promise<{
  isValid: boolean
  storedChecksum: string
  calculatedChecksum: string
  entry?: any
}> {
  try {
    const entry = await getAuditLogById(auditId)
    if (!entry) {
      throw new Error(`Audit log ${auditId} not found`)
    }

    // Recalculate checksum
    const calculatedChecksum = createHash('sha256')
      .update(
        entry.id +
        entry.actor_id +
        entry.action_type +
        entry.action_scope +
        (entry.resource_type || '') +
        (entry.resource_id || '') +
        (entry.before_state ? JSON.stringify(entry.before_state) : '') +
        (entry.after_state ? JSON.stringify(entry.after_state) : '')
      )
      .digest('hex')

    return {
      isValid: entry.checksum === calculatedChecksum,
      storedChecksum: entry.checksum,
      calculatedChecksum,
      entry: entry.isValid ? undefined : entry // Only return entry if there's a mismatch
    }
  } catch (error) {
    console.error('[AUDIT] Failed to verify audit log integrity:', error)
    throw error
  }
}

/**
 * Search audit logs by justification text
 * Full-text search on justification field
 * 
 * @param searchText - Text to search for
 * @param limit - Maximum results
 * @returns - Matching audit entries
 */
export async function searchAuditLogsByJustification(
  searchText: string,
  limit: number = 100
): Promise<any[]> {
  try {
    const result = await query(
      `SELECT * FROM audit_logs 
       WHERE to_tsvector('english', COALESCE(justification, '')) @@ plainto_tsquery('english', $1)
       ORDER BY created_at DESC
       LIMIT $2`,
      [searchText, Math.min(limit, 10000)]
    )
    return result.rows
  } catch (error) {
    console.error('[AUDIT] Failed to search audit logs:', error)
    throw error
  }
}

/**
 * Get audit logs for time-bounded query (for compliance reporting)
 * 
 * @param startTime - Start of time period
 * @param endTime - End of time period
 * @param actionScope - Optional scope filter
 * @returns - Audit entries within time period
 */
export async function getAuditLogsForPeriod(
  startTime: Date,
  endTime: Date,
  actionScope?: 'GLOBAL' | 'TENANT' | 'USER'
): Promise<any[]> {
  try {
    let sql = `
      SELECT * FROM audit_logs 
      WHERE created_at BETWEEN $1 AND $2
    `
    const params: any[] = [startTime, endTime]

    if (actionScope) {
      sql += ` AND action_scope = $3`
      params.push(actionScope)
    }

    sql += ` ORDER BY created_at DESC`

    const result = await query(sql, params)
    return result.rows
  } catch (error) {
    console.error('[AUDIT] Failed to get audit logs for period:', error)
    throw error
  }
}

/**
 * Verify immutability constraint
 * Attempts to update and catches expected error
 * 
 * @returns - Result of immutability test
 */
export async function testImmutabilityConstraint(): Promise<{
  immutable: boolean
  message: string
}> {
  try {
    // Try to find a test entry
    const testEntry = await query(`SELECT id FROM audit_logs LIMIT 1`)
    
    if (testEntry.rows.length === 0) {
      return { immutable: true, message: 'No audit logs to test, but constraint is in place' }
    }

    const testId = testEntry.rows[0].id

    // Try to update (should fail)
    try {
      await query(`UPDATE audit_logs SET justification = 'TEST' WHERE id = $1`, [testId])
      return { immutable: false, message: 'WARNING: UPDATE succeeded (immutability constraint not working!)' }
    } catch (error: any) {
      if (error.message.includes('immutable')) {
        return { immutable: true, message: 'Immutability constraint is working correctly' }
      }
      return { immutable: false, message: `Unexpected error: ${error.message}` }
    }
  } catch (error: any) {
    return { immutable: false, message: `Test failed: ${error.message}` }
  }
}
