/**
 * Face Recognition Service
 *
 * Handles:
 * - Face enrollment (storing student face embeddings, faculty-initiated)
 * - Face verification (matching capture against enrollment)
 * - Distance-based similarity matching
 * - Audit trail of all verification attempts
 *
 * Rewritten for two reasons.
 *
 * The first is that it never worked. face_recognition_enrollments.student_id
 * references students(id), but every function here passed a *user* id — the
 * enrolment lookup even joined `s.user_id = fre.student_id`. No enrolment
 * could satisfy the foreign key, so nothing was ever stored and nothing could
 * ever be verified.
 *
 * The second is tenancy. Scoping was by platform_id, one value shared by every
 * school, so the biometric pool was deployment-wide: enrolment accepted any
 * student id at all, and the audit trail recorded the wrong subject. Face
 * templates are the most sensitive thing this system holds, so every read and
 * write is now scoped to the tenant that owns the student.
 */

import pool, { query } from '../db/connection.js';
import {
  FaceRecognitionEnrollment,
  FaceRecognitionVerification,
  StudentFaceEnrollmentStatus,
  EnrollFaceResponse,
  VerifyFaceResponse,
} from '@jjelotech/types';

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
// SCOPE
// ===========================

/** What these functions need from the server-resolved request context. */
export interface FaceServiceContext {
  tenantId: string;
  userId: string;
  platformId: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolves a student row id within the caller's tenant.
 *
 * Accepts either the student row id or the student's user id, because callers
 * have historically passed both, and returns the students.id that the schema
 * actually references. Returns null for a student in another tenant, so a
 * foreign id is indistinguishable from one that does not exist.
 */
async function resolveStudentId(
  ctx: FaceServiceContext,
  candidate: string
): Promise<string | null> {
  if (!UUID.test(candidate ?? '')) return null;
  const r = await query(
    `SELECT id FROM students
      WHERE tenant_id = $1 AND (id = $2 OR user_id = $2)
      LIMIT 1`,
    [ctx.tenantId, candidate]
  );
  return r.rows[0]?.id ?? null;
}

// ===========================
// ENROLLMENT SERVICE
// ===========================

/**
 * Enrol a student's face. Faculty-initiated; requires a second faculty
 * verification before it can be used to mark attendance.
 */
export async function enrollStudentFace(
  ctx: FaceServiceContext,
  studentRef: string,
  faceEncoding: number[],
  encodingDimension: number,
  faceConfidence: number,
  enrolledById: string,
  enrollmentQualityScore?: number
): Promise<EnrollFaceResponse> {
  const studentId = await resolveStudentId(ctx, studentRef);
  if (!studentId) {
    return {
      success: false,
      enrollmentId: '',
      message: 'Student not found',
      requiresVerification: false,
    };
  }

  if (!Array.isArray(faceEncoding) || faceEncoding.length !== encodingDimension) {
    return {
      success: false,
      enrollmentId: '',
      message: `Face encoding must hold ${encodingDimension} values`,
      requiresVerification: false,
    };
  }

  // One client for the whole write: the supersede, the insert and the audit
  // entry have to commit together or not at all. Issuing BEGIN through the
  // pool, as before, gave no such guarantee.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Re-enrolment retires the previous template rather than deleting it, so
    // past verifications still point at the enrolment that authorised them.
    // A partial unique index allows only one active template per student, so
    // the old one is stood down before the new one is written, not after.
    const previous = await client.query(
      `UPDATE face_recognition_enrollments
          SET is_active = false
        WHERE student_id = $1 AND tenant_id = $2 AND is_active = true
        RETURNING id`,
      [studentId, ctx.tenantId]
    );

    const insertResult = await client.query(
      `INSERT INTO face_recognition_enrollments (
         student_id, platform_id, tenant_id, face_encoding, encoding_dimension,
         enrolled_by_id, face_confidence, enrollment_quality_score,
         is_active, is_verified
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,false)
       RETURNING id`,
      [
        studentId,
        ctx.platformId,
        ctx.tenantId,
        faceEncoding,
        encodingDimension,
        enrolledById,
        faceConfidence,
        enrollmentQualityScore ?? null,
      ]
    );
    const enrollmentId = insertResult.rows[0].id;

    if (previous.rows.length > 0) {
      await client.query(
        `UPDATE face_recognition_enrollments
            SET superseded_by_id = $1
          WHERE id = ANY($2::uuid[]) AND tenant_id = $3`,
        [enrollmentId, previous.rows.map((r: any) => r.id), ctx.tenantId]
      );
    }

    await client.query(
      `INSERT INTO audit_logs (platform_id, tenant_id, user_id, action, entity_type, entity_id, new_values)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        ctx.platformId,
        ctx.tenantId,
        enrolledById,
        'CREATE',
        'face_enrollment',
        enrollmentId,
        JSON.stringify({ tenantId: ctx.tenantId, studentId, faceConfidence, encodingDimension }),
      ]
    );

    await client.query('COMMIT');

    return {
      success: true,
      enrollmentId,
      message: 'Face enrollment created successfully. Faculty verification required.',
      requiresVerification: true,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[faceService] Enrollment error:', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Verify an enrolment (faculty action), confirming the template is usable.
 *
 * Scoped, and self-verification is refused: the point of the step is that a
 * second person looked at the capture.
 */
export async function verifyEnrollment(
  ctx: FaceServiceContext,
  enrollmentId: string,
  verifiedById: string
): Promise<{ success: boolean; message: string }> {
  if (!UUID.test(enrollmentId ?? '')) {
    return { success: false, message: 'Enrollment not found' };
  }

  const existing = await query(
    `SELECT id, enrolled_by_id FROM face_recognition_enrollments
      WHERE id = $1 AND tenant_id = $2`,
    [enrollmentId, ctx.tenantId]
  );
  if (existing.rows.length === 0) {
    return { success: false, message: 'Enrollment not found' };
  }
  if (existing.rows[0].enrolled_by_id === verifiedById) {
    return {
      success: false,
      message: 'An enrollment must be verified by someone other than the person who captured it',
    };
  }

  const result = await query(
    `UPDATE face_recognition_enrollments
        SET is_verified = true, verified_by_id = $2, verified_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND tenant_id = $3
      RETURNING student_id`,
    [enrollmentId, verifiedById, ctx.tenantId]
  );
  if (result.rows.length === 0) {
    return { success: false, message: 'Enrollment not found' };
  }

  await query(
    `INSERT INTO audit_logs (platform_id, tenant_id, user_id, action, entity_type, entity_id, new_values)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      ctx.platformId,
      ctx.tenantId,
      verifiedById,
      'VERIFY',
      'face_enrollment',
      enrollmentId,
      JSON.stringify({
        tenantId: ctx.tenantId,
        student_id: result.rows[0].student_id,
        verification_status: 'verified',
      }),
    ]
  );

  return { success: true, message: 'Enrollment verified successfully' };
}

/** A student's enrolment status, within the caller's tenant. */
export async function getEnrollmentStatus(
  ctx: FaceServiceContext,
  studentRef: string
): Promise<StudentFaceEnrollmentStatus | null> {
  const studentId = await resolveStudentId(ctx, studentRef);
  if (!studentId) return null;

  const result = await query(
    `SELECT s.id AS student_id,
            $3::uuid AS platform_id,
            (fre.id IS NOT NULL) AS has_active_enrollment,
            fre.id AS enrollment_id,
            fre.is_verified,
            fre.enrolled_at,
            fre.face_confidence,
            COUNT(frv.id) AS verification_attempts,
            COUNT(CASE WHEN frv.is_verified THEN 1 END) AS successful_verifications
       FROM students s
       LEFT JOIN face_recognition_enrollments fre
         ON fre.student_id = s.id AND fre.is_active = true AND fre.tenant_id = $2
       LEFT JOIN face_recognition_verifications frv
         ON frv.student_id = s.id AND frv.tenant_id = $2
      WHERE s.id = $1 AND s.tenant_id = $2
      GROUP BY s.id, fre.id`,
    [studentId, ctx.tenantId, ctx.platformId]
  );

  if (result.rows.length === 0) return null;
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
}

// ===========================
// VERIFICATION SERVICE
// ===========================

/**
 * Match a captured face against the student's active enrolment.
 *
 * The session, the student and the enrolment must all belong to the caller's
 * tenant. Every attempt is recorded, matched or not, because the record of
 * what was tried is the thing that makes a disputed mark answerable.
 */
export async function verifyStudentFace(
  ctx: FaceServiceContext,
  studentRef: string,
  sessionId: string,
  capturedFaceEncoding: number[],
  encodingDimension: number,
  clientIp?: string
): Promise<VerifyFaceResponse> {
  const refuse = (message: string, manual = true): VerifyFaceResponse => ({
    success: false,
    isVerified: false,
    similarityScore: 0,
    matchDistance: 0,
    verificationConfidence: 0,
    message,
    verificationId: '',
    requiresManualReview: manual,
  });

  if (!UUID.test(sessionId ?? '')) return refuse('Session not found');

  const sessionCheck = await query(
    `SELECT id FROM course_sessions WHERE id = $1 AND tenant_id = $2`,
    [sessionId, ctx.tenantId]
  );
  if (sessionCheck.rows.length === 0) return refuse('Session not found');

  const studentId = await resolveStudentId(ctx, studentRef);
  if (!studentId) return refuse('Student not found');

  const enrollmentCheck = await query(
    `SELECT id, face_encoding, encoding_dimension, face_confidence, enrollment_quality_score
       FROM face_recognition_enrollments
      WHERE student_id = $1 AND tenant_id = $2 AND is_active = true AND is_verified = true
      LIMIT 1`,
    [studentId, ctx.tenantId]
  );
  if (enrollmentCheck.rows.length === 0) {
    return refuse('No verified face enrollment found. Student must enroll first.');
  }

  const enrollment = enrollmentCheck.rows[0];

  if (encodingDimension !== enrollment.encoding_dimension) {
    return refuse(
      `Face encoding dimension mismatch. Expected ${enrollment.encoding_dimension}, got ${encodingDimension}`
    );
  }

  // Stored as a Postgres array; the driver returns it as a JavaScript array
  // of strings or numbers depending on the element type.
  const enrolledFaceVector = (enrollment.face_encoding as unknown[])?.map(Number);

  if (!Array.isArray(enrolledFaceVector) || enrolledFaceVector.length !== encodingDimension) {
    return refuse('Stored enrollment is unreadable. Re-enrollment required.');
  }

  const matchDistance = euclideanDistance(capturedFaceEncoding, enrolledFaceVector);
  const distanceThreshold = 0.6;
  const similarityScore = distanceToSimilarity(matchDistance, distanceThreshold);
  const verificationConfidence = calculateVerificationConfidence(
    matchDistance,
    enrollment.enrollment_quality_score || 0.95,
    distanceThreshold
  );

  const confidenceThreshold = 0.8;
  const isVerified = verificationConfidence >= confidenceThreshold && similarityScore >= 0.7;

  const attemptCheck = await query(
    `SELECT COUNT(*)::int AS attempt_count FROM face_recognition_verifications
      WHERE student_id = $1 AND session_id = $2 AND tenant_id = $3`,
    [studentId, sessionId, ctx.tenantId]
  );
  const attemptNumber = attemptCheck.rows[0].attempt_count + 1;
  const requiresManualReview = attemptNumber > 2;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const verificationResult = await client.query(
      `INSERT INTO face_recognition_verifications (
         student_id, session_id, captured_face_encoding, enrollment_id,
         match_distance, similarity_score, is_verified, verification_confidence,
         distance_threshold_used, client_ip, attempt_number, tenant_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
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
        ctx.tenantId,
      ]
    );
    const verificationId = verificationResult.rows[0].id;

    await client.query(
      `INSERT INTO audit_logs (platform_id, tenant_id, user_id, action, entity_type, entity_id, new_values)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        ctx.platformId,
        ctx.tenantId,
        ctx.userId,
        'FACE_VERIFICATION',
        'face_verification',
        verificationId,
        JSON.stringify({
          tenantId: ctx.tenantId,
          studentId,
          isVerified,
          confidence: verificationConfidence,
          distance: matchDistance,
          similarity: similarityScore,
        }),
      ]
    );

    await client.query('COMMIT');

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
    await client.query('ROLLBACK').catch(() => {});
    console.error('[faceService] Verification error:', error);
    throw error;
  } finally {
    client.release();
  }
}

/** Every verification attempt for a student in a session, within the tenant. */
export async function getVerificationHistory(
  ctx: FaceServiceContext,
  studentRef: string,
  sessionId: string
): Promise<FaceRecognitionVerification[]> {
  const studentId = await resolveStudentId(ctx, studentRef);
  if (!studentId || !UUID.test(sessionId ?? '')) return [];

  const result = await query(
    `SELECT id, student_id, session_id, match_distance, similarity_score,
            is_verified, verification_confidence, distance_threshold_used,
            verified_at, attempt_number, created_at
       FROM face_recognition_verifications
      WHERE student_id = $1 AND session_id = $2 AND tenant_id = $3
      ORDER BY attempt_number ASC`,
    [studentId, sessionId, ctx.tenantId]
  );

  return result.rows.map((row: any) => ({
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
}
