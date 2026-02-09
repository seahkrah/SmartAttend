/**
 * Attendance Service (Face Recognition Enabled)
 * 
 * Handles:
 * - Creating course sessions
 * - Marking attendance with face verification
 * - Enforcing one-check-in-per-session constraint
 * - Session status management
 * - Attendance metrics
 * 
 * All constraints are database-enforced
 */

import { query } from '../db/connection.js';
import {
  CourseSession,
  CreateSessionRequest,
  UpdateSessionRequest,
  SessionAttendanceRecord,
  MarkAttendanceWithFaceRequest,
  MarkAttendanceWithFaceResponse,
  AttendanceStatus,
} from '@smartattend/types';
import {
  enrollStudentFace,
  verifyStudentFace,
  getEnrollmentStatus,
} from './faceRecognitionService.js';

// ===========================
// SESSION MANAGEMENT
// ===========================

/**
 * Create a course session
 * Faculty creates scheduled sessions for their course
 */
export async function createSession(
  courseId: string,
  sessionData: CreateSessionRequest
): Promise<CourseSession> {
  try {
    // Validate course exists
    const courseCheck = await query(`SELECT id, platform_id FROM courses WHERE id = $1`, [
      courseId,
    ]);

    if (courseCheck.rows.length === 0) {
      throw new Error('Course not found');
    }

    // Validate faculty exists
    const facultyCheck = await query(
      `SELECT id FROM faculty WHERE user_id = $1`,
      [sessionData.lecturerId]
    );

    if (facultyCheck.rows.length === 0) {
      throw new Error('Faculty not found');
    }

    // Insert session
    const result = await query(
      `INSERT INTO course_sessions (
        course_id, session_number, session_date, start_time, end_time,
        attendance_open_at, attendance_close_at, lecturer_id, location, max_capacity
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING 
        id, course_id, session_number, session_date, start_time, end_time,
        attendance_open_at, attendance_close_at, status, lecturer_id,
        location, max_capacity, created_at, updated_at`,
      [
        courseId,
        sessionData.sessionNumber,
        sessionData.sessionDate,
        sessionData.startTime,
        sessionData.endTime,
        sessionData.attendanceOpenAt,
        sessionData.attendanceCloseAt,
        sessionData.lecturerId,
        sessionData.location || null,
        sessionData.maxCapacity || null,
      ]
    );

    const row = result.rows[0];
    return {
      id: row.id,
      courseId: row.course_id,
      sessionNumber: row.session_number,
      sessionDate: row.session_date,
      startTime: row.start_time,
      endTime: row.end_time,
      attendanceOpenAt: row.attendance_open_at,
      attendanceCloseAt: row.attendance_close_at,
      status: row.status,
      lecturerId: row.lecturer_id,
      location: row.location,
      maxCapacity: row.max_capacity,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  } catch (error) {
    console.error('[attendanceService] Create session error:', error);
    throw error;
  }
}

/**
 * Update session status
 */
export async function updateSession(
  sessionId: string,
  updates: UpdateSessionRequest
): Promise<CourseSession | null> {
  try {
    const setClauses: string[] = [];
    const params: any[] = [];
    let paramCount = 1;

    if (updates.status) {
      setClauses.push(`status = $${paramCount++}`);
      params.push(updates.status);
    }
    if (updates.location) {
      setClauses.push(`location = $${paramCount++}`);
      params.push(updates.location);
    }
    if (updates.maxCapacity) {
      setClauses.push(`max_capacity = $${paramCount++}`);
      params.push(updates.maxCapacity);
    }

    if (setClauses.length === 0) {
      return null;
    }

    setClauses.push(`updated_at = CURRENT_TIMESTAMP`);
    params.push(sessionId);

    const result = await query(
      `UPDATE course_sessions 
       SET ${setClauses.join(', ')}
       WHERE id = $${paramCount}
       RETURNING 
         id, course_id, session_number, session_date, start_time, end_time,
         attendance_open_at, attendance_close_at, status, lecturer_id,
         location, max_capacity, created_at, updated_at`,
      params
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id,
      courseId: row.course_id,
      sessionNumber: row.session_number,
      sessionDate: row.session_date,
      startTime: row.start_time,
      endTime: row.end_time,
      attendanceOpenAt: row.attendance_open_at,
      attendanceCloseAt: row.attendance_close_at,
      status: row.status,
      lecturerId: row.lecturer_id,
      location: row.location,
      maxCapacity: row.max_capacity,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  } catch (error) {
    console.error('[attendanceService] Update session error:', error);
    throw error;
  }
}

/**
 * Get session by ID
 */
export async function getSession(sessionId: string): Promise<CourseSession | null> {
  try {
    const result = await query(
      `SELECT 
        id, course_id, session_number, session_date, start_time, end_time,
        attendance_open_at, attendance_close_at, status, lecturer_id,
        location, max_capacity, created_at, updated_at
       FROM course_sessions WHERE id = $1`,
      [sessionId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id,
      courseId: row.course_id,
      sessionNumber: row.session_number,
      sessionDate: row.session_date,
      startTime: row.start_time,
      endTime: row.end_time,
      attendanceOpenAt: row.attendance_open_at,
      attendanceCloseAt: row.attendance_close_at,
      status: row.status,
      lecturerId: row.lecturer_id,
      location: row.location,
      maxCapacity: row.max_capacity,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  } catch (error) {
    console.error('[attendanceService] Get session error:', error);
    throw error;
  }
}

/**
 * Get sessions for a course
 */
export async function getCourseSessions(
  courseId: string,
  status?: string
): Promise<CourseSession[]> {
  try {
    const whereClause = status ? 'WHERE course_id = $1 AND status = $2' : 'WHERE course_id = $1';
    const params = status ? [courseId, status] : [courseId];

    const result = await query(
      `SELECT 
        id, course_id, session_number, session_date, start_time, end_time,
        attendance_open_at, attendance_close_at, status, lecturer_id,
        location, max_capacity, created_at, updated_at
       FROM course_sessions
       ${whereClause}
       ORDER BY session_date ASC, start_time ASC`,
      params
    );

    return result.rows.map((row) => ({
      id: row.id,
      courseId: row.course_id,
      sessionNumber: row.session_number,
      sessionDate: row.session_date,
      startTime: row.start_time,
      endTime: row.end_time,
      attendanceOpenAt: row.attendance_open_at,
      attendanceCloseAt: row.attendance_close_at,
      status: row.status,
      lecturerId: row.lecturer_id,
      location: row.location,
      maxCapacity: row.max_capacity,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  } catch (error) {
    console.error('[attendanceService] Get course sessions error:', error);
    throw error;
  }
}

// ===========================
// ATTENDANCE MARKING
// ===========================

/**
 * Mark attendance with face verification
 * 
 * Process:
 * 1. Verify student face against enrollment
 * 2. Check if attendance window is open
 * 3. Enforce one-per-session constraint (database enforces)
 * 4. Mark attendance as "present" if verified
 * 5. Require manual review if verification fails
 */
export async function markAttendanceWithFace(
  req: MarkAttendanceWithFaceRequest,
  markedById: string
): Promise<MarkAttendanceWithFaceResponse> {
  try {
    // Get session details
    const sessionResult = await query(
      `SELECT 
        cs.id, cs.course_id, cs.session_date, cs.attendance_open_at, cs.attendance_close_at,
        c.platform_id
       FROM course_sessions cs
       JOIN courses c ON cs.course_id = c.id
       WHERE cs.id = $1`,
      [req.sessionId]
    );

    if (sessionResult.rows.length === 0) {
      return {
        success: false,
        attendanceId: '',
        status: 'absent',
        verificationMethod: req.verificationMethod,
        message: 'Session not found',
      };
    }

    const session = sessionResult.rows[0];
    const now = new Date();

    // Check attendance window
    const openAt = new Date(session.attendance_open_at);
    const closeAt = new Date(session.attendance_close_at);

    if (now < openAt || now > closeAt) {
      return {
        success: false,
        attendanceId: '',
        status: 'absent',
        verificationMethod: req.verificationMethod,
        message: `Attendance window closed. Open: ${openAt.toISOString()}, Close: ${closeAt.toISOString()}`,
      };
    }

    let attendanceStatus: AttendanceStatus = 'absent';
    let faceVerified = false;
    let faceVerificationId: string | undefined;

    // Handle face verification if requested
    if (req.verificationMethod === 'FACE_RECOGNITION') {
      if (!req.faceEncoding || !req.encodingDimension) {
        return {
          success: false,
          attendanceId: '',
          status: 'absent',
          verificationMethod: req.verificationMethod,
          message: 'Face encoding required for FACE_RECOGNITION verification',
        };
      }

      // Verify face
      const verifyResult = await verifyStudentFace(
        req.studentId,
        req.sessionId,
        req.faceEncoding,
        req.encodingDimension
      );

      faceVerified = verifyResult.isVerified;

      if (verifyResult.success) {
        faceVerificationId = verifyResult.verificationId;

        if (faceVerified) {
          attendanceStatus = 'present';
        } else if (verifyResult.requiresManualReview) {
          // For manual review, mark as 'absent' initially - admin will correct
          attendanceStatus = 'absent'
        } else {
          attendanceStatus = 'absent';
        }
      }
    } else {
      // Non-face verification (QR, manual, etc.)
      attendanceStatus = 'present';
    }

    // Try to create attendance record
    // This WILL FAIL if student already marked attendance for this session
    // (DB enforces one-per-session constraint)
    try {
      await query('BEGIN');

      const attendanceResult = await query(
        `INSERT INTO school_attendance (
          course_id, student_id, session_id, marked_by_id, attendance_date,
          status, verification_method, face_verified, face_verification_id,
          remarks
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING id`,
        [
          session.course_id,
          req.studentId,
          req.sessionId,
          markedById,
          session.session_date,
          attendanceStatus,
          req.verificationMethod,
          faceVerified,
          faceVerificationId || null,
          req.notes || null,
        ]
      );

      const attendanceId = attendanceResult.rows[0].id;

      // Log to audit
      await query(
        `INSERT INTO audit_logs (platform_id, user_id, action, entity_type, entity_id, new_values)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          session.platform_id,
          markedById,
          'MARK_ATTENDANCE',
          'attendance',
          attendanceId,
          JSON.stringify({
            studentId: req.studentId,
            sessionId: req.sessionId,
            status: attendanceStatus,
            verificationMethod: req.verificationMethod,
            faceVerified,
          }),
        ]
      );

      await query('COMMIT');

      return {
        success: true,
        attendanceId,
        status: attendanceStatus,
        verificationMethod: req.verificationMethod,
        faceVerified,
        message: `Attendance marked as ${attendanceStatus}`,
      };
    } catch (attendanceError: any) {
      await query('ROLLBACK');

      // Check if it's a unique constraint violation (already marked)
      if (attendanceError.code === '23505') {
        return {
          success: false,
          attendanceId: '',
          status: 'absent',
          verificationMethod: req.verificationMethod,
          message: 'Attendance already marked for this session',
        };
      }

      throw attendanceError;
    }
  } catch (error) {
    console.error('[attendanceService] Mark attendance error:', error);
    throw error;
  }
}

/**
 * Get session attendance report
 */
export async function getSessionAttendance(sessionId: string): Promise<SessionAttendanceRecord[]> {
  try {
    const result = await query(
      `SELECT 
        sa.id, sa.student_id, sa.status, sa.attendance_date,
        sa.session_id, sa.verification_method, sa.face_verified,
        sa.face_verification_id, sa.marked_at, sa.marked_by_id,
        sa.created_at, sa.updated_at
       FROM school_attendance sa
       WHERE sa.session_id = $1
       ORDER BY sa.marked_at ASC`,
      [sessionId]
    );

    return result.rows.map((row) => ({
      id: row.id,
      studentId: row.student_id,
      status: row.status,
      date: row.attendance_date,
      sessionId: row.session_id,
      verificationMethod: row.verification_method,
      faceVerified: row.face_verified,
      faceVerificationId: row.face_verification_id,
      markedAt: row.marked_at,
      markedBy: row.marked_by_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      notes: undefined,
    }));
  } catch (error) {
    console.error('[attendanceService] Get session attendance error:', error);
    throw error;
  }
}

/**
 * Get student attendance for a course
 */
export async function getStudentCourseAttendance(
  studentId: string,
  courseId: string
): Promise<SessionAttendanceRecord[]> {
  try {
    const result = await query(
      `SELECT 
        sa.id, sa.student_id, sa.status, sa.attendance_date,
        sa.session_id, sa.verification_method, sa.face_verified,
        sa.face_verification_id, sa.marked_at, sa.marked_by_id,
        sa.created_at, sa.updated_at
       FROM school_attendance sa
       JOIN course_sessions cs ON sa.session_id = cs.id
       WHERE sa.student_id = $1 AND cs.course_id = $2
       ORDER BY sa.attendance_date ASC`,
      [studentId, courseId]
    );

    return result.rows.map((row) => ({
      id: row.id,
      studentId: row.student_id,
      status: row.status,
      date: row.attendance_date,
      sessionId: row.session_id,
      verificationMethod: row.verification_method,
      faceVerified: row.face_verified,
      faceVerificationId: row.face_verification_id,
      markedAt: row.marked_at,
      markedBy: row.marked_by_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      notes: undefined,
    }));
  } catch (error) {
    console.error('[attendanceService] Get student course attendance error:', error);
    throw error;
  }
}
