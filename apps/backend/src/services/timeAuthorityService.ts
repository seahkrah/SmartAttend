import { query } from '../db/connection.js'
import { Request } from 'express'

/**
 * Time Authority Service (PHASE 2, STEP 2.2)
 * Enforces server-side time as the single source of truth
 * 
 * Key Features:
 * - Centralized server time (uses server clock)
 * - Client time treated as advisory only
 * - Clock drift detection per request
 * - Drift logging and severity classification
 * - Attendance action validation based on drift
 */

export interface ClockDriftContext {
  requestId: string
  userId: string
  tenantId?: string
  clientTimestamp: Date
  serverTimestamp: Date
  driftSeconds: number
  severity: 'INFO' | 'WARNING' | 'CRITICAL'
  actionType?: string
  actionId?: string
}

/**
 * Get current server time (single source of truth)
 * This is the authoritative time for all operations
 */
export function getServerTime(): Date {
  return new Date()
}

/**
 * Get server time as ISO string
 */
export function getServerTimeISO(): string {
  return getServerTime().toISOString()
}

/**
 * Get server time as Unix timestamp (milliseconds)
 */
export function getServerTimeMS(): number {
  return getServerTime().getTime()
}

/**
 * Calculate clock drift between client and server
 * 
 * @param clientTimestamp - Client-provided timestamp
 * @param serverTimestamp - Server timestamp (default: now)
 * @returns - Drift in seconds (positive = client ahead, negative = client behind)
 */
export function calculateClockDrift(
  clientTimestamp: Date,
  serverTimestamp?: Date
): number {
  const server = serverTimestamp || getServerTime()
  const clientMs = clientTimestamp.getTime()
  const serverMs = server.getTime()
  const driftMs = clientMs - serverMs
  return Math.round(driftMs / 1000)
}

/**
 * Classify drift severity
 */
export function classifyDriftSeverity(driftSeconds: number): 'INFO' | 'WARNING' | 'CRITICAL' {
  const absDrift = Math.abs(driftSeconds)
  
  if (absDrift <= 5) {
    return 'INFO'        // ±5 seconds: normal variation
  } else if (absDrift <= 60) {
    return 'WARNING'     // ±1 minute: possible clock skew
  } else {
    return 'CRITICAL'    // >±1 minute: significant drift
  }
}

/**
 * Detect and log clock drift
 * 
 * @param context - Clock drift context
 * @returns - Logged drift record ID
 */
export async function logClockDrift(context: ClockDriftContext): Promise<string> {
  try {
    const result = await query(
      `INSERT INTO clock_drift_log 
       (tenant_id, user_id, client_timestamp, server_timestamp, drift_seconds, severity, 
        attendance_affected, request_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        context.tenantId || null,
        context.userId,
        context.clientTimestamp,
        context.serverTimestamp,
        context.driftSeconds,
        context.severity,
        context.actionType?.includes('attendance') || false,
        context.requestId
      ]
    )

    console.log(`[TIME_AUTHORITY] Clock drift logged: ${context.severity} (${context.driftSeconds}s) for user ${context.userId}`)
    return result.rows[0].id
  } catch (error) {
    console.error('[TIME_AUTHORITY] Failed to log clock drift:', error)
    throw error
  }
}

/**
 * Get recent clock drift for user
 * 
 * @param userId - User ID
 * @param limit - Max records to return
 * @returns - Array of drift records
 */
export async function getUserClockDriftHistory(
  userId: string,
  limit: number = 50
): Promise<any[]> {
  try {
    const result = await query(
      `SELECT * FROM clock_drift_log 
       WHERE user_id = $1 
       ORDER BY timestamp DESC 
       LIMIT $2`,
      [userId, limit]
    )
    return result.rows
  } catch (error) {
    console.error('[TIME_AUTHORITY] Failed to get drift history:', error)
    throw error
  }
}

/**
 * Get clock drift statistics for tenant
 * 
 * @param tenantId - Tenant ID
 * @returns - Drift statistics
 */
export async function getTenantClockDriftStats(tenantId: string): Promise<any> {
  try {
    // Overall stats
    const statsResult = await query(
      `SELECT 
        COUNT(*) as total_drift_events,
        COUNT(CASE WHEN severity = 'CRITICAL' THEN 1 END) as critical_count,
        COUNT(CASE WHEN severity = 'WARNING' THEN 1 END) as warning_count,
        COUNT(CASE WHEN severity = 'INFO' THEN 1 END) as info_count,
        AVG(ABS(drift_seconds)) as avg_drift_seconds,
        MAX(ABS(drift_seconds)) as max_drift_seconds
       FROM clock_drift_log 
       WHERE tenant_id = $1`,
      [tenantId]
    )

    // By user
    const byUserResult = await query(
      `SELECT 
        user_id,
        COUNT(*) as drift_count,
        COUNT(CASE WHEN severity = 'CRITICAL' THEN 1 END) as critical_count,
        AVG(ABS(drift_seconds)) as avg_drift
       FROM clock_drift_log 
       WHERE tenant_id = $1 
       GROUP BY user_id 
       ORDER BY critical_count DESC, drift_count DESC 
       LIMIT 10`,
      [tenantId]
    )

    return {
      overall: statsResult.rows[0],
      topDrifters: byUserResult.rows
    }
  } catch (error) {
    console.error('[TIME_AUTHORITY] Failed to get drift stats:', error)
    throw error
  }
}

/**
 * Check if clock drift exceeds thresholds for attendance
 * Returns whether action should be blocked
 * 
 * @param driftSeconds - Drift in seconds
 * @param actionType - Type of action (e.g., 'attendance_checkin')
 * @returns - Object with block flag and reason
 */
export function shouldBlockAttendanceAction(
  driftSeconds: number,
  actionType?: string
): { shouldBlock: boolean; reason?: string; severity: 'INFO' | 'WARNING' | 'CRITICAL' } {
  const absDrift = Math.abs(driftSeconds)
  const severity = classifyDriftSeverity(driftSeconds)

  // Policy: Block if drift > 5 minutes for attendance actions
  const ATTENDANCE_DRIFT_THRESHOLD_SECONDS = 300 // 5 minutes

  if (absDrift > ATTENDANCE_DRIFT_THRESHOLD_SECONDS && actionType?.includes('attendance')) {
    return {
      shouldBlock: true,
      reason: `Clock drift exceeds threshold: ${absDrift}s (max ${ATTENDANCE_DRIFT_THRESHOLD_SECONDS}s)`,
      severity
    }
  }

  return {
    shouldBlock: false,
    severity
  }
}

/**
 * Flag attendance record as affected by drift
 * 
 * @param attendanceRecordId - Attendance record ID
 * @param driftContext - Clock drift context
 */
export async function flagAttendanceForDrift(
  attendanceRecordId: string,
  driftContext: ClockDriftContext
): Promise<void> {
  try {
    // Create integrity flag for manual review
    await query(
      `INSERT INTO attendance_integrity_flags 
       (tenant_id, attendance_record_id, flag_type, severity, flagged_by_superadmin_id, flag_reason)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        driftContext.tenantId,
        attendanceRecordId,
        'CLOCK_DRIFT_VIOLATION',
        driftContext.severity === 'CRITICAL' ? 'HIGH' : 'MEDIUM',
        null, // System-flagged, not by superadmin
        `Clock drift detected: ${driftContext.driftSeconds}s (server: ${driftContext.serverTimestamp.toISOString()}, client: ${driftContext.clientTimestamp.toISOString()})`
      ]
    )

    console.log(`[TIME_AUTHORITY] Attendance flagged for drift: ${attendanceRecordId}`)
  } catch (error) {
    console.error('[TIME_AUTHORITY] Failed to flag attendance:', error)
    throw error
  }
}

/**
 * Get critical drift events (requires investigation)
 * 
 * @param limit - Max results
 * @returns - Array of critical events
 */
export async function getCriticalDriftEvents(limit: number = 100): Promise<any[]> {
  try {
    const result = await query(
      `SELECT * FROM clock_drift_log 
       WHERE severity = 'CRITICAL' AND attendance_affected = true
       ORDER BY timestamp DESC 
       LIMIT $1`,
      [limit]
    )
    return result.rows
  } catch (error) {
    console.error('[TIME_AUTHORITY] Failed to get critical events:', error)
    throw error
  }
}

/**
 * Validate client time against server time
 * Returns validation result
 * 
 * @param clientTimestamp - Client-provided timestamp
 * @param maxAcceptableDrift - Max acceptable drift in seconds (default 300 = 5 min)
 * @returns - Validation result
 */
export function validateClientTime(
  clientTimestamp: Date,
  maxAcceptableDrift: number = 300
): {
  isValid: boolean
  drift: number
  severity: 'INFO' | 'WARNING' | 'CRITICAL'
  message: string
} {
  const serverTime = getServerTime()
  const drift = calculateClockDrift(clientTimestamp, serverTime)
  const severity = classifyDriftSeverity(drift)
  const absDrift = Math.abs(drift)

  if (absDrift > maxAcceptableDrift) {
    return {
      isValid: false,
      drift,
      severity,
      message: `Client time differs from server by ${absDrift}s (max allowed: ${maxAcceptableDrift}s)`
    }
  }

  return {
    isValid: true,
    drift,
    severity,
    message: `Client time valid (drift: ${drift}s)`
  }
}

/**
 * Extract client timestamp from request
 * Tries multiple header/body locations
 * 
 * @param req - Express request
 * @returns - Client timestamp or null
 */
export function extractClientTimestamp(req: Request): Date | null {
  // Try custom header
  const headerTime = req.get('X-Client-Timestamp')
  if (headerTime) {
    try {
      return new Date(headerTime)
    } catch (e) {
      console.warn('[TIME_AUTHORITY] Invalid timestamp in header:', headerTime)
    }
  }

  // Try request body
  const bodyTime = (req.body as any)?.clientTimestamp || (req.body as any)?.timestamp
  if (bodyTime) {
    try {
      return new Date(bodyTime)
    } catch (e) {
      console.warn('[TIME_AUTHORITY] Invalid timestamp in body:', bodyTime)
    }
  }

  return null
}

/**
 * Format drift for display
 * 
 * @param driftSeconds - Drift in seconds
 * @returns - Formatted string
 */
export function formatDrift(driftSeconds: number): string {
  const absDrift = Math.abs(driftSeconds)
  const direction = driftSeconds > 0 ? 'ahead' : 'behind'

  if (absDrift < 60) {
    return `${absDrift}s ${direction}`
  } else if (absDrift < 3600) {
    const minutes = Math.round(absDrift / 60)
    return `${minutes}m ${direction}`
  } else {
    const hours = Math.round(absDrift / 3600)
    return `${hours}h ${direction}`
  }
}
