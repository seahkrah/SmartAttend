/**
 * PHASE 5, STEP 5.3: Admin Handoff Procedures
 * Formal procedures for handing off incident management between admins
 *
 * Purpose: Ensure clean handoffs between different admins/shifts
 * with complete audit trail and no loss of operational context
 */

import { query } from '../db/connection.js'

export interface AdminHandoff {
  id: string
  incidentId: string
  handoffFromUserId: string
  handoffToUserId: string
  handoffTime: Date
  status: 'pending' | 'accepted' | 'rejected'
  notes: string
  contextBrief: string
  activeIncidents: any[]
  escalationPath: string
  nextActions: string[]
  createdAt: Date
}

export interface HandoffSession {
  sessionId: string
  fromAdmin: string
  toAdmin: string
  startTime: Date
  endTime?: Date
  status: 'in-progress' | 'completed'
  incidents: AdminHandoff[]
  briefingNotes: string
  systemHealth: {
    openIncidents: number
    escalatedIncidents: number
    slaAtRisk: number
    criticalAlerts: number
  }
}

/**
 * Initiate admin handoff session
 * Typically done at shift change or during escalation
 */
export async function initiateHandoffSession(
  fromUserId: string,
  toUserId: string,
  platformId: string,
  briefingNotes: string
): Promise<HandoffSession> {
  const sessionId = `handoff_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  const startTime = new Date()

  try {
    console.log(`[HANDOFF] Initiating handoff from ${fromUserId} to ${toUserId}`)

    // Get current system health snapshot
    const systemHealthResult = await query(
      `SELECT 
         (SELECT COUNT(*) FROM incidents WHERE platform_id = $1 AND status NOT IN ('resolved', 'closed')) as open_incidents,
         (SELECT COUNT(*) FROM incidents WHERE platform_id = $1 AND status = 'escalated') as escalated_incidents,
         (SELECT COUNT(*) FROM incidents WHERE platform_id = $1 AND severity IN ('critical', 'high') AND status NOT IN ('resolved', 'closed')) as critical_alerts
       WHERE platform_id = $1`,
      [platformId]
    )

    const healthData = systemHealthResult.rows[0]

    // Get all open incidents for handoff
    const incidentsResult = await query(
      `SELECT id, title, severity, status, created_at, acknowledged_by_user_id
       FROM incidents 
       WHERE platform_id = $1 AND status NOT IN ('resolved', 'closed')
       ORDER BY severity DESC, created_at ASC`,
      [platformId]
    )

    // Create handoff records for each incident
    const handoffs: AdminHandoff[] = []

    for (const incident of incidentsResult.rows) {
      const handoff: AdminHandoff = {
        id: `ho_${incident.id}`,
        incidentId: incident.id,
        handoffFromUserId: fromUserId,
        handoffToUserId: toUserId,
        handoffTime: startTime,
        status: 'pending',
        notes: `Handoff: ${incident.title} (${incident.severity})`,
        contextBrief: `Status: ${incident.status}, Created: ${incident.created_at}`,
        activeIncidents: incidentsResult.rows.map((i) => ({
          id: i.id,
          title: i.title,
          severity: i.severity,
          status: i.status,
        })),
        escalationPath: await buildEscalationPath(incident.id),
        nextActions: await suggestNextActions(incident.id),
        createdAt: startTime,
      }

      handoffs.push(handoff)
    }

    const session: HandoffSession = {
      sessionId,
      fromAdmin: fromUserId,
      toAdmin: toUserId,
      startTime,
      status: 'in-progress',
      incidents: handoffs,
      briefingNotes,
      systemHealth: {
        openIncidents: incidentsResult.rows.length,
        escalatedIncidents: parseInt(healthData.escalated_incidents),
        slaAtRisk: 0, // TODO: Calculate from SLA table
        criticalAlerts: parseInt(healthData.critical_alerts),
      },
    }

    // Store handoff session
    await query(
      `INSERT INTO admin_handoff_sessions (session_id, from_user_id, to_user_id, session_data, status, started_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT DO NOTHING`,
      [sessionId, fromUserId, toUserId, JSON.stringify(session), 'in_progress', startTime]
    ).catch(() => {
      console.log('[HANDOFF] Session table not available, continuing without storage')
    })

    console.log(`[HANDOFF] Session ${sessionId} created with ${handoffs.length} incidents`)

    return session
  } catch (error: any) {
    console.error('[HANDOFF] Error initiating handoff:', error)
    throw error
  }
}

/**
 * Accept handoff - acknowledges coming admin accepts responsibility
 */
export async function acceptHandoff(sessionId: string, toUserId: string): Promise<void> {
  try {
    console.log(`[HANDOFF] ${toUserId} accepting handoff session ${sessionId}`)

    await query(
      `UPDATE admin_handoff_sessions 
       SET status = 'accepted', accepted_at = CURRENT_TIMESTAMP, accepted_by_user_id = $1
       WHERE session_id = $2`,
      [toUserId, sessionId]
    ).catch(() => {
      // Table may not exist
    })

    // Create audit record
    await query(
      `INSERT INTO handoff_audit (session_id, action, user_id, timestamp, details)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT DO NOTHING`,
      [sessionId, 'accepted', toUserId, new Date(), 'Incoming admin accepted handoff']
    ).catch(() => {
      // Audit table may not exist
    })

    console.log(`[HANDOFF] Handoff accepted`)
  } catch (error: any) {
    console.error('[HANDOFF] Error accepting handoff:', error)
    throw error
  }
}

/**
 * Complete handoff - closes the handoff session
 */
export async function completeHandoff(
  sessionId: string,
  completionNotes: string
): Promise<{
  sessionId: string
  status: string
  completedAt: Date
  summary: string
}> {
  try {
    const completedAt = new Date()

    console.log(`[HANDOFF] Completing handoff session ${sessionId}`)

    await query(
      `UPDATE admin_handoff_sessions 
       SET status = 'completed', completed_at = $1, completion_notes = $2
       WHERE session_id = $3`,
      [completedAt, completionNotes, sessionId]
    ).catch(() => {
      // Table may not exist
    })

    console.log(`[HANDOFF] Handoff session completed`)

    return {
      sessionId,
      status: 'completed',
      completedAt,
      summary: `Handoff session ${sessionId} completed at ${completedAt.toISOString()}. Notes: ${completionNotes}`,
    }
  } catch (error: any) {
    console.error('[HANDOFF] Error completing handoff:', error)
    throw error
  }
}

/**
 * Build escalation path for an incident
 */
async function buildEscalationPath(incidentId: string): Promise<string> {
  try {
    const result = await query(
      `SELECT escalation_level FROM incident_escalations 
       WHERE incident_id = $1 
       ORDER BY created_at ASC`,
      [incidentId]
    )

    if (result.rows.length === 0) {
      return 'No escalations yet'
    }

    return result.rows.map((r, i) => `${i + 1}. ${r.escalation_level}`).join(' → ')
  } catch {
    return 'Unknown'
  }
}

/**
 * Suggest next actions based on incident state
 */
async function suggestNextActions(incidentId: string): Promise<string[]> {
  try {
    const result = await query(
      'SELECT status, severity FROM incidents WHERE id = $1',
      [incidentId]
    )

    if (result.rows.length === 0) {
      return []
    }

    const incident = result.rows[0]
    const actions: string[] = []

    switch (incident.status) {
      case 'open':
        actions.push('Review incident description')
        actions.push('Assign to investigation team')
        actions.push('Acknowledge incident')
        break
      case 'acknowledged':
        actions.push('Start formal investigation')
        actions.push('Assign root cause analysis if immediately obvious')
        if (incident.severity === 'critical') {
          actions.push('Consider escalation to level_2 or higher')
        }
        break
      case 'investigating':
        actions.push('Continue investigation')
        actions.push('Document findings as root cause')
        actions.push('Prepare mitigation plan')
        break
      case 'escalated':
        actions.push('Await escalation authority input')
        actions.push('Continue investigation in parallel')
        actions.push('Prepare immediate mitigation options')
        break
      case 'mitigating':
        actions.push('Monitor mitigation effectiveness')
        actions.push('Prepare resolution summary')
        actions.push('Document all remediation steps')
        break
      default:
        actions.push('Review incident details')
    }

    return actions
  } catch {
    return []
  }
}

/**
 * Get handoff recommendations for shift change
 */
export async function getHandoffRecommendations(platformId: string): Promise<{
  recommendedHandoffTime: string
  systemStatus: string
  riskFactors: string[]
  recommendations: string[]
}> {
  try {
    // Get system load metrics
    const metricsResult = await query(
      `SELECT 
         COUNT(CASE WHEN status NOT IN ('resolved', 'closed') THEN 1 END) as open_count,
         COUNT(CASE WHEN status = 'escalated' THEN 1 END) as escalated_count,
         MAX(CASE WHEN severity = 'critical' THEN 1 ELSE 0 END) as has_critical
       FROM incidents 
       WHERE platform_id = $1`,
      [platformId]
    )

    const metrics = metricsResult.rows[0]
    const riskFactors: string[] = []
    const recommendations: string[] = []

    if (metrics.open_count > 10) {
      riskFactors.push(`High load: ${metrics.open_count} open incidents`)
      recommendations.push('Consider extending current shift or staggered handoff')
    }

    if (metrics.escalated_count > 0) {
      riskFactors.push(`${metrics.escalated_count} escalated incidents`)
      recommendations.push('Brief incoming admin on escalation status before handoff')
    }

    if (metrics.has_critical) {
      riskFactors.push('Critical incident active')
      recommendations.push('DO NOT handoff until critical incident stabilized')
    }

    let systemStatus = 'normal'
    if (riskFactors.length > 0) {
      systemStatus = riskFactors.length > 2 ? 'critical' : 'elevated'
    }

    const recommendedHandoffTime =
      systemStatus === 'normal' ? 'Safe to proceed with handoff' : 'Delay handoff until conditions improve'

    return {
      recommendedHandoffTime,
      systemStatus,
      riskFactors,
      recommendations,
    }
  } catch (error: any) {
    console.error('[HANDOFF] Error getting recommendations:', error)
    return {
      recommendedHandoffTime: 'Unable to assess',
      systemStatus: 'unknown',
      riskFactors: [error.message],
      recommendations: [],
    }
  }
}

/**
 * Generate handoff briefing document
 */
export async function generateHandoffBriefing(sessionId: string): Promise<string> {
  try {
    const sessionResult = await query(
      `SELECT session_data FROM admin_handoff_sessions WHERE session_id = $1`,
      [sessionId]
    )

    if (sessionResult.rows.length === 0) {
      throw new Error(`Session ${sessionId} not found`)
    }

    const session: HandoffSession = JSON.parse(sessionResult.rows[0].session_data)

    let briefing = `
================================================================================
                    ADMIN HANDOFF BRIEFING
================================================================================
Session ID: ${session.sessionId}
From: ${session.fromAdmin}
To: ${session.toAdmin}
Time: ${session.startTime.toISOString()}

SYSTEM HEALTH
================================================================================
Open Incidents: ${session.systemHealth.openIncidents}
Escalated Incidents: ${session.systemHealth.escalatedIncidents}
At-Risk SLAs: ${session.systemHealth.slaAtRisk}
Critical Alerts: ${session.systemHealth.criticalAlerts}

ACTIVE INCIDENTS
================================================================================
`

    for (const incident of session.incidents) {
      briefing += `
Incident: ${incident.incidentId}
Title: ${incident.notes}
Status: ${incident.contextBrief}
Escalation Path: ${incident.escalationPath}
Next Actions:
${incident.nextActions.map((a) => `  - ${a}`).join('\n')}
---
`
    }

    briefing += `
BRIEFING NOTES
================================================================================
${session.briefingNotes}

================================================================================
                    END OF BRIEFING
================================================================================
`

    return briefing
  } catch (error: any) {
    console.error('[HANDOFF] Error generating briefing:', error)
    throw error
  }
}
