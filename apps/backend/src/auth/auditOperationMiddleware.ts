import { Request, Response, NextFunction } from 'express'
import { logAudit } from '../services/domainAuditService.js'

/**
 * Audit Middleware (PHASE 2, STEP 2.1)
 * Automatically captures and logs domain operations
 * 
 * Attached to routes to capture:
 * - beforeState: Current state before operation
 * - afterState: Final state after operation
 * - Action metadata: type, scope, justification
 */

/**
 * Audit middleware for POST/PUT/PATCH/DELETE operations
 * Captures before/after state and operation context
 */
export function auditOperationMiddleware(
  actionType: string,
  actionScope: 'GLOBAL' | 'TENANT' | 'USER' = 'USER',
  resourceTypeExtractor?: (req: Request) => string
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Only audit write operations
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      return next()
    }

    const auditId = (req as any).auditId || generateRequestId()
    ;(req as any).auditId = auditId

    try {
      // Capture before state if available (query before operation)
      let beforeState: any = null
      if (req.method === 'PUT' || req.method === 'PATCH' || req.method === 'DELETE') {
        // Store request for after-operation comparison
        beforeState = (req as any).resourceBeforeState || null
      }

      // Intercept response to capture afterState
      let responseBody: any = null
      let statusCode = 200

      // Store original json method
      const originalJson = res.json.bind(res)

      // Override json method to capture response
      res.json = function (data: any) {
        responseBody = data
        statusCode = res.statusCode
        return originalJson(data)
      }

      // Store status code
      const originalStatus = res.status.bind(res)
      res.status = function (code: number) {
        statusCode = code
        return originalStatus(code)
      }

      // Hook res.on('finish') to log after response
      res.on('finish', async () => {
        try {
          // Only log successful operations (2xx status)
          if (statusCode >= 200 && statusCode < 300 && responseBody) {
            const resourceType = resourceTypeExtractor ? resourceTypeExtractor(req) : 'unknown'
            const resourceId = (req as any).resourceId || (req.params?.id || req.body?.id)

            await logAudit({
              actorId: (req as any).user?.userId || 'unknown',
              actorRole: (req as any).user?.role || undefined,
              actionType,
              actionScope,
              resourceType,
              resourceId: resourceId ? String(resourceId) : undefined,
              beforeState,
              afterState: responseBody,
              justification: (req.body as any)?.justification || (req.body as any)?.reason,
              requestId: auditId,
              ipAddress: req.ip || 'unknown',
              userAgent: req.get('user-agent')
            })
          }
        } catch (error) {
          console.error('[AUDIT_MIDDLEWARE] Failed to log audit:', error)
          // Don't fail the request if audit logging fails
        }
      })

      next()
    } catch (error) {
      console.error('[AUDIT_MIDDLEWARE] Middleware error:', error)
      next()
    }
  }
}

/**
 * Query-specific audit middleware
 * For read operations that still need to be logged (e.g., sensitive data access)
 */
export function auditReadMiddleware(
  actionType: string = 'READ',
  actionScope: 'GLOBAL' | 'TENANT' | 'USER' = 'USER'
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Only audit GET operations (optional, can be selective)
    if (req.method !== 'GET') {
      return next()
    }

    const auditId = (req as any).auditId || generateRequestId()
    ;(req as any).auditId = auditId

    try {
      // Capture after response is sent
      res.on('finish', async () => {
        try {
          await logAudit({
            actorId: (req as any).user?.userId || 'unknown',
            actorRole: (req as any).user?.role || undefined,
            actionType,
            actionScope,
            resourceType: 'query_result',
            justification: 'Audit log query or sensitive data access',
            requestId: auditId,
            ipAddress: req.ip || 'unknown',
            userAgent: req.get('user-agent')
          })
        } catch (error) {
          console.error('[AUDIT_READ_MIDDLEWARE] Failed to log read audit:', error)
        }
      })

      next()
    } catch (error) {
      console.error('[AUDIT_READ_MIDDLEWARE] Middleware error:', error)
      next()
    }
  }
}

/**
 * Generate a unique request ID for correlation
 */
function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substring(7)}`
}

/**
 * Middleware to extract and store before-state for comparison
 * Attach BEFORE the main handler for PUT/PATCH/DELETE
 */
export function captureBeforeStateMiddleware(
  resourceFetcher: (req: Request) => Promise<any>
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!['PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      return next()
    }

    try {
      const beforeState = await resourceFetcher(req)
      ;(req as any).resourceBeforeState = beforeState
    } catch (error) {
      console.warn('[AUDIT_MIDDLEWARE] Failed to capture before-state:', error)
      // Continue anyway, beforeState will be null
    }

    next()
  }
}

/**
 * Middleware to audit bulk operations
 * For operations affecting multiple resources
 */
export function auditBulkOperationMiddleware(
  actionType: string,
  actionScope: 'GLOBAL' | 'TENANT' | 'USER' = 'USER'
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      return next()
    }

    const auditId = (req as any).auditId || generateRequestId()
    ;(req as any).auditId = auditId

    try {
      res.on('finish', async () => {
        try {
          const resourceIds = (req.body as any)?.resourceIds || (req.body as any)?.ids || []

          await logAudit({
            actorId: (req as any).user?.userId || 'unknown',
            actorRole: (req as any).user?.role || undefined,
            actionType: `${actionType}_BULK`,
            actionScope,
            resourceType: 'bulk_operation',
            afterState: {
              affectedResourceIds: resourceIds,
              operationCount: resourceIds.length,
              timestamp: new Date().toISOString()
            },
            justification: (req.body as any)?.justification || `Bulk ${actionType}`,
            requestId: auditId,
            ipAddress: req.ip || 'unknown',
            userAgent: req.get('user-agent')
          })
        } catch (error) {
          console.error('[AUDIT_BULK_MIDDLEWARE] Failed to log bulk audit:', error)
        }
      })

      next()
    } catch (error) {
      console.error('[AUDIT_BULK_MIDDLEWARE] Middleware error:', error)
      next()
    }
  }
}
