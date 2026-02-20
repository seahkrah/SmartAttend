/**
 * PHASE 4, STEP 4.1: TENANT ENFORCEMENT MIDDLEWARE
 * 
 * Express middleware that enforces tenant boundaries on every request
 * Resolves tenant context and makes it available to route handlers
 * Prevents any request from operating outside tenant boundaries
 */

import { Request, Response, NextFunction } from 'express'
import { createTenantContext, validateTenantId } from '../types/tenantContext.js'
import type { TenantAwareRequest, TenantContext } from '../types/tenantContext.js'

/**
 * Main tenant enforcement middleware
 * Must be applied to all routes that require tenant isolation
 * 
 * Usage:
 *   app.use(enforceTenanantBoundaries)
 *   // or
 *   router.use(enforceTenantBoundaries)
 */
export function enforceTenantBoundaries(
  req: TenantAwareRequest,
  res: Response,
  next: NextFunction
) {
  try {
    // Skip tenant enforcement for public routes that don't require authentication
    const publicPaths = [
      '/api/auth/login',
      '/api/auth/register',
      '/api/auth/forgot-password',
      '/api/auth/reset-password',
      '/api/auth/refresh',
      '/api/health',
      '/api/superadmin/bootstrap',
    ]
    
    if (publicPaths.some(p => req.path === p || req.path.startsWith(p + '/'))) {
      return next()
    }

    // If no user context yet (not authenticated), skip tenant enforcement
    // The authenticateToken middleware on individual routes will handle auth
    // Also skip if req.user exists but has no real identity (e.g., placeholder from clock drift middleware)
    if (!req.user || !req.user.platformId) {
      return next()
    }

    // Resolve tenant context from JWT token
    const result = createTenantContext(req)

    if (!result.success) {
      return res.status(401).json({
        error: 'Tenant boundary violation',
        message: result.error || 'Failed to resolve tenant context'
      })
    }

    // Attach tenant context to request
    req.tenant = result.tenant as TenantContext

    // Log tenant context for audit
    console.log(
      `[TENANT] User ${req.tenant?.userId} in tenant ${req.tenant?.tenantId} - ${req.method} ${req.path}`
    )

    next()
  } catch (error: any) {
    console.error('[TENANT_ERROR] Tenant boundary enforcement failed:', error)
    return res.status(500).json({
      error: 'Tenant context resolution failed',
      message: error.message
    })
  }
}

/**
 * Validate tenant parameter in URL matches authenticated tenant
 * Prevents user from accessing other tenants via URL manipulation
 * 
 * Usage:
 *   router.get('/tenants/:tenantId/users', validateTenantParam, handler)
 */
export function validateTenantParam(
  req: TenantAwareRequest,
  res: Response,
  next: NextFunction
) {
  try {
    if (!req.tenant) {
      return res.status(401).json({ error: 'Tenant context required' })
    }

    const urlTenantId = req.params.tenantId
    
    if (!urlTenantId) {
      // No tenant param in URL - continue
      return next()
    }

    // Validate tenant ID format
    if (!validateTenantId(urlTenantId)) {
      return res.status(400).json({
        error: 'Invalid tenant ID format',
        provided: urlTenantId
      })
    }

    // Prevent cross-tenant access
    if (urlTenantId !== req.tenant.tenantId) {
      console.warn(
        `[SECURITY] User ${req.tenant.userId} attempted to access other tenant: ${urlTenantId}`
      )
      return res.status(403).json({
        error: 'Forbidden',
        message: 'You do not have access to this tenant'
      })
    }

    next()
  } catch (error: any) {
    console.error('[TENANT_PARAM_VALIDATION_ERROR]', error)
    return res.status(500).json({ error: error.message })
  }
}

/**
 * Validate tenant ID in request body
 * Ensures user cannot create/update records for other tenants
 * 
 * Usage:
 *   router.post('/resources', validateTenantBodyParam('platform_id'), handler)
 */
export function validateTenantBodyParam(paramName: string = 'platform_id') {
  return (req: TenantAwareRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.tenant) {
        return res.status(401).json({ error: 'Tenant context required' })
      }

      // Check if body contains tenant param
      const bodyTenantId = req.body[paramName]
      
      if (!bodyTenantId) {
        // Not provided - OK, we'll assign in service layer
        return next()
      }

      // Validate format
      if (!validateTenantId(bodyTenantId)) {
        return res.status(400).json({
          error: 'Invalid tenant ID format in request body',
          parameter: paramName,
          provided: bodyTenantId
        })
      }

      // Prevent cross-tenant writes
      if (bodyTenantId !== req.tenant.tenantId) {
        console.warn(
          `[SECURITY] User ${req.tenant.userId} attempted to create resource in other tenant: ${bodyTenantId}`
        )
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Cannot create resources in other tenants'
        })
      }

      next()
    } catch (error: any) {
      console.error('[TENANT_BODY_VALIDATION_ERROR]', error)
      return res.status(500).json({ error: error.message })
    }
  }
}

/**
 * Validate query parameter tenant filters
 * Ensures WHERE clauses don't leak data from other tenants
 * 
 * Usage:
 *   router.get('/users', validateTenantQueryParam, handler)
 */
export function validateTenantQueryParam(
  req: TenantAwareRequest,
  res: Response,
  next: NextFunction
) {
  try {
    if (!req.tenant) {
      return res.status(401).json({ error: 'Tenant context required' })
    }

    // Check for common tenant parameters in query
    const tenantParams = ['platform_id', 'tenant_id', 'tenantId']
    
    for (const param of tenantParams) {
      const queryValue = req.query[param]
      
      if (queryValue) {
        if (!validateTenantId(queryValue as string)) {
          return res.status(400).json({
            error: 'Invalid tenant ID in query',
            parameter: param
          })
        }

        // Prevent cross-tenant filtering
        if (queryValue !== req.tenant.tenantId) {
          console.warn(
            `[SECURITY] User ${req.tenant.userId} attempted to query other tenant via query param: ${param}`
          )
          return res.status(403).json({
            error: 'Forbidden',
            message: 'Cannot query other tenants'
          })
        }
      }
    }

    next()
  } catch (error: any) {
    console.error('[TENANT_QUERY_VALIDATION_ERROR]', error)
    return res.status(500).json({ error: error.message })
  }
}

/**
 * Verify tenant owns a specific resource
 * Use in route handlers to ensure resource belongs to authenticated tenant
 * 
 * Usage:
 *   const resource = await getStudentById(studentId)
 *   await verifyTenantOwnsResource(req.tenant, resource, 'Student')
 */
export async function verifyTenantOwnsResource(
  tenant: TenantContext | undefined,
  resource: any,
  resourceName: string = 'Resource'
): Promise<void> {
  if (!tenant) {
    throw new Error('Tenant context not found')
  }

  if (!resource) {
    throw new Error(`${resourceName} not found`)
  }

  // Check tenant ownership
  const resourceTenantId = resource.platform_id || resource.tenant_id
  
  if (resourceTenantId !== tenant.tenantId) {
    console.warn(
      `[SECURITY] Tenant boundary violation detected: User ${tenant.userId} attempted to access ${resourceName} owned by tenant ${resourceTenantId}`
    )
    throw new Error(`${resourceName} access denied: tenant boundary violation`)
  }
}

/**
 * Audit trail for tenant access
 * Logs all tenant-scoped operations for security analysis
 */
export function logTenantAccess(
  tenant: TenantContext,
  action: string,
  details: any = {}
) {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      type: 'TENANT_ACCESS',
      tenant_id: tenant.tenantId,
      user_id: tenant.userId,
      action,
      ip: tenant.ip,
      user_agent: tenant.userAgent,
      details
    })
  )
}

/**
 * Error handler for tenant-related operations
 * Converts tenant boundary violations into proper HTTP responses
 */
export function handleTenantError(
  error: any,
  req: TenantAwareRequest,
  res: Response
): boolean {
  // Check if error is tenant boundary related
  if (
    error.message?.includes('tenant boundary') ||
    error.message?.includes('access denied') ||
    error.message?.includes('not found') ||
    error.message?.includes('Tenant')
  ) {
    // Determine status code
    let status = 403
    if (error.message?.includes('not found')) {
      status = 404
    }

    console.warn(
      `[TENANT_VIOLATION] Tenant ${req.tenant?.tenantId} - ${error.message}`
    )

    res.status(status).json({
      error: 'Access denied',
      message: error.message
    })
    return true
  }

  return false
}

/**
 * Middleware to wrap route handlers and catch tenant errors
 * Provides consistent error handling for tenant boundary violations
 * 
 * Usage:
 *   const handler = withTenantErrorHandling(async (req, res) => {
 *     // Route logic
 *   })
 */
export function withTenantErrorHandling(
  handler: (req: TenantAwareRequest, res: Response) => Promise<void>
) {
  return async (req: TenantAwareRequest, res: Response, next: NextFunction) => {
    try {
      await handler(req, res)
    } catch (error: any) {
      if (!handleTenantError(error, req, res)) {
        // Not a tenant error, pass to next handler
        next(error)
      }
    }
  }
}

/**
 * Type guard to check if request has tenant context
 */
export function hasTenantContext(req: TenantAwareRequest): req is TenantAwareRequest & { tenant: TenantContext } {
  return req.tenant !== undefined && req.tenant !== null
}

/**
 * Assert tenant context exists
 * Throw if missing
 */
export function assertTenantContext(req: TenantAwareRequest): TenantContext {
  if (!req.tenant) {
    throw new Error('Tenant context not found - authentication required')
  }
  return req.tenant
}

/**
 * Tenant context info logging
 * Shows current tenant info for debugging
 */
export function getTenantInfo(req: TenantAwareRequest): string {
  if (!req.tenant) {
    return 'NO_TENANT_CONTEXT'
  }

  return `[${req.tenant.tenantId.substring(0, 8)}...] User ${req.tenant.userId.substring(0, 8)}...`
}
