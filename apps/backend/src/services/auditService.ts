import { query } from '../db/connection.js'
import { Request } from 'express'
import { randomBytes } from 'crypto'

/**
 * Audit Service
 * Provides audit-first logging patterns for infrastructure operations.
 * All critical superadmin actions must be logged BEFORE execution.
 */

export interface AuditContext {
  requestId: string
  actorId: string
  actionType: string
  actionScope: 'GLOBAL' | 'TENANT' | 'USER' | 'SYSTEM'
  targetEntityType?: string
  targetEntityId?: string
  justification?: string
  confirmationToken?: string
  ipAddress?: string
  userAgent?: string
  dryRun?: boolean
}

/**
 * Generate a unique request ID for audit trail correlation
 */
export function generateRequestId(): string {
  return `req_${randomBytes(8).toString('hex')}_${Date.now()}`
}

/**
 * Extract audit context from Express request
 */
export function extractAuditContext(req: Request, actionType: string, actionScope: 'GLOBAL' | 'TENANT' | 'USER' | 'SYSTEM'): AuditContext {
  return {
    requestId: (req as any).requestId || generateRequestId(),
    actorId: req.user?.userId || 'unknown',
    actionType,
    actionScope,
    ipAddress: req.ip || 'unknown',
    userAgent: req.get('user-agent') || undefined,
    dryRun: (req.body as any)?.dryRun === true
  }
}

/**
 * IMMUTABILITY GUARD: Prevent any mutation attempts on audit logs
 * 
 * Phase 10.2: Enforce append-only at service layer
 * No UPDATE or DELETE operations permitted
 */
export function preventUpdateAttempt(operation: 'UPDATE' | 'DELETE'): never {
  throw new Error(
    `[AUDIT IMMUTABILITY] ${operation} operation attempted on audit logs. ` +
    'This operation is prohibited by design. ' +
    'Audit logs must be append-only and immutable. ' +
    'If you need to correct an audit record, create a new explanatory log entry instead.'
  );
}

/**
 * Log an audit entry (append-only, no mutations)
 * Returns the audit ID for correlation
 * 
 * Phase 10.2: Updated to capture before/after state at creation time
 * All data must be provided upfront; no post-hoc updates allowed
 */
export async function logAuditEntry(
  context: AuditContext,
  overrides?: Partial<AuditContext>,
  stateCapture?: {
    beforeState?: any
    afterState?: any
  }
): Promise<string> {
  const finalContext = { ...context, ...overrides }

  try {
    const result = await query(
      `INSERT INTO superadmin_audit_log 
       (actor_id, actor_platform, action_type, action_scope, target_entity_type, target_entity_id, 
        justification, confirmation_token, ip_address, user_agent, request_id, result, 
        before_state, after_state, actor_role, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, CURRENT_TIMESTAMP)
       RETURNING id`,
      [
        finalContext.actorId,
        'superadmin',
        finalContext.actionType,
        finalContext.actionScope,
        finalContext.targetEntityType || null,
        finalContext.targetEntityId || null,
        finalContext.justification || null,
        finalContext.confirmationToken || null,
        finalContext.ipAddress || null,
        finalContext.userAgent || null,
        finalContext.requestId,
        finalContext.dryRun ? 'DRY_RUN' : 'SUCCESS',
        stateCapture?.beforeState ? JSON.stringify(stateCapture.beforeState) : null,
        stateCapture?.afterState ? JSON.stringify(stateCapture.afterState) : null,
        'superadmin'
      ]
    )

    return result.rows[0].id
  } catch (error) {
    console.error('[AUDIT] Failed to log audit entry:', error)
    throw error
  }
}

/**
 * DEPRECATED & REMOVED: updateAuditEntry()
 * 
 * Phase 10.2: This function has been removed to enforce immutability
 * 
 * Original purpose: Update audit log after execution
 * Problem: Allowed rewriting history after the fact
 * Solution: Capture all data (before/after state, result) at creation time
 * 
 * Migration path:
 * - If you need to update audit logs, you have a design problem
 * - Create a NEW audit entry explaining the correction instead
 * - Immutable logging provides legal defensibility
 * 
 * @deprecated - Use logAuditEntry with stateCapture parameter instead
 * @throws - Always throws error directing to immutable pattern
 */
export function updateAuditEntry(): never {
  preventUpdateAttempt('UPDATE');
}

/**
 * DEPRECATED & REMOVED: auditOperation()
 * 
 * Phase 10.2: This function has been removed to enforce immutability
 * 
 * Original purpose: Log operation with automatic state tracking
 * Problem: Updated logs after execution (violated immutability)
 * Solution: Capture state before execution, log once with all data
 * 
 * Migration path:
 * 1. Capture beforeState before operation
 * 2. Execute operation
 * 3. Capture afterState after operation
 * 4. Call logAuditEntry with stateCapture once (immutable)
 * 
 * @deprecated - Use sequential: captureBeforeState -> execute -> logAuditEntry
 * @throws - Always throws error directing to immutable pattern
 */
export function auditOperation(): never {
  preventUpdateAttempt('UPDATE');
}

/**
 * DEPRECATED & REMOVED: auditDryRun()
 * 
 * Phase 10.2: This function has been removed to enforce immutability
 * 
 * Original purpose: Log a dry-run with simulated result
 * Problem: Updated logs after execution (violated immutability)
 * Solution: Log once with dryRun flag and result provided upfront
 * 
 * Migration path:
 * Call logAuditEntry with context.dryRun = true and stateCapture.afterState set
 * 
 * @deprecated - Use logAuditEntry with dryRun flag instead
 * @throws - Always throws error directing to immutable pattern
 */
export function auditDryRun(): never {
  preventUpdateAttempt('UPDATE');
}

/**
 * Retrieve audit logs for a specific actor or entity
 */
export async function getAuditLogs(
  filters?: {
    actorId?: string
    actionType?: string
    actionScope?: string
    targetEntityId?: string
    limit?: number
    offset?: number
  }
): Promise<any[]> {
  let q = 'SELECT * FROM superadmin_audit_log WHERE 1=1'
  const params: any[] = []
  let paramNum = 1

  if (filters?.actorId) {
    q += ` AND actor_id = $${paramNum}`
    params.push(filters.actorId)
    paramNum++
  }

  if (filters?.actionType) {
    q += ` AND action_type = $${paramNum}`
    params.push(filters.actionType)
    paramNum++
  }

  if (filters?.actionScope) {
    q += ` AND action_scope = $${paramNum}`
    params.push(filters.actionScope)
    paramNum++
  }

  if (filters?.targetEntityId) {
    q += ` AND target_entity_id = $${paramNum}`
    params.push(filters.targetEntityId)
    paramNum++
  }

  q += ` ORDER BY timestamp DESC LIMIT $${paramNum} OFFSET $${paramNum + 1}`
  params.push(filters?.limit || 100, filters?.offset || 0)

  const result = await query(q, params)
  return result.rows
}
