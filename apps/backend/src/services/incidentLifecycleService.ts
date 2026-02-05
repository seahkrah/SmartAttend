/**
 * PHASE 5, STEP 5.2: Incident Lifecycle Management Service
 * Enforces incident state transitions and operational requirements
 */

import { query } from '../db/connection.js'
import { createTimelineEvent } from './incidentService.js'

export type IncidentStatus =
  | 'open'
  | 'acknowledged'
  | 'investigating'
  | 'escalated'
  | 'mitigating'
  | 'resolved'
  | 'closed'

export type EscalationLevel = 'level_1' | 'level_2' | 'level_3' | 'executive'

export interface IncidentAcknowledgement {
  acknowledgedByUserId: string
  acknowledgementNote?: string
}

export interface IncidentEscalation {
  escalationLevel: EscalationLevel
  escalationReason: string
  escalatedByUserId: string
  escalationNote?: string
}

export interface RootCauseAssignment {
  rootCause: string
  assignedByUserId: string
  confidence: 'low' | 'medium' | 'high'
  analysisNotes?: string
}

export interface ResolutionSummary {
  rootCause: string
  remediationSteps: string
  preventionMeasures: string
  estimatedImpact?: string
  postMortemUrl?: string
}

/**
 * Acknowledge an incident
 * Transitions: open -> acknowledged, investigating -> acknowledged
 */
export async function acknowledgeIncident(
  incidentId: string,
  acknowledgement: IncidentAcknowledgement
): Promise<void> {
  try {
    // Get current incident
    const result = await query('SELECT status, platform_id FROM incidents WHERE id = $1', [
      incidentId,
    ])

    if (result.rows.length === 0) {
      throw new Error(`Incident ${incidentId} not found`)
    }

    const incident = result.rows[0]

    // Validate state transition
    if (!['open', 'investigating'].includes(incident.status)) {
      throw new Error(
        `Cannot acknowledge incident with status '${incident.status}'. Only 'open' or 'investigating' incidents can be acknowledged.`
      )
    }

    // Update incident
    await query(
      `UPDATE incidents 
       SET status = 'acknowledged', 
           acknowledged_by_user_id = $1, 
           acknowledged_at = CURRENT_TIMESTAMP 
       WHERE id = $2`,
      [acknowledgement.acknowledgedByUserId, incidentId]
    )

    // Create timeline event
    await createTimelineEvent(
      incidentId,
      'acknowledged',
      incident.status,
      'acknowledged',
      `Incident acknowledged${acknowledgement.acknowledgementNote ? ': ' + acknowledgement.acknowledgementNote : ''}`,
      acknowledgement.acknowledgedByUserId
    )

    console.log(`[LIFECYCLE] Incident ${incidentId} acknowledged by ${acknowledgement.acknowledgedByUserId}`)
  } catch (error) {
    console.error('Error acknowledging incident:', error)
    throw error
  }
}

/**
 * Escalate an incident
 * Creates escalation record and updates status to 'escalated'
 */
export async function escalateIncident(
  incidentId: string,
  escalation: IncidentEscalation
): Promise<void> {
  try {
    // Get current incident
    const incidentResult = await query(
      'SELECT status, severity, platform_id FROM incidents WHERE id = $1',
      [incidentId]
    )

    if (incidentResult.rows.length === 0) {
      throw new Error(`Incident ${incidentId} not found`)
    }

    const incident = incidentResult.rows[0]

    // Validate current status can be escalated
    const escalatableStatuses = ['open', 'acknowledged', 'investigating', 'mitigating']
    if (!escalatableStatuses.includes(incident.status)) {
      throw new Error(
        `Cannot escalate incident with status '${incident.status}'. Only ${escalatableStatuses.join(', ')} incidents can be escalated.`
      )
    }

    // Validate escalation level vs severity
    const severityLevels: Record<string, number> = {
      critical: 4,
      high: 3,
      medium: 2,
      low: 1,
    }
    const escalationLevels: Record<EscalationLevel, number> = {
      level_1: 1,
      level_2: 2,
      level_3: 3,
      executive: 4,
    }

    if (escalationLevels[escalation.escalationLevel] < severityLevels[incident.severity]) {
      throw new Error(
        `Escalation level '${escalation.escalationLevel}' is insufficient for '${incident.severity}' severity incident`
      )
    }

    // Create escalation record
    const escalationResult = await query(
      `INSERT INTO incident_escalations 
        (incident_id, escalation_level, reason, escalated_by_user_id, escalation_note) 
       VALUES ($1, $2, $3, $4, $5) 
       RETURNING id`,
      [
        incidentId,
        escalation.escalationLevel,
        escalation.escalationReason,
        escalation.escalatedByUserId,
        escalation.escalationNote || null,
      ]
    )

    // Update incident status to escalated
    await query('UPDATE incidents SET status = $1 WHERE id = $2', ['escalated', incidentId])

    // Create timeline event
    await createTimelineEvent(
      incidentId,
      'escalated',
      incident.status,
      'escalated',
      `Escalated to ${escalation.escalationLevel}: ${escalation.escalationReason}`,
      escalation.escalatedByUserId
    )

    console.log(
      `[LIFECYCLE] Incident ${incidentId} escalated to ${escalation.escalationLevel} by ${escalation.escalatedByUserId}`
    )
  } catch (error) {
    console.error('Error escalating incident:', error)
    throw error
  }
}

/**
 * Assign root cause to incident
 * Transitions: acknowledged/investigating -> investigating
 */
export async function assignRootCause(
  incidentId: string,
  rootCause: RootCauseAssignment
): Promise<void> {
  try {
    // Get current incident
    const result = await query('SELECT status, root_cause FROM incidents WHERE id = $1', [
      incidentId,
    ])

    if (result.rows.length === 0) {
      throw new Error(`Incident ${incidentId} not found`)
    }

    const incident = result.rows[0]

    // Validate state transition
    const validStatuses = ['open', 'acknowledged', 'investigating', 'escalated']
    if (!validStatuses.includes(incident.status)) {
      throw new Error(
        `Cannot assign root cause to incident with status '${incident.status}'. Only ${validStatuses.join(', ')} incidents can have root causes assigned.`
      )
    }

    // Validate root cause length
    if (!rootCause.rootCause || rootCause.rootCause.trim().length < 10) {
      throw new Error('Root cause must be at least 10 characters long')
    }

    // Update incident with root cause
    const newStatus = incident.status === 'open' ? 'investigating' : incident.status
    await query(
      `UPDATE incidents 
       SET root_cause = $1, 
           status = $2 
       WHERE id = $3`,
      [rootCause.rootCause, newStatus, incidentId]
    )

    // Create root cause analysis record
    await query(
      `INSERT INTO incident_root_cause_analyses 
        (incident_id, root_cause, assigned_by_user_id, confidence_level, analysis_notes) 
       VALUES ($1, $2, $3, $4, $5)`,
      [
        incidentId,
        rootCause.rootCause,
        rootCause.assignedByUserId,
        rootCause.confidence,
        rootCause.analysisNotes || null,
      ]
    )

    // Create timeline event
    await createTimelineEvent(
      incidentId,
      'root_cause_assigned',
      incident.root_cause || null,
      rootCause.rootCause,
      `Root cause assigned (${rootCause.confidence} confidence): ${rootCause.rootCause}`,
      rootCause.assignedByUserId
    )

    console.log(`[LIFECYCLE] Root cause assigned to incident ${incidentId}`)
  } catch (error) {
    console.error('Error assigning root cause:', error)
    throw error
  }
}

/**
 * Start investigation of incident
 * Transitions: acknowledged -> investigating
 */
export async function startInvestigation(
  incidentId: string,
  userId: string,
  investigationNote?: string
): Promise<void> {
  try {
    // Get current incident
    const result = await query('SELECT status FROM incidents WHERE id = $1', [incidentId])

    if (result.rows.length === 0) {
      throw new Error(`Incident ${incidentId} not found`)
    }

    const incident = result.rows[0]

    // Validate state transition
    const validStatuses = ['open', 'acknowledged', 'escalated']
    if (!validStatuses.includes(incident.status)) {
      throw new Error(
        `Cannot start investigation on incident with status '${incident.status}'. Only ${validStatuses.join(', ')} incidents can be investigated.`
      )
    }

    // Update incident
    await query('UPDATE incidents SET status = $1 WHERE id = $2', ['investigating', incidentId])

    // Create timeline event
    await createTimelineEvent(
      incidentId,
      'investigation_started',
      incident.status,
      'investigating',
      `Investigation started${investigationNote ? ': ' + investigationNote : ''}`,
      userId
    )

    console.log(`[LIFECYCLE] Investigation started for incident ${incidentId}`)
  } catch (error) {
    console.error('Error starting investigation:', error)
    throw error
  }
}

/**
 * Begin mitigation of incident
 * Transitions: investigating -> mitigating
 */
export async function beginMitigation(
  incidentId: string,
  userId: string,
  mitigationPlan?: string
): Promise<void> {
  try {
    // Get current incident
    const result = await query('SELECT status FROM incidents WHERE id = $1', [incidentId])

    if (result.rows.length === 0) {
      throw new Error(`Incident ${incidentId} not found`)
    }

    const incident = result.rows[0]

    // Validate state transition
    if (incident.status !== 'investigating') {
      throw new Error(
        `Cannot begin mitigation on incident with status '${incident.status}'. Only 'investigating' incidents can be mitigated.`
      )
    }

    // Update incident
    await query('UPDATE incidents SET status = $1 WHERE id = $2', ['mitigating', incidentId])

    // Create timeline event
    await createTimelineEvent(
      incidentId,
      'mitigation_started',
      incident.status,
      'mitigating',
      `Mitigation started${mitigationPlan ? ': ' + mitigationPlan : ''}`,
      userId
    )

    console.log(`[LIFECYCLE] Mitigation started for incident ${incidentId}`)
  } catch (error) {
    console.error('Error beginning mitigation:', error)
    throw error
  }
}

/**
 * Resolve an incident
 * Requires: root cause, remediation steps, prevention measures
 * Transitions: * -> resolved
 */
export async function resolveIncident(
  incidentId: string,
  resolution: ResolutionSummary,
  userId: string
): Promise<void> {
  try {
    // Get current incident
    const result = await query(
      'SELECT status, root_cause, remediation_steps, prevention_measures FROM incidents WHERE id = $1',
      [incidentId]
    )

    if (result.rows.length === 0) {
      throw new Error(`Incident ${incidentId} not found`)
    }

    const incident = result.rows[0]

    // Validate all required resolution fields are provided
    const missingFields: string[] = []
    if (!resolution.rootCause || resolution.rootCause.trim().length === 0) {
      missingFields.push('rootCause')
    }
    if (!resolution.remediationSteps || resolution.remediationSteps.trim().length === 0) {
      missingFields.push('remediationSteps')
    }
    if (!resolution.preventionMeasures || resolution.preventionMeasures.trim().length === 0) {
      missingFields.push('preventionMeasures')
    }

    if (missingFields.length > 0) {
      throw new Error(
        `Cannot resolve incident without required fields: ${missingFields.join(', ')}. All fields must be non-empty.`
      )
    }

    // Update incident with resolution details
    await query(
      `UPDATE incidents 
       SET status = $1, 
           root_cause = $2, 
           remediation_steps = $3, 
           prevention_measures = $4, 
           resolved_by_user_id = $5, 
           resolved_at = CURRENT_TIMESTAMP 
       WHERE id = $6`,
      [
        'resolved',
        resolution.rootCause,
        resolution.remediationSteps,
        resolution.preventionMeasures,
        userId,
        incidentId,
      ]
    )

    // If post mortem URL provided, update it
    if (resolution.postMortemUrl) {
      await query('UPDATE incidents SET post_mortem_url = $1 WHERE id = $2', [
        resolution.postMortemUrl,
        incidentId,
      ])
    }

    // Create timeline event
    await createTimelineEvent(
      incidentId,
      'resolved',
      incident.status,
      'resolved',
      `Incident resolved with comprehensive summary provided${resolution.postMortemUrl ? ' and post-mortem URL' : ''}`,
      userId
    )

    console.log(`[LIFECYCLE] Incident ${incidentId} resolved by ${userId}`)
  } catch (error) {
    console.error('Error resolving incident:', error)
    throw error
  }
}

/**
 * Close a resolved incident
 * Can only close 'resolved' incidents
 * Transitions: resolved -> closed
 */
export async function closeIncident(
  incidentId: string,
  userId: string,
  closureNote?: string
): Promise<void> {
  try {
    // Get current incident
    const result = await query(
      'SELECT status, resolved_at, root_cause, remediation_steps, prevention_measures FROM incidents WHERE id = $1',
      [incidentId]
    )

    if (result.rows.length === 0) {
      throw new Error(`Incident ${incidentId} not found`)
    }

    const incident = result.rows[0]

    // Validate state transition - can only close resolved incidents
    if (incident.status !== 'resolved') {
      throw new Error(
        `Cannot close incident with status '${incident.status}'. Only 'resolved' incidents can be closed.`
      )
    }

    // Verify all required resolution fields exist
    if (!incident.root_cause || !incident.remediation_steps || !incident.prevention_measures) {
      throw new Error(
        'Cannot close incident without complete resolution summary (root cause, remediation steps, prevention measures)'
      )
    }

    // Update incident to closed
    await query('UPDATE incidents SET status = $1 WHERE id = $2', ['closed', incidentId])

    // Create timeline event
    await createTimelineEvent(
      incidentId,
      'closed',
      incident.status,
      'closed',
      `Incident closed${closureNote ? ': ' + closureNote : ''}`,
      userId
    )

    console.log(`[LIFECYCLE] Incident ${incidentId} closed by ${userId}`)
  } catch (error) {
    console.error('Error closing incident:', error)
    throw error
  }
}

/**
 * Get incident lifecycle timeline
 */
export async function getIncidentTimeline(incidentId: string): Promise<any[]> {
  try {
    const result = await query(
      `SELECT * FROM incident_timeline_events 
       WHERE incident_id = $1 
       ORDER BY created_at ASC`,
      [incidentId]
    )
    return result.rows
  } catch (error) {
    console.error('Error retrieving incident timeline:', error)
    throw error
  }
}

/**
 * Get incident escalation history
 */
export async function getEscalationHistory(incidentId: string): Promise<any[]> {
  try {
    const result = await query(
      `SELECT * FROM incident_escalations 
       WHERE incident_id = $1 
       ORDER BY created_at DESC`,
      [incidentId]
    )
    return result.rows
  } catch (error) {
    console.error('Error retrieving escalation history:', error)
    throw error
  }
}

/**
 * Get root cause analysis
 */
export async function getRootCauseAnalysis(incidentId: string): Promise<any[]> {
  try {
    const result = await query(
      `SELECT * FROM incident_root_cause_analyses 
       WHERE incident_id = $1 
       ORDER BY assigned_at DESC`,
      [incidentId]
    )
    return result.rows
  } catch (error) {
    console.error('Error retrieving root cause analysis:', error)
    throw error
  }
}
