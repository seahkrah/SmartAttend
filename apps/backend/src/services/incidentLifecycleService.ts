/**
 * Incident lifecycle: the transitions an incident may make, and the record
 * each one leaves.
 *
 * This used to work in a vocabulary of its own: lower-case statuses, and
 * 'acknowledged', 'escalated' and 'mitigating', none of which the incidents
 * table allows. Its status check admits only OPEN, INVESTIGATING, CONTAINED,
 * RESOLVED and CLOSED. Every precondition compared lower case with the
 * stored upper case and refused, and every status it wrote would have failed
 * the constraint, so no incident could be acknowledged, escalated,
 * investigated, mitigated, resolved or closed through this service.
 *
 * Now:
 *   OPEN ──investigate / root cause──▶ INVESTIGATING ──mitigate──▶ CONTAINED
 *     └────────────── resolve (from any of the three) ──────────▶ RESOLVED ──close──▶ CLOSED
 *
 * Acknowledging and escalating are facts about an incident, not states: an
 * acknowledgement stamps acknowledged_at/by once, and an escalation is a
 * record of its own. Each transition is a single UPDATE guarded by the
 * status it expects, so two people acting at once cannot both succeed.
 */

import { getConnection, query } from '../db/connection.js'
import { createTimelineEvent } from './incidentService.js'

export type IncidentStatus = 'OPEN' | 'INVESTIGATING' | 'CONTAINED' | 'RESOLVED' | 'CLOSED'

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

const ACTIVE: IncidentStatus[] = ['OPEN', 'INVESTIGATING', 'CONTAINED']

/** Why a transition was refused. The message is shown to whoever asked. */
export class IncidentTransitionError extends Error {}

async function currentStatus(incidentId: string): Promise<{ status: IncidentStatus; severity: string } | null> {
  const r = await query('SELECT status, severity FROM incidents WHERE id = $1', [incidentId])
  return r.rows[0] ?? null
}

/**
 * Moves an incident from one of `from` to `to` in one guarded statement.
 * Returns the status it moved from; throws if it was in none of `from`.
 */
async function transition(
  incidentId: string,
  from: IncidentStatus[],
  to: IncidentStatus,
  extraSet = '',
  extraParams: any[] = []
): Promise<IncidentStatus> {
  const before = await currentStatus(incidentId)
  if (!before) throw new IncidentTransitionError('Incident not found')
  const r = await query(
    `UPDATE incidents SET status = $2${extraSet ? ', ' + extraSet : ''}
      WHERE id = $1 AND status = ANY($3::text[])
      RETURNING id`,
    [incidentId, to, from, ...extraParams]
  )
  if (r.rows.length === 0) {
    const now = await currentStatus(incidentId)
    throw new IncidentTransitionError(
      `This incident is ${String(now?.status ?? before.status).toLowerCase()}; `
      + `only ${from.map((f) => f.toLowerCase()).join(' or ')} incidents can become ${to.toLowerCase()}`
    )
  }
  return before.status
}

function required(value: unknown, name: string, min = 1): string {
  const v = typeof value === 'string' ? value.trim() : ''
  if (v.length < min) {
    throw new IncidentTransitionError(min > 1 ? `${name} must be at least ${min} characters` : `${name} is required`)
  }
  return v
}

/** Records that someone has seen the incident and is on it. Once only. */
export async function acknowledgeIncident(
  incidentId: string,
  acknowledgement: IncidentAcknowledgement
): Promise<void> {
  const note = acknowledgement.acknowledgementNote?.trim() || null
  const r = await query(
    `UPDATE incidents
        SET acknowledged_at = CURRENT_TIMESTAMP, acknowledged_by_user_id = $2
      WHERE id = $1 AND acknowledged_at IS NULL AND status = ANY($3::text[])
      RETURNING status`,
    [incidentId, acknowledgement.acknowledgedByUserId, ACTIVE]
  )
  if (r.rows.length === 0) {
    const now = await currentStatus(incidentId)
    if (!now) throw new IncidentTransitionError('Incident not found')
    throw new IncidentTransitionError(
      ACTIVE.includes(now.status) ? 'This incident has already been acknowledged' : `A ${now.status.toLowerCase()} incident cannot be acknowledged`
    )
  }
  await query(
    `INSERT INTO incident_acknowledgements (incident_id, acknowledged_by_user_id, acknowledgement_note)
     VALUES ($1, $2, $3)`,
    [incidentId, acknowledgement.acknowledgedByUserId, note]
  )
  await createTimelineEvent(incidentId, 'acknowledged', null, r.rows[0].status,
    `Acknowledged${note ? ': ' + note : ''}`, acknowledgement.acknowledgedByUserId)
}

const SEVERITY_RANK: Record<string, number> = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 }
const ESCALATION_RANK: Record<EscalationLevel, number> = { level_1: 1, level_2: 2, level_3: 3, executive: 4 }

/** Records an escalation. The incident's status does not change. */
export async function escalateIncident(incidentId: string, escalation: IncidentEscalation): Promise<void> {
  const incident = await currentStatus(incidentId)
  if (!incident) throw new IncidentTransitionError('Incident not found')
  if (!ACTIVE.includes(incident.status)) {
    throw new IncidentTransitionError(`A ${incident.status.toLowerCase()} incident cannot be escalated`)
  }
  if (!(escalation.escalationLevel in ESCALATION_RANK)) {
    throw new IncidentTransitionError(`escalationLevel must be one of ${Object.keys(ESCALATION_RANK).join(', ')}`)
  }
  const reason = required(escalation.escalationReason, 'escalationReason')
  if (ESCALATION_RANK[escalation.escalationLevel] < (SEVERITY_RANK[incident.severity] ?? 1)) {
    throw new IncidentTransitionError(
      `A ${incident.severity.toLowerCase()} incident needs escalation level ${Object.keys(ESCALATION_RANK)[(SEVERITY_RANK[incident.severity] ?? 1) - 1]} or higher`
    )
  }
  await query(
    `INSERT INTO incident_escalations (incident_id, escalation_level, reason, escalated_by_user_id, escalation_note)
     VALUES ($1, $2, $3, $4, $5)`,
    [incidentId, escalation.escalationLevel, reason, escalation.escalatedByUserId, escalation.escalationNote || null]
  )
  await createTimelineEvent(incidentId, 'escalated', null, escalation.escalationLevel,
    `Escalated to ${escalation.escalationLevel}: ${reason}`, escalation.escalatedByUserId)
}

/** Records a root-cause finding; an open incident moves to investigating. */
export async function assignRootCause(incidentId: string, rootCause: RootCauseAssignment): Promise<void> {
  const cause = required(rootCause.rootCause, 'Root cause', 10)
  if (!['low', 'medium', 'high'].includes(rootCause.confidence)) {
    throw new IncidentTransitionError('confidence must be low, medium or high')
  }
  const incident = await currentStatus(incidentId)
  if (!incident) throw new IncidentTransitionError('Incident not found')
  if (!ACTIVE.includes(incident.status)) {
    throw new IncidentTransitionError(`A ${incident.status.toLowerCase()} incident's root cause is recorded in its resolution`)
  }
  const r = await query(
    `UPDATE incidents SET root_cause = $2,
            status = CASE WHEN status = 'OPEN' THEN 'INVESTIGATING' ELSE status END
      WHERE id = $1 AND status = ANY($3::text[]) RETURNING status`,
    [incidentId, cause, ACTIVE]
  )
  if (r.rows.length === 0) throw new IncidentTransitionError('The incident changed while this was being saved; try again')
  await query(
    `INSERT INTO incident_root_cause_analyses (incident_id, root_cause, assigned_by_user_id, confidence_level, analysis_notes)
     VALUES ($1, $2, $3, $4, $5)`,
    [incidentId, cause, rootCause.assignedByUserId, rootCause.confidence, rootCause.analysisNotes || null]
  )
  await createTimelineEvent(incidentId, 'root_cause_assigned', incident.status, r.rows[0].status,
    `Root cause (${rootCause.confidence} confidence): ${cause}`, rootCause.assignedByUserId)
}

/** OPEN → INVESTIGATING. */
export async function startInvestigation(incidentId: string, userId: string, investigationNote?: string): Promise<void> {
  const from = await transition(incidentId, ['OPEN'], 'INVESTIGATING')
  await createTimelineEvent(incidentId, 'investigation_started', from, 'INVESTIGATING',
    `Investigation started${investigationNote?.trim() ? ': ' + investigationNote.trim() : ''}`, userId)
}

/** INVESTIGATING → CONTAINED: the harm has stopped, the cause may not be fixed yet. */
export async function beginMitigation(incidentId: string, userId: string, mitigationPlan?: string): Promise<void> {
  const from = await transition(incidentId, ['INVESTIGATING'], 'CONTAINED', 'contained_at = CURRENT_TIMESTAMP')
  await createTimelineEvent(incidentId, 'contained', from, 'CONTAINED',
    `Contained${mitigationPlan?.trim() ? ': ' + mitigationPlan.trim() : ''}`, userId)
}

/** Any active status → RESOLVED, with the account of what happened and what changes. */
export async function resolveIncident(incidentId: string, resolution: ResolutionSummary, userId: string): Promise<void> {
  const rootCause = required(resolution.rootCause, 'rootCause')
  const remediation = required(resolution.remediationSteps, 'remediationSteps')
  const prevention = required(resolution.preventionMeasures, 'preventionMeasures')
  const postMortem = resolution.postMortemUrl?.trim() || null
  if (postMortem && !/^https?:\/\//i.test(postMortem)) {
    throw new IncidentTransitionError('postMortemUrl must be an http(s) address')
  }

  const client = await getConnection()
  try {
    await client.query('BEGIN')
    const before = await client.query('SELECT status FROM incidents WHERE id = $1 FOR UPDATE', [incidentId])
    if (before.rows.length === 0) throw new IncidentTransitionError('Incident not found')
    if (!ACTIVE.includes(before.rows[0].status)) {
      throw new IncidentTransitionError(`This incident is already ${String(before.rows[0].status).toLowerCase()}`)
    }
    await client.query(
      `UPDATE incidents
          SET status = 'RESOLVED', root_cause = $2, remediation_steps = $3, prevention_measures = $4,
              post_mortem_url = COALESCE($5, post_mortem_url), resolved_by_user_id = $6,
              resolved_at = CURRENT_TIMESTAMP
        WHERE id = $1`,
      [incidentId, rootCause, remediation, prevention, postMortem, userId]
    )
    await client.query(
      `INSERT INTO incident_resolution_summaries
         (incident_id, root_cause, remediation_steps, prevention_measures, post_mortem_url, estimated_impact, resolved_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [incidentId, rootCause, remediation, prevention, postMortem, resolution.estimatedImpact?.trim() || null, userId]
    )
    await client.query('COMMIT')
    await createTimelineEvent(incidentId, 'resolved', before.rows[0].status, 'RESOLVED',
      `Resolved. Root cause: ${rootCause}`, userId)
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw e
  } finally {
    client.release()
  }
}

/** RESOLVED → CLOSED: nothing further is expected. */
export async function closeIncident(incidentId: string, userId: string, closureNote?: string): Promise<void> {
  const from = await transition(incidentId, ['RESOLVED'], 'CLOSED')
  await query(
    `UPDATE incident_resolution_summaries SET closed_at = CURRENT_TIMESTAMP, closed_by_user_id = $2
      WHERE id = (SELECT id FROM incident_resolution_summaries WHERE incident_id = $1 ORDER BY resolved_at DESC LIMIT 1)`,
    [incidentId, userId]
  )
  await createTimelineEvent(incidentId, 'closed', from, 'CLOSED',
    `Closed${closureNote?.trim() ? ': ' + closureNote.trim() : ''}`, userId)
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
