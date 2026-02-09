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
// FACE RECOGNITION ENROLLMENTS
// ===========================
export interface FaceRecognitionEnrollment {
  id: string;
  studentId: string | null;  // Can be null for system enrollment
  platformId: string;
  
  // Face data (stored as array for distance calculations)
  faceEncoding: number[];
  encodingDimension: number;
  
  // Enrollment metadata
  enrolledById: string;
  enrolledAt: string;
  
  // Quality
  faceConfidence: number;
  enrollmentQualityScore?: number;
  
  // Status
  isActive: boolean;
  isVerified: boolean;
  verifiedAt?: string;
  verifiedById?: string;
  
  // Re-enrollment tracking
  supersededById?: string;
  
  createdAt: string;
  updatedAt: string;
}

export interface EnrollFaceRequest {
  studentId: string;
  faceEncoding: number[];
  encodingDimension: number;
  faceConfidence: number;
  enrollmentQualityScore?: number;
}

export interface EnrollFaceResponse {
  success: boolean;
  enrollmentId: string;
  message: string;
  requiresVerification: boolean;
}

// ===========================
// FACE RECOGNITION VERIFICATIONS
// ===========================
export interface FaceRecognitionVerification {
  id: string;
  studentId: string;
  sessionId: string;
  
  // Matching results
  matchDistance: number | null;
  similarityScore: number | null;
  
  // Verification result
  isVerified: boolean;
  verificationConfidence: number;
  
  // Thresholds
  distanceThresholdUsed: number;
  
  // Context
  verifiedAt: string;
  clientIp?: string;
  attemptNumber: number;
  
  createdAt: string;
}

export interface VerifyFaceRequest {
  studentId: string;
  sessionId: string;
  faceEncoding: number[];
  encodingDimension: number;
  clientIp?: string;
}

export interface VerifyFaceResponse {
  success: boolean;
  isVerified: boolean;
  similarityScore: number;
  matchDistance: number;
  verificationConfidence: number;
  message: string;
  verificationId: string;
  requiresManualReview: boolean;
}

// ===========================
// ENROLLMENT STATUS
// ===========================
export interface StudentFaceEnrollmentStatus {
  studentId: string;
  platformId: string;
  hasActiveEnrollment: boolean;
  enrollmentId?: string;
  isVerified: boolean;
  enrolledAt?: string;
  faceConfidence?: number;
  verificationAttempts: number;
  successfulVerifications: number;
}

// ===========================
// ATTENDANCE WITH FACE VERIFICATION
// ===========================
export interface SessionAttendanceRecord extends AttendanceRecord {
  sessionId: string;
  verificationMethod: VerificationMethod;
  faceVerificationId?: string;
  faceEnrollmentId?: string;
  faceVerified: boolean;
}

export interface MarkAttendanceWithFaceRequest {
  studentId: string;
  sessionId: string;
  verificationMethod: VerificationMethod;
  faceEncoding?: number[];  // Required if verification_method is FACE_RECOGNITION
  encodingDimension?: number;
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
