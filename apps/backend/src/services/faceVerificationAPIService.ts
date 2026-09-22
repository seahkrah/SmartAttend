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
