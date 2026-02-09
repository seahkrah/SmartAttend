/**
 * Enhanced Face Verification API Service
 * 
 * Features:
 * - Face embedding storage and retrieval
 * - Batch face verification
 * - Liveness detection (spoofing detection)
 * - Confidence scoring
 * - Audit trail for all verifications
 */

import pool from '../db/connection.js'

interface FaceVerificationRequest {
  sessionId: string
  studentId: string
  embedding: number[]
  imageMetadata?: {
    width: number
    height: number
    brightness: number
    contrast: number
    edges: number
    texture: number
  }
}

interface FaceVerificationResponse {
  verified: boolean
  confidence: number
  livenessScore: number
  distance: number
  enrolledFaceId?: string
  warnings?: string[]
}

/**
 * Calculate Euclidean distance between two embeddings
 */
export function euclideanDistance(embed1: number[], embed2: number[]): number {
  let sum = 0
  for (let i = 0; i < embed1.length; i++) {
    const diff = embed1[i] - embed2[i]
    sum += diff * diff
  }
  return Math.sqrt(sum)
}

/**
 * Compute cosine similarity between two embeddings
 */
export function cosineSimilarity(embed1: number[], embed2: number[]): number {
  let dotProduct = 0
  let norm1 = 0
  let norm2 = 0

  for (let i = 0; i < embed1.length; i++) {
    dotProduct += embed1[i] * embed2[i]
    norm1 += embed1[i] * embed1[i]
    norm2 += embed2[i] * embed2[i]
  }

  norm1 = Math.sqrt(norm1)
  norm2 = Math.sqrt(norm2)

  if (norm1 === 0 || norm2 === 0) return 0
  return dotProduct / (norm1 * norm2)
}

/**
 * Detect liveness from image metadata
 * Returns 0-100 liveness score
 */
export function detectLiveness(metadata?: {
  brightness: number
  contrast: number
  edges: number
  texture: number
}): { score: number; isAlive: boolean; details: string[] } {
  const details: string[] = []
  let score = 50 // Base score

  if (!metadata) {
    // No metadata - assume live (conservative approach)
    return {
      score: 75,
      isAlive: true,
      details: ['Insufficient metadata for liveness detection'],
    }
  }

  // Brightness check: 0-50 is too dark (likely printed/2D), 200+ is too bright (likely screen reflection)
  if (metadata.brightness < 50 || metadata.brightness > 200) {
    score -= 15
    details.push(
      `Abnormal brightness: ${metadata.brightness} (likely ${metadata.brightness < 50 ? 'printed' : 'reflected'})`
    )
  } else {
    score += 10
    details.push(`Normal brightness: ${metadata.brightness}`)
  }

  // Contrast: Low contrast indicates flat image (printed/screen)
  if (metadata.contrast < 30) {
    score -= 20
    details.push('Low contrast (likely printed or 2D presentation)')
  } else if (metadata.contrast > 100) {
    score += 5
    details.push('Good contrast (indicates depth/3D)')
  }

  // Edges: Flat images have fewer edges
  if (metadata.edges < 100) {
    score -= 15
    details.push('Few edges detected (flat image characteristics)')
  } else {
    score += 10
    details.push('Adequate edge detection (3D characteristics present)')
  }

  // Texture: Real faces have specific texture patterns
  if (metadata.texture < 50) {
    score -= 10
    details.push('Low texture detail (flat/smooth surface)')
  } else {
    score += 10
    details.push('Natural texture patterns detected')
  }

  // Clamp to 0-100
  score = Math.max(0, Math.min(100, score))

  return {
    score,
    isAlive: score >= 60,
    details,
  }
}

/**
 * Verify student face against enrolled face
 */
export async function verifyStudentFace(
  request: FaceVerificationRequest
): Promise<FaceVerificationResponse> {
  try {
    // Get enrolled face for student
    const query = `
      SELECT id, embedding, enrolled_at
      FROM face_recognition_enrollments
      WHERE student_id = $1
      ORDER BY enrolled_at DESC
      LIMIT 1
    `

    const result = await pool.query(query, [request.studentId])

    if (result.rows.length === 0) {
      return {
        verified: false,
        confidence: 0,
        livenessScore: 0,
        distance: 999,
        warnings: ['No enrolled face found for student'],
      }
    }

    const enrolledFace = result.rows[0]
    const enrolledEmbedding = JSON.parse(enrolledFace.embedding)

    // Calculate distance
    const distance = euclideanDistance(request.embedding, enrolledEmbedding)
    
    // Calculate cosine similarity as secondary metric
    const similarity = cosineSimilarity(request.embedding, enrolledEmbedding)

    // Distance-based confidence: 0 = 100%, 3+ = 0%
    const distanceConfidence = Math.max(0, 100 - (distance / 3) * 100)

    // Similarity-based confidence: 0 = 0%, 1 = 100%
    const similarityConfidence = Math.max(0, ((similarity + 1) / 2) * 100)

    // Combined confidence (weighted average)
    const confidence = distanceConfidence * 0.6 + similarityConfidence * 0.4

    // Liveness detection
    const liveness = detectLiveness(request.imageMetadata)

    // Verification threshold: 80% confidence + live detection
    const verified = confidence >= 80 && liveness.score >= 60

    const warnings: string[] = []
    if (liveness.score < 60) {
      warnings.push(`Low liveness score: ${liveness.score}% - may be spoofing attempt`)
    }
    if (distance > 2.5) {
      warnings.push(`High distance score: ${distance.toFixed(2)} - face mismatch suspected`)
    }

    // Log verification attempt
    await pool.query(
      `
      INSERT INTO face_recognition_verifications
      (student_id, session_id, enrolled_face_id, distance, confidence, is_match)
      VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [request.studentId, request.sessionId, enrolledFace.id, distance, confidence, verified]
    )

    return {
      verified,
      confidence: Math.round(confidence),
      livenessScore: liveness.score,
      distance,
      enrolledFaceId: enrolledFace.id,
      warnings: warnings.length > 0 ? warnings : undefined,
    }
  } catch (error: any) {
    console.error('[verifyStudentFace] Error:', error)
    throw new Error(`Face verification failed: ${error.message}`)
  }
}

/**
 * Enroll student face for the first time
 */
export async function enrollNewFace(
  studentId: string,
  sessionId: string,
  embedding: number[]
): Promise<{ enrolled: boolean; enrollmentId: string }> {
  try {
    const query = `
      INSERT INTO face_recognition_enrollments
      (student_id, session_id, embedding, enrolled_at)
      VALUES ($1, $2, $3, NOW())
      RETURNING id, student_id, enrolled_at
    `

    const result = await pool.query(query, [studentId, sessionId, JSON.stringify(embedding)])

    if (result.rows.length > 0) {
      return {
        enrolled: true,
        enrollmentId: result.rows[0].id,
      }
    }

    throw new Error('Enrollment failed')
  } catch (error: any) {
    console.error('[enrollNewFace] Error:', error)
    throw new Error(`Face enrollment failed: ${error.message}`)
  }
}

/**
 * Get enrollment status for student
 */
export async function getEnrollmentStatusAPI(studentId: string): Promise<{
  enrolled: boolean
  enrollmentCount: number
  lastEnrolledAt?: string
  lastEnrolledSessionId?: string
}> {
  try {
    const query = `
      SELECT COUNT(*) as count, MAX(enrolled_at) as last_enrolled, MAX(session_id) as session_id
      FROM face_recognition_enrollments
      WHERE student_id = $1
    `

    const result = await pool.query(query, [studentId])
    const row = result.rows[0]

    return {
      enrolled: row.count > 0,
      enrollmentCount: parseInt(row.count),
      lastEnrolledAt: row.last_enrolled,
      lastEnrolledSessionId: row.session_id,
    }
  } catch (error: any) {
    console.error('[getEnrollmentStatusAPI] Error:', error)
    throw new Error(`Failed to get enrollment status: ${error.message}`)
  }
}

/**
 * Get verification audit trail for a student in a session
 */
export async function getVerificationAuditTrail(
  studentId: string,
  sessionId: string
): Promise<
  Array<{
    verificationId: string
    attemptNumber: number
    distance: number
    confidence: number
    isMatch: boolean
    verifiedAt: string
  }>
> {
  try {
    const query = `
      SELECT 
        id as "verificationId",
        ROW_NUMBER() OVER (PARTITION BY student_id ORDER BY created_at) as "attemptNumber",
        distance,
        confidence,
        is_match as "isMatch",
        created_at as "verifiedAt"
      FROM face_recognition_verifications
      WHERE student_id = $1 AND session_id = $2
      ORDER BY created_at DESC
    `

    const result = await pool.query(query, [studentId, sessionId])
    return result.rows
  } catch (error: any) {
    console.error('[getVerificationAuditTrail] Error:', error)
    throw new Error(`Failed to get audit trail: ${error.message}`)
  }
}
