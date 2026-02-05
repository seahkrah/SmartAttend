/**
 * PHASE 6, STEP 6.2: Immutable Correction History Service
 * Non-destructive attendance corrections with visible audit trail
 * Core Principle: Silent corrections are prohibited
 */

import { query } from '../db/connection.js'

export type CorrectionType =
  | 'data_entry_error'
  | 'biometric_revalidation'
  | 'system_override'
  | 'policy_exception'
  | 'duplicate_entry_removal'
  | 'time_synchronization_fix'
  | 'device_malfunction_correction'
  | 'attendance_appeal_approved'

export type RecordType = 'school_attendance' | 'corporate_checkins'

export interface CorrectionRequest {
  correctionReason: string
  correctionType: CorrectionType
  correctedByUserId: string
  supportingEvidenceUrl?: string
  approvalNotes?: string
  
  // New values (at least one must be provided)
  newStatus?: string
  newAttendanceState?: string
  newFaceVerified?: boolean
}

export interface CorrectionResponse {
  correctionId: string
  attendanceRecordId: string
  originalValues: Record<string, any>
  correctedValues: Record<string, any>
  correctionReason: string
  correctionType: CorrectionType
  correctedBy: string
  correctionTimestamp: string
}

/**
 * Create a non-destructive correction for school attendance
 * Never modifies original record, always creates new correction entry
 */
export async function correctSchoolAttendance(
  attendanceId: string,
  request: CorrectionRequest
): Promise<CorrectionResponse> {
  try {
    // Validate request has at least one field to correct
    if (!request.newStatus && !request.newAttendanceState && request.newFaceVerified === undefined) {
      throw new Error('At least one field must be provided for correction (status, attendance_state, or face_verified)')
    }

    // Validate reason is provided (silent corrections prohibited)
    if (!request.correctionReason || request.correctionReason.trim().length < 10) {
      throw new Error('Correction reason must be at least 10 characters (silent corrections prohibited)')
    }

    // Get current attendance record (preserve original values)
    const attendanceResult = await query(
      `SELECT id, status, attendance_state, face_verified FROM school_attendance WHERE id = $1`,
      [attendanceId]
    )

    if (attendanceResult.rows.length === 0) {
      throw new Error(`School attendance record ${attendanceId} not found`)
    }

    const attendance = attendanceResult.rows[0]

    // Create correction record (non-destructive)
    const correctionResult = await query(
      `INSERT INTO attendance_corrections (
        attendance_record_id,
        record_type,
        original_status,
        original_attendance_state,
        original_face_verified,
        corrected_status,
        corrected_attendance_state,
        corrected_face_verified,
        correction_reason,
        correction_type,
        corrected_by_user_id,
        supporting_evidence_url,
        approval_notes
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING id, correction_timestamp`,
      [
        attendanceId,
        'school_attendance',
        attendance.status,
        attendance.attendance_state,
        attendance.face_verified,
        request.newStatus || attendance.status,
        request.newAttendanceState || attendance.attendance_state,
        request.newFaceVerified !== undefined ? request.newFaceVerified : attendance.face_verified,
        request.correctionReason,
        request.correctionType,
        request.correctedByUserId,
        request.supportingEvidenceUrl || null,
        request.approvalNotes || null,
      ]
    )

    const correctionId = correctionResult.rows[0].id
    const correctionTimestamp = correctionResult.rows[0].correction_timestamp

    // Log correction in audit log (for meta-tracking)
    await query(
      `INSERT INTO correction_audit_log (correction_id, action, actor_user_id, action_notes)
       VALUES ($1, 'created', $2, $3)`,
      [correctionId, request.correctedByUserId, `Type: ${request.correctionType}`]
    )

    // Get user info for response
    const userResult = await query('SELECT email FROM users WHERE id = $1', [request.correctedByUserId])
    const correctedByEmail = userResult.rows[0]?.email || request.correctedByUserId

    console.log(
      `[CORRECTION] School attendance ${attendanceId} corrected: ${request.correctionType} - ${request.correctionReason}`
    )

    return {
      correctionId,
      attendanceRecordId: attendanceId,
      originalValues: {
        status: attendance.status,
        attendance_state: attendance.attendance_state,
        face_verified: attendance.face_verified,
      },
      correctedValues: {
        status: request.newStatus || attendance.status,
        attendance_state: request.newAttendanceState || attendance.attendance_state,
        face_verified: request.newFaceVerified !== undefined ? request.newFaceVerified : attendance.face_verified,
      },
      correctionReason: request.correctionReason,
      correctionType: request.correctionType,
      correctedBy: correctedByEmail,
      correctionTimestamp,
    }
  } catch (error) {
    console.error('Error correcting school attendance:', error)
    throw error
  }
}

/**
 * Create a non-destructive correction for corporate checkin
 */
export async function correctCorporateCheckin(
  checkinId: string,
  request: CorrectionRequest
): Promise<CorrectionResponse> {
  try {
    // Validate request
    if (!request.newStatus && !request.newAttendanceState && request.newFaceVerified === undefined) {
      throw new Error('At least one field must be provided for correction')
    }

    if (!request.correctionReason || request.correctionReason.trim().length < 10) {
      throw new Error('Correction reason must be at least 10 characters (silent corrections prohibited)')
    }

    // Get current record
    const checkinResult = await query(
      `SELECT id, face_verified, checkin_state FROM corporate_checkins WHERE id = $1`,
      [checkinId]
    )

    if (checkinResult.rows.length === 0) {
      throw new Error(`Corporate checkin record ${checkinId} not found`)
    }

    const checkin = checkinResult.rows[0]

    // Create correction record
    const correctionResult = await query(
      `INSERT INTO attendance_corrections (
        attendance_record_id,
        record_type,
        original_face_verified,
        original_attendance_state,
        corrected_face_verified,
        corrected_attendance_state,
        correction_reason,
        correction_type,
        corrected_by_user_id,
        supporting_evidence_url,
        approval_notes
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id, correction_timestamp`,
      [
        checkinId,
        'corporate_checkins',
        checkin.face_verified,
        checkin.checkin_state,
        request.newFaceVerified !== undefined ? request.newFaceVerified : checkin.face_verified,
        request.newAttendanceState || checkin.checkin_state,
        request.correctionReason,
        request.correctionType,
        request.correctedByUserId,
        request.supportingEvidenceUrl || null,
        request.approvalNotes || null,
      ]
    )

    const correctionId = correctionResult.rows[0].id
    const correctionTimestamp = correctionResult.rows[0].correction_timestamp

    // Log in audit
    await query(
      `INSERT INTO correction_audit_log (correction_id, action, actor_user_id, action_notes)
       VALUES ($1, 'created', $2, $3)`,
      [correctionId, request.correctedByUserId, `Type: ${request.correctionType}`]
    )

    const userResult = await query('SELECT email FROM users WHERE id = $1', [request.correctedByUserId])
    const correctedByEmail = userResult.rows[0]?.email || request.correctedByUserId

    console.log(
      `[CORRECTION] Corporate checkin ${checkinId} corrected: ${request.correctionType} - ${request.correctionReason}`
    )

    return {
      correctionId,
      attendanceRecordId: checkinId,
      originalValues: {
        face_verified: checkin.face_verified,
        checkin_state: checkin.checkin_state,
      },
      correctedValues: {
        face_verified: request.newFaceVerified !== undefined ? request.newFaceVerified : checkin.face_verified,
        checkin_state: request.newAttendanceState || checkin.checkin_state,
      },
      correctionReason: request.correctionReason,
      correctionType: request.correctionType,
      correctedBy: correctedByEmail,
      correctionTimestamp,
    }
  } catch (error) {
    console.error('Error correcting corporate checkin:', error)
    throw error
  }
}

/**
 * Get correction history for attendance record
 * Shows all corrections (immutable audit trail)
 */
export async function getCorrectionHistory(
  attendanceRecordId: string,
  recordType: RecordType
): Promise<any[]> {
  try {
    const result = await query(
      `SELECT * FROM attendance_corrections 
       WHERE attendance_record_id = $1 AND record_type = $2 
       ORDER BY correction_timestamp DESC`,
      [attendanceRecordId, recordType]
    )
    return result.rows
  } catch (error) {
    console.error('Error retrieving correction history:', error)
    throw error
  }
}

/**
 * Revert a correction (but never delete it)
 * Creates an audit trail of the revert action
 */
export async function revertCorrection(
  correctionId: string,
  revertedByUserId: string,
  revertReason: string
): Promise<void> {
  try {
    if (!revertReason || revertReason.trim().length < 10) {
      throw new Error('Revert reason must be at least 10 characters')
    }

    // Mark correction as reverted (immutable, cannot undo)
    await query(
      `UPDATE attendance_corrections 
       SET is_reverted = true, 
           reverted_by_user_id = $1, 
           reverted_at = CURRENT_TIMESTAMP,
           revert_reason = $2
       WHERE id = $3 AND is_reverted = false`,
      [revertedByUserId, revertReason, correctionId]
    )

    // Log revert in audit log
    await query(
      `INSERT INTO correction_audit_log (correction_id, action, actor_user_id, action_notes)
       VALUES ($1, 'reverted', $2, $3)`,
      [correctionId, revertedByUserId, revertReason]
    )

    console.log(`[CORRECTION] Correction ${correctionId} reverted: ${revertReason}`)
  } catch (error) {
    console.error('Error reverting correction:', error)
    throw error
  }
}

/**
 * Get active corrections (not reverted)
 */
export async function getActiveCorrections(
  startDate: string,
  endDate: string
): Promise<any[]> {
  try {
    const result = await query(
      `SELECT * FROM attendance_correction_trail 
       WHERE status = 'ACTIVE' AND correction_timestamp >= $1 AND correction_timestamp <= $2
       ORDER BY correction_timestamp DESC`,
      [startDate, endDate]
    )
    return result.rows
  } catch (error) {
    console.error('Error retrieving active corrections:', error)
    throw error
  }
}

/**
 * Get correction statistics
 */
export async function getCorrectionStatistics(date?: string): Promise<any[]> {
  try {
    let query_text = `SELECT * FROM correction_statistics`
    const params: any[] = []

    if (date) {
      query_text += ` WHERE correction_date = $1`
      params.push(date)
    }

    const result = await query(query_text, params)
    return result.rows
  } catch (error) {
    console.error('Error retrieving correction statistics:', error)
    throw error
  }
}

/**
 * Get corrections by type
 */
export async function getCorrectionsByType(
  correctionType: CorrectionType,
  startDate: string,
  endDate: string
): Promise<any[]> {
  try {
    const result = await query(
      `SELECT * FROM attendance_correction_trail 
       WHERE correction_type = $1 
       AND correction_timestamp >= $2 
       AND correction_timestamp <= $3
       ORDER BY correction_timestamp DESC`,
      [correctionType, startDate, endDate]
    )
    return result.rows
  } catch (error) {
    console.error('Error retrieving corrections by type:', error)
    throw error
  }
}

/**
 * Audit trail view - all corrections visible with full context
 */
export async function getFullCorrectionAuditTrail(
  startDate: string,
  endDate: string
): Promise<any[]> {
  try {
    const result = await query(
      `SELECT * FROM attendance_correction_trail 
       WHERE correction_timestamp >= $1 AND correction_timestamp <= $2
       ORDER BY correction_timestamp DESC`,
      [startDate, endDate]
    )
    return result.rows
  } catch (error) {
    console.error('Error retrieving correction audit trail:', error)
    throw error
  }
}

/**
 * Validate no silent corrections exist (compliance check)
 */
export async function validateNoSilentCorrections(
  startDate: string,
  endDate: string
): Promise<{
  isSilentCorrectionFree: boolean
  recordsWithoutReason: number
  detailedRecords: any[]
}> {
  try {
    const result = await query(
      `SELECT * FROM attendance_corrections 
       WHERE correction_timestamp >= $1 
       AND correction_timestamp <= $2
       AND (correction_reason IS NULL OR correction_reason = '')`,
      [startDate, endDate]
    )

    return {
      isSilentCorrectionFree: result.rows.length === 0,
      recordsWithoutReason: result.rows.length,
      detailedRecords: result.rows,
    }
  } catch (error) {
    console.error('Error validating silent corrections:', error)
    throw error
  }
}
