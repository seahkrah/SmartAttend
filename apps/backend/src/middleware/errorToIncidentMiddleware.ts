/**
 * PHASE 5, STEP 5.1: Error to Incident Middleware
 * Intercepts errors and automatically creates incidents for critical issues
 */

import { Response, NextFunction, RequestHandler, ErrorRequestHandler } from 'express'
import type { ExtendedRequest } from '../types/auth.js'
import { classifyError, shouldCreateIncident } from '../services/errorClassificationService.js'
import { createIncident } from '../services/incidentService.js'

/**
 * Wrap route handler to catch errors and create incidents
 */
export function withIncidentTracking(
  handler: (req: ExtendedRequest, res: Response, next?: NextFunction) => Promise<void>
): any {
  return async (req: any, res: Response, next: NextFunction) => {
    try {
      await handler(req, res, next)
    } catch (error: any) {
      // Extract error details
      const errorCode = error.code || error.errorCode
      const errorMessage = error.message || 'Unknown error'
      const errorType = error.name || error.constructor.name
      const stackTrace = error.stack

      // Classify the error
      const classification = classifyError(errorCode, errorMessage, errorType)

      // Log the error immediately
      console.error('[ERROR]', {
        code: errorCode,
        message: errorMessage,
        type: errorType,
        severity: classification.severity,
        category: classification.category,
        stack: stackTrace,
        userId: (req as any).user?.id,
        path: req.path,
      })

      // Create incident if needed
      if (shouldCreateIncident(classification)) {
        try {
          const platformId = req.platformId || 'unknown'
          const incidentId = await createIncident({
            platformId,
            errorCode,
            errorMessage,
            errorType,
            stackTrace,
            detectedByUserId: (req as any).user?.id,
            detectionMethod: 'automated',
            detectionSource: 'api_handler',
            affectedUsers: 1,
            affectedSystems: [req.path],
            businessImpact: `Error in ${req.method} ${req.path}`,
          })

          // Add incident ID to response
          res.locals.incidentId = incidentId
        } catch (incidentError) {
          console.error('[INCIDENT_CREATE_ERROR]', incidentError)
        }
      }

      // Pass error to Express error handler
      next(error)
    }
  }
}

/**
 * Global error handler middleware
 * Ensures no errors die silently
 */
export const errorToIncidentHandler: any = (
  err: any,
  req: any,
  res: Response,
  next: NextFunction
) => {
  // Extract error details
  const errorCode = err.code || err.errorCode || 'INTERNAL_ERROR'
  const errorMessage = err.message || 'Internal server error'
  const errorType = err.name || 'Error'
  const stackTrace = err.stack

  // Classify the error
  const classification = classifyError(errorCode, errorMessage, errorType)

  // IMPORTANT: Never let errors be silent - always log
  console.error('[UNHANDLED_ERROR]', {
    code: errorCode,
    message: errorMessage,
    type: errorType,
    severity: classification.severity,
    category: classification.category,
    stack: stackTrace,
    userId: (req as any).user?.id,
    path: req.path,
    method: req.method,
    timestamp: new Date().toISOString(),
  })

  // Attempt to create incident for critical errors
  if (shouldCreateIncident(classification)) {
    createIncident({
      platformId: req.platformId || 'unknown',
      errorCode,
      errorMessage,
      errorType,
      stackTrace,
      detectedByUserId: (req as any).user?.id,
      detectionMethod: 'automated',
      detectionSource: 'global_error_handler',
      affectedUsers: 1,
      affectedSystems: [`${req.method} ${req.path}`],
      businessImpact: `Unhandled ${classification.category} error`,
    }).catch((incidentError) => {
      console.error('[INCIDENT_CREATE_FAILED]', incidentError)
    })
  }

  // Determine status code
  let statusCode = err.statusCode || 500
  if (classification.severity === 'critical') {
    statusCode = 500
  } else if (classification.category === 'user') {
    statusCode = 400
  }

  // Send error response
  res.status(statusCode).json({
    success: false,
    error: {
      code: errorCode,
      message: errorMessage,
      severity: classification.severity,
      category: classification.category,
      incidentId: res.locals?.incidentId,
      timestamp: new Date().toISOString(),
    },
  })
}

/**
 * Database error interceptor
 * Wraps database queries to catch and track errors
 */
export function withDatabaseErrorTracking(
  handler: (req: ExtendedRequest, res: Response, next?: NextFunction) => Promise<void>
): any {
  return async (req: any, res: Response, next: NextFunction) => {
    try {
      await handler(req, res, next)
    } catch (error: any) {
      // Check if it's a database error
      if (error.code || error.severity === 'ERROR') {
        const errorCode = `DB_${error.code || 'QUERY_ERROR'}`
        const errorMessage = error.message || 'Database query failed'

        console.error('[DATABASE_ERROR]', {
          code: errorCode,
          message: errorMessage,
          severity: error.severity,
          detail: error.detail,
          hint: error.hint,
          userId: (req as any).user?.id,
          path: req.path,
        })

        // Create incident for database errors
        const classification = classifyError(errorCode, errorMessage, 'DatabaseError')
        if (shouldCreateIncident(classification)) {
          try {
            const platformId = req.platformId || 'unknown'
            const incidentId = await createIncident({
              platformId,
              errorCode,
              errorMessage: `Database error: ${errorMessage}`,
              errorType: 'DatabaseError',
              stackTrace: error.stack,
              detectedByUserId: (req as any).user?.id,
              detectionMethod: 'automated',
              detectionSource: 'database_query',
              affectedUsers: 0,
              affectedSystems: ['database'],
              businessImpact: 'Database operation failed',
            })

            res.locals.incidentId = incidentId
          } catch (incidentError) {
            console.error('[INCIDENT_CREATE_ERROR]', incidentError)
          }
        }
      }

      // Pass to next error handler
      next(error)
    }
  }
}

/**
 * Uncaught exception handler
 * Handles errors that escape all middleware
 */
export function setupUncaughtHandlers() {
  // Handle uncaught exceptions
  process.on('uncaughtException', (error: any) => {
    console.error('[UNCAUGHT_EXCEPTION]', {
      message: error.message,
      type: error.name,
      stack: error.stack,
      timestamp: new Date().toISOString(),
    })

    // Try to create incident in database (may fail if DB is down)
    const classification = classifyError(
      undefined,
      error.message,
      error.name
    )

    if (shouldCreateIncident(classification)) {
      console.log('[INCIDENT] Would create incident for uncaught exception')
      // Note: Can't easily access platformId here, would need to implement differently
      // For now, just ensure error is logged
    }

    // Exit process after logging
    process.exit(1)
  })

  // Handle unhandled promise rejections
  process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
    console.error('[UNHANDLED_REJECTION]', {
      reason,
      promise,
      timestamp: new Date().toISOString(),
    })

    // Try to create incident
    const errorMessage = reason?.message || String(reason)
    const classification = classifyError(
      undefined,
      errorMessage,
      reason?.name || 'UnhandledPromiseRejection'
    )

    if (shouldCreateIncident(classification)) {
      console.log('[INCIDENT] Would create incident for unhandled rejection')
    }
  })
}
