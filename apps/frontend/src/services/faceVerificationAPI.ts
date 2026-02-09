/**
 * Face Verification API Client
 * 
 * Sends face embeddings to backend for verification
 * - Verifies student faces
 * - Stores face encodings on backend
 * - Gets enrollment status
 * - Retrieves verification audit trails
 */

import { axiosClient } from '../utils/axiosClient';

export interface FaceVerifyRequest {
  sessionId: string
  studentId: string
  embedding: number[]
  imageMetadata?: {
    brightness: number
    contrast: number
    edges: number
    texture: number
  }
}

export interface FaceVerifyResponse {
  verified: boolean
  confidence: number
  livenessScore: number
  distance: number
  enrolledFaceId?: string
  isFirstEnrollment?: boolean
  warnings?: string[]
}

export interface EnrollmentStatus {
  enrolled: boolean
  enrollmentCount: number
  lastEnrolledAt?: string
  lastEnrolledSessionId?: string
}

export interface VerificationAuditEntry {
  verificationId: string
  attemptNumber: number
  distance: number
  confidence: number
  isMatch: boolean
  verifiedAt: string
}

/**
 * Verify face against enrolled face
 */
export async function verifyFaceWithBackend(request: FaceVerifyRequest): Promise<FaceVerifyResponse> {
  try {
    const response = await axiosClient.post('/face/verify', request)
    return response.data.data
  } catch (error: any) {
    console.error('[faceVerifyAPI] Error:', error)
    throw new Error(error.response?.data?.error || 'Face verification failed')
  }
}

/**
 * Enroll a new face for a student
 */
export async function enrollFaceWithBackend(
  studentId: string,
  sessionId: string,
  embedding: number[]
): Promise<{ enrolled: boolean; enrollmentId: string }> {
  try {
    const response = await axiosClient.post('/face/enroll', {
      studentId,
      sessionId,
      embedding,
    })
    return response.data.data
  } catch (error: any) {
    console.error('[enrollFaceAPI] Error:', error)
    throw new Error(error.response?.data?.error || 'Face enrollment failed')
  }
}

/**
 * Get enrollment status for a student
 */
export async function getEnrollmentStatusFromBackend(studentId: string): Promise<EnrollmentStatus> {
  try {
    const response = await axiosClient.get(`/face/enrollment-status/${studentId}`)
    return response.data.data
  } catch (error: any) {
    console.error('[enrollmentStatusAPI] Error:', error)
    throw new Error(error.response?.data?.error || 'Failed to get enrollment status')
  }
}

/**
 * Get verification audit trail
 */
export async function getAuditTrailFromBackend(
  sessionId: string,
  studentId: string
): Promise<VerificationAuditEntry[]> {
  try {
    const response = await axiosClient.get(`/face/audit-trail/${sessionId}/${studentId}`)
    return response.data.data
  } catch (error: any) {
    console.error('[auditTrailAPI] Error:', error)
    throw new Error(error.response?.data?.error || 'Failed to get audit trail')
  }
}
