/**
 * PHASE 6, STEP 6.1: Attendance State Machine Service
 * Enforces explicit state transitions for attendance records
 * States: VERIFIED, FLAGGED, REVOKED, MANUAL_OVERRIDE
 */

import { query } from '../db/connection.js'

export type AttendanceState = 'VERIFIED' | 'FLAGGED' | 'REVOKED' | 'MANUAL_OVERRIDE'
export type RecordType = 'school_attendance' | 'corporate_checkins'

export interface StateTransitionRequest {
  newState: AttendanceState
  reason: string
  changedByUserId: string
  auditNotes?: string
}

export interface AttendanceStateRecord {
  id: string
  currentState: AttendanceState
  reason: string
  changedBy: string
  changedAt: string
}

/**
 * Valid state transitions
 * Defines which states can transition to which other states
 */
const VALID_TRANSITIONS: Record<AttendanceState, AttendanceState[]> = {
  VERIFIED: ['FLAGGED', 'REVOKED', 'MANUAL_OVERRIDE'],
  FLAGGED: ['VERIFIED', 'REVOKED', 'MANUAL_OVERRIDE'],
  REVOKED: ['MANUAL_OVERRIDE', 'VERIFIED'],
  MANUAL_OVERRIDE: ['VERIFIED', 'FLAGGED', 'REVOKED'],
}

/**
 * Validate if a state transition is allowed
 */
export function isValidTransition(
  currentState: AttendanceState,
  newState: AttendanceState
): boolean {
  if (currentState === newState) {
    return false // No transition needed
  }
  return VALID_TRANSITIONS[currentState]?.includes(newState) ?? false
}

/**
 * Get transition rules for a given state
 */
export function getValidTransitions(state: AttendanceState): AttendanceState[] {
  return VALID_TRANSITIONS[state] || []
}

/**
 * Change school attendance state
 */
export async function changeSchoolAttendanceState(
  attendanceId: string,
  request: StateTransitionRequest
): Promise<void> {
  try {
    // Get current attendance record
    const result = await query(
      'SELECT attendance_state FROM school_attendance WHERE id = $1',
      [attendanceId]
    )

    if (result.rows.length === 0) {
      throw new Error(`School attendance record ${attendanceId} not found`)
    }

    const currentState = result.rows[0].attendance_state as AttendanceState

    // Validate state transition
    if (!isValidTransition(currentState, request.newState)) {
      const validTransitions = getValidTransitions(currentState)
      throw new Error(
        `Cannot transition from '${currentState}' to '${request.newState}'. Valid transitions: ${validTransitions.join(', ')}`
      )
    }

    // Update attendance record
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
        request.reason,
        request.changedByUserId,
        request.auditNotes || null,
        attendanceId,
      ]
    )

    // Record state change in history
    await query(
      `INSERT INTO attendance_state_history 
        (attendance_record_id, record_type, previous_state, new_state, reason, changed_by_user_id, audit_notes) 
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        attendanceId,
        'school_attendance',
        currentState,
        request.newState,
        request.reason,
        request.changedByUserId,
        request.auditNotes || null,
      ]
    )

    console.log(
      `[ATTENDANCE] School attendance ${attendanceId}: ${currentState} → ${request.newState} (${request.reason})`
    )
  } catch (error) {
    console.error('Error changing school attendance state:', error)
    throw error
  }
}

/**
 * Change corporate checkin state
 */
export async function changeCorporateCheckinState(
  checkinId: string,
  request: StateTransitionRequest
): Promise<void> {
  try {
    // Get current checkin record
    const result = await query(
      'SELECT checkin_state FROM corporate_checkins WHERE id = $1',
      [checkinId]
    )

    if (result.rows.length === 0) {
      throw new Error(`Corporate checkin record ${checkinId} not found`)
    }

    const currentState = result.rows[0].checkin_state as AttendanceState

    // Validate state transition
    if (!isValidTransition(currentState, request.newState)) {
      const validTransitions = getValidTransitions(currentState)
      throw new Error(
        `Cannot transition from '${currentState}' to '${request.newState}'. Valid transitions: ${validTransitions.join(', ')}`
      )
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
        request.reason,
        request.changedByUserId,
        request.auditNotes || null,
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
        request.reason,
        request.changedByUserId,
        request.auditNotes || null,
      ]
    )

    console.log(
      `[ATTENDANCE] Corporate checkin ${checkinId}: ${currentState} → ${request.newState} (${request.reason})`
    )
  } catch (error) {
    console.error('Error changing corporate checkin state:', error)
    throw error
  }
}

/**
 * Get attendance state history
 */
export async function getAttendanceStateHistory(
  recordId: string,
  recordType: RecordType
): Promise<any[]> {
  try {
    const result = await query(
      `SELECT * FROM attendance_state_history 
       WHERE attendance_record_id = $1 AND record_type = $2 
       ORDER BY changed_at DESC`,
      [recordId, recordType]
    )
    return result.rows
  } catch (error) {
    console.error('Error retrieving attendance state history:', error)
    throw error
  }
}

/**
 * Get all flagged attendance records for a date range
 */
export async function getFlaggedAttendanceRecords(
  platformId: string,
  startDate: string,
  endDate: string
): Promise<any[]> {
  try {
    const result = await query(
      `SELECT * FROM flagged_attendance_records 
       WHERE event_date >= $1 AND event_date <= $2 
       ORDER BY changed_at DESC`,
      [startDate, endDate]
    )
    return result.rows
  } catch (error) {
    console.error('Error retrieving flagged attendance records:', error)
    throw error
  }
}

/**
 * Get flagged attendance records for specific student
 */
export async function getFlaggedAttendanceByStudent(
  studentId: string,
  startDate?: string,
  endDate?: string
): Promise<any[]> {
  try {
    let query_text = `SELECT * FROM school_attendance 
                     WHERE student_id = $1 AND attendance_state = 'FLAGGED'`
    const params: any[] = [studentId]

    if (startDate) {
      query_text += ` AND attendance_date >= $${params.length + 1}`
      params.push(startDate)
    }

    if (endDate) {
      query_text += ` AND attendance_date <= $${params.length + 1}`
      params.push(endDate)
    }

    query_text += ' ORDER BY attendance_date DESC'

    const result = await query(query_text, params)
    return result.rows
  } catch (error) {
    console.error('Error retrieving flagged attendance for student:', error)
    throw error
  }
}

/**
 * Get flagged attendance records for specific employee
 */
export async function getFlaggedAttendanceByEmployee(
  employeeId: string,
  startDate?: string,
  endDate?: string
): Promise<any[]> {
  try {
    let query_text = `SELECT * FROM corporate_checkins 
                     WHERE employee_id = $1 AND checkin_state = 'FLAGGED'`
    const params: any[] = [employeeId]

    if (startDate) {
      query_text += ` AND DATE(check_in_time) >= $${params.length + 1}`
      params.push(startDate)
    }

    if (endDate) {
      query_text += ` AND DATE(check_in_time) <= $${params.length + 1}`
      params.push(endDate)
    }

    query_text += ' ORDER BY check_in_time DESC'

    const result = await query(query_text, params)
    return result.rows
  } catch (error) {
    console.error('Error retrieving flagged attendance for employee:', error)
    throw error
  }
}

/**
 * Get state statistics for date range
 */
export async function getStateStatistics(
  startDate: string,
  endDate: string
): Promise<Record<string, number>> {
  try {
    const result = await query(
      `SELECT new_state as state, COUNT(*) as count 
       FROM attendance_state_history 
       WHERE changed_at >= $1 AND changed_at <= $2 
       GROUP BY new_state`,
      [startDate, endDate]
    )

    const stats: Record<string, number> = {
      VERIFIED: 0,
      FLAGGED: 0,
      REVOKED: 0,
      MANUAL_OVERRIDE: 0,
    }

    result.rows.forEach((row: any) => {
      stats[row.state] = parseInt(row.count, 10)
    })

    return stats
  } catch (error) {
    console.error('Error retrieving state statistics:', error)
    throw error
  }
}

/**
 * Verify all records between dates are in proper state
 */
export async function auditStateCompliance(
  startDate: string,
  endDate: string
): Promise<{
  totalRecords: number
  verifiedCount: number
  flaggedCount: number
  revokedCount: number
  manualOverrideCount: number
  complianceRate: number
}> {
  try {
    // School attendance counts
    const schoolResult = await query(
      `SELECT attendance_state, COUNT(*) as count 
       FROM school_attendance 
       WHERE attendance_date >= $1 AND attendance_date <= $2 
       GROUP BY attendance_state`,
      [startDate, endDate]
    )

    // Corporate checkit counts
    const corporateResult = await query(
      `SELECT checkin_state, COUNT(*) as count 
       FROM corporate_checkins 
       WHERE DATE(check_in_time) >= $1 AND DATE(check_in_time) <= $2 
       GROUP BY checkin_state`,
      [startDate, endDate]
    )

    const counts: Record<string, number> = {
      VERIFIED: 0,
      FLAGGED: 0,
      REVOKED: 0,
      MANUAL_OVERRIDE: 0,
    }

    schoolResult.rows.forEach((row: any) => {
      counts[row.attendance_state] = (counts[row.attendance_state] || 0) + parseInt(row.count, 10)
    })

    corporateResult.rows.forEach((row: any) => {
      counts[row.checkin_state] = (counts[row.checkin_state] || 0) + parseInt(row.count, 10)
    })

    const total = Object.values(counts).reduce((a, b) => a + b, 0)
    const verifiedRate = total > 0 ? (counts.VERIFIED / total) * 100 : 0

    return {
      totalRecords: total,
      verifiedCount: counts.VERIFIED,
      flaggedCount: counts.FLAGGED,
      revokedCount: counts.REVOKED,
      manualOverrideCount: counts.MANUAL_OVERRIDE,
      complianceRate: Math.round(verifiedRate * 100) / 100,
    }
  } catch (error) {
    console.error('Error auditing state compliance:', error)
    throw error
  }
}
