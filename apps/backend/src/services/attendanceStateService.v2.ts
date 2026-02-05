/**
 * PHASE 10: Enhanced Attendance State Service
 * Adds rejection logging, reason codes, idempotency, and duplicate detection
 */

import { query } from '../db/connection.js'

export type AttendanceState = 'VERIFIED' | 'FLAGGED' | 'REVOKED' | 'MANUAL_OVERRIDE'
export type RecordType = 'school_attendance' | 'corporate_checkins'
export type TransitionStatus = 'ACCEPTED' | 'REJECTED'

export interface StateTransitionRequest {
  newState: AttendanceState
  reasonCode: string  // REQUIRED: enum from attendance_reason_codes
  additionalJustification?: string
  changedByUserId: string
  changedByRole?: string
  ipAddress?: string
  userAgent?: string
}

export interface TransitionAttempt {
  id: string
  status: TransitionStatus
  rejectionReason?: string
  attemptedAt: string
}

export interface AttendanceHistory {
  recordId: string
  currentState: AttendanceState
  timeline: HistoryEntry[]
  attemptedTransitions: TransitionAttempt[]
}

export interface HistoryEntry {
  timestamp: string
  previousState: AttendanceState | null
  newState: AttendanceState
  reasonCode: string
  reasonText: string
  changedByUserId: string
  changedByName: string
  status: 'ACCEPTED'
}

/**
 * Valid state transitions
 */
const VALID_TRANSITIONS: Record<AttendanceState, AttendanceState[]> = {
  VERIFIED: ['FLAGGED', 'REVOKED', 'MANUAL_OVERRIDE'],
  FLAGGED: ['VERIFIED', 'REVOKED', 'MANUAL_OVERRIDE'],
  REVOKED: ['MANUAL_OVERRIDE', 'VERIFIED'],
  MANUAL_OVERRIDE: ['VERIFIED', 'FLAGGED', 'REVOKED'],
}

/**
 * Check if state transition is valid
 */
export function isValidTransition(
  currentState: AttendanceState,
  newState: AttendanceState
): boolean {
  if (currentState === newState) {
    return false
  }
  return VALID_TRANSITIONS[currentState]?.includes(newState) ?? false
}

/**
 * Get valid transitions for a state
 */
export function getValidTransitions(state: AttendanceState): AttendanceState[] {
  return VALID_TRANSITIONS[state] || []
}

/**
 * Log a transition attempt (success or rejection)
 */
async function logTransitionAttempt(
  attendanceId: string,
  recordType: RecordType,
  currentState: AttendanceState,
  requestedState: AttendanceState,
  status: TransitionStatus,
  reasonCode: string | null,
  rejectionReason: string | null,
  userId: string,
  ipAddress?: string,
  userAgent?: string
): Promise<string> {
  try {
    const result = await query(
      `INSERT INTO attendance_transition_attempts 
       (attendance_record_id, record_type, current_state, requested_state, 
        reason_code, status, rejection_reason, requested_by_user_id, 
        request_ip_address, request_user_agent, attempted_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP)
       RETURNING id`,
      [
        attendanceId,
        recordType,
        currentState,
        requestedState,
        reasonCode,
        status,
        rejectionReason,
        userId,
        ipAddress,
        userAgent,
      ]
    )
    return result.rows[0].id
  } catch (error) {
    console.error('[ATTENDANCE] Failed to log transition attempt:', error)
    throw error
  }
}

/**
 * Detect if this attendance has already been marked (via idempotency key)
 */
async function checkDuplicate(
  attendanceId: string,
  idempotencyKey: string
): Promise<{ isDuplicate: boolean; originalRecordId?: string }> {
  try {
    const result = await query(
      `SELECT attendance_record_id FROM attendance_idempotency_keys 
       WHERE idempotency_key = $1`,
      [idempotencyKey]
    )

    if (result.rows.length > 0) {
      return {
        isDuplicate: true,
        originalRecordId: result.rows[0].attendance_record_id,
      }
    }

    return { isDuplicate: false }
  } catch (error) {
    console.error('[ATTENDANCE] Failed to check duplicate:', error)
    throw error
  }
}

/**
 * Register idempotency key to prevent future duplicates
 */
async function registerIdempotencyKey(
  attendanceId: string,
  idempotencyKey: string,
  sourceSystem: string,
  deviceId?: string
): Promise<void> {
  try {
    await query(
      `INSERT INTO attendance_idempotency_keys 
       (attendance_record_id, idempotency_key, source_system, source_device_id)
       VALUES ($1, $2, $3, $4)`,
      [attendanceId, idempotencyKey, sourceSystem, deviceId]
    )
  } catch (error) {
    console.error('[ATTENDANCE] Failed to register idempotency key:', error)
    throw error
  }
}

/**
 * Validate reason code is valid for target state
 */
async function validateReasonCode(
  reasonCode: string,
  targetState: AttendanceState
): Promise<{ isValid: boolean; reasonText?: string; requiresJustification?: boolean }> {
  try {
    const result = await query(
      `SELECT description, requires_additional_justification, valid_for_states
       FROM attendance_reason_codes 
       WHERE code = $1`,
      [reasonCode]
    )

    if (result.rows.length === 0) {
      return { isValid: false }
    }

    const row = result.rows[0]
    const validStates = row.valid_for_states
      .split(',')
      .map((s: string) => s.trim())

    const isValidForState = validStates.includes(targetState)

    if (!isValidForState) {
      return { isValid: false }
    }

    return {
      isValid: true,
      reasonText: row.description,
      requiresJustification: row.requires_additional_justification,
    }
  } catch (error) {
    console.error('[ATTENDANCE] Failed to validate reason code:', error)
    throw error
  }
}

/**
 * Core: Change school attendance state with full validation and logging
 */
export async function changeSchoolAttendanceState(
  attendanceId: string,
  request: StateTransitionRequest
): Promise<{ success: boolean; attemptId: string; isDuplicate?: boolean }> {
  try {
    // 1. Get current attendance record
    const result = await query(
      'SELECT attendance_state FROM school_attendance WHERE id = $1',
      [attendanceId]
    )

    if (result.rows.length === 0) {
      // Rejection: Record not found
      const attemptId = await logTransitionAttempt(
        attendanceId,
        'school_attendance',
        'VERIFIED', // Unknown state
        request.newState,
        'REJECTED',
        request.reasonCode,
        'Attendance record not found',
        request.changedByUserId,
        request.ipAddress,
        request.userAgent
      )
      throw new Error(`School attendance record ${attendanceId} not found`)
    }

    const currentState = result.rows[0].attendance_state as AttendanceState

    // 2. Validate state transition
    if (!isValidTransition(currentState, request.newState)) {
      const validTransitions = getValidTransitions(currentState)
      const rejectionReason = `Invalid state transition from '${currentState}' to '${request.newState}'. Valid transitions: ${validTransitions.join(', ')}`

      const attemptId = await logTransitionAttempt(
        attendanceId,
        'school_attendance',
        currentState,
        request.newState,
        'REJECTED',
        request.reasonCode,
        rejectionReason,
        request.changedByUserId,
        request.ipAddress,
        request.userAgent
      )

      console.log(
        `[ATTENDANCE] Transition attempt REJECTED: ${attendanceId} ${currentState} → ${request.newState}`
      )
      throw new Error(rejectionReason)
    }

    // 3. Validate reason code
    const reasonValidation = await validateReasonCode(
      request.reasonCode,
      request.newState
    )

    if (!reasonValidation.isValid) {
      const rejectionReason = `Reason code '${request.reasonCode}' not valid for state '${request.newState}'`

      const attemptId = await logTransitionAttempt(
        attendanceId,
        'school_attendance',
        currentState,
        request.newState,
        'REJECTED',
        request.reasonCode,
        rejectionReason,
        request.changedByUserId,
        request.ipAddress,
        request.userAgent
      )

      throw new Error(rejectionReason)
    }

    // 4. Check for missing required justification
    if (
      reasonValidation.requiresJustification &&
      !request.additionalJustification
    ) {
      const rejectionReason = `Additional justification required for reason code '${request.reasonCode}'`

      const attemptId = await logTransitionAttempt(
        attendanceId,
        'school_attendance',
        currentState,
        request.newState,
        'REJECTED',
        request.reasonCode,
        rejectionReason,
        request.changedByUserId,
        request.ipAddress,
        request.userAgent
      )

      throw new Error(rejectionReason)
    }

    // 5. Update attendance record
    await query(
      `UPDATE school_attendance 
       SET attendance_state = $1, 
           state_reason = $2, 
           state_changed_by = $3, 
           state_changed_at = CURRENT_TIMESTAMP,
           state_audit_notes = $4
       WHERE id = $5`,
      [
        request.newState,
        request.reasonCode,
        request.changedByUserId,
        request.additionalJustification || null,
        attendanceId,
      ]
    )

    // 6. Record state change in history (with reason code)
    await query(
      `INSERT INTO attendance_state_history 
        (attendance_record_id, record_type, previous_state, new_state, reason, changed_by_user_id, audit_notes) 
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        attendanceId,
        'school_attendance',
        currentState,
        request.newState,
        request.reasonCode,
        request.changedByUserId,
        request.additionalJustification || null,
      ]
    )

    // 7. Log successful transition attempt
    const attemptId = await logTransitionAttempt(
      attendanceId,
      'school_attendance',
      currentState,
      request.newState,
      'ACCEPTED',
      request.reasonCode,
      null,
      request.changedByUserId,
      request.ipAddress,
      request.userAgent
    )

    console.log(
      `[ATTENDANCE] School attendance ${attendanceId}: ${currentState} → ${request.newState} (reason: ${request.reasonCode})`
    )

    return { success: true, attemptId }
  } catch (error) {
    console.error('[ATTENDANCE] Error changing school attendance state:', error)
    throw error
  }
}

/**
 * Similar implementation for corporate checkins
 */
export async function changeCorporateCheckinState(
  checkinId: string,
  request: StateTransitionRequest
): Promise<{ success: boolean; attemptId: string }> {
  try {
    // Get current checkin record
    const result = await query(
      'SELECT checkin_state FROM corporate_checkins WHERE id = $1',
      [checkinId]
    )

    if (result.rows.length === 0) {
      await logTransitionAttempt(
        checkinId,
        'corporate_checkins',
        'VERIFIED',
        request.newState,
        'REJECTED',
        request.reasonCode,
        'Checkin record not found',
        request.changedByUserId,
        request.ipAddress,
        request.userAgent
      )
      throw new Error(`Corporate checkin record ${checkinId} not found`)
    }

    const currentState = result.rows[0].checkin_state as AttendanceState

    // Validate state transition
    if (!isValidTransition(currentState, request.newState)) {
      const validTransitions = getValidTransitions(currentState)
      const rejectionReason = `Invalid state transition from '${currentState}' to '${request.newState}'. Valid transitions: ${validTransitions.join(', ')}`

      await logTransitionAttempt(
        checkinId,
        'corporate_checkins',
        currentState,
        request.newState,
        'REJECTED',
        request.reasonCode,
        rejectionReason,
        request.changedByUserId,
        request.ipAddress,
        request.userAgent
      )

      throw new Error(rejectionReason)
    }

    // Validate reason code
    const reasonValidation = await validateReasonCode(
      request.reasonCode,
      request.newState
    )

    if (!reasonValidation.isValid) {
      const rejectionReason = `Reason code '${request.reasonCode}' not valid for state '${request.newState}'`

      await logTransitionAttempt(
        checkinId,
        'corporate_checkins',
        currentState,
        request.newState,
        'REJECTED',
        request.reasonCode,
        rejectionReason,
        request.changedByUserId,
        request.ipAddress,
        request.userAgent
      )

      throw new Error(rejectionReason)
    }

    // Update checkin record
    await query(
      `UPDATE corporate_checkins 
       SET checkin_state = $1, 
           state_reason = $2, 
           state_changed_by = $3, 
           state_changed_at = CURRENT_TIMESTAMP,
           state_audit_notes = $4
       WHERE id = $5`,
      [
        request.newState,
        request.reasonCode,
        request.changedByUserId,
        request.additionalJustification || null,
        checkinId,
      ]
    )

    // Record state change in history
    await query(
      `INSERT INTO attendance_state_history 
        (attendance_record_id, record_type, previous_state, new_state, reason, changed_by_user_id, audit_notes) 
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        checkinId,
        'corporate_checkins',
        currentState,
        request.newState,
        request.reasonCode,
        request.changedByUserId,
        request.additionalJustification || null,
      ]
    )

    // Log successful transition attempt
    const attemptId = await logTransitionAttempt(
      checkinId,
      'corporate_checkins',
      currentState,
      request.newState,
      'ACCEPTED',
      request.reasonCode,
      null,
      request.changedByUserId,
      request.ipAddress,
      request.userAgent
    )

    console.log(
      `[ATTENDANCE] Corporate checkin ${checkinId}: ${currentState} → ${request.newState} (reason: ${request.reasonCode})`
    )

    return { success: true, attemptId }
  } catch (error) {
    console.error('[ATTENDANCE] Error changing corporate checkin state:', error)
    throw error
  }
}

/**
 * Get full attendance history including transitions and rejections
 */
export async function getAttendanceHistory(
  attendanceId: string
): Promise<AttendanceHistory> {
  try {
    // Get current state
    const currentResult = await query(
      'SELECT attendance_state FROM school_attendance WHERE id = $1',
      [attendanceId]
    )

    if (currentResult.rows.length === 0) {
      throw new Error(`Attendance record ${attendanceId} not found`)
    }

    const currentState = currentResult.rows[0]
      .attendance_state as AttendanceState

    // Get accepted transitions (history)
    const historyResult = await query(
      `SELECT 
        ash.changed_at,
        ash.previous_state,
        ash.new_state,
        ash.reason,
        ash.changed_by_user_id,
        u.full_name as changed_by_name
       FROM attendance_state_history ash
       LEFT JOIN users u ON ash.changed_by_user_id = u.id
       WHERE ash.attendance_record_id = $1
       ORDER BY ash.changed_at ASC`,
      [attendanceId]
    )

    const timeline: HistoryEntry[] = historyResult.rows.map((row: any) => ({
      timestamp: row.changed_at,
      previousState: row.previous_state,
      newState: row.new_state,
      reasonCode: row.reason,
      reasonText: row.reason, // Would need additional JOIN for actual text
      changedByUserId: row.changed_by_user_id,
      changedByName: row.changed_by_name || 'System',
      status: 'ACCEPTED',
    }))

    // Get rejected transitions
    const rejectedResult = await query(
      `SELECT 
        id,
        attempted_at,
        rejection_reason
       FROM attendance_transition_attempts
       WHERE attendance_record_id = $1 AND status = 'REJECTED'
       ORDER BY attempted_at DESC`,
      [attendanceId]
    )

    const attemptedTransitions: TransitionAttempt[] = rejectedResult.rows.map(
      (row: any) => ({
        id: row.id,
        status: 'REJECTED',
        rejectionReason: row.rejection_reason,
        attemptedAt: row.attempted_at,
      })
    )

    return {
      recordId: attendanceId,
      currentState,
      timeline,
      attemptedTransitions,
    }
  } catch (error) {
    console.error('[ATTENDANCE] Error getting attendance history:', error)
    throw error
  }
}

/**
 * Export helper functions for testing and analysis
 */
export { logTransitionAttempt, checkDuplicate, registerIdempotencyKey }
