/**
 * ===========================
 * PRIVILEGE ESCALATION DETECTION SERVICE
 * ===========================
 * 
 * Automatically detects privilege escalation patterns.
 * Creates escalation events and marks roles as compromised.
 * 
 * Detection Patterns:
 * 1. TEMPORAL_CLUSTER: 5+ role changes in 60 seconds
 * 2. RECURSIVE_ESCALATION: A→B→C→admin chain
 * 3. BYPASS_PATTERN: Role changed, then immediate action (no gap)
 * 4. COORDINATED_ELEVATION: Multiple users promoted by same admin, then same actions
 * 5. UNUSUAL_SUPERADMIN_ACTION: Superadmin doing non-normal job
 */

import { query } from '../db/connection.js'
import { v4 as uuidv4 } from 'uuid'

// ===========================
// TYPES & CONSTANTS
// ===========================

export type EventType =
  | 'TEMPORAL_CLUSTER'
  | 'RECURSIVE_ESCALATION'
  | 'BYPASS_PATTERN'
  | 'COORDINATED_ELEVATION'
  | 'UNUSUAL_SUPERADMIN_ACTION'
  | 'MULTIPLE_ROLES'

export type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

export interface EscalationScore {
  eventType: EventType
  score: number // 0-100
  severity: Severity
  reason: string
  correlationFlags?: string[]
}

/**
 * Threshold configuration
 */
const DETECTION_THRESHOLDS = {
  TEMPORAL_CLUSTER: {
    changeLimit: 5,
    timeWindowSeconds: 60,
    severity: 'MEDIUM' as Severity,
  },
  RECURSIVE_ESCALATION: {
    chainLength: 3, // A→B→C→admin
    severity: 'HIGH' as Severity,
  },
  BYPASS_PATTERN: {
    timeDeltaSeconds: 5, // Role change then action within 5s
    severity: 'HIGH' as Severity,
  },
  COORDINATED_ELEVATION: {
    userLimit: 5, // 5+ users promoted by same admin
    timeDeltaSeconds: 3600, // Within 1 hour
    severity: 'CRITICAL' as Severity,
  },
  UNUSUAL_SUPERADMIN_ACTION: {
    severity: 'CRITICAL' as Severity,
  },
}

// ===========================
// PRIVILEGE ESCALATION DETECTION SERVICE
// ===========================

export class PrivilegeEscalationDetectionService {
  /**
   * MAIN: Detect privilege escalation on role change
   */
  async detectPrivilegeEscalation(params: {
    roleAssignmentHistoryId: string
    userId: string
    roleId: string
    changedByUserId: string
  }): Promise<{
    detected: boolean
    score: number // 0-100
    severity?: Severity
    event?: string // event_id
    reason?: string
    flags?: string[]
  }> {
    try {
      let maxScore = 0
      let eventSeverity: Severity = 'LOW'
      const correlationFlags: string[] = []

      // 1. Check temporal clustering
      const temporalScore = await this.scoreTemporalCluster(params.userId)
      if (temporalScore > 0) {
        maxScore = Math.max(maxScore, temporalScore)
        eventSeverity = 'MEDIUM'
        correlationFlags.push('TEMPORAL_CLUSTER')
      }

      // 2. Check recursive escalation chain
      const recursiveScore = await this.scoreRecursiveEscalation(params.changedByUserId, params.userId)
      if (recursiveScore > 0) {
        maxScore = Math.max(maxScore, recursiveScore)
        eventSeverity = 'HIGH'
        correlationFlags.push('RECURSIVE_ESCALATION')
      }

      // 3. Check bypass pattern (immediate follow-on action)
      const bypassScore = await this.scoreBypassPattern(params.userId)
      if (bypassScore > 0) {
        maxScore = Math.max(maxScore, bypassScore)
        eventSeverity = 'HIGH'
        correlationFlags.push('BYPASS_PATTERN')
      }

      // 4. Check coordinated elevation
      const coordinatedScore = await this.scoreCoordinatedElevation(params.changedByUserId)
      if (coordinatedScore > 0) {
        maxScore = Math.max(maxScore, coordinatedScore)
        eventSeverity = 'CRITICAL'
        correlationFlags.push('COORDINATED_ELEVATION')
      }

      // 5. Check unusual superadmin action
      const role = await this.getRoleNameById(params.roleId)
      if (role === 'superadmin') {
        const unusualScore = await this.scoreUnusualSuperadminAction(params.changedByUserId)
        if (unusualScore > 0) {
          maxScore = Math.max(maxScore, unusualScore)
          eventSeverity = 'CRITICAL'
          correlationFlags.push('UNUSUAL_SUPERADMIN_ACTION')
        }
      }

      // Create escalation event if suspicious
      let escalationEventId: string | undefined

      if (maxScore > 50) {
        escalationEventId = await this.createEscalationEvent({
          roleAssignmentHistoryId: params.roleAssignmentHistoryId,
          affectedUserId: params.userId,
          triggeredByUserId: params.changedByUserId,
          eventType: this.determineEventType(correlationFlags),
          severity: eventSeverity,
          anomalyScore: maxScore,
          correlationFlags,
        })

        // Mark user's role as potentially compromised
        await query(
          `UPDATE users 
           SET role_may_be_compromised = TRUE,
               last_escalation_event_id = $1
           WHERE id = $2`,
          [escalationEventId, params.userId]
        )

        console.error(
          `[ESCALATION_DETECTED] ${eventSeverity} score=${maxScore} userId=${params.userId} flags=${correlationFlags.join(',')}`
        )
      }

      // Update role_assignment_history with scores
      await query(
        `UPDATE role_assignment_history 
         SET anomaly_score = $1, detection_flags = $2, is_verified = FALSE
         WHERE id = $3`,
        [maxScore, correlationFlags, params.roleAssignmentHistoryId]
      )

      return {
        detected: maxScore > 50,
        score: maxScore,
        severity: eventSeverity,
        event: escalationEventId,
        reason: correlationFlags.join(', '),
        flags: correlationFlags,
      }
    } catch (error) {
      console.error('[ESCALATION_DETECTION] Error detecting privilege escalation:', error)
      throw error
    }
  }

  /**
   * PATTERN 1: Temporal Clustering
   * 5+ role changes in 60 seconds = suspicious
   */
  private async scoreTemporalCluster(userId: string): Promise<number> {
    try {
      const result = await query(
        `SELECT COUNT(*) as change_count
         FROM role_assignment_history
         WHERE user_id = $1
           AND assigned_at > CURRENT_TIMESTAMP - INTERVAL '60 seconds'`,
        [userId]
      )

      const changeCount = parseInt(result.rows[0].change_count)

      if (changeCount >= DETECTION_THRESHOLDS.TEMPORAL_CLUSTER.changeLimit) {
        // Score: (changeCount / 5) * 100, capped at 100
        return Math.min((changeCount / DETECTION_THRESHOLDS.TEMPORAL_CLUSTER.changeLimit) * 100, 100)
      }

      return 0
    } catch (error) {
      console.error('[ESCALATION_DETECTION] Error scoring temporal cluster:', error)
      return 0
    }
  }

  /**
   * PATTERN 2: Recursive Escalation
   * A creates role for B, B creates role for C, C becomes admin → chain detected
   */
  private async scoreRecursiveEscalation(changedByUserId: string, newAdminUserId: string): Promise<number> {
    try {
      // Trace the chain backwards: who promoted changedByUserId?
      const chainResult = await query(
        `WITH RECURSIVE escalation_chain AS (
           -- Start: find who promoted the role changer
           SELECT u.id, u.assigned_by_id, 1 as depth
           FROM role_assignment_history u
           WHERE u.user_id = $1
             AND u.assigned_at > CURRENT_TIMESTAMP - INTERVAL '7 days'
           
           UNION ALL
           
           -- Recursive: go up the chain
           SELECT parent.id, parent.assigned_by_id, child.depth + 1
           FROM role_assignment_history parent
           JOIN escalation_chain child ON parent.user_id = child.assigned_by_id
           WHERE child.depth < 10
             AND parent.assigned_at > CURRENT_TIMESTAMP - INTERVAL '7 days'
         )
         SELECT MAX(depth) as chain_length
         FROM escalation_chain
         WHERE assigned_by_id IS NOT NULL`,
        [changedByUserId]
      )

      const chainLength = parseInt(chainResult.rows[0]?.chain_length || 0)

      if (chainLength >= DETECTION_THRESHOLDS.RECURSIVE_ESCALATION.chainLength) {
        // Score: (chainLength / 3) * 100, capped at 100
        return Math.min((chainLength / DETECTION_THRESHOLDS.RECURSIVE_ESCALATION.chainLength) * 100, 100)
      }

      return 0
    } catch (error) {
      console.error('[ESCALATION_DETECTION] Error scoring recursive escalation:', error)
      return 0
    }
  }

  /**
   * PATTERN 3: Bypass Pattern
   * Role changed, then immediate action (no time for verification)
   */
  private async scoreBypassPattern(userId: string): Promise<number> {
    try {
      const result = await query(
        `SELECT COUNT(*) as action_count
         FROM audit_logs
         WHERE actor_id = $1
           AND created_at > (
             SELECT assigned_at FROM role_assignment_history
             WHERE user_id = $1
             ORDER BY assigned_at DESC
             LIMIT 1
           )
           AND created_at < (
             SELECT assigned_at FROM role_assignment_history
             WHERE user_id = $1
             ORDER BY assigned_at DESC
             LIMIT 1
           ) + INTERVAL '5 seconds'`,
        [userId]
      )

      const actionCount = parseInt(result.rows[0].action_count)

      // If any action within 5 seconds of role change, suspicious
      if (actionCount > 0) {
        return 75 // High score: no time for review
      }

      return 0
    } catch (error) {
      console.error('[ESCALATION_DETECTION] Error scoring bypass pattern:', error)
      return 0
    }
  }

  /**
   * PATTERN 4: Coordinated Elevation
   * 5+ users promoted by same admin within 1 hour, then same actions
   */
  private async scoreCoordinatedElevation(adminUserId: string): Promise<number> {
    try {
      // Find all users promoted by this admin in last hour
      const promoteResult = await query(
        `SELECT COUNT(DISTINCT user_id) as promoted_count,
                ARRAY_AGG(DISTINCT user_id) as promoted_users
         FROM role_assignment_history
         WHERE assigned_by_user_id = $1
           AND assigned_at > CURRENT_TIMESTAMP - INTERVAL '1 hour'`,
        [adminUserId]
      )

      const promotedCount = parseInt(promoteResult.rows[0].promoted_count)
      const promotedUsers = promoteResult.rows[0].promoted_users

      if (promotedCount >= DETECTION_THRESHOLDS.COORDINATED_ELEVATION.userLimit) {
        // Now check if all these users did the same action
        const actionResult = await query(
          `SELECT action, COUNT(*) as frequency
           FROM audit_logs
           WHERE actor_id = ANY($1)
             AND created_at > CURRENT_TIMESTAMP - INTERVAL '1 hour'
           GROUP BY action
           ORDER BY frequency DESC
           LIMIT 1`,
          [promotedUsers]
        )

        // If same action done by all promoted users, high coordination
        if (actionResult.rows.length > 0 && actionResult.rows[0].frequency >= promotedCount * 0.8) {
          return 85 // Very suspicious: coordinated behavior
        }

        // Even without same action, 5+ promotions is flag
        return 65
      }

      return 0
    } catch (error) {
      console.error('[ESCALATION_DETECTION] Error scoring coordinated elevation:', error)
      return 0
    }
  }

  /**
   * PATTERN 5: Unusual Superadmin Action
   * Superadmin doing non-normal job (marking attendance, approving registration, etc)
   */
  private async scoreUnusualSuperadminAction(userId: string): Promise<number> {
    try {
      const result = await query(
        `SELECT action, COUNT(*) as frequency
         FROM audit_logs
         WHERE actor_id = $1
           AND created_at > CURRENT_TIMESTAMP - INTERVAL '24 hours'
         GROUP BY action
         ORDER BY frequency DESC`,
        [userId]
      )

      const actions = result.rows

      // Check if any unusual actions
      const unusualActions = actions.filter((a: any) =>
        ['MARK_ATTENDANCE', 'APPROVE_REGISTRATION', 'MODIFY_PAST_ATTENDANCE'].includes(a.action)
      )

      if (unusualActions.length > 0) {
        // Superadmin should NOT be marking attendance
        return 80
      }

      return 0
    } catch (error) {
      console.error('[ESCALATION_DETECTION] Error scoring unusual superadmin action:', error)
      return 0
    }
  }

  /**
   * Determine primary event type from flags
   */
  private determineEventType(flags: string[]): EventType {
    if (flags.includes('RECURSIVE_ESCALATION')) return 'RECURSIVE_ESCALATION'
    if (flags.includes('COORDINATED_ELEVATION')) return 'COORDINATED_ELEVATION'
    if (flags.includes('BYPASS_PATTERN')) return 'BYPASS_PATTERN'
    if (flags.includes('UNUSUAL_SUPERADMIN_ACTION')) return 'UNUSUAL_SUPERADMIN_ACTION'
    if (flags.includes('TEMPORAL_CLUSTER')) return 'TEMPORAL_CLUSTER'
    return 'TEMPORAL_CLUSTER'
  }

  /**
   * Create escalation event record
   */
  private async createEscalationEvent(params: {
    roleAssignmentHistoryId: string
    affectedUserId: string
    triggeredByUserId: string
    eventType: EventType
    severity: Severity
    anomalyScore: number
    correlationFlags: string[]
  }): Promise<string> {
    try {
      const id = uuidv4()

      await query(
        `INSERT INTO privilege_escalation_events (
          id, role_assignment_id, affected_user_id, triggered_by_user_id,
          event_type, severity, anomaly_score, correlation_flags, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          id,
          params.roleAssignmentHistoryId,
          params.affectedUserId,
          params.triggeredByUserId,
          params.eventType,
          params.severity,
          params.anomalyScore,
          params.correlationFlags,
          'OPEN',
        ]
      )

      console.error(
        `[ESCALATION_EVENT_CREATED] ${params.eventType} severity=${params.severity} score=${params.anomalyScore}`
      )

      return id
    } catch (error) {
      console.error('[ESCALATION_DETECTION] Error creating escalation event:', error)
      throw error
    }
  }

  /**
   * Get role name by ID
   */
  private async getRoleNameById(roleId: string): Promise<string | null> {
    try {
      const result = await query(`SELECT name FROM roles WHERE id = $1`, [roleId])

      if (result.rows.length === 0) {
        return null
      }

      return result.rows[0].name
    } catch (error) {
      console.error('[ESCALATION_DETECTION] Error getting role name:', error)
      return null
    }
  }

  /**
   * Get all escalation events
   */
  async getEscalationEvents(
    limit: number = 100,
    severity?: Severity
  ): Promise<any[]> {
    try {
      let sql = `SELECT * FROM privilege_escalation_events`
      const params: any[] = []

      if (severity) {
        sql += ` WHERE severity = $1`
        params.push(severity)
      }

      sql += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`
      params.push(limit)

      const result = await query(sql, params)
      return result.rows
    } catch (error) {
      console.error('[ESCALATION_DETECTION] Error getting escalation events:', error)
      throw error
    }
  }

  /**
   * Get open escalation events for investigation
   */
  async getOpenEscalationEvents(): Promise<any[]> {
    try {
      const result = await query(
        `SELECT * FROM privilege_escalation_events
         WHERE status = 'OPEN'
         ORDER BY severity DESC, created_at DESC`,
        []
      )

      return result.rows
    } catch (error) {
      console.error('[ESCALATION_DETECTION] Error getting open events:', error)
      throw error
    }
  }

  /**
   * Mark event as under investigation
   */
  async markUnderInvestigation(eventId: string, notes: string): Promise<void> {
    try {
      await query(
        `UPDATE privilege_escalation_events 
         SET status = 'INVESTIGATING', investigation_notes = $1
         WHERE id = $2`,
        [notes, eventId]
      )

      console.log(`[ESCALATION_EVENT] Event ${eventId} marked as investigating`)
    } catch (error) {
      console.error('[ESCALATION_DETECTION] Error updating event:', error)
      throw error
    }
  }

  /**
   * Resolve escalation event
   */
  async resolveEvent(eventId: string, resolution: string): Promise<void> {
    try {
      await query(
        `UPDATE privilege_escalation_events 
         SET status = 'RESOLVED', investigation_notes = $1, resolved_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [resolution, eventId]
      )

      console.log(`[ESCALATION_EVENT] Event ${eventId} resolved`)
    } catch (error) {
      console.error('[ESCALATION_DETECTION] Error resolving event:', error)
      throw error
    }
  }
}

export default PrivilegeEscalationDetectionService
