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
export type VerificationMethod = 'FACE_RECOGNITION' | 'QR_CODE' | 'MANUAL' | 'RFID' | 'TOKEN';
export type SessionStatus = 'SCHEDULED' | 'IN_SESSION' | 'CLOSED' | 'CANCELLED';
export interface CourseSession {
    id: string;
    courseId: string;
    sessionNumber: number;
    sessionDate: string;
    startTime: string;
    endTime: string;
    attendanceOpenAt: string;
    attendanceCloseAt: string;
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
export interface FaceRecognitionEnrollment {
    id: string;
    studentId: string | null;
    platformId: string;
    faceEncoding: number[];
    encodingDimension: number;
    enrolledById: string;
    enrolledAt: string;
    faceConfidence: number;
    enrollmentQualityScore?: number;
    isActive: boolean;
    isVerified: boolean;
    verifiedAt?: string;
    verifiedById?: string;
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
export interface FaceRecognitionVerification {
    id: string;
    studentId: string;
    sessionId: string;
    matchDistance: number | null;
    similarityScore: number | null;
    isVerified: boolean;
    verificationConfidence: number;
    distanceThresholdUsed: number;
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
    faceEncoding?: number[];
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
//# sourceMappingURL=attendance.d.ts.map