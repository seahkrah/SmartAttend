/**
 * PHASE 5, STEP 5.1: Incident Service
 * Manages incident creation, updating, and tracking
 */

import { query } from '../db/connection.js'
import {
  classifyError,
  shouldCreateIncident,
  type ErrorClassification,
} from './errorClassificationService.js'
import {
  generateErrorFingerprint,
  fingerprintDatabaseError,
  type ErrorFingerprint,
} from './errorFingerprintService.js'

export interface CreateIncidentInput {
  platformId: string
  errorCode?: string
  errorMessage: string
  errorType?: string
  stackTrace?: string
  incidentType?: string
  detectedByUserId?: string
  detectionMethod?: 'automated' | 'user_report' | 'monitoring'
  detectionSource?: string
  affectedUsers?: number
  affectedSystems?: string[]
  businessImpact?: string
}

export interface UpdateIncidentInput {
  status?: string
  severity?: string
  acknowledgedByUserId?: string
  resolvedByUserId?: string
  rootCause?: string
  remediationSteps?: string
  preventionMeasures?: string
  postMortemUrl?: string
}

/**
 * Get or create error fingerprint in database
 */
async function getOrCreateFingerprint(
  fingerprint: ErrorFingerprint,
  errorClassification: ErrorClassification
): Promise<string> {
  try {
    // Check if fingerprint already exists
    const existingResult = await query(
      'SELECT id FROM error_fingerprints WHERE fingerprint_hash = $1',
      [fingerprint.hash]
    )

    if (existingResult.rows.length > 0) {
      return existingResult.rows[0].id
    }

    // Create new fingerprint record
    const createResult = await query(
      `INSERT INTO error_fingerprints 
        (fingerprint_hash, error_code, error_message, stack_trace_pattern, is_active) 
       VALUES ($1, $2, $3, $4, true) 
       RETURNING id`,
      [
        fingerprint.hash,
        fingerprint.errorCode,
        fingerprint.errorMessage,
        fingerprint.stackTracePattern,
      ]
    )

    return createResult.rows[0].id
  } catch (error) {
    console.error('Error creating fingerprint:', error)
    throw error
  }
}

/**
 * Create a new incident from error
 */
export async function createIncident(input: CreateIncidentInput): Promise<string> {
  try {
    // Classify the error
    const errorClassification = classifyError(
      input.errorCode,
      input.errorMessage,
      input.errorType
    )

    // Generate fingerprint
    const fingerprint = generateErrorFingerprint(
      input.errorCode,
      input.errorMessage,
      input.stackTrace
    )

    // Get or create fingerprint record
    const fingerprintId = await getOrCreateFingerprint(
      fingerprint,
      errorClassification
    )

    // Determine incident type if not provided
    const incidentType =
      input.incidentType ||
      (errorClassification.category === 'security'
        ? 'security_breach'
        : errorClassification.category === 'integrity'
          ? 'data_integrity'
          : 'error')

    // Build title
    const title = `${errorClassification.category.toUpperCase()}: ${input.errorMessage.substring(0, 80)}`

    // Create incident record
    const result = await query(
      `INSERT INTO incidents 
        (
          platform_id,
          incident_type,
          title,
          description,
          severity,
          category,
          status,
          error_fingerprint_id,
          error_count,
          detected_by_user_id,
          detection_method,
          detection_source,
          first_error_at,
          last_error_at,
          affected_users,
          affected_systems,
          business_impact
        ) 
       VALUES ($1, $2, $3, $4, $5, $6, 'open', $7, 1, $8, $9, $10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $11, $12, $13) 
       RETURNING id`,
      [
        input.platformId,
        incidentType,
        title,
        input.errorMessage,
        errorClassification.severity,
        errorClassification.category,
        fingerprintId,
        input.detectedByUserId || null,
        input.detectionMethod || 'automated',
        input.detectionSource || 'system',
        input.affectedUsers || 0,
        input.affectedSystems ? JSON.stringify(input.affectedSystems) : null,
        input.businessImpact || null,
      ]
    )

    const incidentId = result.rows[0].id

    // Log the error
    await logError(incidentId, input, errorClassification, fingerprintId)

    // Create timeline event
    await createTimelineEvent(incidentId, 'created', null, 'open', 'Incident automatically created from error')

    console.log(`[INCIDENT] Created incident ${incidentId} for error:`, input.errorMessage)

    // If requires escalation, update status
    if (errorClassification.requireEscalation) {
      await updateIncident(incidentId, { status: 'escalated' })
      console.log(`[INCIDENT] Escalated incident ${incidentId} - ${errorClassification.description}`)
    }

    return incidentId
  } catch (error) {
    console.error('Error creating incident:', error)
    throw error
  }
}

/**
 * Log error details
 */
async function logError(
  incidentId: string,
  input: CreateIncidentInput,
  classification: ErrorClassification,
  fingerprintId: string
): Promise<void> {
  try {
    await query(
      `INSERT INTO error_logs 
        (
          platform_id,
          incident_id,
          error_fingerprint_id,
          error_code,
          error_message,
          error_type,
          stack_trace,
          service_name,
          operation_name,
          severity,
          category,
          is_recoverable,
          environment,
          metadata
        ) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        input.platformId,
        incidentId,
        fingerprintId,
        input.errorCode || null,
        input.errorMessage,
        input.errorType || null,
        input.stackTrace || null,
        input.detectionSource || 'system',
        null,
        classification.severity,
        classification.category,
        true,
        process.env.NODE_ENV || 'development',
        JSON.stringify({
          affectedSystems: input.affectedSystems,
          businessImpact: input.businessImpact,
        }),
      ]
    )
  } catch (error) {
    console.error('Error logging error:', error)
    // Don't throw - logging errors shouldn't break incident creation
  }
}

/**
 * Create timeline event for incident
 */
export async function createTimelineEvent(
  incidentId: string,
  eventType: string,
  oldValue: any,
  newValue: any,
  description: string,
  performedByUserId?: string
): Promise<void> {
  try {
    await query(
      `INSERT INTO incident_timeline_events 
        (incident_id, event_type, old_value, new_value, description, performed_by_user_id) 
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        incidentId,
        eventType,
        oldValue ? JSON.stringify(oldValue) : null,
        newValue ? JSON.stringify(newValue) : null,
        description,
        performedByUserId || null,
      ]
    )
  } catch (error) {
    console.error('Error creating timeline event:', error)
  }
}

/**
 * Update incident
 */
export async function updateIncident(
  incidentId: string,
  input: UpdateIncidentInput
): Promise<void> {
  try {
    const updates: string[] = []
    const values: any[] = []
    let paramIndex = 1

    if (input.status !== undefined) {
      updates.push(`status = $${paramIndex++}`)
      values.push(input.status)
    }
    if (input.severity !== undefined) {
      updates.push(`severity = $${paramIndex++}`)
      values.push(input.severity)
    }
    if (input.acknowledgedByUserId !== undefined) {
      updates.push(`acknowledged_by_user_id = $${paramIndex++}`)
      updates.push(`acknowledged_at = CURRENT_TIMESTAMP`)
      values.push(input.acknowledgedByUserId)
    }
    if (input.resolvedByUserId !== undefined) {
      updates.push(`resolved_by_user_id = $${paramIndex++}`)
      updates.push(`resolved_at = CURRENT_TIMESTAMP`)
      updates.push(`status = 'resolved'`)
      values.push(input.resolvedByUserId)
    }
    if (input.rootCause !== undefined) {
      updates.push(`root_cause = $${paramIndex++}`)
      values.push(input.rootCause)
    }
    if (input.remediationSteps !== undefined) {
      updates.push(`remediation_steps = $${paramIndex++}`)
      values.push(input.remediationSteps)
    }
    if (input.preventionMeasures !== undefined) {
      updates.push(`prevention_measures = $${paramIndex++}`)
      values.push(input.preventionMeasures)
    }
    if (input.postMortemUrl !== undefined) {
      updates.push(`post_mortem_url = $${paramIndex++}`)
      values.push(input.postMortemUrl)
    }

    if (updates.length === 0) {
      return
    }

    values.push(incidentId)
    await query(
      `UPDATE incidents SET ${updates.join(', ')} WHERE id = $${paramIndex}`,
      values
    )
  } catch (error) {
    console.error('Error updating incident:', error)
    throw error
  }
}

/**
 * Get incident by ID
 */
export async function getIncident(incidentId: string): Promise<any> {
  try {
    const result = await query('SELECT * FROM incidents WHERE id = $1', [
      incidentId,
    ])
    return result.rows[0] || null
  } catch (error) {
    console.error('Error retrieving incident:', error)
    throw error
  }
}

/**
 * Get open incidents for platform
 */
export async function getOpenIncidents(platformId: string): Promise<any[]> {
  try {
    const result = await query(
      `SELECT * FROM incidents 
       WHERE platform_id = $1 AND status IN ('open', 'investigating', 'escalated') 
       ORDER BY severity DESC, created_at DESC`,
      [platformId]
    )
    return result.rows
  } catch (error) {
    console.error('Error retrieving open incidents:', error)
    throw error
  }
}

/**
 * Get critical open incidents
 */
export async function getCriticalIncidents(platformId: string): Promise<any[]> {
  try {
    const result = await query(
      `SELECT * FROM incidents 
       WHERE platform_id = $1 AND status IN ('open', 'investigating') AND severity = 'critical'
       ORDER BY created_at DESC`,
      [platformId]
    )
    return result.rows
  } catch (error) {
    console.error('Error retrieving critical incidents:', error)
    throw error
  }
}

/**
 * Get incident statistics for platform
 */
export async function getIncidentStatistics(platformId: string): Promise<any> {
  try {
    const result = await query(
      `SELECT 
         COUNT(*) as total_incidents,
         SUM(CASE WHEN severity = 'critical' THEN 1 ELSE 0 END) as critical_count,
         SUM(CASE WHEN severity = 'high' THEN 1 ELSE 0 END) as high_count,
         SUM(CASE WHEN severity = 'medium' THEN 1 ELSE 0 END) as medium_count,
         SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open_count,
         SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolved_count,
         AVG(EXTRACT(EPOCH FROM (resolved_at - created_at))/60) as avg_resolution_time_minutes
       FROM incidents 
       WHERE platform_id = $1`,
      [platformId]
    )
    return result.rows[0]
  } catch (error) {
    console.error('Error retrieving incident statistics:', error)
    throw error
  }
}
