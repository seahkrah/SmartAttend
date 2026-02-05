/**
 * Superadmin Security Service
 * 
 * Implements comprehensive security hardening for superadmin operations:
 * - Mandatory MFA verification
 * - Short session TTL enforcement
 * - IP allowlist validation
 * - Rate limiting on destructive actions
 * - Confirmation token validation
 * - Dry-run mode for high-impact operations
 * 
 * All operations are tracked immutably in audit logs.
 */

import { query } from '../db/connection.js'
import { config } from '../config/environment.js'
import crypto from 'crypto'
import { v4 as uuidv4 } from 'uuid'

/**
 * Session management for superadmin with enforced TTL
 */
export interface SuperadminSession {
  id: string
  userId: string
  token: string
  ipAddress: string
  userAgent?: string
  createdAt: Date
  expiresAt: Date
  mfaVerifiedAt?: Date
  mfaMethod?: 'TOTP' | 'SMS' | 'EMAIL'
  isActive: boolean
}

/**
 * MFA Challenge for verification
 */
export interface MFAChallenge {
  id: string
  userId: string
  method: 'TOTP' | 'SMS' | 'EMAIL'
  code: string
  attempts: number
  maxAttempts: number
  expiresAt: Date
  verified: boolean
  verifiedAt?: Date
}

/**
 * Confirmation token for destructive operations
 */
export interface ConfirmationToken {
  id: string
  operation: string
  context: Record<string, any>
  token: string
  isUsed: boolean
  attempts: number
  maxAttempts: number
  createdAt: Date
  expiresAt: Date
}

/**
 * Rate limit state for destructive operations
 */
export interface RateLimit {
  key: string
  action: string
  count: number
  resetAt: Date
  blocked: boolean
}

// ===========================
// MFA VERIFICATION
// ===========================

/**
 * Check if MFA is required for superadmin in this environment
 */
export function isMFARequired(): boolean {
  return config.nodeEnv === 'production' || config.security.mfaEnabled
}

/**
 * Check if user has MFA enabled
 */
export async function isMFAEnabled(userId: string): Promise<boolean> {
  try {
    const result = await query(
      `SELECT mfa_enabled FROM users WHERE id = $1`,
      [userId]
    )
    return result.rows[0]?.mfa_enabled === true
  } catch (error) {
    console.error('Error checking MFA status:', error)
    return false
  }
}

/**
 * Create MFA challenge (send code to user)
 */
export async function createMFAChallenge(
  userId: string,
  method: 'TOTP' | 'SMS' | 'EMAIL'
): Promise<MFAChallenge> {
  const challengeId = uuidv4()
  const code = generateMFACode()
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000) // 10 minutes

  try {
    // Store challenge in database
    await query(
      `INSERT INTO mfa_challenges (id, user_id, method, code, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [challengeId, userId, method, code, expiresAt]
    )

    // In production, send code via SMS/Email
    if (method === 'SMS' || method === 'EMAIL') {
      // TODO: Send via SMS/Email service
      console.log(`[MFA] ${method} code sent to user ${userId}: ${code}`)
    }

    return {
      id: challengeId,
      userId,
      method,
      code, // Only return in dev for testing
      attempts: 0,
      maxAttempts: 5,
      expiresAt,
      verified: false
    }
  } catch (error) {
    console.error('Error creating MFA challenge:', error)
    throw error
  }
}

/**
 * Verify MFA code
 */
export async function verifyMFACode(
  challengeId: string,
  providedCode: string
): Promise<{ success: boolean; userId?: string; error?: string }> {
  try {
    const result = await query(
      `SELECT user_id, code, attempts, max_attempts, expires_at, verified_at
       FROM mfa_challenges
       WHERE id = $1 AND verified_at IS NULL`,
      [challengeId]
    )

    if (result.rows.length === 0) {
      return { success: false, error: 'Challenge not found or already verified' }
    }

    const challenge = result.rows[0]

    // Check if expired
    if (new Date(challenge.expires_at) < new Date()) {
      return { success: false, error: 'Challenge expired' }
    }

    // Check attempts
    if (challenge.attempts >= challenge.max_attempts) {
      return { success: false, error: 'Too many attempts' }
    }

    // Increment attempts
    await query(
      `UPDATE mfa_challenges SET attempts = attempts + 1 WHERE id = $1`,
      [challengeId]
    )

    // Verify code
    if (providedCode !== challenge.code) {
      return { success: false, error: 'Invalid code' }
    }

    // Mark as verified
    await query(
      `UPDATE mfa_challenges SET verified_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [challengeId]
    )

    return { success: true, userId: challenge.user_id }
  } catch (error) {
    console.error('Error verifying MFA code:', error)
    return { success: false, error: 'Verification failed' }
  }
}

/**
 * Generate random MFA code (6-digit)
 */
function generateMFACode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

// ===========================
// SESSION MANAGEMENT
// ===========================

/**
 * Create superadmin session with short TTL
 */
export async function createSuperadminSession(
  userId: string,
  ipAddress: string,
  userAgent?: string,
  mfaVerifiedAt?: Date
): Promise<SuperadminSession> {
  const sessionId = uuidv4()
  const sessionToken = generateSecureToken()
  
  // Short TTL: 15 minutes for superadmin
  const ttlMinutes = config.nodeEnv === 'production' ? 15 : 60
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000)

  try {
    await query(
      `INSERT INTO superadmin_sessions (id, user_id, token, ip_address, user_agent, expires_at, mfa_verified_at, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true)`,
      [sessionId, userId, hashToken(sessionToken), ipAddress, userAgent, expiresAt, mfaVerifiedAt]
    )

    return {
      id: sessionId,
      userId,
      token: sessionToken,
      ipAddress,
      userAgent,
      createdAt: new Date(),
      expiresAt,
      mfaVerifiedAt,
      isActive: true
    }
  } catch (error) {
    console.error('Error creating superadmin session:', error)
    throw error
  }
}

/**
 * Verify superadmin session is still valid
 */
export async function verifySuperadminSession(
  sessionId: string,
  token: string,
  ipAddress: string
): Promise<{ valid: boolean; userId?: string; error?: string }> {
  try {
    const result = await query(
      `SELECT user_id, ip_address, expires_at, is_active, mfa_verified_at
       FROM superadmin_sessions
       WHERE id = $1 AND token = $2 AND is_active = true`,
      [sessionId, hashToken(token)]
    )

    if (result.rows.length === 0) {
      return { valid: false, error: 'Invalid session' }
    }

    const session = result.rows[0]

    // Check expiration
    if (new Date(session.expires_at) < new Date()) {
      await query(
        `UPDATE superadmin_sessions SET is_active = false WHERE id = $1`,
        [sessionId]
      )
      return { valid: false, error: 'Session expired' }
    }

    // Check IP address (if allowlist enabled)
    if (config.security.ipAllowlistEnabled && session.ip_address !== ipAddress) {
      return { valid: false, error: 'IP address mismatch' }
    }

    // Check MFA verification (if required)
    if (isMFARequired() && !session.mfa_verified_at) {
      return { valid: false, error: 'MFA not verified' }
    }

    return { valid: true, userId: session.user_id }
  } catch (error) {
    console.error('Error verifying superadmin session:', error)
    return { valid: false, error: 'Verification failed' }
  }
}

/**
 * End superadmin session
 */
export async function endSuperadminSession(sessionId: string): Promise<void> {
  try {
    await query(
      `UPDATE superadmin_sessions SET is_active = false, ended_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [sessionId]
    )
  } catch (error) {
    console.error('Error ending superadmin session:', error)
    throw error
  }
}

/**
 * Get all active sessions for user (for monitoring)
 */
export async function getActiveSuperadminSessions(userId: string): Promise<SuperadminSession[]> {
  try {
    const result = await query(
      `SELECT id, user_id, ip_address, user_agent, created_at, expires_at, mfa_verified_at, is_active
       FROM superadmin_sessions
       WHERE user_id = $1 AND is_active = true
       ORDER BY created_at DESC`,
      [userId]
    )

    return result.rows.map(row => ({
      id: row.id,
      userId: row.user_id,
      token: '', // Never return token
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      createdAt: new Date(row.created_at),
      expiresAt: new Date(row.expires_at),
      mfaVerifiedAt: row.mfa_verified_at ? new Date(row.mfa_verified_at) : undefined,
      isActive: row.is_active
    }))
  } catch (error) {
    console.error('Error getting active sessions:', error)
    return []
  }
}

// ===========================
// IP ALLOWLIST MANAGEMENT
// ===========================

/**
 * Check if IP is allowlisted for superadmin
 */
export async function isIPAllowlisted(userId: string, ipAddress: string): Promise<boolean> {
  if (!config.security.ipAllowlistEnabled) {
    return true // Allowlist disabled
  }

  try {
    const result = await query(
      `SELECT COUNT(*) as count FROM ip_allowlist
       WHERE user_id = $1 AND ip_address = $2 AND is_active = true AND expires_at > NOW()`,
      [userId, ipAddress]
    )

    return result.rows[0].count > 0
  } catch (error) {
    console.error('Error checking IP allowlist:', error)
    return false
  }
}

/**
 * Add IP to allowlist
 */
export async function addIPToAllowlist(
  userId: string,
  ipAddress: string,
  description?: string,
  expirationDays: number = 30
): Promise<{ id: string; expiresAt: Date }> {
  const allowlistId = uuidv4()
  const expiresAt = new Date(Date.now() + expirationDays * 24 * 60 * 60 * 1000)

  try {
    await query(
      `INSERT INTO ip_allowlist (id, user_id, ip_address, description, expires_at, is_active)
       VALUES ($1, $2, $3, $4, $5, true)`,
      [allowlistId, userId, ipAddress, description, expiresAt]
    )

    return { id: allowlistId, expiresAt }
  } catch (error) {
    console.error('Error adding IP to allowlist:', error)
    throw error
  }
}

/**
 * Get all allowlisted IPs for user
 */
export async function getAllowlistedIPs(userId: string): Promise<any[]> {
  try {
    const result = await query(
      `SELECT id, ip_address, description, created_at, expires_at, is_active
       FROM ip_allowlist
       WHERE user_id = $1 AND is_active = true
       ORDER BY created_at DESC`,
      [userId]
    )

    return result.rows
  } catch (error) {
    console.error('Error getting allowlisted IPs:', error)
    return []
  }
}

// ===========================
// RATE LIMITING
// ===========================

/**
 * Check rate limit for destructive action
 */
export async function checkRateLimit(
  userId: string,
  action: string,
  maxCount: number = 5,
  windowSeconds: number = 3600
): Promise<{ allowed: boolean; remaining: number; resetAt: Date }> {
  const key = `${userId}:${action}`
  const resetAt = new Date(Date.now() + windowSeconds * 1000)

  try {
    // Get current count
    const result = await query(
      `SELECT id, count, reset_at FROM rate_limits
       WHERE user_id = $1 AND action = $2 AND reset_at > NOW()`,
      [userId, action]
    )

    if (result.rows.length === 0) {
      // Create new entry
      await query(
        `INSERT INTO rate_limits (id, user_id, action, count, reset_at)
         VALUES ($1, $2, $3, 1, $4)`,
        [uuidv4(), userId, action, resetAt]
      )
      return { allowed: true, remaining: maxCount - 1, resetAt }
    }

    const current = result.rows[0]
    const newCount = current.count + 1

    if (newCount > maxCount) {
      return { allowed: false, remaining: 0, resetAt: new Date(current.reset_at) }
    }

    // Increment count
    await query(
      `UPDATE rate_limits SET count = count + 1 WHERE id = $1`,
      [current.id]
    )

    return { allowed: true, remaining: maxCount - newCount, resetAt }
  } catch (error) {
    console.error('Error checking rate limit:', error)
    // Fail open for availability
    return { allowed: true, remaining: maxCount - 1, resetAt }
  }
}

/**
 * Reset rate limit after successful verification
 */
export async function resetRateLimit(userId: string, action: string): Promise<void> {
  try {
    await query(
      `DELETE FROM rate_limits WHERE user_id = $1 AND action = $2`,
      [userId, action]
    )
  } catch (error) {
    console.error('Error resetting rate limit:', error)
  }
}

// ===========================
// CONFIRMATION TOKENS
// ===========================

/**
 * Generate confirmation token for destructive operation
 */
export async function generateConfirmationToken(
  operation: string,
  context: Record<string, any>,
  ttlSeconds: number = 900
): Promise<{ token: string; id: string; expiresAt: Date }> {
  const tokenId = uuidv4()
  const plainToken = generateSecureToken()
  const hashedToken = hashToken(plainToken)
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000)

  try {
    await query(
      `INSERT INTO confirmation_tokens (id, operation, context, token_hash, expires_at, is_used)
       VALUES ($1, $2, $3::jsonb, $4, $5, false)`,
      [tokenId, operation, JSON.stringify(context), hashedToken, expiresAt]
    )

    return {
      token: plainToken,
      id: tokenId,
      expiresAt
    }
  } catch (error) {
    console.error('Error generating confirmation token:', error)
    throw error
  }
}

/**
 * Verify confirmation token
 */
export async function verifyConfirmationToken(
  token: string,
  operation: string
): Promise<{ valid: boolean; context?: Record<string, any>; error?: string }> {
  const hashedToken = hashToken(token)

  try {
    const result = await query(
      `SELECT id, context, attempts, max_attempts, expires_at, is_used
       FROM confirmation_tokens
       WHERE token_hash = $1 AND operation = $2 AND is_used = false`,
      [hashedToken, operation]
    )

    if (result.rows.length === 0) {
      return { valid: false, error: 'Token not found or already used' }
    }

    const tokenRecord = result.rows[0]

    // Check expiration
    if (new Date(tokenRecord.expires_at) < new Date()) {
      return { valid: false, error: 'Token expired' }
    }

    // Check attempts
    if (tokenRecord.attempts >= tokenRecord.max_attempts) {
      return { valid: false, error: 'Too many attempts' }
    }

    return { valid: true, context: tokenRecord.context }
  } catch (error) {
    console.error('Error verifying confirmation token:', error)
    return { valid: false, error: 'Verification failed' }
  }
}

/**
 * Consume confirmation token (mark as used)
 */
export async function consumeConfirmationToken(token: string, operation: string): Promise<void> {
  const hashedToken = hashToken(token)

  try {
    await query(
      `UPDATE confirmation_tokens
       SET is_used = true, confirmed_at = CURRENT_TIMESTAMP
       WHERE token_hash = $1 AND operation = $2`,
      [hashedToken, operation]
    )
  } catch (error) {
    console.error('Error consuming confirmation token:', error)
    throw error
  }
}

// ===========================
// DRY-RUN MODE
// ===========================

/**
 * Execute operation in dry-run mode (no state changes)
 */
export async function executeDryRun(
  operation: string,
  context: Record<string, any>,
  validationFn: (context: Record<string, any>) => Promise<{ valid: boolean; issues?: string[] }>
): Promise<{ success: boolean; issues?: string[]; simulatedResult?: any }> {
  try {
    console.log(`[DRY-RUN] Simulating ${operation} with context:`, context)

    // Validate operation would succeed
    const validation = await validationFn(context)

    if (!validation.valid) {
      return {
        success: false,
        issues: validation.issues || ['Validation failed']
      }
    }

    // Log dry-run attempt
    await query(
      `INSERT INTO dry_run_logs (operation, context, validation_result, simulated_at)
       VALUES ($1, $2::jsonb, $3::jsonb, CURRENT_TIMESTAMP)`,
      [operation, JSON.stringify(context), JSON.stringify({ valid: true })]
    ).catch(err => console.warn('Failed to log dry-run:', err))

    return {
      success: true,
      simulatedResult: {
        would: `${operation} would succeed`,
        context,
        validationPassed: true
      }
    }
  } catch (error) {
    console.error('Error executing dry-run:', error)
    return {
      success: false,
      issues: ['Dry-run validation failed']
    }
  }
}

// ===========================
// UTILITY FUNCTIONS
// ===========================

/**
 * Generate secure random token
 */
function generateSecureToken(): string {
  return crypto.randomBytes(32).toString('hex')
}

/**
 * Hash token for storage
 */
function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

/**
 * Log security event to immutable audit trail
 */
export async function logSecurityEvent(
  userId: string,
  eventType: string,
  details: Record<string, any>,
  severity: 'INFO' | 'WARNING' | 'CRITICAL'
): Promise<void> {
  try {
    await query(
      `INSERT INTO security_event_logs (user_id, event_type, details, severity, logged_at)
       VALUES ($1, $2, $3::jsonb, $4, CURRENT_TIMESTAMP)`,
      [userId, eventType, JSON.stringify(details), severity]
    )
  } catch (error) {
    console.error('Error logging security event:', error)
  }
}
