/**
 * ===========================
 * TIME AUTHORITY MIDDLEWARE
 * ===========================
 * 
 * Express middleware for enforcing time authority in attendance operations.
 * Validates client time, logs drift, and enforces thresholds.
 */

import { Request, Response, NextFunction } from 'express'
import { extractClientTimestamp, validateTimeAuthority } from '../services/timeAuthorityService'
import { v4 as uuidv4 } from 'uuid'

/**
 * Middleware to extract and validate client time
 * Attaches drift info to request object for downstream handlers
 */
export async function timeAuthorityMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    // Extract client timestamp
    const clientTime = extractClientTimestamp(req)
    if (!clientTime) {
      // No client time provided - use server time
      (req as any).timeAuthority = {
        clientTime: new Date(),
        serverTime: new Date(),
        drift: {
          driftMS: 0,
          driftSeconds: 0,
          direction: 'AHEAD',
          category: 'ACCEPTABLE',
          actionTaken: 'PROCEED_SILENT',
          isAccepted: true,
        },
        shouldProceed: true,
        logId: null,
        message: 'No client time provided (using server time)',
      }
      return next()
    }

    // Generate request ID for tracking
    const requestId = req.get('X-Request-ID') || uuidv4()

    // Extract device info from headers or body
    const deviceInfo = {
      device_id: req.get('X-Device-ID') || 'unknown',
      device_model: req.get('X-Device-Model'),
      app_version: req.get('X-App-Version'),
      os_version: req.get('X-OS-Version'),
      platform: req.get('X-Platform') || 'WEB_BROWSER',
    }

    // Get user ID from auth context (set by auth middleware)
    const userId = (req as any).userId

    // Determine action type from request
    const actionType = `${req.method} ${req.path}`.substring(0, 100)

    // Extract location if provided
    let location
    const latStr = req.get('X-Latitude')
    const lngStr = req.get('X-Longitude')
    if (latStr && lngStr) {
      location = {
        lat: parseFloat(latStr),
        lng: parseFloat(lngStr),
      }
    }

    // Validate time authority
    const timeAuthResult = await validateTimeAuthority({
      clientTime,
      serverTime: new Date(),
      deviceInfo,
      userId,
      actionType,
      location,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
      networkType: req.get('X-Network-Type'),
      requestId,
    })

    // Attach to request for downstream handlers
    (req as any).timeAuthority = timeAuthResult

    // If critical drift, log warning but allow to proceed (decision is per-endpoint)
    if (timeAuthResult.drift.category === 'CRITICAL') {
      console.warn(
        `[TIME_AUTHORITY] Critical drift detected: ${timeAuthResult.drift.driftSeconds}s for user ${userId}`
      )
    }

    next()
  } catch (error) {
    console.error('[TIME_AUTHORITY] Middleware error:', error)
    // Continue anyway - time authority shouldn't break requests
    (req as any).timeAuthority = {
      error: true,
      message: 'Time authority validation failed',
      shouldProceed: true, // Default to proceed
    }
    next()
  }
}

/**
 * Middleware to enforce time authority for attendance actions
 * Blocks if drift exceeds threshold
 */
export function enforceTimeAuthority(req: Request, res: Response, next: NextFunction) {
  const timeAuthority = (req as any).timeAuthority

  if (!timeAuthority) {
    return res.status(500).json({
      error: 'TIME_AUTHORITY_ERROR',
      message: 'Time authority validation not performed',
    })
  }

  if (timeAuthority.error) {
    return res.status(500).json({
      error: 'TIME_AUTHORITY_ERROR',
      message: timeAuthority.message,
    })
  }

  // If drift is BLOCKED or CRITICAL, reject
  if (timeAuthority.drift.category === 'BLOCKED' || timeAuthority.drift.category === 'CRITICAL') {
    return res.status(400).json({
      error: 'CLOCK_DRIFT_BLOCKED',
      message: timeAuthority.message || 'Your device clock is too far off. Please sync and try again.',
      drift: {
        seconds: timeAuthority.drift.driftSeconds,
        direction: timeAuthority.drift.direction,
        category: timeAuthority.drift.category,
      },
      incidentId: timeAuthority.incidentId,
    })
  }

  // Otherwise proceed (even if WARNING category)
  next()
}

/**
 * Middleware to log time authority to response
 */
export function attachTimeAuthorityToResponse(req: Request, res: Response, next: NextFunction) {
  const original_json = res.json

  res.json = function(data: any) {
    const timeAuthority = (req as any).timeAuthority

    if (timeAuthority && !timeAuthority.error) {
      // Attach drift info to response for client awareness
      if (typeof data === 'object' && data !== null) {
        data._timeAuthority = {
          category: timeAuthority.drift.category,
          driftSeconds: timeAuthority.drift.driftSeconds,
          logId: timeAuthority.logId,
          message: timeAuthority.message,
        }
      }
    }

    // Call original json method
    return original_json.call(this, data)
  }

  next()
}

export default {
  timeAuthorityMiddleware,
  enforceTimeAuthority,
  attachTimeAuthorityToResponse,
}
