/**
 * ===========================
 * TIME AUTHORITY SERVICE - PHASE 11
 * ===========================
 * 
 * Enforces server time as ground truth for all attendance operations.
 * Calculates, logs, and enforces drift thresholds for forensic tracking.
 * 
 * Core Principle: Server time is the only accepted time. Client time is
 * measured against server time. All deviations are logged immutably.
 * 
 * Key Responsibilities:
 * 1. Calculate drift from client provided time
 * 2. Classify drift into categories (ACCEPTABLE/WARNING/BLOCKED/CRITICAL)
 * 3. Log drift immutably with device/user/context info
 * 4. Enforce thresholds (reject/warn/escalate)
 * 5. Create incidents for violations
 * 6. Track device fingerprints and patterns
 */

import { query } from '../db/connection.js'
import { Request } from 'express'
import crypto from 'crypto'
import { v4 as uuidv4 } from 'uuid'

// ===========================
// TYPES & CONSTANTS
// ===========================

export type DriftCategory = 'ACCEPTABLE' | 'WARNING' | 'BLOCKED' | 'CRITICAL'
export type ActionTaken = 'PROCEED_SILENT' | 'PROCEED_WITH_WARNING' | 'BLOCKED' | 'ESCALATED'
export type DriftDirection = 'AHEAD' | 'BEHIND'
export type DeviceType = 'MOBILE_IOS' | 'MOBILE_ANDROID' | 'WEB_BROWSER' | 'KIOSK_DEVICE'

export interface DriftThreshold {
  device_type: DeviceType
  acceptable_drift_seconds: number
  warning_drift_seconds: number
  blocked_drift_seconds: number
  critical_drift_seconds: number
  should_proceed_on_warning: boolean
  should_block_on_critical: boolean
  should_escalate_on_critical: boolean
}

export interface DriftCalculation {
  driftMS: number
  driftSeconds: number
  direction: DriftDirection
  category: DriftCategory
  actionTaken: ActionTaken
  isAccepted: boolean
  incidentSeverity?: 'WARNING' | 'URGENT' | 'CRITICAL'
}

export interface DeviceInfo {
  device_id: string
  device_model?: string
  app_version?: string
  os_version?: string
  platform?: string
}

export interface TimeAuthorityContext {
  clientTime: Date
  serverTime?: Date
  deviceInfo: DeviceInfo
  userId?: string
  actionType: string
  location?: { lat: number; lng: number }
  ipAddress?: string
  userAgent?: string
  networkType?: string
  requestId?: string
}

// ===========================
// UTILITY FUNCTIONS
// ===========================

/**
 * Get current server time (single source of truth)
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
 * Positive = client ahead, Negative = client behind
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
 * Classify drift severity (old-style for backward compatibility)
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
 * Format drift for display
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

/**
 * Extract client timestamp from request
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
 * Generate SHA-256 checksum for immutability verification
 */
function generateChecksum(data: any): string {
  const json = JSON.stringify(data, Object.keys(data).sort())
  return crypto.createHash('sha256').update(json).hexdigest()
}

/**
 * Validate client time against server time
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

// ===========================
// MAIN SERVICE FUNCTIONS
// ===========================

/**
 * MAIN ENTRY POINT: Validate and enforce time authority
 */
export async function validateTimeAuthority(
  context: TimeAuthorityContext
): Promise<{
  drift: DriftCalculation
  logId: string
  shouldProceed: boolean
  message?: string
  incidentId?: string
}> {
  try {
    const serverTime = context.serverTime || getServerTime()
    const driftMS = (context.clientTime?.getTime?.() || 0) - serverTime.getTime()
    const driftSeconds = driftMS / 1000
    const direction: DriftDirection = driftSeconds > 0 ? 'AHEAD' : 'BEHIND'

    // 1. Classify drift
    const category = classifyDriftCategory(driftSeconds)
    
    // 2. Determine action
    const { actionTaken, isAccepted, incidentSeverity } = determineAction(driftSeconds, category)

    // 3. Detect forensic indicators
    const forensicFlags = detectForensicIndicators(driftSeconds, direction, context)

    // 4. Log drift immutably
    const logId = await logDriftEvent({
      clientTime: context.clientTime,
      serverTime,
      driftMS,
      driftSeconds,
      direction,
      category,
      actionTaken,
      isAccepted,
      deviceInfo: context.deviceInfo,
      userId: context.userId,
      actionType: context.actionType,
      location: context.location,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      networkType: context.networkType,
      requestId: context.requestId,
      forensicFlags
    })

    // 5. Create incident if needed
    let incidentId: string | undefined
    if (category === 'WARNING' || category === 'BLOCKED' || category === 'CRITICAL') {
      incidentId = await createIncident(logId, category, driftSeconds, incidentSeverity)
    }

    // 6. Escalate if critical
    if (category === 'CRITICAL') {
      await escalateToSecurityTeam(logId, incidentId, driftSeconds, context)
    }

    return {
      drift: {
        driftMS,
        driftSeconds,
        direction,
        category,
        actionTaken,
        isAccepted,
        incidentSeverity,
      },
      logId,
      shouldProceed: isAccepted,
      message: generateMessage(category, driftSeconds),
      incidentId,
    }
  } catch (error) {
    console.error('[TIME_AUTHORITY] validateTimeAuthority failed:', error)
    throw error
  }
}

/**
 * Classify drift into category
 */
function classifyDriftCategory(driftSeconds: number): DriftCategory {
  const absDrift = Math.abs(driftSeconds)

  if (absDrift <= 5) return 'ACCEPTABLE'
  if (absDrift <= 300) return 'WARNING'      // ±5 minutes
  if (absDrift <= 600) return 'BLOCKED'      // ±10 minutes
  return 'CRITICAL'                           // >10 minutes
}

/**
 * Determine action based on drift category
 */
function determineAction(
  driftSeconds: number,
  category: DriftCategory
): { actionTaken: ActionTaken; isAccepted: boolean; incidentSeverity?: string } {
  const absDrift = Math.abs(driftSeconds)

  if (category === 'ACCEPTABLE') {
    return {
      actionTaken: 'PROCEED_SILENT',
      isAccepted: true,
    }
  }

  if (category === 'WARNING') {
    return {
      actionTaken: 'PROCEED_WITH_WARNING',
      isAccepted: true,
      incidentSeverity: 'WARNING',
    }
  }

  if (category === 'BLOCKED') {
    return {
      actionTaken: 'BLOCKED',
      isAccepted: false,
      incidentSeverity: 'URGENT',
    }
  }

  return {
    actionTaken: 'ESCALATED',
    isAccepted: false,
    incidentSeverity: 'CRITICAL',
  }
}

/**
 * Detect forensic indicators
 */
function detectForensicIndicators(
  driftSeconds: number,
  direction: DriftDirection,
  context: TimeAuthorityContext
): string[] {
  const flags: string[] = []

  // Extreme drift
  if (Math.abs(driftSeconds) > 3600) {
    flags.push(direction === 'AHEAD' ? 'clock_ahead_by_hours' : 'clock_behind_by_hours')
  }

  // TODO: Implement additional forensic checks
  // - Replay pattern detection
  // - Device fingerprinting
  // - Known compromised devices
  // - Coordinated fraud patterns

  return flags
}

/**
 * Log drift event immutably
 */
async function logDriftEvent(params: {
  clientTime: Date
  serverTime: Date
  driftMS: number
  driftSeconds: number
  direction: DriftDirection
  category: DriftCategory
  actionTaken: ActionTaken
  isAccepted: boolean
  deviceInfo: DeviceInfo
  userId?: string
  actionType: string
  location?: { lat: number; lng: number }
  ipAddress?: string
  userAgent?: string
  networkType?: string
  requestId?: string
  forensicFlags: string[]
}): Promise<string> {
  const id = uuidv4()

  try {
    const result = await query(
      `INSERT INTO drift_audit_log (
        id, user_id, device_id, device_model, app_version, os_version,
        client_time, server_time, request_received_at, drift_ms, drift_seconds,
        drift_direction, drift_category, action_taken, action_type,
        action_location, ip_address, user_agent, network_type, request_id,
        was_accepted, forensic_flags, checksum
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
        $16, $17, $18, $19, $20, $21, $22, $23
      ) RETURNING id`,
      [
        id,
        params.userId || null,
        params.deviceInfo.device_id,
        params.deviceInfo.device_model || null,
        params.deviceInfo.app_version || null,
        params.deviceInfo.os_version || null,
        params.clientTime,
        params.serverTime,
        new Date(),
        params.driftMS,
        params.driftSeconds,
        params.direction,
        params.category,
        params.actionTaken,
        params.actionType,
        params.location ? `POINT(${params.location.lng} ${params.location.lat})` : null,
        params.ipAddress || null,
        params.userAgent || null,
        params.networkType || null,
        params.requestId || null,
        params.isAccepted,
        params.forensicFlags,
        generateChecksum({
          id,
          clientTime: params.clientTime,
          serverTime: params.serverTime,
          driftSeconds: params.driftSeconds,
        })
      ]
    )

    return result.rows[0].id
  } catch (error) {
    console.error('[TIME_AUTHORITY] Failed to log drift event:', error)
    throw error
  }
}

/**
 * Create incident for threshold violations
 */
async function createIncident(
  driftAuditId: string,
  category: DriftCategory,
  driftSeconds: number,
  severity?: string
): Promise<string> {
  const id = uuidv4()
  const incidentType = category === 'CRITICAL' ? 'CRITICAL' : 'WARNING'
  const incidentSeverity = severity || (category === 'CRITICAL' ? 'CRITICAL' : 'WARNING')

  try {
    const result = await query(
      `INSERT INTO time_authority_incidents (
        id, drift_audit_id, incident_type, severity,
        drift_seconds, status
      ) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [id, driftAuditId, incidentType, incidentSeverity, driftSeconds, 'OPEN']
    )

    return result.rows[0].id
  } catch (error) {
    console.error('[TIME_AUTHORITY] Failed to create incident:', error)
    throw error
  }
}

/**
 * Escalate critical issues to security team
 */
async function escalateToSecurityTeam(
  logId: string,
  incidentId: string | undefined,
  driftSeconds: number,
  context: TimeAuthorityContext
): Promise<void> {
  try {
    console.error(
      `🚨 TIME AUTHORITY CRITICAL ESCALATION:\n` +
      `  Log ID: ${logId}\n` +
      `  Incident ID: ${incidentId}\n` +
      `  Drift: ${driftSeconds}s\n` +
      `  User: ${context.userId}\n` +
      `  Device: ${context.deviceInfo.device_id}\n` +
      `  Action: ${context.actionType}\n` +
      `  IP: ${context.ipAddress}`
    )

    // TODO: Send security alert
    // TODO: Trigger incident response workflow
  } catch (error) {
    console.error('[TIME_AUTHORITY] Failed to escalate to security team:', error)
  }
}

/**
 * Generate user-friendly message
 */
function generateMessage(category: DriftCategory, driftSeconds: number): string {
  const absDrift = Math.abs(driftSeconds)

  if (category === 'ACCEPTABLE') {
    return 'Time OK'
  }

  if (category === 'WARNING') {
    const minutes = Math.round(absDrift / 60)
    return `Device time is ${minutes} minute(s) off. Action recorded but proceeding.`
  }

  if (category === 'BLOCKED') {
    return 'Device clock is too far off. Please sync device time and try again.'
  }

  return 'Critical time sync issue. Please contact support.'
}

// ===========================
// QUERY FUNCTIONS
// ===========================

export async function getUserClockDriftHistory(
  userId: string,
  limit: number = 50
): Promise<any[]> {
  try {
    const result = await query(
      `SELECT * FROM drift_audit_log 
       WHERE user_id = $1 
       ORDER BY created_at DESC 
       LIMIT $2`,
      [userId, limit]
    )
    return result.rows
  } catch (error) {
    console.error('[TIME_AUTHORITY] Failed to get drift history:', error)
    throw error
  }
}

export async function getTenantClockDriftStats(tenantId: string): Promise<any> {
  try {
    const result = await query(
      `SELECT 
        COUNT(*) as total_drift_events,
        COUNT(*) FILTER (WHERE drift_category = 'CRITICAL') as critical_count,
        COUNT(*) FILTER (WHERE drift_category = 'BLOCKED') as blocked_count,
        COUNT(*) FILTER (WHERE drift_category = 'WARNING') as warning_count,
        COUNT(*) FILTER (WHERE drift_category = 'ACCEPTABLE') as acceptable_count,
        AVG(ABS(drift_seconds)) as avg_drift_seconds,
        MAX(ABS(drift_seconds)) as max_drift_seconds
       FROM drift_audit_log 
       WHERE user_id IN (SELECT id FROM users WHERE tenant_id = $1)`,
      [tenantId]
    )

    return result.rows[0] || {}
  } catch (error) {
    console.error('[TIME_AUTHORITY] Failed to get drift stats:', error)
    throw error
  }
}

export async function getCriticalDriftEvents(limit: number = 100): Promise<any[]> {
  try {
    const result = await query(
      `SELECT * FROM drift_audit_log 
       WHERE drift_category IN ('BLOCKED', 'CRITICAL')
       ORDER BY created_at DESC 
       LIMIT $1`,
      [limit]
    )
    return result.rows
  } catch (error) {
    console.error('[TIME_AUTHORITY] Failed to get critical events:', error)
    throw error
  }
}

export async function getOpenIncidents(limit: number = 50): Promise<any[]> {
  try {
    const result = await query(
      `SELECT * FROM time_authority_incidents 
       WHERE status IN ('OPEN', 'INVESTIGATING')
       ORDER BY created_at DESC LIMIT $1`,
      [limit]
    )
    return result.rows
  } catch (error) {
    console.error('[TIME_AUTHORITY] Failed to get open incidents:', error)
    throw error
  }
}

// ===========================
// BACKWARD COMPATIBILITY
// ===========================

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
 * Legacy compatibility - log clock drift (old format)
 */
export async function logClockDrift(context: ClockDriftContext): Promise<string> {
  return validateTimeAuthority({
    clientTime: context.clientTimestamp,
    serverTime: context.serverTimestamp,
    deviceInfo: {
      device_id: context.userId,
      platform: 'WEB_BROWSER'
    },
    userId: context.userId,
    actionType: context.actionType || 'UNKNOWN',
    requestId: context.requestId
  }).then(result => result.logId)
}

/**
 * Check if clock drift exceeds thresholds
 */
export function shouldBlockAttendanceAction(
  driftSeconds: number,
  actionType?: string
): { shouldBlock: boolean; reason?: string; severity: 'INFO' | 'WARNING' | 'CRITICAL' } {
  const absDrift = Math.abs(driftSeconds)
  const severity = classifyDriftSeverity(driftSeconds)
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
