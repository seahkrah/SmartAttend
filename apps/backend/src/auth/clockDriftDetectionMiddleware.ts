import { Request, Response, NextFunction } from 'express'
import {
  getServerTime,
  calculateClockDrift,
  classifyDriftSeverity,
  logClockDrift,
  shouldBlockAttendanceAction,
  flagAttendanceForDrift,
  extractClientTimestamp,
  ClockDriftContext
} from '../services/timeAuthorityService.js'
import crypto from 'crypto'

/**
 * Clock Drift Detection Middleware (PHASE 2, STEP 2.2)
 * 
 * Detects clock drift on every request
 * - Extracts client time if provided
 * - Calculates drift against server time
 * - Logs drift to database
 * - Attaches drift context to request for downstream use
 */

/**
 * Middleware to detect and log clock drift
 * Attaches drift context to request.user.clockDriftContext
 */
export function clockDriftDetectionMiddleware() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const serverTime = getServerTime()
      const clientTime = extractClientTimestamp(req)
      
      // Store server time on request for consistency
      if (!req.user) {
        req.user = { userId: '', platformId: '', roleId: '' }
      }
      ;(req.user as any).serverTimestamp = serverTime

      // If no client time provided, skip drift detection
      if (!clientTime) {
        ;(req.user as any).clockDriftContext = {
          detected: false,
          reason: 'no_client_time'
        }
        return next()
      }

      // Calculate drift
      const driftSeconds = calculateClockDrift(clientTime, serverTime)
      const severity = classifyDriftSeverity(driftSeconds)

      // Create drift context
      const requestId = req.get('X-Request-ID') || crypto.randomUUID()
      const driftContext: ClockDriftContext = {
        requestId,
        userId: (req.user as any)?.id || 'unknown',
        tenantId: (req.user as any)?.tenantId,
        clientTimestamp: clientTime,
        serverTimestamp: serverTime,
        driftSeconds,
        severity,
        actionType: req.method + ' ' + req.path
      }

      // Attach to request
      ;(req.user as any).clockDriftContext = {
        detected: true,
        driftSeconds,
        severity,
        context: driftContext
      }

      // Log drift asynchronously (don't block request)
      logClockDrift(driftContext).catch(err =>
        console.error('[CLOCK_DRIFT] Async logging failed:', err)
      )

      next()
    } catch (error) {
      console.error('[CLOCK_DRIFT_MIDDLEWARE] Error:', error)
      // Don't fail request due to drift detection error
      next()
    }
  }
}

/**
 * Middleware to validate attendance actions against clock drift
 * Blocks or flags operations that exceed drift thresholds
 */
export function attendanceClockDriftValidationMiddleware() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Skip non-attendance routes
      if (!req.path.includes('/attendance') || !['POST', 'PUT', 'PATCH'].includes(req.method)) {
        return next()
      }

      const driftContext = (req.user as any)?.clockDriftContext

      // Skip if drift not detected
      if (!driftContext?.detected) {
        return next()
      }

      const { driftSeconds } = driftContext
      const actionType = req.method + ' ' + req.path

      // Check if action should be blocked
      const validation = shouldBlockAttendanceAction(driftSeconds, actionType)

      if (validation.shouldBlock) {
        console.warn(
          `[ATTENDANCE_DRIFT_BLOCK] Blocking action: ${actionType}, Drift: ${driftSeconds}s, User: ${(req.user as any)?.id}`
        )

        res.status(409).json({
          error: 'CLOCK_DRIFT_VIOLATION',
          message: validation.reason,
          severity: validation.severity,
          drift: driftSeconds,
          serverTime: driftContext.context?.serverTimestamp,
          clientTime: driftContext.context?.clientTimestamp,
          action: 'Please synchronize your device clock and retry'
        })
        return
      }

      // If drift is warning level or higher, prepare to flag attendance if it's created/modified
      if (driftContext.context && (validation.severity === 'WARNING' || validation.severity === 'CRITICAL')) {
        ;(req.user as any).shouldFlagAttendanceForDrift = true
        ;(req.user as any).driftContext = driftContext.context
      }

      next()
    } catch (error) {
      console.error('[ATTENDANCE_DRIFT_VALIDATION] Error:', error)
      next()
    }
  }
}

/**
 * Middleware to attach clock drift context to audit logs
 */
export function auditClockDriftContextMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    const driftContext = (req.user as any)?.clockDriftContext

    if (driftContext?.detected) {
      // Attach drift info to audit context
      ;(req.user as any).auditContext = {
        ...(req.user as any).auditContext,
        clockDriftDetected: true,
        driftSeconds: driftContext.driftSeconds,
        driftSeverity: driftContext.severity
      }
    }

    next()
  }
}

/**
 * Middleware to handle post-attendance-creation flagging
 * Should be used AFTER attendance is created/modified
 */
export function flagDriftAffectedAttendanceMiddleware() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Only handle POST/PUT responses that created/modified attendance
      if (req.method !== 'POST' && req.method !== 'PUT') {
        return next()
      }

      if (!req.path.includes('/attendance')) {
        return next()
      }

      // Check if we should flag for drift
      const shouldFlag = (req.user as any)?.shouldFlagAttendanceForDrift
      if (!shouldFlag) {
        return next()
      }

      // Try to get attendance ID from response or request
      let attendanceId: string | null = null

      // Check if response has data (added by controller)
      if (res.locals?.attendanceId) {
        attendanceId = res.locals.attendanceId
      } else if ((req.body as any)?.id) {
        attendanceId = (req.body as any).id
      }

      if (attendanceId && (req.user as any).driftContext) {
        await flagAttendanceForDrift(attendanceId, (req.user as any).driftContext)
      }

      next()
    } catch (error) {
      console.error('[FLAG_DRIFT_ATTENDANCE] Error:', error)
      // Don't fail request due to flagging error
      next()
    }
  }
}

/**
 * Middleware to warn about clock drift (but allow operation)
 * Used for informational endpoints
 */
export function clockDriftWarningMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    const driftContext = (req.user as any)?.clockDriftContext

    if (driftContext?.detected && driftContext.severity !== 'INFO') {
      // Add warning header
      res.set('X-Clock-Drift-Warning', `${driftContext.driftSeconds}s ${driftContext.severity}`)
    }

    next()
  }
}

/**
 * Middleware to strict enforce server time for critical operations
 * Blocks ANY operation if drift exceeds threshold
 */
export function strictClockDriftEnforcementMiddleware(maxDriftSeconds: number = 60) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const driftContext = (req.user as any)?.clockDriftContext

    if (driftContext?.detected) {
      const absDrift = Math.abs(driftContext.driftSeconds)

      if (absDrift > maxDriftSeconds) {
        res.status(409).json({
          error: 'CLOCK_DRIFT_VIOLATION',
          message: `Clock drift exceeds maximum allowed: ${absDrift}s > ${maxDriftSeconds}s`,
          severity: driftContext.severity,
          drift: driftContext.driftSeconds,
          action: 'Please synchronize your device clock'
        })
        return
      }
    }

    next()
  }
}

/**
 * Utility function to add clock drift context to response headers
 * Useful for debugging and client-side drift adjustment
 */
export function attachClockDriftResponseHeaders(req: Request, res: Response): void {
  const driftContext = (req.user as any)?.clockDriftContext
  const serverTime = (req.user as any)?.serverTimestamp

  if (serverTime) {
    res.set('X-Server-Time', serverTime.toISOString())
  }

  if (driftContext?.detected) {
    res.set('X-Clock-Drift', `${driftContext.driftSeconds}s`)
    res.set('X-Clock-Drift-Severity', driftContext.severity)
  }
}
