/**
 * ===========================
 * INCIDENT MANAGEMENT SERVICE
 * ===========================
 * 
 * Core incident lifecycle management.
 * Enforces workflow: REPORTED → ACKNOWLEDGED → INVESTIGATING → RESOLVED → CLOSED
 * 
 * Guarantees:
 * 1. High-severity errors auto-create incidents
 * 2. Cannot ACK without incident existing
 * 3. Cannot resolve without ACK
 * 4. Cannot close without root cause
 * 5. Timeline is immutable
 */

import { query } from '../db/connection.js'
import { v4 as uuidv4 } from 'uuid'
import crypto from 'crypto'

// ===========================
// TYPES & CONSTANTS
// ===========================

export type IncidentType = 'P0_INCIDENT' | 'P1_INCIDENT' | 'P2_INCIDENT'
export type IncidentSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM'
export type IncidentStatus = 'REPORTED' | 'ACKNOWLEDGED' | 'INVESTIGATING' | 'RESOLVED' | 'CLOSED'
export type RootCauseCategory =
  | 'USER_ERROR'
  | 'SYSTEM_DEFECT'
  | 'EXTERNAL_DEPENDENCY'
  | 'CONFIGURATION'
  | 'SECURITY'
  | 'UNKNOWN'

export interface IncidentContext {
  userId: string
  role?: string
  ipAddress?: string
  userAgent?: string
}

/**
 * Severity threshold for auto-incident creation
 */
const ERROR_SEVERITY_THRESHOLD = 'HIGH' // HIGH or CRITICAL creates incident

/**
 * Escalation thresholds
 */
const ESCALATION_THRESHOLDS = {
  NO_ACK_1HR: 60 * 60 * 1000, // 1 hour in milliseconds
  NO_ACK_4HR: 4 * 60 * 60 * 1000,
  NO_ROOT_CAUSE_24HR: 24 * 60 * 60 * 1000,
}

// ===========================
// INCIDENT MANAGEMENT SERVICE
// ===========================

export class IncidentManagementService {
  /**
   * MAIN: Create incident from high-severity error
   * Auto-called when error is logged with severity >= HIGH
   */
  async createIncidentFromError(params: {
    errorId: string
    severity: IncidentSeverity
    errorType: string
    errorMessage: string
    tenantId?: string
  }): Promise<string | null> {
    try {
      // 1. Check deduplication: has incident been created in last 5 minutes for this error?
      const dedupeResult = await query(
        `SELECT id FROM incidents 
         WHERE created_from_error_id = $1 
         AND created_at > CURRENT_TIMESTAMP - INTERVAL '5 minutes'
         LIMIT 1`,
        [params.errorId]
      )

      if (dedupeResult.rows.length > 0) {
        console.log(
          `[INCIDENT] Incident already exists for error ${params.errorId}, skipping deduplication`
        )
        return dedupeResult.rows[0].id
      }

      // 2. Determine incident type from severity
      const incidentType = this.severityToIncidentType(params.severity)

      // 3. Create incident record
      const incidentId = uuidv4()
      const checksum = this.generateChecksum(incidentId, params.errorMessage)

      await query(
        `INSERT INTO incidents (
          id, incident_type, severity, description, created_from_error_id,
          created_by_system, current_severity, checksum, created_from_tenant_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          incidentId,
          incidentType,
          params.severity,
          params.errorMessage,
          params.errorId,
          true, // created_by_system = TRUE
          params.severity,
          checksum,
          params.tenantId || null,
        ]
      )

      // 4. Create initial REPORTED event
      await this.logIncidentEvent({
        incidentId,
        eventType: 'REPORTED',
        statusAfter: 'REPORTED',
        actorUserId: null,
        actorRole: 'SYSTEM',
        metadata: {
          errorType: params.errorType,
          autoCreated: true,
        },
      })

      // 5. Update audit_logs to link the error to this incident
      await query(
        `UPDATE audit_logs 
         SET created_incident_id = $1, incident_severity = $2
         WHERE id = $3`,
        [incidentId, params.severity, params.errorId]
      )

      console.error(
        `[INCIDENT_CREATED] ${params.severity} incident created from error: ${params.errorMessage}`
      )

      return incidentId
    } catch (error) {
      console.error('[INCIDENT] Error creating incident from error:', error)
      throw error
    }
  }

  /**
   * Acknowledge incident (required before any investigation)
   */
  async acknowledgeIncident(params: {
    incidentId: string
    userId: string
    notes: string
    context: IncidentContext
  }): Promise<void> {
    try {
      // 1. Verify incident exists and is in REPORTED state
      const incidentResult = await query(
        `SELECT i.*, cs.current_status FROM incidents i
         LEFT JOIN current_incident_status cs ON i.id = cs.id
         WHERE i.id = $1`,
        [params.incidentId]
      )

      if (incidentResult.rows.length === 0) {
        throw new Error(`Incident not found: ${params.incidentId}`)
      }

      const incident = incidentResult.rows[0]
      const currentStatus = incident.current_status || 'REPORTED'

      // 2. Check if already acknowledged
      const ackResult = await query(
        `SELECT id FROM incident_acknowledgments WHERE incident_id = $1 LIMIT 1`,
        [params.incidentId]
      )

      if (ackResult.rows.length > 0) {
        throw new Error(`Incident already acknowledged: ${params.incidentId}`)
      }

      // 3. Create acknowledgment record (immutable)
      const ackId = uuidv4()
      const checksum = this.generateChecksum(ackId, params.userId + params.notes)

      await query(
        `INSERT INTO incident_acknowledgments (
          id, incident_id, ack_by_user_id, ack_notes, severity_at_ack, checksum
        ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [ackId, params.incidentId, params.userId, params.notes, incident.severity, checksum]
      )

      // 4. Log acknowledgment event
      await this.logIncidentEvent({
        incidentId: params.incidentId,
        eventType: 'ACKNOWLEDGED',
        statusAfter: 'ACKNOWLEDGED',
        statusBefore: currentStatus,
        actorUserId: params.userId,
        actorRole: params.context.role || 'UNKNOWN',
        metadata: {
          notes: params.notes,
          acknowledgedAt: new Date().toISOString(),
        },
      })

      // 5. Update user's incident stats
      await query(
        `UPDATE users 
         SET last_incident_ack_id = $1, incident_ack_count = incident_ack_count + 1
         WHERE id = $2`,
        [params.incidentId, params.userId]
      )

      console.log(
        `[INCIDENT_ACK] Incident ${params.incidentId} acknowledged by ${params.context.role}`
      )
    } catch (error) {
      console.error('[INCIDENT] Error acknowledging incident:', error)
      throw error
    }
  }

  /**
   * Record root cause analysis
   */
  async recordRootCause(params: {
    incidentId: string
    userId: string
    rootCauseSummary: string
    category: RootCauseCategory
    remediationSteps: string
    context: IncidentContext
  }): Promise<string> {
    try {
      // 1. Verify incident is acknowledged first
      const ackResult = await query(
        `SELECT id FROM incident_acknowledgments WHERE incident_id = $1 LIMIT 1`,
        [params.incidentId]
      )

      if (ackResult.rows.length === 0) {
        throw new Error(`Incident must be acknowledged first: ${params.incidentId}`)
      }

      // 2. Check if root cause already exists
      const existingRcResult = await query(
        `SELECT id FROM incident_root_causes WHERE incident_id = $1 LIMIT 1`,
        [params.incidentId]
      )

      if (existingRcResult.rows.length > 0) {
        throw new Error(`Root cause already recorded for incident: ${params.incidentId}`)
      }

      // 3. Create root cause record
      const rcId = uuidv4()
      const checksum = this.generateChecksum(
        rcId,
        params.rootCauseSummary + params.remediationSteps
      )

      await query(
        `INSERT INTO incident_root_causes (
          id, incident_id, root_cause_summary, root_cause_category,
          identified_by_user_id, remediation_steps, checksum
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          rcId,
          params.incidentId,
          params.rootCauseSummary,
          params.category,
          params.userId,
          params.remediationSteps,
          checksum,
        ]
      )

      // 4. Log ROOT_CAUSE_IDENTIFIED event
      await this.logIncidentEvent({
        incidentId: params.incidentId,
        eventType: 'ROOT_CAUSE_IDENTIFIED',
        statusAfter: 'INVESTIGATING',
        actorUserId: params.userId,
        actorRole: params.context.role || 'UNKNOWN',
        metadata: {
          category: params.category,
          rootCauseSummary: params.rootCauseSummary,
        },
      })

      console.log(
        `[INCIDENT_RC] Root cause recorded for incident ${params.incidentId}: ${params.category}`
      )

      return rcId
    } catch (error) {
      console.error('[INCIDENT] Error recording root cause:', error)
      throw error
    }
  }

  /**
   * Resolve/close incident
   * Requires: ACK + Root Cause
   */
  async resolveIncident(params: {
    incidentId: string
    userId: string
    resolutionSummary: string
    resolutionNotes: string
    impactAssessment?: string
    lessonsLearned?: string
    followUpActions?: string
    context: IncidentContext
  }): Promise<void> {
    try {
      // 1. Verify ACK exists
      const ackResult = await query(
        `SELECT id FROM incident_acknowledgments WHERE incident_id = $1 LIMIT 1`,
        [params.incidentId]
      )

      if (ackResult.rows.length === 0) {
        throw new Error(
          `Incident must be acknowledged before resolution: ${params.incidentId}`
        )
      }

      // 2. Verify root cause exists
      const rcResult = await query(
        `SELECT id FROM incident_root_causes WHERE incident_id = $1 LIMIT 1`,
        [params.incidentId]
      )

      if (rcResult.rows.length === 0) {
        throw new Error(`Root cause must be recorded before resolution: ${params.incidentId}`)
      }

      // 3. Create resolution record
      const resId = uuidv4()
      const checksum = this.generateChecksum(resId, params.resolutionSummary)

      await query(
        `INSERT INTO incident_resolution (
          id, incident_id, resolved_by_user_id, resolution_summary,
          resolution_notes, impact_assessment, lessons_learned,
          follow_up_actions, status_after_resolution, checksum
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          resId,
          params.incidentId,
          params.userId,
          params.resolutionSummary,
          params.resolutionNotes,
          params.impactAssessment || null,
          params.lessonsLearned || null,
          params.followUpActions || null,
          'CLOSED', // Default status
          checksum,
        ]
      )

      // 4. Update incidents table current_severity
      await query(
        `UPDATE incidents SET current_severity = 'RESOLVED' WHERE id = $1`,
        [params.incidentId]
      )

      // 5. Log RESOLVED event
      await this.logIncidentEvent({
        incidentId: params.incidentId,
        eventType: 'RESOLVED',
        statusAfter: 'RESOLVED',
        actorUserId: params.userId,
        actorRole: params.context.role || 'UNKNOWN',
        metadata: {
          resolutionSummary: params.resolutionSummary,
          lessonsLearned: params.lessonsLearned || null,
        },
      })

      // 6. Log CLOSED event
      await this.logIncidentEvent({
        incidentId: params.incidentId,
        eventType: 'CLOSED',
        statusAfter: 'CLOSED',
        actorUserId: params.userId,
        actorRole: params.context.role || 'UNKNOWN',
        metadata: {
          closedAt: new Date().toISOString(),
        },
      })

      console.log(`[INCIDENT_RESOLVED] Incident ${params.incidentId} resolved and closed`)
    } catch (error) {
      console.error('[INCIDENT] Error resolving incident:', error)
      throw error
    }
  }

  /**
   * Get current incident status
   */
  async getIncidentStatus(incidentId: string): Promise<any | null> {
    try {
      const result = await query(
        `SELECT * FROM current_incident_status WHERE id = $1`,
        [incidentId]
      )

      if (result.rows.length === 0) {
        return null
      }

      return result.rows[0]
    } catch (error) {
      console.error('[INCIDENT] Error getting incident status:', error)
      throw error
    }
  }

  /**
   * Get full incident history (immutable timeline)
   */
  async getIncidentHistory(incidentId: string): Promise<any[]> {
    try {
      const result = await query(
        `SELECT 
          il.event_type, il.status_before, il.status_after, il.actor_user_id,
          il.actor_role, il.metadata, il.event_at, il.checksum,
          u.email as actor_email
         FROM incident_lifecycle il
         LEFT JOIN users u ON il.actor_user_id = u.id
         WHERE il.incident_id = $1
         ORDER BY il.event_at ASC`,
        [incidentId]
      )

      return result.rows
    } catch (error) {
      console.error('[INCIDENT] Error getting incident history:', error)
      throw error
    }
  }

  /**
   * Get all open incidents
   */
  async getOpenIncidents(): Promise<any[]> {
    try {
      const result = await query(
        `SELECT * FROM open_incidents ORDER BY created_at DESC LIMIT 100`
      )

      return result.rows
    } catch (error) {
      console.error('[INCIDENT] Error getting open incidents:', error)
      throw error
    }
  }

  /**
   * Get overdue incidents (no ACK in threshold)
   */
  async getOverdueIncidents(): Promise<any[]> {
    try {
      const result = await query(
        `SELECT * FROM overdue_incidents WHERE hours_since_creation > 1 ORDER BY created_at ASC`
      )

      return result.rows
    } catch (error) {
      console.error('[INCIDENT] Error getting overdue incidents:', error)
      throw error
    }
  }

  /**
   * Get incident by ID with full context
   */
  async getIncidentDetails(incidentId: string): Promise<{
    incident: any
    acknowledgment: any | null
    rootCause: any | null
    resolution: any | null
    timeline: any[]
    escalations: any[]
  } | null> {
    try {
      // Get incident
      const incidentResult = await query(`SELECT * FROM incidents WHERE id = $1`, [incidentId])

      if (incidentResult.rows.length === 0) {
        return null
      }

      // Get acknowledgment
      const ackResult = await query(
        `SELECT * FROM incident_acknowledgments WHERE incident_id = $1`,
        [incidentId]
      )

      // Get root cause
      const rcResult = await query(`SELECT * FROM incident_root_causes WHERE incident_id = $1`, [
        incidentId,
      ])

      // Get resolution
      const resResult = await query(`SELECT * FROM incident_resolution WHERE incident_id = $1`, [
        incidentId,
      ])

      // Get timeline
      const timeline = await this.getIncidentHistory(incidentId)

      // Get escalations
      const escResult = await query(
        `SELECT * FROM incident_escalations WHERE incident_id = $1 ORDER BY escalated_at DESC`,
        [incidentId]
      )

      return {
        incident: incidentResult.rows[0],
        acknowledgment: ackResult.rows[0] || null,
        rootCause: rcResult.rows[0] || null,
        resolution: resResult.rows[0] || null,
        timeline,
        escalations: escResult.rows,
      }
    } catch (error) {
      console.error('[INCIDENT] Error getting incident details:', error)
      throw error
    }
  }

  /**
   * Log incident lifecycle event (immutable append-only)
   */
  private async logIncidentEvent(params: {
    incidentId: string
    eventType: string
    statusAfter: string
    statusBefore?: string
    actorUserId?: string | null
    actorRole?: string
    metadata?: any
  }): Promise<string> {
    try {
      const eventId = uuidv4()
      const checksum = this.generateChecksum(eventId, params.eventType + params.statusAfter)

      await query(
        `INSERT INTO incident_lifecycle (
          id, incident_id, event_type, status_before, status_after,
          actor_user_id, actor_role, metadata, checksum
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          eventId,
          params.incidentId,
          params.eventType,
          params.statusBefore || null,
          params.statusAfter,
          params.actorUserId || null,
          params.actorRole || 'SYSTEM',
          params.metadata ? JSON.stringify(params.metadata) : null,
          checksum,
        ]
      )

      // Update incidents.total_events counter
      await query(
        `UPDATE incidents SET total_events = total_events + 1 WHERE id = $1`,
        [params.incidentId]
      )

      return eventId
    } catch (error) {
      console.error('[INCIDENT] Error logging event:', error)
      throw error
    }
  }

  /**
   * Create escalation event
   */
  async createEscalation(params: {
    incidentId: string
    escalationReason: string
    escalatedToUserId: string
  }): Promise<string> {
    try {
      const escId = uuidv4()
      const checksum = this.generateChecksum(escId, params.escalationReason)

      await query(
        `INSERT INTO incident_escalations (
          id, incident_id, escalation_reason, escalated_to_user_id, checksum
        ) VALUES ($1, $2, $3, $4, $5)`,
        [escId, params.incidentId, params.escalationReason, params.escalatedToUserId, checksum]
      )

      // Log escalation event
      await this.logIncidentEvent({
        incidentId: params.incidentId,
        eventType: 'ESCALATED',
        statusAfter: 'REPORTED', // Status doesn't change, just escalated
        actorUserId: null,
        actorRole: 'SYSTEM',
        metadata: {
          escalationReason: params.escalationReason,
          escalatedTo: params.escalatedToUserId,
        },
      })

      console.warn(`[INCIDENT_ESCALATION] Incident ${params.incidentId} escalated: ${params.escalationReason}`)

      return escId
    } catch (error) {
      console.error('[INCIDENT] Error creating escalation:', error)
      throw error
    }
  }

  // ===========================
  // HELPER FUNCTIONS
  // ===========================

  private severityToIncidentType(severity: IncidentSeverity): IncidentType {
    switch (severity) {
      case 'CRITICAL':
        return 'P0_INCIDENT'
      case 'HIGH':
        return 'P1_INCIDENT'
      case 'MEDIUM':
        return 'P2_INCIDENT'
      default:
        return 'P2_INCIDENT'
    }
  }

  private generateChecksum(id: string, content: string): string {
    return crypto.createHash('sha256').update(id + content).hexdigest()
  }
}

export default IncidentManagementService
