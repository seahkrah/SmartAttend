/**
 * PHASE 4, STEP 4.2: ROLE ESCALATION DETECTION SERVICE
 * 
 * Tracks role changes, detects escalations, and prevents silent role changes
 * No role change is allowed without logging and verification
 */

import { query } from '../db/connection.js'
import type { TenantContext } from '../types/tenantContext.js'

/**
 * Role assignment change event
 */
export interface RoleAssignmentChange {
  userId: string
  previousRoleId?: string
  newRoleId: string
  changedByUserId: string
  changeReason?: string
  changeSource: 'manual' | 'automatic' | 'api' | 'system'
  ipAddress?: string
  userAgent?: string
}

/**
 * Role escalation detection result
 */
export interface EscalationDetectionResult {
  isEscalation: boolean
  isAnomalous: boolean
  escalationType?: string
  severity?: 'low' | 'medium' | 'high' | 'critical'
  reasons: string[]
  requiresRevalidation: boolean
}

/**
 * Role Assignment History Service
 * Logs all role changes and detects escalations
 */
export class RoleAssignmentHistoryService {
  /**
   * Record a role assignment change
   * ALWAYS logs - no silent changes allowed
   */
  static async logRoleChange(
    tenant: TenantContext,
    change: RoleAssignmentChange
  ): Promise<any> {
    try {
      // Get current role ID for logging
      const userResult = await query(
        'SELECT role_id FROM users WHERE id = $1 AND platform_id = $2',
        [change.userId, tenant.tenantId]
      )

      if (userResult.rows.length === 0) {
        throw new Error('User not found')
      }

      const previousRoleId = change.previousRoleId || userResult.rows[0].role_id

      // Detect if this is an escalation
      const escalationDetection = await this.detectEscalation(
        tenant,
        change.userId,
        previousRoleId,
        change.newRoleId
      )

      // Log the role change
      const historyResult = await query(
        `INSERT INTO role_assignment_history
         (platform_id, user_id, previous_role_id, new_role_id, changed_by_user_id,
          change_reason, change_source, ip_address, user_agent, is_escalation, is_anomalous)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *`,
        [
          tenant.tenantId,
          change.userId,
          previousRoleId || null,
          change.newRoleId,
          change.changedByUserId,
          change.changeReason || null,
          change.changeSource,
          change.ipAddress,
          change.userAgent,
          escalationDetection.isEscalation,
          escalationDetection.isAnomalous
        ]
      )

      const historyRecord = historyResult.rows[0]

      // Create escalation event if needed
      if (escalationDetection.requiresRevalidation) {
        await this.createEscalationEvent(
          tenant,
          change.userId,
          previousRoleId,
          change.newRoleId,
          escalationDetection
        )
      }

      // Log the audit trail
      await this.logAuditTrail(tenant, change, escalationDetection, historyRecord.id)

      return {
        historyId: historyRecord.id,
        escalation: escalationDetection,
        timestamp: historyRecord.created_at
      }
    } catch (error: any) {
      console.error('[ROLE_CHANGE_ERROR]', error)
      throw new Error(`Failed to log role change: ${error.message}`)
    }
  }

  /**
   * Detect if role change is an escalation
   */
  private static async detectEscalation(
    tenant: TenantContext,
    userId: string,
    previousRoleId: string,
    newRoleId: string
  ): Promise<EscalationDetectionResult> {
    const reasons: string[] = []
    let isEscalation = false
    let isAnomalous = false
    let escalationType: string | undefined
    let severity: 'low' | 'medium' | 'high' | 'critical' | undefined

    try {
      // Get role information
      const rolesResult = await query(
        `SELECT id, name, permissions FROM roles
         WHERE platform_id = $1 AND (id = $2 OR id = $3)`,
        [tenant.tenantId, previousRoleId, newRoleId]
      )

      const previousRole = rolesResult.rows.find(r => r.id === previousRoleId)
      const newRole = rolesResult.rows.find(r => r.id === newRoleId)

      if (!newRole) {
        throw new Error('New role not found')
      }

      // Get user's history
      const historyResult = await query(
        `SELECT COUNT(*) as count FROM role_assignment_history
         WHERE platform_id = $1 AND user_id = $2`,
        [tenant.tenantId, userId]
      )

      const assignmentCount = parseInt(historyResult.rows[0].count, 10)

      // Detection: Check if jumping to very high privilege role
      const highPrivilegeRoles = ['superadmin', 'admin', 'administrator']
      const isNewRoleHighPrivilege = highPrivilegeRoles.some(
        role => newRole.name.toLowerCase().includes(role)
      )

      // Detection 1: Privilege elevation
      if (previousRole && isNewRoleHighPrivilege) {
        const previousIsHighPrivilege = highPrivilegeRoles.some(
          role => previousRole.name.toLowerCase().includes(role)
        )
        
        if (!previousIsHighPrivilege) {
          isEscalation = true
          escalationType = 'unexpected_elevation'
          severity = 'high'
          reasons.push('Elevation to high-privilege role')
        }
      }

      // Detection 2: Direct jump to superadmin (very suspicious)
      if (newRole.name.toLowerCase() === 'superadmin' && assignmentCount > 0) {
        isEscalation = true
        escalationType = 'privilege_jump'
        severity = 'critical'
        reasons.push('Direct jump to superadmin role')
      }

      // Detection 3: Multiple role changes in short time
      const recentChangesResult = await query(
        `SELECT COUNT(*) as count FROM role_assignment_history
         WHERE platform_id = $1 AND user_id = $2 
         AND created_at > NOW() - INTERVAL '1 hour'`,
        [tenant.tenantId, userId]
      )

      const recentChangeCount = parseInt(recentChangesResult.rows[0].count, 10)
      
      if (recentChangeCount > 2) {
        isAnomalous = true
        reasons.push('Multiple role changes in short time window')
      }

      // Detection 4: Role change outside normal patterns
      const rulesResult = await query(
        `SELECT * FROM role_assignment_rules
         WHERE platform_id = $1 
         AND to_role_id = $2
         AND enabled = true
         AND is_allowed = false`,
        [tenant.tenantId, newRoleId]
      )

      if (rulesResult.rows.length > 0) {
        isAnomalous = true
        reasons.push('Role assignment violates rules')
      }

      // Detection 5: Permission jump
      if (previousRole && newRole.permissions) {
        const previousPermissions = previousRole.permissions || []
        const newPermissions = newRole.permissions || []
        
        const addedPermissions = newPermissions.filter(
          (p: any) => !previousPermissions.includes(p)
        )

        if (addedPermissions.length > 5) {
          isAnomalous = true
          reasons.push(`Received ${addedPermissions.length} new permissions`)
        }
      }

      // Set default severity if escalation detected
      if (isEscalation && !severity) {
        severity = 'medium'
      }

    } catch (error: any) {
      console.warn('[ESCALATION_DETECTION_ERROR]', error.message)
      // Don't fail the role change, but mark as suspicious
      isAnomalous = true
      reasons.push('Error during escalation detection')
    }

    return {
      isEscalation,
      isAnomalous: isEscalation || isAnomalous,
      escalationType,
      severity,
      reasons,
      requiresRevalidation: isEscalation || isAnomalous
    }
  }

  /**
   * Create escalation event for investigation
   */
  private static async createEscalationEvent(
    tenant: TenantContext,
    userId: string,
    previousRoleId: string | undefined,
    newRoleId: string,
    detection: EscalationDetectionResult
  ): Promise<void> {
    try {
      await query(
        `INSERT INTO role_escalation_events
         (platform_id, user_id, escalation_type, severity, previous_role_id, new_role_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          tenant.tenantId,
          userId,
          detection.escalationType || 'unknown',
          detection.severity || 'medium',
          previousRoleId || null,
          newRoleId
        ]
      )
    } catch (error: any) {
      console.error('[ESCALATION_EVENT_ERROR]', error)
    }
  }

  /**
   * Log audit trail for role changes
   */
  private static async logAuditTrail(
    tenant: TenantContext,
    change: RoleAssignmentChange,
    detection: EscalationDetectionResult,
    historyId: string
  ): Promise<void> {
    try {
      await query(
        `INSERT INTO role_change_audit_log
         (platform_id, user_id, action_type, entity_type, entity_id,
          details, initiated_by_user_id, ip_address, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          tenant.tenantId,
          change.userId,
          'role_assigned',
          'role',
          change.newRoleId,
          JSON.stringify({
            historyId,
            changeSource: change.changeSource,
            changeReason: change.changeReason,
            isEscalation: detection.isEscalation,
            isAnomalous: detection.isAnomalous,
            reasons: detection.reasons
          }),
          change.changedByUserId,
          change.ipAddress,
          change.userAgent
        ]
      )
    } catch (error: any) {
      console.error('[AUDIT_LOG_ERROR]', error)
    }
  }

  /**
   * Get role assignment history for user
   */
  static async getUserRoleHistory(
    tenant: TenantContext,
    userId: string,
    limit: number = 50
  ) {
    const result = await query(
      `SELECT
        rah.id,
        rah.user_id,
        rah.previous_role_id,
        rah.new_role_id,
        pr.name as previous_role_name,
        nr.name as new_role_name,
        rah.change_reason,
        rah.change_source,
        rah.is_escalation,
        rah.is_anomalous,
        rah.created_at
       FROM role_assignment_history rah
       LEFT JOIN roles pr ON rah.previous_role_id = pr.id
       LEFT JOIN roles nr ON rah.new_role_id = nr.id
       WHERE rah.platform_id = $1 AND rah.user_id = $2
       ORDER BY rah.created_at DESC
       LIMIT $3`,
      [tenant.tenantId, userId, limit]
    )

    return result.rows
  }

  /**
   * Get escalation events for tenant
   */
  static async getEscalationEvents(
    tenant: TenantContext,
    options: {
      unresolved?: boolean
      severity?: string
      limit?: number
    } = {}
  ) {
    let sql = `SELECT * FROM role_escalation_events WHERE platform_id = $1`
    const params: any[] = [tenant.tenantId]

    if (options.unresolved !== undefined) {
      sql += ` AND is_resolved = ${!options.unresolved}`
    }

    if (options.severity) {
      sql += ` AND severity = $${params.length + 1}`
      params.push(options.severity)
    }

    sql += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`
    params.push(options.limit || 100)

    const result = await query(sql, params)
    return result.rows
  }

  /**
   * Verify role is still valid (force revalidation)
   */
  static async revalidateUserRole(
    tenant: TenantContext,
    userId: string,
    initiatedByUserId: string
  ): Promise<{
    isValid: boolean
    currentRole: any
    revalidatedAt: string
    issues: string[]
  }> {
    try {
      const issues: string[] = []

      // Get current user role
      const userResult = await query(
        `SELECT u.id, u.role_id, r.name, r.permissions, u.is_active
         FROM users u
         JOIN roles r ON u.role_id = r.id
         WHERE u.id = $1 AND u.platform_id = $2`,
        [userId, tenant.tenantId]
      )

      if (userResult.rows.length === 0) {
        throw new Error('User not found')
      }

      const user = userResult.rows[0]

      // Check 1: Is user active?
      if (!user.is_active) {
        issues.push('User is inactive')
      }

      // Check 2: Does role still exist?
      const roleResult = await query(
        `SELECT * FROM roles WHERE id = $1 AND platform_id = $2`,
        [user.role_id, tenant.tenantId]
      )

      if (roleResult.rows.length === 0) {
        issues.push('Assigned role no longer exists')
      }

      // Check 3: Verify role is allowed via rules
      const allowedRulesResult = await query(
        `SELECT COUNT(*) as count FROM role_assignment_rules
         WHERE platform_id = $1 AND to_role_id = $2 AND enabled = true AND is_allowed = false`,
        [tenant.tenantId, user.role_id]
      )

      if (parseInt(allowedRulesResult.rows[0].count, 10) > 0) {
        issues.push('Role violates assignment rules')
      }

      // Log the revalidation
      await query(
        `INSERT INTO role_change_audit_log
         (platform_id, user_id, action_type, entity_type, entity_id,
          details, initiated_by_user_id, ip_address, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          tenant.tenantId,
          userId,
          'role_revalidated',
          'user',
          userId,
          JSON.stringify({
            isValid: issues.length === 0,
            issues
          }),
          initiatedByUserId,
          'system',
          'role-revalidation'
        ]
      )

      return {
        isValid: issues.length === 0,
        currentRole: {
          id: user.role_id,
          name: user.name,
          permissions: user.permissions
        },
        revalidatedAt: new Date().toISOString(),
        issues
      }
    } catch (error: any) {
      console.error('[ROLE_REVALIDATION_ERROR]', error)
      throw new Error(`Revalidation failed: ${error.message}`)
    }
  }

  /**
   * Queue user for role revalidation
   */
  static async queueForRevalidation(
    tenant: TenantContext,
    userId: string,
    reason: string,
    priority: 'low' | 'normal' | 'high' | 'critical' = 'normal',
    escalationEventId?: string
  ): Promise<any> {
    const result = await query(
      `INSERT INTO role_revalidation_queue
       (platform_id, user_id, reason, escalation_event_id, priority)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [tenant.tenantId, userId, reason, escalationEventId || null, priority]
    )

    return result.rows[0]
  }

  /**
   * Get pending revalidations
   */
  static async getPendingRevalidations(
    tenant: TenantContext,
    priority?: string
  ) {
    let sql = `SELECT * FROM role_revalidation_queue
               WHERE platform_id = $1 AND revalidation_status = 'pending'`
    const params: any[] = [tenant.tenantId]

    if (priority) {
      sql += ` AND priority = $${params.length + 1}`
      params.push(priority)
    }

    sql += ` ORDER BY priority DESC, created_at ASC`

    const result = await query(sql, params)
    return result.rows
  }

  /**
   * Mark revalidation as completed
   */
  static async completeRevalidation(
    tenant: TenantContext,
    revalidationId: string,
    result: any,
    revalidatedByUserId: string
  ): Promise<void> {
    await query(
      `UPDATE role_revalidation_queue
       SET revalidation_status = $1, revalidation_result = $2, 
           revalidated_at = NOW(), revalidated_by_user_id = $3, updated_at = NOW()
       WHERE id = $4 AND platform_id = $5`,
      [
        result.isValid ? 'completed' : 'failed',
        JSON.stringify(result),
        revalidatedByUserId,
        revalidationId,
        tenant.tenantId
      ]
    )
  }

  /**
   * Resolve escalation event
   */
  static async resolveEscalationEvent(
    tenant: TenantContext,
    escalationEventId: string,
    resolution: 'confirmed' | 'false_alarm' | 'authorized',
    note: string,
    resolvedByUserId: string
  ): Promise<void> {
    await query(
      `UPDATE role_escalation_events
       SET is_resolved = true, resolution_note = $1, 
           resolved_at = NOW(), resolved_by_user_id = $2
       WHERE id = $3 AND platform_id = $4`,
      [
        `${resolution}: ${note}`,
        resolvedByUserId,
        escalationEventId,
        tenant.tenantId
      ]
    )
  }

  /**
   * Check if role change requires approval
   */
  static async requiresApproval(
    tenant: TenantContext,
    fromRoleId: string | undefined,
    toRoleId: string
  ): Promise<{
    requiresApproval: boolean
    approvalRoles: string[]
    reason: string
  }> {
    const result = await query(
      `SELECT * FROM role_assignment_rules
       WHERE platform_id = $1 
       AND to_role_id = $2
       AND enabled = true
       AND requires_approval = true`,
      [tenant.tenantId, toRoleId]
    )

    if (result.rows.length > 0) {
      const rule = result.rows[0]
      
      const approvalRolesResult = await query(
        `SELECT name FROM roles WHERE id = $1`,
        [rule.approval_required_from_role_id]
      )

      const approvalRoles = approvalRolesResult.rows.map(r => r.name)

      return {
        requiresApproval: true,
        approvalRoles,
        reason: rule.rule_description || 'Role assignment requires approval'
      }
    }

    return {
      requiresApproval: false,
      approvalRoles: [],
      reason: 'No approval required'
    }
  }

  /**
   * Request role assignment approval
   */
  static async requestRoleApproval(
    tenant: TenantContext,
    userId: string,
    requestedRoleId: string,
    requestedByUserId: string,
    reason?: string
  ): Promise<any> {
    const result = await query(
      `INSERT INTO role_assignment_approvals
       (platform_id, user_id, requested_role_id, requested_by_user_id, approval_reason)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        tenant.tenantId,
        userId,
        requestedRoleId,
        requestedByUserId,
        reason || null
      ]
    )

    return result.rows[0]
  }

  /**
   * Get pending approvals
   */
  static async getPendingApprovals(tenant: TenantContext) {
    const result = await query(
      `SELECT * FROM role_assignment_approvals
       WHERE platform_id = $1 AND approval_status = 'pending'
       ORDER BY created_at ASC`,
      [tenant.tenantId]
    )

    return result.rows
  }

  /**
   * Approve role assignment
   */
  static async approveRoleAssignment(
    tenant: TenantContext,
    approvalId: string,
    approvedByUserId: string,
    reason?: string
  ): Promise<void> {
    await query(
      `UPDATE role_assignment_approvals
       SET approval_status = $1, approved_by_user_id = $2, 
           approval_reason = $3, updated_at = NOW()
       WHERE id = $4 AND platform_id = $5`,
      ['approved', approvedByUserId, reason || null, approvalId, tenant.tenantId]
    )
  }

  /**
   * Reject role assignment
   */
  static async rejectRoleAssignment(
    tenant: TenantContext,
    approvalId: string,
    approvedByUserId: string,
    reason: string
  ): Promise<void> {
    await query(
      `UPDATE role_assignment_approvals
       SET approval_status = $1, approved_by_user_id = $2, 
           rejection_reason = $3, updated_at = NOW()
       WHERE id = $4 AND platform_id = $5`,
      ['rejected', approvedByUserId, reason, approvalId, tenant.tenantId]
    )
  }
}

export default RoleAssignmentHistoryService
