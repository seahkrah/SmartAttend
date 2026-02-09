/**
 * Face Recognition Service
 * 
 * Handles:
 * - Face enrollment (storing student face embeddings, faculty-initiated)
 * - Face verification (matching capture against enrollment)
 * - Distance-based similarity matching
 * - Audit trail of all verification attempts
 * 
 * Database is source of truth for all decisions
 */

import { query } from '../db/connection.js';
import {
  FaceRecognitionEnrollment,
  FaceRecognitionVerification,
  StudentFaceEnrollmentStatus,
  EnrollFaceResponse,
  VerifyFaceResponse,
} from '@smartattend/types';

// ===========================
// DISTANCE CALCULATION
// ===========================

/**
 * Calculate Euclidean distance between two face vectors
 */
function euclideanDistance(vec1: number[], vec2: number[]): number {
  if (vec1.length !== vec2.length) {
    throw new Error('Vector dimensions must match');
  }

  let sum = 0;
  for (let i = 0; i < vec1.length; i++) {
    const diff = vec1[i] - vec2[i];
    sum += diff * diff;
  }

  return Math.sqrt(sum);
}

/**
 * Convert distance to normalized similarity score (0.0 - 1.0)
 * Lower distance = higher similarity
 * 
 * Uses tanh-based normalization to asymptotically approach 0 as distance increases
 */
function distanceToSimilarity(distance: number, maxDistance: number = 1.0): number {
  // Clamp to [0, max_distance]
  const clampedDistance = Math.min(Math.max(distance, 0), maxDistance);
  
  // Invert and normalize: 1.0 - (distance / max_distance)
  return Math.max(0.0, 1.0 - (clampedDistance / maxDistance));
}

/**
 * Calculate confidence score based on distance
 * Accounts for:
 * - Distance from enrollment
 * - General face quality
 */
function calculateVerificationConfidence(
  distance: number,
  enrollmentQuality: number = 0.95,
  distanceThreshold: number = 0.6
): number {
  // Similarity score
  const similarity = distanceToSimilarity(distance, distanceThreshold);
  
  // Weight by enrollment quality
  const weightedConfidence = similarity * (1 - (enrollmentQuality <= 0 ? 0.1 : 0.0));
  
  return Math.min(1.0, Math.max(0.0, weightedConfidence));
}

// ===========================
// ENROLLMENT SERVICE
// ===========================

/**
 * Enroll a student's face
 * Faculty-initiated process
 * 
 * Steps:
 * 1. Validate student exists and hasn't already enrolled
 * 2. Store face encoding in database
 * 3. Mark as pending verification
 * 4. Faculty must verify the enrollment quality
 */
export async function enrollStudentFace(
  studentId: string,
  platformId: string,
  faceEncoding: number[],
  encodingDimension: number,
  faceConfidence: number,
  enrolledById: string,
  enrollmentQualityScore?: number
): Promise<EnrollFaceResponse> {
  try {
    // Check if student exists
    const studentCheck = await query(
      `SELECT id FROM students WHERE user_id = $1`,
      [studentId]
    );

    if (studentCheck.rows.length === 0) {
      return {
        success: false,
        enrollmentId: '',
        message: 'Student not found',
        requiresVerification: false,
      };
    }

    const studentRecord = studentCheck.rows[0];

    // Check for active enrollment (to supersede if re-enrolling)
    const existingEnrollment = await query(
      `SELECT id FROM face_recognition_enrollments 
       WHERE student_id = $1 AND platform_id = $2 AND is_active = true`,
      [studentId, platformId]
    );

    try {
      await query('BEGIN');

      let enrollmentId: string;

      if (existingEnrollment.rows.length > 0) {
        // Re-enrollment: mark old as superseded
        await query(
          `UPDATE face_recognition_enrollments 
           SET is_active = false, superseded_by_id = (SELECT id FROM face_recognition_enrollments 
                                                        WHERE student_id = $1 AND platform_id = $2 AND is_active = true LIMIT 1)
           WHERE student_id = $1 AND platform_id = $2 AND is_active = true`,
          [studentId, platformId]
        );
      }

      // Insert new enrollment
      const insertResult = await query(
        `INSERT INTO face_recognition_enrollments (
          student_id, platform_id, face_encoding, encoding_dimension,
          enrolled_by_id, face_confidence, enrollment_quality_score,
          is_active, is_verified
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id`,
        [
          studentId,
          platformId,
          faceEncoding,
          encodingDimension,
          enrolledById,
          faceConfidence,
          enrollmentQualityScore || null,
          true,
          false, // Requires faculty verification
        ]
      );

      enrollmentId = insertResult.rows[0].id;

      // Log to audit trail
      await query(
        `INSERT INTO audit_logs (platform_id, user_id, action, entity_type, entity_id, new_values)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          platformId,
          enrolledById,
          'CREATE',
          'face_enrollment',
          enrollmentId,
          JSON.stringify({
            studentId,
            faceConfidence,
            encodingDimension,
          }),
        ]
      );

      await query('COMMIT');

      return {
        success: true,
        enrollmentId,
        message: 'Face enrollment created successfully. Faculty verification required.',
        requiresVerification: true,
      };
    } catch (error) {
      await query('ROLLBACK');
      throw error;
    }
  } catch (error) {
    console.error('[faceService] Enrollment error:', error);
    throw error;
  }
}

/**
 * Verify an enrollment (faculty action)
 * Confirms that the face enrollment quality is acceptable
 */
export async function verifyEnrollment(
  enrollmentId: string,
  verifiedById: string
): Promise<{ success: boolean; message: string }> {
  try {
    const result = await query(
      `UPDATE face_recognition_enrollments 
       SET is_verified = true, verified_by_id = $2, verified_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING student_id, platform_id`,
      [enrollmentId, verifiedById]
    );

    if (result.rows.length === 0) {
      return { success: false, message: 'Enrollment not found' };
    }

    const { student_id, platform_id } = result.rows[0];

    // Log verification
    await query(
      `INSERT INTO audit_logs (platform_id, user_id, action, entity_type, entity_id, new_values)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        platform_id,
        verifiedById,
        'VERIFY',
        'face_enrollment',
        enrollmentId,
        JSON.stringify({ student_id, verification_status: 'verified' }),
      ]
    );

    return {
      success: true,
      message: 'Enrollment verified successfully',
    };
  } catch (error) {
    console.error('[faceService] Verification error:', error);
    throw error;
  }
}

/**
 * Get student's enrollment status
 */
export async function getEnrollmentStatus(
  studentId: string,
  platformId: string
): Promise<StudentFaceEnrollmentStatus | null> {
  try {
    const result = await query(
      `SELECT 
        s.user_id AS student_id,
        $2 AS platform_id,
        (fre.id IS NOT NULL) AS has_active_enrollment,
        fre.id AS enrollment_id,
        fre.is_verified,
        fre.enrolled_at,
        fre.face_confidence,
        COUNT(frv.id) AS verification_attempts,
        COUNT(CASE WHEN frv.is_verified THEN 1 END) AS successful_verifications
       FROM students s
       LEFT JOIN face_recognition_enrollments fre 
         ON s.user_id = fre.student_id AND fre.is_active = true AND fre.platform_id = $2
       LEFT JOIN face_recognition_verifications frv 
         ON s.user_id = frv.student_id
       WHERE s.user_id = $1
       GROUP BY s.user_id, fre.id`,
      [studentId, platformId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      studentId: row.student_id,
      platformId: row.platform_id,
      hasActiveEnrollment: row.has_active_enrollment,
      enrollmentId: row.enrollment_id,
      isVerified: row.is_verified || false,
      enrolledAt: row.enrolled_at,
      faceConfidence: row.face_confidence,
      verificationAttempts: parseInt(row.verification_attempts, 10),
      successfulVerifications: parseInt(row.successful_verifications, 10),
    };
  } catch (error) {
    console.error('[faceService] GetEnrollmentStatus error:', error);
    throw error;
  }
}

// ===========================
// VERIFICATION SERVICE
// ===========================

/**
 * Verify a student's face during attendance
 * 
 * Steps:
 * 1. Check if student has active enrollment
 * 2. Get enrollment face vector
 * 3. Calculate distance between captured and enrolled face
 * 4. Log verification attempt with distance/confidence
 * 5. Return verification result
 */
export async function verifyStudentFace(
  studentId: string,
  sessionId: string,
  capturedFaceEncoding: number[],
  encodingDimension: number,
  clientIp?: string
): Promise<VerifyFaceResponse> {
  try {
    // Get session and course details
    const sessionCheck = await query(
      `SELECT cs.id, cs.course_id, c.platform_id 
       FROM course_sessions cs
       JOIN courses c ON cs.course_id = c.id
       WHERE cs.id = $1`,
      [sessionId]
    );

    if (sessionCheck.rows.length === 0) {
      return {
        success: false,
        isVerified: false,
        similarityScore: 0,
        matchDistance: 0,
        verificationConfidence: 0,
        message: 'Session not found',
        verificationId: '',
        requiresManualReview: true,
      };
    }

    const { platform_id: platformId } = sessionCheck.rows[0];

    // Get active enrollment
    const enrollmentCheck = await query(
      `SELECT id, face_encoding, encoding_dimension, face_confidence, enrollment_quality_score
       FROM face_recognition_enrollments
       WHERE student_id = $1 AND platform_id = $2 AND is_active = true AND is_verified = true
       LIMIT 1`,
      [studentId, platformId]
    );

    if (enrollmentCheck.rows.length === 0) {
      return {
        success: false,
        isVerified: false,
        similarityScore: 0,
        matchDistance: 0,
        verificationConfidence: 0,
        message: 'No verified face enrollment found. Student must enroll first.',
        verificationId: '',
        requiresManualReview: true,
      };
    }

    const enrollment = enrollmentCheck.rows[0];

    // Validate encoding dimensions match
    if (encodingDimension !== enrollment.encoding_dimension) {
      return {
        success: false,
        isVerified: false,
        similarityScore: 0,
        matchDistance: 0,
        verificationConfidence: 0,
        message: `Face encoding dimension mismatch. Expected ${enrollment.encoding_dimension}, got ${encodingDimension}`,
        verificationId: '',
        requiresManualReview: true,
      };
    }

    // Calculate distance
    const enrolledFaceVector = enrollment.face_encoding as number[];
    const matchDistance = euclideanDistance(capturedFaceEncoding, enrolledFaceVector);
    
    // Calculate similarity score
    const distanceThreshold = 0.6; // Euclidean distance threshold
    const similarityScore = distanceToSimilarity(matchDistance, distanceThreshold);
    
    // Calculate confidence
    const verificationConfidence = calculateVerificationConfidence(
      matchDistance,
      enrollment.enrollment_quality_score || 0.95,
      distanceThreshold
    );

    // Decision logic
    const confidenceThreshold = 0.80; // Must be 80%+ confident
    const isVerified = verificationConfidence >= confidenceThreshold && similarityScore >= 0.7;
    
    // Check attempt count (for potential overrides)
    const attemptCheck = await query(
      `SELECT COUNT(*) AS attempt_count FROM face_recognition_verifications
       WHERE student_id = $1 AND session_id = $2`,
      [studentId, sessionId]
    );

    const attemptNumber = parseInt(attemptCheck.rows[0].attempt_count, 10) + 1;
    const requiresManualReview = attemptNumber > 2;

    try {
      await query('BEGIN');

      // Log verification attempt
      const verificationResult = await query(
        `INSERT INTO face_recognition_verifications (
          student_id, session_id, captured_face_encoding, enrollment_id,
          match_distance, similarity_score, is_verified, verification_confidence,
          distance_threshold_used, client_ip, attempt_number
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING id`,
        [
          studentId,
          sessionId,
          capturedFaceEncoding,
          enrollment.id,
          matchDistance,
          similarityScore,
          isVerified,
          verificationConfidence,
          distanceThreshold,
          clientIp || null,
          attemptNumber,
        ]
      );

      const verificationId = verificationResult.rows[0].id;

      // Log to audit
      await query(
        `INSERT INTO audit_logs (platform_id, user_id, action, entity_type, entity_id, new_values)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          platformId,
          studentId,
          'FACE_VERIFICATION',
          'face_verification',
          verificationId,
          JSON.stringify({
            isVerified,
            confidence: verificationConfidence,
            distance: matchDistance,
            similarity: similarityScore,
          }),
        ]
      );

      await query('COMMIT');

      return {
        success: true,
        isVerified,
        similarityScore,
        matchDistance,
        verificationConfidence,
        message: isVerified
          ? 'Face verification successful'
          : requiresManualReview
          ? 'Face verification inconclusive. Manual review required.'
          : 'Face verification failed. Does not match enrollment.',
        verificationId,
        requiresManualReview,
      };
    } catch (error) {
      await query('ROLLBACK');
      throw error;
    }
  } catch (error) {
    console.error('[faceService] Verification error:', error);
    throw error;
  }
}

/**
 * Get verification history for a student in a session
 */
export async function getVerificationHistory(
  studentId: string,
  sessionId: string
): Promise<FaceRecognitionVerification[]> {
  try {
    const result = await query(
      `SELECT 
        id, student_id, session_id, match_distance, similarity_score,
        is_verified, verification_confidence, distance_threshold_used,
        verified_at, attempt_number, created_at
       FROM face_recognition_verifications
       WHERE student_id = $1 AND session_id = $2
       ORDER BY attempt_number ASC`,
      [studentId, sessionId]
    );

    return result.rows.map((row) => ({
      id: row.id,
      studentId: row.student_id,
      sessionId: row.session_id,
      matchDistance: row.match_distance,
      similarityScore: row.similarity_score,
      isVerified: row.is_verified,
      verificationConfidence: row.verification_confidence,
      distanceThresholdUsed: row.distance_threshold_used,
      verifiedAt: row.verified_at,
      attemptNumber: row.attempt_number,
      createdAt: row.created_at,
    }));
  } catch (error) {
    console.error('[faceService] GetVerificationHistory error:', error);
    throw error;
  }
}
