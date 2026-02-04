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
 * Log an audit entry (append-only)
 * Returns the audit ID for correlation
 */
export async function logAuditEntry(context: AuditContext, overrides?: Partial<AuditContext>): Promise<string> {
  const finalContext = { ...context, ...overrides }

  try {
    const result = await query(
      `INSERT INTO superadmin_audit_log 
       (actor_id, actor_platform, action_type, action_scope, target_entity_type, target_entity_id, justification, confirmation_token, ip_address, user_agent, request_id, result)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
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
        finalContext.dryRun ? 'DRY_RUN' : 'PENDING'
      ]
    )

    return result.rows[0].id
  } catch (error) {
    console.error('[AUDIT] Failed to log audit entry:', error)
    throw error
  }
}

/**
 * Update an audit entry with before/after state and result
 */
export async function updateAuditEntry(
  auditId: string,
  result: 'SUCCESS' | 'FAILURE' | 'PARTIAL',
  beforeState?: any,
  afterState?: any,
  errorMessage?: string
): Promise<void> {
  try {
    await query(
      `UPDATE superadmin_audit_log 
       SET before_state = $1, after_state = $2, result = $3, error_message = $4
       WHERE id = $5`,
      [
        beforeState ? JSON.stringify(beforeState) : null,
        afterState ? JSON.stringify(afterState) : null,
        result,
        errorMessage || null,
        auditId
      ]
    )
  } catch (error) {
    console.error('[AUDIT] Failed to update audit entry:', error)
    throw error
  }
}

/**
 * Convenience wrapper: log an operation with automatic before/after state tracking
 */
export async function auditOperation(
  context: AuditContext,
  operation: () => Promise<any>,
  options?: {
    captureBeforeState?: () => Promise<any>
    captureAfterState?: (result: any) => Promise<any>
  }
): Promise<any> {
  let auditId: string = 'unknown'
  let beforeState: any
  let operationResult: any

  try {
    // Capture before state if requested
    if (options?.captureBeforeState) {
      beforeState = await options.captureBeforeState()
    }

    // Log audit entry with PENDING result
    auditId = await logAuditEntry(context)

    // Execute the operation
    operationResult = await operation()

    // Capture after state if requested
    let afterState: any
    if (options?.captureAfterState) {
      afterState = await options.captureAfterState(operationResult)
    }

    // Update audit entry with success result
    await updateAuditEntry(auditId, 'SUCCESS', beforeState, afterState)

    return operationResult
  } catch (error: any) {
    // Update audit entry with failure result
    if (auditId !== 'unknown') {
      await updateAuditEntry(auditId, 'FAILURE', beforeState, undefined, error.message)
    }
    throw error
  }
}

/**
 * Log a dry-run operation
 */
export async function auditDryRun(
  context: AuditContext,
  simulatedResult: any
): Promise<void> {
  const dryContext = { ...context, dryRun: true }
  const auditId = await logAuditEntry(dryContext)
  await updateAuditEntry(auditId, 'SUCCESS', undefined, simulatedResult)
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
