/**
 * Attendance Types
 */

export type AttendanceStatus = 'present' | 'absent' | 'late' | 'excused';

export interface AttendanceRecord {
  id: string;
  userId?: string;
  studentId?: string;
  employeeId?: string;
  status: AttendanceStatus;
  date: string;
  notes?: string;
  markedBy?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface MarkAttendanceRequest {
  userId?: string;
  studentId?: string;
  employeeId?: string;
  status: AttendanceStatus;
  date: string;
  notes?: string;
}

export interface AttendanceStats {
  totalAttendance: number;
  presentDays: number;
  absentDays: number;
  lateDays: number;
  excusedDays: number;
  totalMembers: number;
  trend: 'up' | 'down' | 'stable';
}

export interface AttendanceHistory {
  data: AttendanceRecord[];
  total: number;
  limit: number;
  offset: number;
}

export interface AttendanceReport {
  data: (AttendanceRecord & {
    userInfo?: {
      name: string;
      email: string;
      studentId?: string;
      employeeId?: string;
    };
  })[];
  total: number;
  limit: number;
  offset: number;
  generatedAt: string;
}

/**
 * FACE RECOGNITION & SESSION-BASED ATTENDANCE
 */

// Verification methods
export type VerificationMethod = 'FACE_RECOGNITION' | 'QR_CODE' | 'MANUAL' | 'RFID' | 'TOKEN';

// ===========================
// COURSE SESSIONS
// ===========================
export type SessionStatus = 'SCHEDULED' | 'IN_SESSION' | 'CLOSED' | 'CANCELLED';

export interface CourseSession {
  id: string;
  courseId: string;
  sessionNumber: number;
  sessionDate: string;  // ISO date
  startTime: string;    // HH:mm:ss
  endTime: string;      // HH:mm:ss
  
  // Attendance window
  attendanceOpenAt: string;   // ISO timestamp
  attendanceCloseAt: string;  // ISO timestamp
  
  // Status and metadata
  status: SessionStatus;
  lecturerId: string;
  location?: string;
  maxCapacity?: number;
  
  createdAt: string;
  updatedAt: string;
}

export interface CreateSessionRequest {
  courseId: string;
  sessionNumber: number;
  sessionDate: string;
  startTime: string;
  endTime: string;
  attendanceOpenAt: string;
  attendanceCloseAt: string;
  lecturerId: string;
  location?: string;
  maxCapacity?: number;
}

export interface UpdateSessionRequest {
  status?: SessionStatus;
  location?: string;
  maxCapacity?: number;
}

// ===========================
// FACE MATCHING (/api/biometrics)
// ===========================
// The server derives faces from camera images. No type here carries a face
// descriptor: the client never sends one and never receives one.

export type FacePose = 'center' | 'left' | 'right';

export interface FaceChallenge {
  challengeId: string;
  /** The poses to capture, one image each, in this order. */
  steps: FacePose[];
  expiresAt: string;
}

export interface FaceMatchResult {
  matched: true;
  /** Cite this when recording attendance; usable once, for five minutes. */
  matchId: string;
  distance: number;
  threshold: number;
}

// ===========================
// ATTENDANCE WITH FACE VERIFICATION
// ===========================
export interface SessionAttendanceRecord extends AttendanceRecord {
  sessionId: string;
  verificationMethod: VerificationMethod;
  /** The biometric event the face check cited, when there was one. */
  faceMatchId?: string;
  faceVerified: boolean;
  /** When the mark was recorded. school_attendance.marked_at is the column
   *  that carries this; the table has no created_at/updated_at pair. */
  markedAt?: string;
}

export interface MarkAttendanceWithFaceRequest {
  studentId: string;
  sessionId: string;
  verificationMethod: VerificationMethod;
  /** Required for FACE_RECOGNITION: a match from /api/biometrics/identify. */
  faceMatchId?: string;
  notes?: string;
}

export interface MarkAttendanceWithFaceResponse {
  success: boolean;
  attendanceId: string;
  status: AttendanceStatus;
  verificationMethod: VerificationMethod;
  faceVerified?: boolean;
  message: string;
}
