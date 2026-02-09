/**
 * ===========================
 * ROLE BOUNDARY SERVICE
 * ===========================
 * 
 * Enforces role boundaries at service layer.
 * No role should be able to lie convincingly.
 * 
 * Responsibilities:
 * 1. Define what each role CAN do (role_permissions_matrix)
 * 2. Verify user has required role for action
 * 3. Check action against role boundaries
 * 4. Log role boundary violations
 * 5. Detect if role state is compromised
 */

import { query } from '../db/connection.js'
import { v4 as uuidv4 } from 'uuid'
import crypto from 'crypto'

// ===========================
// TYPES & CONSTANTS
// ===========================

export type UserRole = 'superadmin' | 'tenant_admin' | 'faculty' | 'admin' | 'student' | 'employee' | 'user'
export type ActionName = string
export type ResourceType = 'ATTENDANCE' | 'USER' | 'AUDIT_LOG' | 'ROLE' | 'TENANT' | 'ATTENDANCE_RECORD'
export type RestrictionScope = 'OWN_ONLY' | 'TENANT' | 'GLOBAL' | 'NONE'

export interface RoleGuardContext {
  userId: string
  actionName: ActionName
  resourceType?: ResourceType
  targetResourceId?: string
  targetUserId?: string
  ipAddress?: string
  userAgent?: string
  requestId?: string
}

export interface RolePermission {
  action_name: string
  action_resource_type: string
  is_allowed: boolean
  restriction_scope: RestrictionScope
}

// ===========================
// SUPERADMIN TRANSPARENCY
// ===========================

/**
 * Actions that are UNEXPECTED for superadmin
 * If superadmin performs these, it's flagged as unusual
 */
const UNEXPECTED_SUPERADMIN_ACTIONS = new Set([
  'MARK_ATTENDANCE',      // Faculty/admin job
  'APPROVE_REGISTRATION', // Admin/tenant_admin job
  'MODIFY_PAST_ATTENDANCE', // Not needed
  'GRANT_STUDENT_ROLE',   // Registration flow job
])

const NORMAL_SUPERADMIN_ACTIONS = new Set([
  'READ_AUDIT_LOGS',
  'READ_USER_HISTORY',
  'SUSPEND_TENANT',
  'LOCK_TENANT',
  'VIEW_ESCALATION_EVENTS',
  'INVESTIGATE_INCIDENT',
])

// ===========================
// ROLE BOUNDARY SERVICE
// ===========================

export class RoleBoundaryService {
  private permissionCache: Map<string, RolePermission[]> = new Map()
  private lastCacheUpdate: number = 0
  private CACHE_TTL = 5 * 60 * 1000 // 5 minutes

  /**
   * MAIN GUARD: Enforce role boundary
   * 
   * This is THE function that prevents roles from lying.
   * Every service method that checks role should call this.
   */
  async enforceRoleGuard(context: RoleGuardContext): Promise<{ isAllowed: boolean; reason?: string }> {
    try {
      // 1. Verify user exists and get their role from DATABASE (fresh)
      const userRoleResult = await query(
        `SELECT r.id, r.name FROM users u
         JOIN roles r ON u.role_id = r.id
         WHERE u.id = $1`,
        [context.userId]
      )

      if (userRoleResult.rows.length === 0) {
        return {
          isAllowed: false,
          reason: 'User or role not found',
        }
      }

      const role: UserRole = userRoleResult.rows[0].name
      const roleId = userRoleResult.rows[0].id

      // 2. Check if user's role is marked as compromised
      const userSecurityResult = await query(
        `SELECT role_may_be_compromised FROM users WHERE id = $1`,
        [context.userId]
      )

      if (userSecurityResult.rows[0].role_may_be_compromised) {
        await this.logBoundaryViolation({
          ...context,
          reason: 'Role marked as compromised',
          severity: 'CRITICAL',
        })
        return {
          isAllowed: false,
          reason: 'Your role requires revalidation',
        }
      }

      // 3. Check if this role can perform this action
      const permission = await this.getPermission(roleId, context.actionName, context.resourceType)

      if (!permission || !permission.is_allowed) {
        await this.logBoundaryViolation({
          ...context,
          reason: `Role '${role}' not allowed to perform '${context.actionName}'`,
          severity: 'MEDIUM',
        })
        return {
          isAllowed: false,
          reason: `Your role (${role}) cannot perform ${context.actionName}`,
        }
      }

      // 4. Check superadmin transparency
      if (role === 'superadmin' && UNEXPECTED_SUPERADMIN_ACTIONS.has(context.actionName)) {
        // Superadmin CAN do this, but it's unusual
        // Log it for audit review, but allow
        console.warn(
          `[SUPERADMIN_TRANSPARENCY] Unusual action: ${context.actionName} by superadmin ${context.userId}`
        )

        await query(
          `INSERT INTO audit_logs (action, actor_id, resource_type, details)
           VALUES ($1, $2, $3, $4)`,
          [
            `UNUSUAL_SUPERADMIN_ACTION_${context.actionName}`,
            context.userId,
            context.resourceType || 'UNKNOWN',
            JSON.stringify({ context }),
          ]
        )

        // Still allow superadmin to do it
        return { isAllowed: true }
      }

      // 5. Check scope restrictions
      if (permission.restriction_scope === 'OWN_ONLY' && context.targetUserId) {
        if (context.targetUserId !== context.userId) {
          await this.logBoundaryViolation({
            ...context,
            reason: `Role can only ${context.actionName} own resources`,
            severity: 'HIGH',
          })
          return {
            isAllowed: false,
            reason: `You can only ${context.actionName} your own data`,
          }
        }
      }

      // All checks passed
      return { isAllowed: true }
    } catch (error) {
      console.error('[ROLE_GUARD] Error enforcing role guard:', error)
      throw error
    }
  }

  /**
   * Get permission from cache or database
   */
  private async getPermission(
    roleId: string,
    actionName: string,
    resourceType?: string
  ): Promise<RolePermission | null> {
    try {
      // Check cache first
      const cacheKey = `${roleId}:${actionName}:${resourceType || 'ANY'}`
      const now = Date.now()

      if (this.permissionCache.has(cacheKey) && now - this.lastCacheUpdate < this.CACHE_TTL) {
        return this.permissionCache.get(cacheKey) || null
      }

      // Query database
      const result = await query(
        `SELECT action_name, action_resource_type, is_allowed, restriction_scope
         FROM role_permissions_matrix
         WHERE role_id = $1 AND action_name = $2
           AND (action_resource_type = $3 OR action_resource_type IS NULL)
         LIMIT 1`,
        [roleId, actionName, resourceType || null]
      )

      if (result.rows.length === 0) {
        return null
      }

      const permission = result.rows[0]
      this.permissionCache.set(cacheKey, permission)
      this.lastCacheUpdate = now

      return permission
    } catch (error) {
      console.error('[ROLE_GUARD] Error getting permission:', error)
      throw error
    }
  }

  /**
   * Log boundary violation
   */
  async logBoundaryViolation(params: {
    userId: string
    actionName: string
    resourceType?: ResourceType
    targetResourceId?: string
    reason: string
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
    ipAddress?: string
    userAgent?: string
    requestId?: string
  }): Promise<string> {
    try {
      const id = uuidv4()

      const userRoleResult = await query(
        `SELECT r.name FROM users u
         JOIN roles r ON u.role_id = r.id
         WHERE u.id = $1`,
        [params.userId]
      )

      const userRole = userRoleResult.rows[0]?.name || 'UNKNOWN'

      await query(
        `INSERT INTO role_boundary_violations (
          id, user_id, user_role, action_type, target_resource_type, 
          target_resource_id, reason, severity, ip_address, user_agent, request_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          id,
          params.userId,
          userRole,
          params.actionName,
          params.resourceType || null,
          params.targetResourceId || null,
          params.reason,
          params.severity,
          params.ipAddress || null,
          params.userAgent || null,
          params.requestId || null,
        ]
      )

      if (params.severity === 'CRITICAL' || params.severity === 'HIGH') {
        console.error(
          `[ROLE_BOUNDARY_VIOLATION] ${params.severity}: ${params.reason} (User: ${params.userId})`
        )
      }

      return id
    } catch (error) {
      console.error('[ROLE_GUARD] Error logging boundary violation:', error)
      throw error
    }
  }

  /**
   * Log role change for history
   */
  async logRoleChange(params: {
    userId: string
    roleId: string
    changedByUserId: string
    reason: string
    severity?: 'SYSTEM_BOOTSTRAP' | 'NORMAL' | 'ESCALATION_SUSPECTED' | 'EMERGENCY'
    detectionFlags?: string[]
  }): Promise<string> {
    try {
      const id = uuidv4()
      const severity = params.severity || 'NORMAL'

      // Generate checksum for immutability
      const checksum = crypto
        .createHash('sha256')
        .update(JSON.stringify({ id, userId: params.userId, roleId: params.roleId }))
        .hexdigest()

      await query(
        `INSERT INTO role_assignment_history (
          id, user_id, role_id, assigned_by_user_id, reason, severity, 
          detection_flags, checksum
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          id,
          params.userId,
          params.roleId,
          params.changedByUserId,
          params.reason,
          severity,
          params.detectionFlags || [],
          checksum,
        ]
      )

      // Update user's security metadata
      await query(
        `UPDATE users 
         SET last_role_change_at = CURRENT_TIMESTAMP,
             last_role_change_by_id = $1,
             total_role_changes = total_role_changes + 1
         WHERE id = $2`,
        [params.changedByUserId, params.userId]
      )

      console.log(
        `[ROLE_CHANGE_LOGGED] User ${params.userId} assigned role ${params.roleId} by ${params.changedByUserId}`
      )

      return id
    } catch (error) {
      console.error('[ROLE_GUARD] Error logging role change:', error)
      throw error
    }
  }

  /**
   * Get user's current role
   */
  async getUserRole(userId: string): Promise<UserRole | null> {
    try {
      const result = await query(
        `SELECT r.name FROM users u
         JOIN roles r ON u.role_id = r.id
         WHERE u.id = $1`,
        [userId]
      )

      if (result.rows.length === 0) {
        return null
      }

      return result.rows[0].name as UserRole
    } catch (error) {
      console.error('[ROLE_GUARD] Error getting user role:', error)
      throw error
    }
  }

  /**
   * Get user's role change history
   */
  async getUserRoleHistory(userId: string, limit: number = 50): Promise<any[]> {
    try {
      const result = await query(
        `SELECT 
          id, user_id, role_id, assigned_by_user_id, assigned_at,
          revoked_at, reason, severity, detection_flags, anomaly_score,
          is_verified
         FROM role_assignment_history
         WHERE user_id = $1
         ORDER BY assigned_at DESC
         LIMIT $2`,
        [userId, limit]
      )

      return result.rows
    } catch (error) {
      console.error('[ROLE_GUARD] Error getting role history:', error)
      throw error
    }
  }

  /**
   * Check if user's role has escalation flags
   */
  async isRoleCompromised(userId: string): Promise<boolean> {
    try {
      const result = await query(
        `SELECT role_may_be_compromised FROM users WHERE id = $1`,
        [userId]
      )

      if (result.rows.length === 0) {
        return false
      }

      return result.rows[0].role_may_be_compromised
    } catch (error) {
      console.error('[ROLE_GUARD] Error checking role compromise:', error)
      throw error
    }
  }

  /**
   * Mark role as potentially compromised
   */
  async markRoleAsCompromised(userId: string, escalationEventId: string): Promise<void> {
    try {
      await query(
        `UPDATE users 
         SET role_may_be_compromised = TRUE,
             last_escalation_event_id = $1
         WHERE id = $2`,
        [escalationEventId, userId]
      )

      console.warn(`[ROLE_GUARD] User ${userId}'s role marked as compromised`)
    } catch (error) {
      console.error('[ROLE_GUARD] Error marking role as compromised:', error)
      throw error
    }
  }

  /**
   * Unmark role (after investigation/resolution)
   */
  async unmarkRoleAsCompromised(userId: string): Promise<void> {
    try {
      await query(
        `UPDATE users 
         SET role_may_be_compromised = FALSE
         WHERE id = $1`,
        [userId]
      )

      console.log(`[ROLE_GUARD] User ${userId}'s role unmarked as compromised`)
    } catch (error) {
      console.error('[ROLE_GUARD] Error unmarking role as compromised:', error)
      throw error
    }
  }

  /**
   * Get all boundary violations
   */
  async getBoundaryViolations(limit: number = 100): Promise<any[]> {
    try {
      const result = await query(
        `SELECT * FROM role_boundary_violations
         ORDER BY created_at DESC
         LIMIT $1`,
        [limit]
      )

      return result.rows
    } catch (error) {
      console.error('[ROLE_GUARD] Error getting boundary violations:', error)
      throw error
    }
  }

  /**
   * Refresh permission cache
   */
  refreshCache(): void {
    this.permissionCache.clear()
    this.lastCacheUpdate = 0
  }
}

export default RoleBoundaryService
