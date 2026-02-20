import { Request, Response, NextFunction } from 'express'
import {
  getServerTime,
  calculateClockDrift,
  classifyDriftSeverity,
  extractClientTimestamp,
  validateTimeAuthority,
  TimeAuthorityContext,
  DriftCalculation
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
      // NOTE: Do NOT create a fake req.user here — it breaks tenant enforcement.
      // Store clock drift data on req directly instead.
      ;(req as any)._serverTimestamp = serverTime
      if (req.user) {
        ;(req.user as any).serverTimestamp = serverTime
      }

      // If no client time provided, skip drift detection
      if (!clientTime) {
        ;(req as any)._clockDriftContext = {
          detected: false,
          reason: 'no_client_time'
        }
        if (req.user) {
          ;(req.user as any).clockDriftContext = (req as any)._clockDriftContext
        }
        return next()
      }

      // Calculate drift
      const driftSeconds = calculateClockDrift(clientTime, serverTime)
      const severity = classifyDriftSeverity(driftSeconds)

      // Create drift context
      const requestId = req.get('X-Request-ID') || crypto.randomUUID()
      const driftContext: TimeAuthorityContext = {
        requestId,
        clientTime,
        serverTime,
        deviceInfo: {
          device_id: req.get('X-Device-ID') || req.ip || 'unknown',
          platform: req.get('X-Platform') || 'WEB_BROWSER'
        },
        userId: (req.user as any)?.id,
        actionType: `${req.method} ${req.path}`
      }

      // Attach to request — store on req directly so it's available even before authenticateToken
      ;(req as any)._clockDriftContext = {
        detected: true,
        driftSeconds,
        severity,
        context: driftContext
      }
      if (req.user) {
        ;(req.user as any).clockDriftContext = (req as any)._clockDriftContext
      }

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

      const driftContext = (req as any)._clockDriftContext || (req.user as any)?.clockDriftContext

      // Skip if drift not detected
      if (!driftContext?.detected) {
        return next()
      }

      const { driftSeconds, severity } = driftContext
      const actionType = req.method + ' ' + req.path

      // Block if drift is critical (> 5 minutes)
      if (severity === 'CRITICAL') {
        console.warn(
          `[ATTENDANCE_DRIFT_BLOCK] Blocking action: ${actionType}, Drift: ${driftSeconds}s, User: ${(req.user as any)?.id}`
        )

        res.status(409).json({
          error: 'CLOCK_DRIFT_VIOLATION',
          message: 'Device clock drift too large. Please synchronize your device clock and retry.',
          severity: 'CRITICAL',
          drift: driftSeconds,
          serverTime: driftContext.context?.serverTime,
          clientTime: driftContext.context?.clientTime,
          action: 'Please synchronize your device clock and retry'
        })
        return
      }

      // If drift is warning level, flag for audit
      if (severity === 'WARNING') {
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
    const driftContext = (req as any)._clockDriftContext || (req.user as any)?.clockDriftContext

    if (driftContext?.detected && req.user) {
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
        console.log(`[DRIFT_FLAGGED_ATTENDANCE] Flagged attendance ${attendanceId} due to clock drift`)
        // TODO: Store flag in database with attendance record
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
    const driftContext = (req as any)._clockDriftContext || (req.user as any)?.clockDriftContext

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
    const driftContext = (req as any)._clockDriftContext || (req.user as any)?.clockDriftContext

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
  const driftContext = (req as any)._clockDriftContext || (req.user as any)?.clockDriftContext
  const serverTime = (req as any)._serverTimestamp || (req.user as any)?.serverTimestamp

  if (serverTime) {
    res.set('X-Server-Time', serverTime.toISOString())
  }

  if (driftContext?.detected) {
    res.set('X-Clock-Drift', `${driftContext.driftSeconds}s`)
    res.set('X-Clock-Drift-Severity', driftContext.severity)
  }
}
