/**
 * PHASE 5, STEP 5.1: Error Fingerprinting Service
 * Creates unique fingerprints for errors to enable deduplication
 * and grouping of similar errors
 */

import crypto from 'crypto'

export interface ErrorFingerprint {
  hash: string
  errorCode: string | null
  errorMessage: string
  stackTracePattern: string
  isRecurring: boolean
}

/**
 * Generate error fingerprint hash
 * Combines error code, message, and stack trace pattern for uniqueness
 */
export function generateErrorFingerprint(
  errorCode: string | undefined,
  errorMessage: string,
  stackTrace: string | undefined,
  includeFull: boolean = false
): ErrorFingerprint {
  // Extract first few lines of stack trace for pattern matching
  const stackTracePattern = extractStackTracePattern(stackTrace, 3)

  // Create fingerprint components
  const fingerprintComponents = [
    errorCode || 'UNKNOWN',
    normalizErrorMessage(errorMessage),
    stackTracePattern || 'NO_STACK',
  ]

  // Join components for hashing
  const fingerprintString = fingerprintComponents.join('|')

  // Generate SHA256 hash
  const hash = crypto.createHash('sha256').update(fingerprintString).digest('hex')

  return {
    hash,
    errorCode: errorCode || null,
    errorMessage,
    stackTracePattern,
    isRecurring: false,
  }
}

/**
 * Extract first N lines of stack trace for pattern matching
 * Removes variable values to focus on code location
 */
function extractStackTracePattern(stackTrace: string | undefined, lines: number): string {
  if (!stackTrace) {
    return ''
  }

  // Split by newline and take first N lines
  const stackLines = stackTrace
    .split('\n')
    .slice(0, lines)
    .map((line) => {
      // Remove line numbers and variable values
      return line
        .replace(/:\d+:\d+/g, ':LINE')
        .replace(/0x[0-9a-f]+/g, '0xADDR')
        .trim()
    })
    .filter((line) => line.length > 0)
    .join('|')

  return stackLines
}

/**
 * Normalize error message to allow grouping of similar messages
 * Removes timestamps, IDs, and variable values
 */
function normalizErrorMessage(message: string): string {
  return message
    .toLowerCase()
    // Remove UUIDs and GUIDs
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, 'UUID')
    // Remove timestamps
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[Z\+\-\d:]*/, 'TIMESTAMP')
    // Remove numbers (could be IDs, counts, etc.)
    .replace(/\b\d+\b/g, 'NUM')
    // Remove file paths
    .replace(/[a-z]:\\[^\s]*/gi, 'PATH')
    .replace(/\/[^\s]*/g, 'PATH')
    // Remove quoted strings
    .replace(/'[^']*'/g, 'STRING')
    .replace(/"[^"]*"/g, 'STRING')
    // Collapse multiple spaces
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Calculate similarity between two fingerprints
 * Returns a score from 0 to 1 (1 = identical)
 */
export function calculateFingerprintSimilarity(
  fingerprint1: ErrorFingerprint,
  fingerprint2: ErrorFingerprint
): number {
  // Check exact hash match first
  if (fingerprint1.hash === fingerprint2.hash) {
    return 1.0
  }

  // Check if error codes match
  if (fingerprint1.errorCode === fingerprint2.errorCode && fingerprint1.errorCode) {
    // If error codes match, high similarity
    if (fingerprint1.stackTracePattern === fingerprint2.stackTracePattern) {
      return 0.9
    }
    // Same error code but different stack trace - still related
    return 0.6
  }

  // Check if stack traces match (key indicator of same issue)
  if (
    fingerprint1.stackTracePattern &&
    fingerprint2.stackTracePattern &&
    fingerprint1.stackTracePattern === fingerprint2.stackTracePattern
  ) {
    return 0.7
  }

  // Check message similarity
  const messageSimilarity = calculateStringSimilarity(
    fingerprint1.errorMessage,
    fingerprint2.errorMessage
  )
  return messageSimilarity > 0.7 ? 0.5 : 0
}

/**
 * Calculate Levenshtein distance-based similarity
 */
function calculateStringSimilarity(str1: string, str2: string): number {
  const s1 = str1.toLowerCase()
  const s2 = str2.toLowerCase()

  if (s1 === s2) return 1.0

  const longer = s1.length > s2.length ? s1 : s2
  const shorter = s1.length > s2.length ? s2 : s1

  if (longer.length === 0) return 1.0

  const distance = levenshteinDistance(longer, shorter)
  return (longer.length - distance) / longer.length
}

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(s1: string, s2: string): number {
  const costs = []

  for (let i = 0; i <= s1.length; i++) {
    let lastValue = i
    for (let j = 0; j <= s2.length; j++) {
      if (i === 0) {
        costs[j] = j
      } else if (j > 0) {
        let newValue = costs[j - 1]
        if (s1.charAt(i - 1) !== s2.charAt(j - 1)) {
          newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1
        }
        costs[j - 1] = lastValue
        lastValue = newValue
      }
    }
    if (i > 0) {
      costs[s2.length] = lastValue
    }
  }

  return costs[s2.length]
}

/**
 * Create fingerprint for database errors
 */
export function fingerprintDatabaseError(
  error: any,
  query?: string
): ErrorFingerprint {
  const errorCode = error.code ? `DB_${error.code}` : 'DB_ERROR'
  const message = error.message || 'Unknown database error'

  // Include first part of query in fingerprint to distinguish different query errors
  let stackTrace = ''
  if (query) {
    // Extract just the first clause to avoid noise from parameters
    const queryStart = query.match(/^[A-Z]+\s+[A-Z]+/)?.[0] || 'QUERY'
    stackTrace = `${queryStart}\n${error.file || 'unknown'}:${error.line || 0}`
  }

  return generateErrorFingerprint(errorCode, message, stackTrace || error.stack)
}

/**
 * Create fingerprint for API validation errors
 */
export function fingerprintValidationError(
  fieldName: string,
  validationType: string,
  expectedValue?: any
): ErrorFingerprint {
  const errorCode = `VALIDATION_${validationType.toUpperCase()}`
  const message = `Field ${fieldName} failed ${validationType} validation`

  return generateErrorFingerprint(errorCode, message, undefined)
}

/**
 * Create fingerprint for authentication errors
 */
export function fingerprintAuthError(
  authType: string,
  reason: string
): ErrorFingerprint {
  const errorCode = `AUTH_${authType.toUpperCase()}_${reason.toUpperCase()}`
  const message = `Authentication failed: ${authType} - ${reason}`

  return generateErrorFingerprint(errorCode, message, undefined)
}

/**
 * Create fingerprint for role/permission errors
 */
export function fingerprintRoleError(
  action: string,
  requiredRole: string,
  userRole: string
): ErrorFingerprint {
  const errorCode = 'UNAUTHORIZED_ROLE'
  const message = `Action ${action} requires ${requiredRole} but user has ${userRole}`

  return generateErrorFingerprint(errorCode, message, undefined)
}
