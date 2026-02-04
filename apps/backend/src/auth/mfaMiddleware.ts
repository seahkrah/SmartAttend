import { Request, Response, NextFunction } from 'express'
import { query } from '../db/connection.js'

/**
 * MFA Enforcement Middleware
 * Requires MFA verification for superadmin operations
 */

export interface MfaSession {
  userId: string
  mfaVerifiedAt: Date
  mfaTTLSeconds: number
}

// In-memory store for MFA verification (in production, use Redis or DB)
const mfaVerifiedSessions = new Map<string, MfaSession>()

/**
 * Check if superadmin has recently completed MFA
 */
export function isMfaVerified(userId: string, ttlSeconds: number = 900): boolean {
  const session = mfaVerifiedSessions.get(userId)
  if (!session) {
    return false
  }

  const elapsedSeconds = (Date.now() - session.mfaVerifiedAt.getTime()) / 1000
  return elapsedSeconds < session.mfaTTLSeconds
}

/**
 * Mark user as MFA verified
 */
export function markMfaVerified(userId: string, ttlSeconds: number = 900): void {
  mfaVerifiedSessions.set(userId, {
    userId,
    mfaVerifiedAt: new Date(),
    mfaTTLSeconds: ttlSeconds
  })
}

/**
 * Clear MFA verification (on logout or timeout)
 */
export function clearMfaVerification(userId: string): void {
  mfaVerifiedSessions.delete(userId)
}

/**
 * MFA Enforcement Middleware
 * Can be applied to specific routes that require MFA
 */
export function requireMfa(req: Request, res: Response, next: NextFunction) {
  const userId = req.user?.userId
  if (!userId) {
    return res.status(401).json({ error: 'Not authenticated' })
  }

  // Check if user has recent MFA verification
  if (!isMfaVerified(userId)) {
    return res.status(403).json({
      error: 'MFA verification required',
      code: 'MFA_REQUIRED',
      message: 'Please complete MFA verification to perform this action',
      recoveryHint: 'Call POST /api/superadmin/mfa/challenge to start MFA flow'
    })
  }

  // MFA verified, proceed
  next()
}

/**
 * Soft MFA check (logs warning if MFA is old, but allows operation)
 */
export function warnIfMfaOld(ttlWarningSeconds: number = 300) {
  return (req: Request, res: Response, next: NextFunction) => {
    const userId = req.user?.userId
    if (!userId) {
      return next()
    }

    const session = mfaVerifiedSessions.get(userId)
    if (session) {
      const elapsedSeconds = (Date.now() - session.mfaVerifiedAt.getTime()) / 1000
      if (elapsedSeconds > session.mfaTTLSeconds - ttlWarningSeconds) {
        res.setHeader(
          'X-MFA-Warning',
          `MFA verification will expire in ${Math.ceil((session.mfaTTLSeconds - elapsedSeconds) / 60)} minutes`
        )
      }
    }

    next()
  }
}

/**
 * MFA Challenge Endpoint
 * Creates a challenge for the user to verify via their MFA method
 */
export interface MfaChallengeRequest {
  method: 'TOTP' | 'SMS' | 'EMAIL'
  phoneNumber?: string
}

export interface MfaChallengeResponse {
  challengeId: string
  expiresAt: string
  method: 'TOTP' | 'SMS' | 'EMAIL'
  maskedDestination?: string // e.g., "***-***-1234" for SMS
  attemptLimit: number
  attemptsRemaining: number
}

// In-memory challenge store (production: use DB)
const mfaChallenges = new Map<
  string,
  {
    userId: string
    method: string
    code: string
    expiresAt: Date
    attempts: number
    maxAttempts: number
  }
>()

/**
 * Create an MFA challenge
 */
export async function createMfaChallenge(
  userId: string,
  method: 'TOTP' | 'SMS' | 'EMAIL'
): Promise<MfaChallengeResponse> {
  const challengeId = `mfa_${Date.now()}_${Math.random().toString(36).substring(7)}`

  // Generate a 6-digit code for SMS/EMAIL (TOTP is handled by authenticator app)
  const code = method === 'TOTP' ? '' : Math.floor(Math.random() * 1000000).toString().padStart(6, '0')
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000) // 10 minute expiry

  mfaChallenges.set(challengeId, {
    userId,
    method,
    code,
    expiresAt,
    attempts: 0,
    maxAttempts: 3
  })

  // TODO: Send actual SMS/EMAIL with code
  if (method === 'SMS') {
    console.log(`[MFA] SMS code for user ${userId}: ${code}`)
  } else if (method === 'EMAIL') {
    console.log(`[MFA] Email code for user ${userId}: ${code}`)
  }

  return {
    challengeId,
    expiresAt: expiresAt.toISOString(),
    method,
    maskedDestination: method === 'SMS' ? '***-***-1234' : undefined,
    attemptLimit: 3,
    attemptsRemaining: 3
  }
}

/**
 * Verify an MFA challenge
 */
export async function verifyMfaChallenge(
  challengeId: string,
  code: string
): Promise<{ success: boolean; userId: string; error?: string }> {
  const challenge = mfaChallenges.get(challengeId)

  if (!challenge) {
    return { success: false, userId: '', error: 'Challenge not found or expired' }
  }

  if (challenge.expiresAt < new Date()) {
    mfaChallenges.delete(challengeId)
    return { success: false, userId: '', error: 'Challenge has expired' }
  }

  if (challenge.attempts >= challenge.maxAttempts) {
    mfaChallenges.delete(challengeId)
    return { success: false, userId: '', error: 'Too many failed attempts' }
  }

  challenge.attempts++

  if (code !== challenge.code && challenge.method !== 'TOTP') {
    return {
      success: false,
      userId: challenge.userId,
      error: `Invalid code. ${challenge.maxAttempts - challenge.attempts} attempts remaining`
    }
  }

  // Success: mark as verified and clean up
  mfaChallenges.delete(challengeId)
  markMfaVerified(challenge.userId, 900) // 15 min TTL

  return { success: true, userId: challenge.userId }
}
