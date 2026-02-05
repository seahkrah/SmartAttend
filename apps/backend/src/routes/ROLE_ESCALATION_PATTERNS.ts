/**
 * PHASE 4, STEP 4.2: ROLE ESCALATION DETECTION - INTEGRATION PATTERNS
 * 
 * Shows how to integrate role escalation detection into routes
 * Demonstrates no-silent-changes enforcement
 */

import { Router, Request, Response } from 'express'
import { authenticateToken } from '../auth/middleware.js'
import { enforceTenantBoundaries } from '../auth/tenantEnforcementMiddleware.js'
import {
  enforceRoleChangeLogging,
  requireRoleApprovalForSensitiveChanges,
  enforceRoleRevalidation
} from '../auth/roleRevalidationMiddleware.js'
import { RoleAssignmentHistoryService } from '../services/roleEscalationDetectionService.js'
import type { TenantAwareRequest } from '../types/tenantContext.js'

const router = Router()

/**
 * PATTERN 1: Log all role changes (no silent changes)
 * 
 * GUARANTEE: Every role change is logged with:
 * - Who changed it (changed_by_user_id)
 * - When (timestamp)
 * - From what role (previous_role_id)
 * - To what role (new_role_id)
 * - Why (change_reason)
 * - If it's suspicious (is_escalation, is_anomalous)
 */
router.put(
  '/users/:userId/role',
  authenticateToken,
  enforceTenantBoundaries,
  enforceRoleChangeLogging,
  async (req: TenantAwareRequest, res: Response) => {
    try {
      if (!req.tenant || !req.roleChangeLogger) {
        return res.status(401).json({ error: 'Tenant context required' })
      }

      const { userId } = req.params
      const { newRoleId, changeReason } = req.body

      if (!newRoleId) {
        return res.status(400).json({ error: 'newRoleId required' })
      }

      // Validate new role exists
      const roleResult = await require('../db/connection.js').query(
        'SELECT id FROM roles WHERE id = $1 AND platform_id = $2',
        [newRoleId, req.tenant.tenantId]
      )

      if (roleResult.rows.length === 0) {
        return res.status(404).json({ error: 'Role not found' })
      }

      // Get current role
      const userResult = await require('../db/connection.js').query(
        'SELECT role_id FROM users WHERE id = $1 AND platform_id = $2',
        [userId, req.tenant.tenantId]
      )

      if (userResult.rows.length === 0) {
        return res.status(404).json({ error: 'User not found' })
      }

      const previousRoleId = userResult.rows[0].role_id

      // GUARANTEE: No silent changes - log the change
      const logResult = await req.roleChangeLogger({
        userId,
        previousRoleId,
        newRoleId,
        changedByUserId: req.user?.userId,
        changeReason,
        changeSource: 'api'
      })

      // If escalation detected, inform the user
      if (logResult.escalation.requiresRevalidation) {
        console.warn(
          `[ESCALATION_DETECTED] User ${userId}: ${logResult.escalation.reasons.join('; ')}`
        )
      }

      // Actually perform the role change
      await require('../db/connection.js').query(
        'UPDATE users SET role_id = $1, updated_at = NOW() WHERE id = $2',
        [newRoleId, userId]
      )

      res.json({
        success: true,
        userId,
        previousRoleId,
        newRoleId,
        changeId: logResult.historyId,
        escalationDetected: logResult.escalation.requiresRevalidation,
        escalationDetails: logResult.escalation
      })
    } catch (error: any) {
      console.error('[ROLE_CHANGE_ERROR]', error)
      res.status(500).json({ error: error.message })
    }
  }
)

/**
 * PATTERN 2: Require approval for sensitive role changes
 * 
 * GUARANTEE: High-privilege roles require approval before assignment
 * Prevents unauthorized escalation
 */
router.put(
  '/users/:userId/role/with-approval',
  authenticateToken,
  enforceTenantBoundaries,
  requireRoleApprovalForSensitiveChanges,
  enforceRoleChangeLogging,
  async (req: TenantAwareRequest, res: Response) => {
    try {
      if (!req.tenant || !req.roleChangeLogger) {
        return res.status(401).json({ error: 'Tenant context required' })
      }

      const { userId } = req.params
      const { newRoleId, changeReason } = req.body

      // Log the change
      const logResult = await req.roleChangeLogger({
        userId,
        newRoleId,
        changedByUserId: req.user?.userId,
        changeReason,
        changeSource: 'api'
      })

      // Perform role change
      await require('../db/connection.js').query(
        'UPDATE users SET role_id = $1, updated_at = NOW() WHERE id = $2',
        [newRoleId, userId]
      )

      res.json({
        success: true,
        userId,
        newRoleId,
        changeId: logResult.historyId,
        escalationDetected: logResult.escalation.requiresRevalidation,
        approvalInfo: req.roleApprovalInfo
      })
    } catch (error: any) {
      res.status(500).json({ error: error.message })
    }
  }
)

/**
 * PATTERN 3: Get role assignment history (audit trail)
 * 
 * Shows complete history of role changes
 * No changes are hidden or removed
 */
router.get(
  '/users/:userId/role/history',
  authenticateToken,
  enforceTenantBoundaries,
  async (req: TenantAwareRequest, res: Response) => {
    try {
      if (!req.tenant) {
        return res.status(401).json({ error: 'Tenant context required' })
      }

      const { userId } = req.params
      const limit = parseInt(req.query.limit as string) || 50

      const history = await RoleAssignmentHistoryService.getUserRoleHistory(
        req.tenant,
        userId,
        limit
      )

      res.json({
        userId,
        history,
        count: history.length,
        details: {
          escalations: history.filter(h => h.is_escalation),
          anomalies: history.filter(h => h.is_anomalous)
        }
      })
    } catch (error: any) {
      res.status(500).json({ error: error.message })
    }
  }
)

/**
 * PATTERN 4: Get escalation events (security review)
 * 
 * Shows detected escalations that need investigation
 */
router.get(
  '/security/escalation-events',
  authenticateToken,
  enforceTenantBoundaries,
  async (req: TenantAwareRequest, res: Response) => {
    try {
      if (!req.tenant) {
        return res.status(401).json({ error: 'Tenant context required' })
      }

      const unresolved = req.query.unresolved === 'true'
      const severity = req.query.severity as string

      const events = await RoleAssignmentHistoryService.getEscalationEvents(
        req.tenant,
        {
          unresolved,
          severity,
          limit: 100
        }
      )

      res.json({
        escalationEvents: events,
        count: events.length,
        unresolved: events.filter(e => !e.is_resolved),
        bySeverity: {
          critical: events.filter(e => e.severity === 'critical'),
          high: events.filter(e => e.severity === 'high'),
          medium: events.filter(e => e.severity === 'medium'),
          low: events.filter(e => e.severity === 'low')
        }
      })
    } catch (error: any) {
      res.status(500).json({ error: error.message })
    }
  }
)

/**
 * PATTERN 5: Manually trigger role revalidation
 * 
 * GUARANTEE: Forces user's role to be re-verified
 * Detects if role is still valid, if user is active, etc.
 */
router.post(
  '/users/:userId/role/revalidate',
  authenticateToken,
  enforceTenantBoundaries,
  async (req: TenantAwareRequest, res: Response) => {
    try {
      if (!req.tenant || !req.user) {
        return res.status(401).json({ error: 'Tenant context required' })
      }

      const { userId } = req.params

      // Perform revalidation
      const result = await RoleAssignmentHistoryService.revalidateUserRole(
        req.tenant,
        userId,
        req.user.userId
      )

      if (result.isValid) {
        res.json({
          isValid: true,
          currentRole: result.currentRole,
          revalidatedAt: result.revalidatedAt
        })
      } else {
        res.status(400).json({
          isValid: false,
          issues: result.issues,
          action: 'review_role_assignment'
        })
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message })
    }
  }
)

/**
 * PATTERN 6: Queue multiple users for revalidation
 * 
 * Used after detecting anomalies
 */
router.post(
  '/security/revalidate-users-batch',
  authenticateToken,
  enforceTenantBoundaries,
  async (req: TenantAwareRequest, res: Response) => {
    try {
      if (!req.tenant) {
        return res.status(401).json({ error: 'Tenant context required' })
      }

      const { userIds, reason, priority = 'high' } = req.body

      if (!Array.isArray(userIds) || userIds.length === 0) {
        return res.status(400).json({ error: 'userIds array required' })
      }

      const queued = []

      for (const userId of userIds) {
        try {
          const result = await RoleAssignmentHistoryService.queueForRevalidation(
            req.tenant,
            userId,
            reason,
            priority
          )
          queued.push({ userId, revalidationId: result.id })
        } catch (error: any) {
          console.error(`Failed to queue user ${userId}:`, error)
        }
      }

      res.status(202).json({
        queued: queued.length,
        records: queued,
        message: `${queued.length} users queued for revalidation`
      })
    } catch (error: any) {
      res.status(500).json({ error: error.message })
    }
  }
)

/**
 * PATTERN 7: Get pending revalidations (admin endpoint)
 * 
 * Shows users that need role revalidation
 */
router.get(
  '/security/pending-revalidations',
  authenticateToken,
  enforceTenantBoundaries,
  async (req: TenantAwareRequest, res: Response) => {
    try {
      if (!req.tenant) {
        return res.status(401).json({ error: 'Tenant context required' })
      }

      const priority = req.query.priority as string

      const pending = await RoleAssignmentHistoryService.getPendingRevalidations(
        req.tenant,
        priority
      )

      res.json({
        pending,
        count: pending.length,
        byPriority: {
          critical: pending.filter(p => p.priority === 'critical'),
          high: pending.filter(p => p.priority === 'high'),
          normal: pending.filter(p => p.priority === 'normal'),
          low: pending.filter(p => p.priority === 'low')
        }
      })
    } catch (error: any) {
      res.status(500).json({ error: error.message })
    }
  }
)

/**
 * PATTERN 8: Resolve escalation event (security review decision)
 * 
 * Admin confirms if escalation was authorized or not
 */
router.post(
  '/security/escalation-events/:eventId/resolve',
  authenticateToken,
  enforceTenantBoundaries,
  async (req: TenantAwareRequest, res: Response) => {
    try {
      if (!req.tenant || !req.user) {
        return res.status(401).json({ error: 'Tenant context required' })
      }

      const { eventId } = req.params
      const { resolution, note } = req.body

      if (!['confirmed', 'false_alarm', 'authorized'].includes(resolution)) {
        return res.status(400).json({
          error: 'Invalid resolution',
          allowed: ['confirmed', 'false_alarm', 'authorized']
        })
      }

      await RoleAssignmentHistoryService.resolveEscalationEvent(
        req.tenant,
        eventId,
        resolution,
        note,
        req.user.userId
      )

      res.json({
        eventId,
        resolved: true,
        resolution,
        resolvedBy: req.user.userId,
        timestamp: new Date().toISOString()
      })
    } catch (error: any) {
      res.status(500).json({ error: error.message })
    }
  }
)

/**
 * PATTERN 9: Get role assignment audit log
 * 
 * Complete audit trail of all role-related changes
 */
router.get(
  '/audit/role-changes',
  authenticateToken,
  enforceTenantBoundaries,
  async (req: TenantAwareRequest, res: Response) => {
    try {
      if (!req.tenant) {
        return res.status(401).json({ error: 'Tenant context required' })
      }

      const userId = req.query.userId as string
      const actionType = req.query.actionType as string
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 500)

      let sql = 'SELECT * FROM role_change_audit_log WHERE platform_id = $1'
      const params: any[] = [req.tenant.tenantId]

      if (userId) {
        sql += ` AND user_id = $${params.length + 1}`
        params.push(userId)
      }

      if (actionType) {
        sql += ` AND action_type = $${params.length + 1}`
        params.push(actionType)
      }

      sql += ` ORDER BY timestamp DESC LIMIT $${params.length + 1}`
      params.push(limit)

      const { query: q } = await import('../db/connection.js')
      const result = await q(sql, params)

      res.json({
        records: result.rows,
        count: result.rows.length,
        limit,
        filters: { userId, actionType }
      })
    } catch (error: any) {
      res.status(500).json({ error: error.message })
    }
  }
)

/**
 * PATTERN 10: Request role assignment approval
 * 
 * For sensitive changes that require approval
 */
router.post(
  '/users/:userId/role/request-approval',
  authenticateToken,
  enforceTenantBoundaries,
  async (req: TenantAwareRequest, res: Response) => {
    try {
      if (!req.tenant || !req.user) {
        return res.status(401).json({ error: 'Tenant context required' })
      }

      const { userId } = req.params
      const { requestedRoleId, reason } = req.body

      if (!requestedRoleId) {
        return res.status(400).json({ error: 'requestedRoleId required' })
      }

      // Check if approval is required
      const { requiresApproval } =
        await RoleAssignmentHistoryService.requiresApproval(
          req.tenant,
          undefined,
          requestedRoleId
        )

      if (!requiresApproval) {
        return res.status(400).json({
          error: 'This role does not require approval'
        })
      }

      // Request approval
      const approval = await RoleAssignmentHistoryService.requestRoleApproval(
        req.tenant,
        userId,
        requestedRoleId,
        req.user.userId,
        reason
      )

      res.status(202).json({
        approvalId: approval.id,
        userId,
        requestedRoleId,
        status: 'approval_requested',
        createdAt: approval.created_at
      })
    } catch (error: any) {
      res.status(500).json({ error: error.message })
    }
  }
)

/**
 * SECURITY GUARANTEES
 * 
 * ✅ NO SILENT ROLE CHANGES
 *    Every change logged: who, when, from, to, why
 * 
 * ✅ ESCALATION DETECTION
 *    Automatic detection: elevation, privilege jumps, timing anomalies
 * 
 * ✅ FORCED REVALIDATION
 *    On anomaly: role is queued for re-verification
 * 
 * ✅ APPROVAL WORKFLOW
 *    High-privilege roles: require approval before assignment
 * 
 * ✅ AUDIT TRAIL
 *    Complete history: immutable, cannot be modified or deleted
 * 
 * ✅ VISIBILITY
 *    All changes visible: to security team via endpoints
 */

export default router
