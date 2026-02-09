/**
 * PHASE 5, STEP 5.3: Incident Replay System
 * Export, store, and replay incidents for forensic analysis and testing
 *
 * Purpose: Enable forensic replay of production incidents to understand
 * system behavior and validate fixes
 */

import { query } from '../db/connection.js'
import {
  acknowledgeIncident,
  escalateIncident,
  assignRootCause,
  startInvestigation,
  beginMitigation,
  resolveIncident,
  closeIncident,
} from './incidentLifecycleService.js'

export interface IncidentReplayRecord {
  id: string
  incidentId: string
  title: string
  description: string
  severity: string
  originalCreatedAt: string
  exportedAt: string
  actions: IncidentActionRecord[]
  timeline: any[]
  escalations: any[]
  rootCauseAnalyses: any[]
  metadata: Record<string, any>
}

export interface IncidentActionRecord {
  sequence: number
  timestamp: string
  action: string
  actor?: string
  payload: Record<string, any>
  result?: Record<string, any>
}

export interface ReplayResult {
  replayId: string
  originalIncidentId: string
  status: 'completed' | 'failed'
  actionsReplayed: number
  actionsFailed: number
  duration: number
  newIncidentId?: string
  differences: string[]
  createdAt: string
}

/**
 * Export an incident with complete audit trail
 */
export async function exportIncident(incidentId: string): Promise<IncidentReplayRecord> {
  try {
    // Get incident details
    const incidentResult = await query('SELECT * FROM incidents WHERE id = $1', [incidentId])
    if (incidentResult.rows.length === 0) {
      throw new Error(`Incident ${incidentId} not found`)
    }

    const incident = incidentResult.rows[0]

    // Get timeline
    const timelineResult = await query(
      `SELECT * FROM incident_timeline_events 
       WHERE incident_id = $1 
       ORDER BY created_at ASC`,
      [incidentId]
    )

    // Get escalations
    const escalationsResult = await query(
      `SELECT * FROM incident_escalations 
       WHERE incident_id = $1 
       ORDER BY created_at ASC`,
      [incidentId]
    )

    // Get root cause analyses
    const rootCausesResult = await query(
      `SELECT * FROM incident_root_cause_analyses 
       WHERE incident_id = $1 
       ORDER BY assigned_at ASC`,
      [incidentId]
    )

    // Build action sequence from timeline
    const actions: IncidentActionRecord[] = timelineResult.rows.map((event, idx) => ({
      sequence: idx + 1,
      timestamp: event.created_at.toISOString(),
      action: event.event_type,
      actor: event.performed_by_user_id,
      payload: {
        description: event.description,
        oldValue: event.old_value,
        newValue: event.new_value,
      },
    }))

    const exportRecord: IncidentReplayRecord = {
      id: `export_${incidentId}_${Date.now()}`,
      incidentId,
      title: incident.title,
      description: incident.description,
      severity: incident.severity,
      originalCreatedAt: incident.created_at.toISOString(),
      exportedAt: new Date().toISOString(),
      actions,
      timeline: timelineResult.rows,
      escalations: escalationsResult.rows,
      rootCauseAnalyses: rootCausesResult.rows,
      metadata: {
        originalStatus: incident.status,
        errorSource: incident.error_source,
        tenantId: incident.platform_id,
        acknowledgedAt: incident.acknowledged_at?.toISOString(),
        resolvedAt: incident.resolved_at?.toISOString(),
      },
    }

    console.log(`[REPLAY] Exported incident ${incidentId}`)

    // Store export record for audit
    await query(
      `INSERT INTO incident_exports (incident_id, export_data, exported_at)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [incidentId, JSON.stringify(exportRecord), new Date()]
    ).catch(() => {
      // Table may not exist, continue anyway
    })

    return exportRecord
  } catch (error: any) {
    console.error('[REPLAY] Error exporting incident:', error)
    throw error
  }
}

/**
 * Replay an exported incident to validate fixes or understand behavior
 */
export async function replayIncident(
  record: IncidentReplayRecord,
  userId: string,
  platformId: string,
  simulateChanges?: boolean
): Promise<ReplayResult> {
  const startTime = Date.now()
  let actionsReplayed = 0
  let actionsFailed = 0
  const differences: string[] = []
  let newIncidentId = ''

  try {
    console.log(`[REPLAY] Replaying incident ${record.incidentId}...`)

    // Create new incident from exported data
    const createResult = await query(
      `INSERT INTO incidents 
        (title, description, severity, status, error_source, platform_id) 
       VALUES ($1, $2, $3, $4, $5, $6) 
       RETURNING id`,
      [
        `[REPLAY] ${record.title}`,
        `Original: ${record.description}\nOriginal Created: ${record.originalCreatedAt}`,
        record.severity,
        'open',
        record.metadata.errorSource,
        platformId,
      ]
    )

    newIncidentId = createResult.rows[0].id
    console.log(`[REPLAY] Created replay incident: ${newIncidentId}`)

    // Replay each action in sequence
    for (const action of record.actions) {
      try {
        console.log(
          `  [${action.sequence}/${record.actions.length}] ${action.action} (originally at ${action.timestamp})`
        )

        switch (action.action) {
          case 'acknowledged':
            await acknowledgeIncident(newIncidentId, {
              acknowledgedByUserId: userId,
              acknowledgementNote: action.payload.description,
            })
            break

          case 'escalated':
            // Extract escalation details from payload
            if (record.escalations.length > 0) {
              const escalation = record.escalations[0]
              await escalateIncident(newIncidentId, {
                escalationLevel: escalation.escalation_level,
                escalationReason: escalation.reason,
                escalatedByUserId: userId,
                escalationNote: escalation.escalation_note,
              })
            }
            break

          case 'investigation_started':
            await startInvestigation(newIncidentId, userId, action.payload.description)
            break

          case 'root_cause_assigned':
            if (record.rootCauseAnalyses.length > 0) {
              const rca = record.rootCauseAnalyses[0]
              await assignRootCause(newIncidentId, {
                rootCause: rca.root_cause,
                assignedByUserId: userId,
                confidence: rca.confidence_level,
                analysisNotes: rca.analysis_notes,
                analysisEvidence: rca.analysis_evidence,
              })
            }
            break

          case 'mitigation_started':
            await beginMitigation(newIncidentId, userId, action.payload.description)
            break

          case 'resolved':
            if (simulateChanges) {
              // Option to use identical values or validate system allows replay
              await resolveIncident(newIncidentId, userId, {
                rootCause: `[REPLAYED] ${record.metadata.originalStatus}`,
                remediationSteps: 'Replayed remediation from original incident',
                preventionMeasures: 'Replayed prevention measures from original incident',
              })
            } else {
              console.log(`  [SKIP] Resolution step skipped (use simulateChanges=true to complete)`)
            }
            break

          case 'closed':
            if (simulateChanges) {
              await closeIncident(newIncidentId, userId, {
                closureNote: 'Replayed from forensic analysis',
              })
            }
            break

          case 'created':
            // Skip - already created
            console.log(`  [SKIP] Creation step already executed`)
            continue
        }

        actionsReplayed++
      } catch (error: any) {
        actionsFailed++
        console.error(`  [ERROR] Action ${action.sequence} failed: ${error.message}`)
        differences.push(`Step ${action.sequence} (${action.action}): ${error.message}`)
      }
    }

    const duration = Date.now() - startTime

    console.log(`[REPLAY] Completed: ${actionsReplayed}/${record.actions.length} actions replayed`)

    // Verify the replayed incident
    const verifyResult = await query('SELECT status FROM incidents WHERE id = $1', [newIncidentId])
    const finalStatus = verifyResult.rows[0]?.status

    if (finalStatus !== record.metadata.originalStatus && simulateChanges) {
      differences.push(
        `Final status mismatch: original='${record.metadata.originalStatus}', replay='${finalStatus}'`
      )
    }

    // Store replay record
    await query(
      `INSERT INTO incident_replay_runs (original_incident_id, replayed_incident_id, actions_replayed, 
        actions_failed, duration_ms, status, differences)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT DO NOTHING`,
      [
        record.incidentId,
        newIncidentId,
        actionsReplayed,
        actionsFailed,
        duration,
        actionsFailed === 0 ? 'success' : 'partial',
        JSON.stringify(differences),
      ]
    ).catch(() => {
      // Table may not exist
    })

    return {
      replayId: `replay_${Date.now()}`,
      originalIncidentId: record.incidentId,
      status: actionsFailed === 0 ? 'completed' : 'failed',
      actionsReplayed,
      actionsFailed,
      duration,
      newIncidentId,
      differences,
      createdAt: new Date().toISOString(),
    }
  } catch (error: any) {
    console.error('[REPLAY] Replay failed:', error)
    return {
      replayId: `replay_${Date.now()}`,
      originalIncidentId: record.incidentId,
      status: 'failed',
      actionsReplayed,
      actionsFailed,
      duration: Date.now() - startTime,
      differences: [error.message],
      createdAt: new Date().toISOString(),
    }
  }
}

/**
 * Export all critical incidents for forensic analysis
 */
export async function exportCriticalIncidents(platformId: string): Promise<IncidentReplayRecord[]> {
  try {
    const result = await query(
      `SELECT id FROM incidents 
       WHERE platform_id = $1 AND severity = 'critical' AND status IN ('resolved', 'closed')
       ORDER BY created_at DESC
       LIMIT 50`,
      [platformId]
    )

    const exports: IncidentReplayRecord[] = []

    for (const row of result.rows) {
      try {
        const exported = await exportIncident(row.id)
        exports.push(exported)
      } catch (error: any) {
        console.error(`Failed to export incident ${row.id}:`, error)
      }
    }

    console.log(`[REPLAY] Exported ${exports.length} critical incidents`)
    return exports
  } catch (error: any) {
    console.error('[REPLAY] Error exporting critical incidents:', error)
    throw error
  }
}

/**
 * Import and replay multiple incidents
 */
export async function replayMultipleIncidents(
  records: IncidentReplayRecord[],
  userId: string,
  platformId: string
): Promise<{
  totalReplayed: number
  successful: number
  failed: number
  results: ReplayResult[]
}> {
  const results: ReplayResult[] = []

  console.log(`[REPLAY] Starting batch replay of ${records.length} incidents...`)

  for (const record of records) {
    try {
      const result = await replayIncident(record, userId, platformId, true)
      results.push(result)
    } catch (error: any) {
      console.error(`Failed to replay ${record.incidentId}:`, error)
    }
  }

  const successful = results.filter((r) => r.status === 'completed').length
  const failed = results.filter((r) => r.status === 'failed').length

  console.log(`[REPLAY] Batch replay complete: ${successful} successful, ${failed} failed`)

  return {
    totalReplayed: records.length,
    successful,
    failed,
    results,
  }
}
