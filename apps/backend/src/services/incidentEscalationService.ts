/**
 * ===========================
 * INCIDENT ESCALATION SERVICE
 * ===========================
 * 
 * Background service that monitors incidents and auto-escalates them.
 * Should be run periodically (every 5 minutes).
 * 
 * Responsibilities:
 * 1. Find unacknowledged incidents past 1 hour threshold
 * 2. Find incidents without root cause past 24 hour threshold
 * 3. Create escalation events
 * 4. Notify on-call engineer
 * 5. Track escalation acknowledgments
 */

import { query } from '../db/connection.js'
import IncidentManagementService from './incidentManagementService.js'

// ===========================
// CONSTANTS
// ===========================

const ESCALATION_RULES = {
  // No ACK after 1 hour - escalate to on-call
  NO_ACK_1HR: {
    thresholdMs: 60 * 60 * 1000, // 1 hour
    severity: 'CRITICAL',
    reason: 'NO_ACK_1HR',
  },
  // No ACK after 4 hours - escalate to supervisor
  NO_ACK_4HR: {
    thresholdMs: 4 * 60 * 60 * 1000, // 4 hours
    severity: 'CRITICAL',
    reason: 'NO_ACK_4HR',
  },
  // No root cause after 24 hours - escalate to director
  NO_ROOT_CAUSE_24HR: {
    thresholdMs: 24 * 60 * 60 * 1000, // 24 hours
    severity: 'HIGH',
    reason: 'NO_ROOT_CAUSE_24HR',
  },
}

// ===========================
// INCIDENT ESCALATION SERVICE
// ===========================

export class IncidentEscalationService {
  private incidentService: IncidentManagementService

  constructor() {
    this.incidentService = new IncidentManagementService()
  }

  /**
   * Main: Run escalation checks
   * Should be called every 5 minutes via cron or timer
   */
  async checkAndEscalateOverdueIncidents(): Promise<{
    checked: number
    escalated: number
    errors: number
  }> {
    try {
      const stats = {
        checked: 0,
        escalated: 0,
        errors: 0,
      }

      // 1. Get all open incidents
      const openIncidents = await this.incidentService.getOpenIncidents()

      console.log(`[ESCALATION] Checking ${openIncidents.length} open incidents for escalation`)

      for (const incident of openIncidents) {
        stats.checked++

        try {
          // 2. Check each escalation rule
          const now = Date.now()
          const createdAt = new Date(incident.created_at).getTime()
          const timeSinceCreation = now - createdAt

          // Rule 1: NO ACK in 1 hour?
          if (
            incident.current_status === 'REPORTED' &&
            timeSinceCreation > ESCALATION_RULES.NO_ACK_1HR.thresholdMs
          ) {
            // Check if already escalated with this reason
            const esc1Result = await query(
              `SELECT id FROM incident_escalations 
               WHERE incident_id = $1 AND escalation_reason = $2 LIMIT 1`,
              [incident.id, 'NO_ACK_1HR']
            )

            if (esc1Result.rows.length === 0) {
              // Escalate to on-call
              const onCallUserId = await this.getOnCallUser(incident)

              if (onCallUserId) {
                await this.incidentService.createEscalation({
                  incidentId: incident.id,
                  escalationReason: 'NO_ACK_1HR',
                  escalatedToUserId: onCallUserId,
                })
                stats.escalated++

                // Send alert (would be integration with alerting system)
                console.error(
                  `[ESCALATION_ALERT] P0 incident ${incident.id} not acknowledged in 1 hour. Paging on-call.`
                )
              }
            }
          }

          // Rule 2: NO ACK in 4 hours?
          if (
            incident.current_status === 'REPORTED' &&
            timeSinceCreation > ESCALATION_RULES.NO_ACK_4HR.thresholdMs
          ) {
            const esc4Result = await query(
              `SELECT id FROM incident_escalations 
               WHERE incident_id = $1 AND escalation_reason = $2 LIMIT 1`,
              [incident.id, 'NO_ACK_4HR']
            )

            if (esc4Result.rows.length === 0) {
              // Escalate to supervisor
              const supervisorUserId = await this.getSupervisor(incident)

              if (supervisorUserId) {
                await this.incidentService.createEscalation({
                  incidentId: incident.id,
                  escalationReason: 'NO_ACK_4HR',
                  escalatedToUserId: supervisorUserId,
                })
                stats.escalated++

                console.error(
                  `[ESCALATION_ALERT] P1 incident ${incident.id} not acknowledged in 4 hours. Escalating to supervisor.`
                )
              }
            }
          }

          // Rule 3: NO ROOT CAUSE in 24 hours?
          if (
            incident.current_status === 'ACKNOWLEDGED' &&
            !incident.root_cause &&
            timeSinceCreation > ESCALATION_RULES.NO_ROOT_CAUSE_24HR.thresholdMs
          ) {
            const esc24Result = await query(
              `SELECT id FROM incident_escalations 
               WHERE incident_id = $1 AND escalation_reason = $2 LIMIT 1`,
              [incident.id, 'NO_ROOT_CAUSE_24HR']
            )

            if (esc24Result.rows.length === 0) {
              // Escalate to director
              const directorUserId = await this.getDirector(incident)

              if (directorUserId) {
                await this.incidentService.createEscalation({
                  incidentId: incident.id,
                  escalationReason: 'NO_ROOT_CAUSE_24HR',
                  escalatedToUserId: directorUserId,
                })
                stats.escalated++

                console.error(
                  `[ESCALATION_ALERT] Incident ${incident.id} without root cause for 24 hours. Escalating to director.`
                )
              }
            }
          }
        } catch (error) {
          console.error(`[ESCALATION] Error processing incident ${incident.id}:`, error)
          stats.errors++
        }
      }

      console.log(
        `[ESCALATION] Complete: checked=${stats.checked}, escalated=${stats.escalated}, errors=${stats.errors}`
      )

      return stats
    } catch (error) {
      console.error('[ESCALATION] Fatal error in escalation check:', error)
      throw error
    }
  }

  /**
   * Check for incidents that should block user sessions
   * If critical incident not ACK'd, block all users from operating
   */
  async blockSessionsIfCriticalUnack(): Promise<number> {
    try {
      const blockedCount = await query(
        `SELECT COUNT(*) as count FROM open_incidents 
         WHERE current_status = 'REPORTED' AND severity = 'CRITICAL'`
      )

      const count = parseInt(blockedCount.rows[0].count)

      if (count > 0) {
        console.warn(
          `[ESCALATION] ${count} critical incidents unacknowledged. May trigger session blocking.`
        )

        // Get the oldest unack'd critical incident
        const criticalResult = await query(
          `SELECT * FROM open_incidents 
           WHERE current_status = 'REPORTED' AND severity = 'CRITICAL'
           ORDER BY created_at ASC LIMIT 1`
        )

        if (criticalResult.rows.length > 0) {
          const incident = criticalResult.rows[0]

          // Check if incident is > 2 hours old without ACK
          const now = Date.now()
          const createdAt = new Date(incident.created_at).getTime()
          const hoursSinceCreation = (now - createdAt) / (60 * 60 * 1000)

          if (hoursSinceCreation > 2) {
            console.error(
              `[ESCALATION_CRITICAL] Critical incident ${incident.id} unack'd for ${hoursSinceCreation.toFixed(1)} hours`
            )

            // Option: Block new sessions
            // BLOCKED_DUE_TO_INCIDENT flag can be checked on login
            // return incident.id for blocking logic in auth middleware
          }
        }
      }

      return count
    } catch (error) {
      console.error('[ESCALATION] Error checking critical incidents:', error)
      return 0
    }
  }

  /**
   * Get escalation stats for dashboard
   */
  async getEscalationStats(): Promise<{
    totalOpen: number
    unacked: number
    noRootCause: number
    criticalUnacked: number
    escalatedToday: number
  }> {
    try {
      // Total open
      const openResult = await query(`SELECT COUNT(*) as count FROM open_incidents`)
      const totalOpen = parseInt(openResult.rows[0].count)

      // Unacked
      const unackedResult = await query(
        `SELECT COUNT(*) as count FROM open_incidents WHERE current_status = 'REPORTED'`
      )
      const unacked = parseInt(unackedResult.rows[0].count)

      // No root cause
      const noRcResult = await query(
        `SELECT COUNT(*) as count FROM open_incidents 
         WHERE current_status IN ('REPORTED', 'ACKNOWLEDGED') AND root_cause IS NULL`
      )
      const noRootCause = parseInt(noRcResult.rows[0].count)

      // Critical unacked
      const criticalResult = await query(
        `SELECT COUNT(*) as count FROM open_incidents 
         WHERE current_status = 'REPORTED' AND severity = 'CRITICAL'`
      )
      const criticalUnacked = parseInt(criticalResult.rows[0].count)

      // Escalated today
      const todayResult = await query(
        `SELECT COUNT(*) as count FROM incident_escalations 
         WHERE escalated_at > CURRENT_TIMESTAMP - INTERVAL '24 hours'`
      )
      const escalatedToday = parseInt(todayResult.rows[0].count)

      return {
        totalOpen,
        unacked,
        noRootCause,
        criticalUnacked,
        escalatedToday,
      }
    } catch (error) {
      console.error('[ESCALATION] Error getting stats:', error)
      throw error
    }
  }

  // ===========================
  // ESCALATION ROUTING HELPERS
  // ===========================

  /**
   * Get on-call user for incident escalation
   */
  private async getOnCallUser(incident: any): Promise<string | null> {
    try {
      // Query for on-call user (would integrate with on-call schedule)
      // For now, find first superadmin
      const result = await query(
        `SELECT u.id FROM users u
         JOIN roles r ON u.role_id = r.id
         WHERE r.name = 'superadmin'
         LIMIT 1`
      )

      if (result.rows.length > 0) {
        return result.rows[0].id
      }

      return null
    } catch (error) {
      console.error('[ESCALATION] Error getting on-call user:', error)
      return null
    }
  }

  /**
   * Get supervisor for escalation
   */
  private async getSupervisor(incident: any): Promise<string | null> {
    try {
      // Get tenant superadmin or global superadmin
      const result = await query(
        `SELECT u.id FROM users u
         JOIN roles r ON u.role_id = r.id
         WHERE r.name = 'tenant_admin' OR r.name = 'superadmin'
         LIMIT 1`
      )

      if (result.rows.length > 0) {
        return result.rows[0].id
      }

      return null
    } catch (error) {
      console.error('[ESCALATION] Error getting supervisor:', error)
      return null
    }
  }

  /**
   * Get director for escalation (same as on-call for now)
   */
  private async getDirector(incident: any): Promise<string | null> {
    return this.getOnCallUser(incident)
  }
}

export default IncidentEscalationService
