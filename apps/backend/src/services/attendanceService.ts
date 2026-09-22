/**
 * Session-based attendance, with face verification.
 *
 * Rewritten because every function here took an id straight from the request
 * and queried on it alone. A lecturer at one school could read any session by
 * id, create a session against another school's course, and pull any student's
 * attendance history. There was no tenant anywhere in the file.
 *
 * Three other things were wrong and are fixed here rather than preserved:
 *
 *   * The insert named school_attendance.course_id, a column that does not
 *     exist, so marking attendance through this path could only ever throw.
 *     The table is keyed on schedule_id; the schedule is now derived from the
 *     session's course and lecturer.
 *   * BEGIN and COMMIT were issued through the pool, so each statement could
 *     land on a different connection and the "transaction" guaranteed nothing.
 *     The write now holds one client for its whole span.
 *   * Reads selected sa.created_at and sa.updated_at, neither of which exists.
 *     marked_at is the column that records when a mark was made.
 *
 * Every exported function now takes the server-resolved context first. The
 * tenant is never a parameter the caller may choose.
 */

import pool, { query } from '../db/connection.js';
import {
  CourseSession,
  CreateSessionRequest,
  UpdateSessionRequest,
  SessionAttendanceRecord,
  MarkAttendanceWithFaceRequest,
  MarkAttendanceWithFaceResponse,
  AttendanceStatus,
} from '@jjelotech/types';
import { verifyStudentFace } from './faceRecognitionService.js';

/** What the service needs from the resolved request context. */
export interface ServiceContext {
  tenantId: string;
  userId: string;
  platformId: string;
}

const SESSION_COLUMNS = `
  id, course_id, session_number, session_date, start_time, end_time,
  attendance_open_at, attendance_close_at, status, lecturer_id,
  location, max_capacity, created_at, updated_at`;

function toSession(row: any): CourseSession {
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
}

function toAttendanceRecord(row: any): SessionAttendanceRecord {
  return {
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
    createdAt: row.marked_at,
    updatedAt: row.marked_at,
    notes: row.remarks ?? undefined,
  };
}

/** Raised for anything the caller may not act on. */
export class AttendanceScopeError extends Error {
  constructor(message: string, readonly status = 404) {
    super(message);
    this.name = 'AttendanceScopeError';
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireUuid(value: string, what: string): string {
  if (!UUID.test(value ?? '')) throw new AttendanceScopeError(`${what} not found`);
  return value;
}

// ===========================
// SESSION MANAGEMENT
// ===========================

/**
 * Creates a session against a course in the caller's own tenant.
 *
 * The lecturer must also be this tenant's: a session is an assignment of a
 * person to a class, and both halves must belong here.
 */
export async function createSession(
  ctx: ServiceContext,
  courseId: string,
  sessionData: CreateSessionRequest
): Promise<CourseSession> {
  requireUuid(courseId, 'Course');

  const course = await query(`SELECT id FROM courses WHERE id = $1 AND tenant_id = $2`, [
    courseId,
    ctx.tenantId,
  ]);
  if (course.rows.length === 0) throw new AttendanceScopeError('Course not found');

  // course_sessions.lecturer_id references faculty(id). Callers pass either
  // the faculty row id or the lecturer's user id, so both are resolved to the
  // id the schema expects rather than being stored as given.
  requireUuid(String(sessionData.lecturerId ?? ''), 'Faculty member');
  const faculty = await query(
    `SELECT id FROM faculty
      WHERE tenant_id = $2 AND (id = $1 OR user_id = $1)
      LIMIT 1`,
    [sessionData.lecturerId, ctx.tenantId]
  );
  if (faculty.rows.length === 0) throw new AttendanceScopeError('Faculty member not found');
  const lecturerId = faculty.rows[0].id;

  let result;
  try {
    result = await query(
      `INSERT INTO course_sessions (
         course_id, session_number, session_date, start_time, end_time,
         attendance_open_at, attendance_close_at, lecturer_id, location, max_capacity, tenant_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING ${SESSION_COLUMNS}`,
      [
        courseId,
        sessionData.sessionNumber,
        sessionData.sessionDate,
        sessionData.startTime,
        sessionData.endTime,
        sessionData.attendanceOpenAt,
        sessionData.attendanceCloseAt,
        lecturerId,
        sessionData.location || null,
        sessionData.maxCapacity || null,
        ctx.tenantId,
      ]
    );
  } catch (error: any) {
    // One session per course, date and start time.
    if (error.code === '23505') {
      throw new AttendanceScopeError(
        'A session already exists for this course at that date and time',
        409
      );
    }
    throw error;
  }

  return toSession(result.rows[0]);
}

/**
 * Updates a session, scoped.
 *
 * Returns null when the session is not in this tenant, so the caller answers
 * 404 and a foreign id is indistinguishable from one that does not exist.
 */
export async function updateSession(
  ctx: ServiceContext,
  sessionId: string,
  updates: UpdateSessionRequest
): Promise<CourseSession | null> {
  requireUuid(sessionId, 'Session');

  const setClauses: string[] = [];
  const params: any[] = [];

  if (updates.status) {
    params.push(updates.status);
    setClauses.push(`status = $${params.length}`);
  }
  if (updates.location) {
    params.push(updates.location);
    setClauses.push(`location = $${params.length}`);
  }
  if (updates.maxCapacity) {
    params.push(updates.maxCapacity);
    setClauses.push(`max_capacity = $${params.length}`);
  }
  if (setClauses.length === 0) return null;

  setClauses.push('updated_at = CURRENT_TIMESTAMP');
  params.push(sessionId, ctx.tenantId);

  const result = await query(
    `UPDATE course_sessions SET ${setClauses.join(', ')}
      WHERE id = $${params.length - 1} AND tenant_id = $${params.length}
      RETURNING ${SESSION_COLUMNS}`,
    params
  );

  return result.rows.length === 0 ? null : toSession(result.rows[0]);
}

export async function getSession(
  ctx: ServiceContext,
  sessionId: string
): Promise<CourseSession | null> {
  if (!UUID.test(sessionId ?? '')) return null;

  const result = await query(
    `SELECT ${SESSION_COLUMNS} FROM course_sessions WHERE id = $1 AND tenant_id = $2`,
    [sessionId, ctx.tenantId]
  );
  return result.rows.length === 0 ? null : toSession(result.rows[0]);
}

export async function getCourseSessions(
  ctx: ServiceContext,
  courseId: string,
  status?: string
): Promise<CourseSession[]> {
  if (!UUID.test(courseId ?? '')) return [];

  // The tenant predicate is $1 so the optional status filter cannot displace it.
  const params: any[] = [ctx.tenantId, courseId];
  let where = 'tenant_id = $1 AND course_id = $2';
  if (status) {
    params.push(status);
    where += ` AND status = $${params.length}`;
  }

  const result = await query(
    `SELECT ${SESSION_COLUMNS} FROM course_sessions
      WHERE ${where}
      ORDER BY session_date ASC, start_time ASC`,
    params
  );
  return result.rows.map(toSession);
}

// ===========================
// ATTENDANCE MARKING
// ===========================

/**
 * Marks attendance against a session, optionally verified by face.
 *
 * markedByFacultyId is a faculty row id, not a user id: school_attendance
 * .marked_by_id references faculty(id), and passing a user id there silently
 * failed the foreign key.
 */
export async function markAttendanceWithFace(
  ctx: ServiceContext,
  req: MarkAttendanceWithFaceRequest,
  markedByFacultyId: string
): Promise<MarkAttendanceWithFaceResponse> {
  const refuse = (message: string): MarkAttendanceWithFaceResponse => ({
    success: false,
    attendanceId: '',
    status: 'absent',
    verificationMethod: req.verificationMethod,
    message,
  });

  if (!UUID.test(req.sessionId ?? '') || !UUID.test(req.studentId ?? '')) {
    return refuse('Session not found');
  }

  // The session, the student and the schedule all have to be this tenant's.
  // A session id from another school reads as missing, not as forbidden.
  const sessionResult = await query(
    `SELECT cs.id, cs.course_id, cs.session_date, cs.attendance_open_at,
            cs.attendance_close_at, cs.lecturer_id
       FROM course_sessions cs
      WHERE cs.id = $1 AND cs.tenant_id = $2`,
    [req.sessionId, ctx.tenantId]
  );
  if (sessionResult.rows.length === 0) return refuse('Session not found');
  const session = sessionResult.rows[0];

  const studentCheck = await query(
    `SELECT id FROM students WHERE id = $1 AND tenant_id = $2`,
    [req.studentId, ctx.tenantId]
  );
  if (studentCheck.rows.length === 0) return refuse('Student not found');

  // school_attendance is keyed on schedule_id, so the session's course and
  // lecturer are resolved to the class they actually teach.
  const scheduleResult = await query(
    `SELECT cs.id
       FROM class_schedules cs
      WHERE cs.course_id = $2 AND cs.tenant_id = $1 AND cs.faculty_id = $3
      ORDER BY cs.section
      LIMIT 1`,
    [ctx.tenantId, session.course_id, session.lecturer_id]
  );
  if (scheduleResult.rows.length === 0) {
    return refuse('This session has no class schedule to record attendance against');
  }
  const scheduleId = scheduleResult.rows[0].id;

  const enrolled = await query(
    `SELECT 1 FROM student_courses
      WHERE student_id = $1 AND schedule_id = $2 AND tenant_id = $3 AND status = 'enrolled'`,
    [req.studentId, scheduleId, ctx.tenantId]
  );
  if (enrolled.rows.length === 0) return refuse('Student is not enrolled in this class');

  const now = new Date();
  const openAt = new Date(session.attendance_open_at);
  const closeAt = new Date(session.attendance_close_at);
  if (now < openAt || now > closeAt) {
    return refuse(
      `Attendance window closed. Open: ${openAt.toISOString()}, Close: ${closeAt.toISOString()}`
    );
  }

  let attendanceStatus: AttendanceStatus = 'absent';
  let faceVerified = false;
  let faceVerificationId: string | undefined;

  if (req.verificationMethod === 'FACE_RECOGNITION') {
    if (!req.faceEncoding || !req.encodingDimension) {
      return refuse('Face encoding required for FACE_RECOGNITION verification');
    }

    const verifyResult = await verifyStudentFace(
      ctx,
      req.studentId,
      req.sessionId,
      req.faceEncoding,
      req.encodingDimension
    );

    faceVerified = verifyResult.isVerified;
    if (verifyResult.success) {
      faceVerificationId = verifyResult.verificationId;
      // An unverified face is left absent for a human to correct through the
      // audit trail, rather than quietly recorded as present.
      attendanceStatus = faceVerified ? 'present' : 'absent';
    }
  } else {
    attendanceStatus = 'present';
  }

  // One client for the whole write, so the attendance row and its audit entry
  // commit or roll back together. The previous BEGIN/COMMIT went through the
  // pool and could run on unrelated connections.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const attendanceResult = await client.query(
      `INSERT INTO school_attendance (
         schedule_id, student_id, session_id, marked_by_id, attendance_date,
         status, verification_method, face_verified, face_verification_id,
         remarks, tenant_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id`,
      [
        scheduleId,
        req.studentId,
        req.sessionId,
        markedByFacultyId,
        session.session_date,
        attendanceStatus,
        req.verificationMethod,
        faceVerified,
        faceVerificationId || null,
        req.notes || null,
        ctx.tenantId,
      ]
    );

    const attendanceId = attendanceResult.rows[0].id;

    await client.query(
      `INSERT INTO audit_logs (platform_id, user_id, action, entity_type, entity_id, new_values)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        ctx.platformId,
        ctx.userId,
        'MARK_ATTENDANCE',
        'attendance',
        attendanceId,
        JSON.stringify({
          tenantId: ctx.tenantId,
          studentId: req.studentId,
          sessionId: req.sessionId,
          status: attendanceStatus,
          verificationMethod: req.verificationMethod,
          faceVerified,
        }),
      ]
    );

    await client.query('COMMIT');

    return {
      success: true,
      attendanceId,
      status: attendanceStatus,
      verificationMethod: req.verificationMethod,
      faceVerified,
      message: `Attendance marked as ${attendanceStatus}`,
    };
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.code === '23505') {
      return refuse('Attendance already marked for this session');
    }
    console.error('[attendanceService] Mark attendance error:', error);
    throw error;
  } finally {
    client.release();
  }
}

// ===========================
// REPORTS
// ===========================

export async function getSessionAttendance(
  ctx: ServiceContext,
  sessionId: string
): Promise<SessionAttendanceRecord[]> {
  if (!UUID.test(sessionId ?? '')) return [];

  const result = await query(
    `SELECT sa.id, sa.student_id, sa.status, sa.attendance_date,
            sa.session_id, sa.verification_method, sa.face_verified,
            sa.face_verification_id, sa.marked_at, sa.marked_by_id, sa.remarks
       FROM school_attendance sa
      WHERE sa.session_id = $1 AND sa.tenant_id = $2
      ORDER BY sa.marked_at ASC`,
    [sessionId, ctx.tenantId]
  );
  return result.rows.map(toAttendanceRecord);
}

export async function getStudentCourseAttendance(
  ctx: ServiceContext,
  studentId: string,
  courseId: string
): Promise<SessionAttendanceRecord[]> {
  if (!UUID.test(studentId ?? '') || !UUID.test(courseId ?? '')) return [];

  const result = await query(
    `SELECT sa.id, sa.student_id, sa.status, sa.attendance_date,
            sa.session_id, sa.verification_method, sa.face_verified,
            sa.face_verification_id, sa.marked_at, sa.marked_by_id, sa.remarks
       FROM school_attendance sa
       JOIN course_sessions cs ON cs.id = sa.session_id AND cs.tenant_id = $3
      WHERE sa.student_id = $1 AND cs.course_id = $2 AND sa.tenant_id = $3
      ORDER BY sa.attendance_date ASC`,
    [studentId, courseId, ctx.tenantId]
  );
  return result.rows.map(toAttendanceRecord);
}
