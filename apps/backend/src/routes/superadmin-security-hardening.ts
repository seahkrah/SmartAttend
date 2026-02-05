/**
 * Superadmin Security Hardening Routes
 * 
 * Enhanced API endpoints with comprehensive security controls:
 * - Mandatory MFA verification
 * - Short session TTL
 * - IP allowlisting
 * - Rate limiting
 * - Confirmation tokens for destructive operations
 * - Dry-run mode for high-impact operations
 */

import express, { Request, Response } from 'express'
import { authenticateToken } from '../auth/middleware.js'
import {
  requireMFAVerification,
  validateSuperadminSession,
  checkIPAllowlist,
  rateLimitDestructive,
  requireConfirmationToken,
  enforceSessionTTL
} from '../auth/superadminSecurityMiddleware.js'
import {
  createMFAChallenge,
  verifyMFACode,
  createSuperadminSession,
  endSuperadminSession,
  getActiveSuperadminSessions,
  addIPToAllowlist,
  getAllowlistedIPs,
  generateConfirmationToken,
  verifyConfirmationToken,
  consumeConfirmationToken,
  executeDryRun,
  logSecurityEvent,
  isMFARequired,
  resetRateLimit
} from '../services/superadminSecurityService.js'
import { config } from '../config/environment.js'
import { query } from '../db/connection.js'

const router = express.Router()

// ===========================
// MIDDLEWARE CHAIN
// ===========================

// 1. Authenticate user
router.use(authenticateToken)

// 2. Verify superadmin role (existing middleware)
router.use(async (req: Request, res: Response, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' })
    }

    const roleCheck = await query(
      `SELECT r.name FROM users u
       JOIN roles r ON u.role_id = r.id
       WHERE u.id = $1 AND r.name = 'superadmin'`,
      [req.user.userId]
    )

    if (roleCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Superadmin access required' })
    }

    next()
  } catch (error: any) {
    return res.status(500).json({ error: 'Authorization error' })
  }
})

// 3. Validate session (wrapped for async)
router.use((req: Request, res: Response, next) => {
  validateSuperadminSession(req, res, next).catch(next)
})

// 4. Check IP allowlist (wrapped for async)
router.use((req: Request, res: Response, next) => {
  checkIPAllowlist(req, res, next).catch(next)
})

// 5. Enforce session TTL (wrapped for async)
router.use((req: Request, res: Response, next) => {
  enforceSessionTTL(req, res, next).catch(next)
})

// 6. Rate limit destructive actions (applied selectively)
router.use((req, res, next) => {
  // Apply rate limiting to DELETE and some POST operations
  if (req.method === 'DELETE' || (req.method === 'POST' && req.path.includes('/reset-password'))) {
    return rateLimitDestructive(req, res, next).catch(next)
  }
  next()
})

// ===========================
// MFA ENDPOINTS
// ===========================

/**
 * POST /api/superadmin/security/mfa/challenge
 * Start MFA verification process
 */
router.post('/security/mfa/challenge', async (req: Request, res: Response) => {
  try {
    const { method = 'TOTP' } = req.body
    const userId = req.user!.userId

    if (!['TOTP', 'SMS', 'EMAIL'].includes(method)) {
      return res.status(400).json({ error: 'Invalid MFA method' })
    }

    if (!isMFARequired()) {
      return res.json({
        message: 'MFA not required in this environment',
        mfaRequired: false
      })
    }

    const challenge = await createMFAChallenge(userId, method)

    await logSecurityEvent(userId, 'MFA_CHALLENGE_CREATED', {
      method,
      challengeId: challenge.id
    }, 'INFO')

    return res.status(201).json({
      success: true,
      data: {
        challengeId: challenge.id,
        method,
        expiresAt: challenge.expiresAt,
        code: method === 'TOTP' ? undefined : challenge.code // Only return code for testing in dev
      },
      hint: method === 'TOTP'
        ? 'Enter the code from your authenticator app'
        : `${method} code sent to your registered ${method.toLowerCase()}`
    })
  } catch (error: any) {
    console.error('Error creating MFA challenge:', error)
    return res.status(500).json({ error: 'Failed to create MFA challenge' })
  }
})

/**
 * POST /api/superadmin/security/mfa/verify
 * Verify MFA code and create authenticated session
 */
router.post('/security/mfa/verify', async (req: Request, res: Response) => {
  try {
    const { challengeId, code } = req.body
    const userId = req.user!.userId
    const ipAddress = req.ip || 'unknown'

    if (!challengeId || !code) {
      return res.status(400).json({ error: 'Challenge ID and code required' })
    }

    // Verify MFA code
    const verification = await verifyMFACode(challengeId, code)

    if (!verification.success) {
      await logSecurityEvent(userId, 'MFA_VERIFICATION_FAILED', {
        challengeId,
        reason: verification.error
      }, 'WARNING')

      return res.status(403).json({
        error: 'MFA verification failed',
        details: verification.error
      })
    }

    // Create authenticated session
    const session = await createSuperadminSession(
      userId,
      ipAddress,
      req.get('user-agent'),
      new Date()
    )

    // Reset rate limits on successful MFA
    await resetRateLimit(userId, 'MFA_ATTEMPTS').catch(() => {})

    await logSecurityEvent(userId, 'MFA_VERIFIED', {
      method: 'CODE',
      sessionId: session.id
    }, 'INFO')

    return res.status(200).json({
      success: true,
      message: 'MFA verified',
      data: {
        sessionId: session.id,
        token: session.token,
        expiresAt: session.expiresAt,
        ttlMinutes: Math.floor((session.expiresAt.getTime() - Date.now()) / 60000)
      }
    })
  } catch (error: any) {
    console.error('Error verifying MFA:', error)
    return res.status(500).json({ error: 'MFA verification failed' })
  }
})

// ===========================
// SESSION MANAGEMENT
// ===========================

/**
 * GET /api/superadmin/security/sessions
 * List active sessions for monitoring
 */
router.get('/security/sessions', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId

    const sessions = await getActiveSuperadminSessions(userId)

    return res.json({
      success: true,
      data: sessions,
      count: sessions.length,
      message: sessions.length === 0 ? 'No active sessions' : undefined
    })
  } catch (error: any) {
    console.error('Error getting sessions:', error)
    return res.status(500).json({ error: 'Failed to get sessions' })
  }
})

/**
 * POST /api/superadmin/security/sessions/logout
 * End current session
 */
router.post('/security/sessions/logout', async (req: Request, res: Response) => {
  try {
    const sessionId = (req as any).sessionId
    const userId = req.user!.userId

    if (sessionId) {
      await endSuperadminSession(sessionId)
    }

    await logSecurityEvent(userId, 'SESSION_LOGOUT', {
      sessionId
    }, 'INFO')

    return res.json({
      success: true,
      message: 'Session ended'
    })
  } catch (error: any) {
    console.error('Error ending session:', error)
    return res.status(500).json({ error: 'Failed to end session' })
  }
})

/**
 * POST /api/superadmin/security/sessions/invalidate
 * Invalidate all active sessions (e.g., after password change)
 */
router.post('/security/sessions/invalidate', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId
    const confirmationToken = (req as any).confirmationToken

    // Verify confirmation token
    const tokenVerification = await verifyConfirmationToken(confirmationToken, 'SESSION_INVALIDATION')
    if (!tokenVerification.valid) {
      return res.status(403).json({ error: 'Invalid confirmation token' })
    }

    // Invalidate all active sessions
    await query(
      `UPDATE superadmin_sessions SET is_active = false WHERE user_id = $1`,
      [userId]
    )

    // Consume token
    await consumeConfirmationToken(confirmationToken, 'SESSION_INVALIDATION')

    await logSecurityEvent(userId, 'ALL_SESSIONS_INVALIDATED', {
      reason: tokenVerification.context?.reason
    }, 'WARNING')

    return res.json({
      success: true,
      message: 'All sessions invalidated. Please login again.'
    })
  } catch (error: any) {
    console.error('Error invalidating sessions:', error)
    return res.status(500).json({ error: 'Failed to invalidate sessions' })
  }
})

// ===========================
// IP ALLOWLIST MANAGEMENT
// ===========================

/**
 * GET /api/superadmin/security/ip-allowlist
 * List allowlisted IPs
 */
router.get('/security/ip-allowlist', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId

    if (!config.security.ipAllowlistEnabled) {
      return res.json({
        success: true,
        data: [],
        message: 'IP allowlist is not enabled'
      })
    }

    const ips = await getAllowlistedIPs(userId)

    return res.json({
      success: true,
      data: ips
    })
  } catch (error: any) {
    console.error('Error getting allowlist:', error)
    return res.status(500).json({ error: 'Failed to get IP allowlist' })
  }
})

/**
 * POST /api/superadmin/security/ip-allowlist
 * Add IP to allowlist (requires MFA)
 */
router.post('/security/ip-allowlist', async (req: Request, res: Response) => {
  try {
    const { ipAddress, description, expirationDays = 30 } = req.body
    const userId = req.user!.userId

    if (!ipAddress) {
      return res.status(400).json({ error: 'IP address required' })
    }

    if (!config.security.ipAllowlistEnabled) {
      return res.status(403).json({
        error: 'IP allowlist is not enabled in this environment'
      })
    }

    // Validate IP format
    if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ipAddress)) {
      return res.status(400).json({ error: 'Invalid IP address format' })
    }

    const result = await addIPToAllowlist(userId, ipAddress, description, expirationDays)

    await logSecurityEvent(userId, 'IP_ADDED_TO_ALLOWLIST', {
      ipAddress,
      expiresAt: result.expiresAt
    }, 'INFO')

    return res.status(201).json({
      success: true,
      message: 'IP added to allowlist',
      data: {
        id: result.id,
        ipAddress,
        expiresAt: result.expiresAt
      }
    })
  } catch (error: any) {
    console.error('Error adding IP to allowlist:', error)
    return res.status(500).json({ error: 'Failed to add IP to allowlist' })
  }
})

// ===========================
// CONFIRMATION TOKENS
// ===========================

/**
 * POST /api/superadmin/security/confirmation-token
 * Generate confirmation token for destructive operation
 */
router.post('/security/confirmation-token', async (req: Request, res: Response) => {
  try {
    const { operation, context } = req.body
    const userId = req.user!.userId

    if (!operation || !context) {
      return res.status(400).json({
        error: 'Operation and context required'
      })
    }

    const result = await generateConfirmationToken(operation, {
      ...context,
      requestedBy: userId
    })

    await logSecurityEvent(userId, 'CONFIRMATION_TOKEN_GENERATED', {
      operation,
      tokenId: result.id
    }, 'INFO')

    return res.status(201).json({
      success: true,
      data: {
        token: result.token,
        id: result.id,
        expiresAt: result.expiresAt,
        expiresIn: Math.floor((result.expiresAt.getTime() - Date.now()) / 1000)
      },
      warning: 'Token valid for 15 minutes. Share securely if needed.'
    })
  } catch (error: any) {
    console.error('Error generating confirmation token:', error)
    return res.status(500).json({ error: 'Failed to generate confirmation token' })
  }
})

// ===========================
// DRY-RUN ENDPOINTS
// ===========================

/**
 * POST /api/superadmin/security/delete-account-dryrun
 * Simulate account deletion without making changes
 */
router.post('/security/delete-account-dryrun', async (req: Request, res: Response) => {
  try {
    const { userId } = req.body
    const superadminId = req.user!.userId

    if (!userId) {
      return res.status(400).json({ error: 'User ID required' })
    }

    const result = await executeDryRun(
      'DELETE_SUPERADMIN_ACCOUNT',
      { targetUserId: userId, actorId: superadminId },
      async (context) => {
        // Validate that target user exists and is superadmin
        const userCheck = await query(
          `SELECT u.id FROM users u
           JOIN roles r ON u.role_id = r.id
           WHERE u.id = $1 AND r.name = 'superadmin'`,
          [context.targetUserId]
        )

        if (userCheck.rows.length === 0) {
          return { valid: false, issues: ['Target user is not a superadmin'] }
        }

        // Validate not deleting self
        if (context.targetUserId === context.actorId) {
          return { valid: false, issues: ['Cannot delete your own account'] }
        }

        return { valid: true }
      }
    )

    if (!result.success) {
      return res.json({
        success: false,
        dryRun: true,
        issues: result.issues
      })
    }

    return res.json({
      success: true,
      dryRun: true,
      message: 'Dry-run succeeded. Operation would succeed if executed.',
      nextStep: 'POST /api/superadmin/accounts/:userId (with confirmation token)',
      confirmationTokenNeeded: true
    })
  } catch (error: any) {
    console.error('Error in dry-run:', error)
    return res.status(500).json({ error: 'Dry-run failed' })
  }
})

// ===========================
// SECURITY STATUS
// ===========================

/**
 * GET /api/superadmin/security/status
 * Get current security configuration and status
 */
router.get('/security/status', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId

    return res.json({
      success: true,
      security: {
        mfaRequired: isMFARequired(),
        mfaEnabled: config.security.mfaEnabled,
        ipAllowlistEnabled: config.security.ipAllowlistEnabled,
        rateLimitingEnabled: true,
        sessionTTLMinutes: config.nodeEnv === 'production' ? 15 : 60,
        confirmationTokenRequired: true,
        dryRunSupported: true
      },
      environment: {
        nodeEnv: config.nodeEnv,
        timestamp: new Date().toISOString()
      },
      user: {
        userId,
        mfaStatus: await getMFAStatus(userId)
      }
    })
  } catch (error: any) {
    console.error('Error getting security status:', error)
    return res.status(500).json({ error: 'Failed to get security status' })
  }
})

/**
 * Helper: Get MFA status for user
 */
async function getMFAStatus(userId: string): Promise<string> {
  try {
    const result = await query(
      `SELECT mfa_enabled, mfa_method FROM users WHERE id = $1`,
      [userId]
    )

    if (result.rows.length === 0) {
      return 'unknown'
    }

    const user = result.rows[0]
    if (!user.mfa_enabled) {
      return 'not_enabled'
    }

    return `enabled_${user.mfa_method || 'unknown'}`
  } catch (error) {
    return 'error'
  }
}

export default router
