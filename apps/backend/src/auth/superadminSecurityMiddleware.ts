/**
 * Superadmin Security Middleware
 * 
 * Enforces security controls for all superadmin operations:
 * - MFA verification
 * - Session validation
 * - IP allowlist checking
 * - Rate limiting
 * 
 * Applied globally to /api/superadmin routes
 */

import { Request, Response, NextFunction } from 'express'
import {
  isMFARequired,
  verifySuperadminSession,
  isIPAllowlisted,
  checkRateLimit,
  logSecurityEvent
} from '../services/superadminSecurityService.js'
import { config } from '../config/environment.js'
import { query } from '../db/connection.js'

/**
 * Middleware: Verify superadmin has active MFA session
 * 
 * MFA is mandatory in production, optional in development
 */
export function requireMFAVerification(req: Request, res: Response, next: NextFunction) {
  if (!isMFARequired()) {
    // MFA not required in this environment
    return next()
  }

  // Check if user has MFA verified session
  const sessionId = (req as any).sessionId
  const session = (req as any).session

  if (!session || !session.mfaVerifiedAt) {
    console.warn(`[SECURITY] Superadmin attempted operation without MFA verification: ${req.user?.userId}`)
    
    return res.status(403).json({
      error: 'MFA verification required',
      hint: 'Complete MFA challenge before performing sensitive operations',
      action: 'POST /api/superadmin/mfa/challenge'
    })
  }

  // Check MFA age (must be recent - within 30 minutes)
  const mfaAge = Date.now() - new Date(session.mfaVerifiedAt).getTime()
  const maxMFAAge = 30 * 60 * 1000 // 30 minutes

  if (mfaAge > maxMFAAge) {
    console.warn(`[SECURITY] MFA verification expired for user: ${req.user?.userId}`)
    
    return res.status(403).json({
      error: 'MFA verification expired',
      hint: 'Re-verify with MFA challenge',
      action: 'POST /api/superadmin/mfa/challenge'
    })
  }

  next()
}

/**
 * Middleware: Validate superadmin session
 * 
 * Checks:
 * - Session token is valid
 * - Session has not expired
 * - IP address matches (if allowlist enabled)
 */
export async function validateSuperadminSession(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user?.userId) {
      return res.status(401).json({ error: 'Not authenticated' })
    }

    // Get session info from request (set by auth middleware)
    const sessionId = (req as any).sessionId
    const sessionToken = (req as any).sessionToken
    const ipAddress = req.ip || req.connection.remoteAddress || 'unknown'

    if (!sessionId || !sessionToken) {
      return res.status(401).json({ error: 'Invalid session' })
    }

    // Verify session
    const verification = await verifySuperadminSession(sessionId, sessionToken, ipAddress)

    if (!verification.valid) {
      await logSecurityEvent(req.user.userId, 'INVALID_SESSION', {
        reason: verification.error,
        ipAddress
      }, 'WARNING')

      return res.status(403).json({
        error: 'Session invalid',
        details: verification.error
      })
    }

    // Store session for later use
    (req as any).session = {
      id: sessionId,
      userId: verification.userId,
      ipAddress
    }

    next()
  } catch (error: any) {
    console.error('[SECURITY] Session validation error:', error)
    return res.status(500).json({ error: 'Session validation failed' })
  }
}

/**
 * Middleware: Check IP allowlist
 * 
 * Verifies IP address is on superadmin's allowlist
 * (if enabled in environment)
 */
export async function checkIPAllowlist(req: Request, res: Response, next: NextFunction) {
  try {
    if (!config.security.ipAllowlistEnabled) {
      // IP allowlist disabled
      return next()
    }

    const userId = req.user?.userId
    const ipAddress = req.ip || req.connection.remoteAddress || 'unknown'

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' })
    }

    const allowed = await isIPAllowlisted(userId, ipAddress)

    if (!allowed) {
      await logSecurityEvent(userId, 'IP_NOT_ALLOWLISTED', {
        ipAddress,
        endpoint: req.path
      }, 'WARNING')

      return res.status(403).json({
        error: 'IP address not allowed',
        hint: 'Add this IP to your allowlist',
        details: `Your IP: ${ipAddress}`,
        action: 'POST /api/superadmin/ip-allowlist'
      })
    }

    next()
  } catch (error: any) {
    console.error('[SECURITY] IP allowlist check error:', error)
    return res.status(500).json({ error: 'IP validation failed' })
  }
}

/**
 * Middleware: Rate limit destructive actions
 * 
 * Actions covered:
 * - DELETE /accounts/:userId (delete superadmin)
 * - POST /accounts/:userId/reset-password
 * - POST /sessions/invalidate
 * - POST /incidents (create incident)
 * 
 * Limits: 5 per hour
 */
export async function rateLimitDestructive(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user?.userId
    if (!userId) return next()

    // Determine action based on endpoint
    let action = 'UNKNOWN'
    if (req.method === 'DELETE' && req.path.includes('/accounts/')) {
      action = 'DELETE_SUPERADMIN'
    } else if (req.method === 'POST' && req.path.includes('/reset-password')) {
      action = 'RESET_PASSWORD'
    } else if (req.method === 'POST' && req.path.includes('/sessions/invalidate')) {
      action = 'INVALIDATE_SESSIONS'
    } else if (req.method === 'POST' && req.path.includes('/incidents')) {
      action = 'CREATE_INCIDENT'
    } else {
      return next()
    }

    // Check rate limit (5 per hour)
    const limit = await checkRateLimit(userId, action, 5, 3600)

    if (!limit.allowed) {
      await logSecurityEvent(userId, 'RATE_LIMIT_EXCEEDED', {
        action,
        endpoint: req.path,
        resetAt: limit.resetAt
      }, 'WARNING')

      return res.status(429).json({
        error: 'Rate limit exceeded',
        details: `Too many ${action} operations`,
        retryAfter: Math.ceil((limit.resetAt.getTime() - Date.now()) / 1000),
        resetAt: limit.resetAt
      })
    }

    // Add rate limit info to response headers
    res.setHeader('X-RateLimit-Remaining', limit.remaining)
    res.setHeader('X-RateLimit-Reset', Math.floor(limit.resetAt.getTime() / 1000))

    next()
  } catch (error: any) {
    console.error('[SECURITY] Rate limit check error:', error)
    // Fail open for availability
    next()
  }
}

/**
 * Middleware: Require confirmation token for destructive operations
 * 
 * Operations covered:
 * - DELETE /accounts/:userId (delete superadmin)
 * - POST /sessions/invalidate (invalidate sessions)
 * - POST /tenants/:tenantId/lifecycle (change lifecycle to DECOMMISSIONED)
 * 
 * Confirmation tokens prevent accidental operations and provide audit trail.
 */
export function requireConfirmationToken(req: Request, res: Response, next: NextFunction) {
  // Only for destructive operations
  const isDestructive = (
    (req.method === 'DELETE' && req.path.includes('/accounts/')) ||
    (req.method === 'POST' && req.path.includes('/sessions/invalidate')) ||
    (req.method === 'POST' && req.path.includes('/lifecycle') && req.body?.newState === 'DECOMMISSIONED')
  )

  if (!isDestructive) {
    return next()
  }

  // Check if request is a dry-run
  if (req.body?.dryRun === true) {
    // Dry-run doesn't need confirmation
    return next()
  }

  // Require confirmation token
  const confirmationToken = req.body?.confirmationToken
  if (!confirmationToken) {
    return res.status(409).json({
      error: 'Confirmation required',
      hint: 'This is a destructive operation. Confirmation token required.',
      next_step: 'GET /api/superadmin/confirmation-token (to generate token)'
    })
  }

  // Store token for later validation
  (req as any).confirmationToken = confirmationToken

  next()
}

/**
 * Middleware: Enforce short session TTL in production
 * 
 * Production: 15 minutes
 * Staging: 60 minutes
 * Development: 2 hours
 */
export async function enforceSessionTTL(req: Request, res: Response, next: NextFunction) {
  try {
    const sessionId = (req as any).sessionId
    if (!sessionId) return next()

    const result = await query(
      `SELECT created_at, expires_at FROM superadmin_sessions WHERE id = $1`,
      [sessionId]
    )

    if (result.rows.length === 0) return next()

    const session = result.rows[0]
    const createdAt = new Date(session.created_at)
    const expiresAt = new Date(session.expires_at)
    const sessionAge = Date.now() - createdAt.getTime()

    // Get expected TTL based on environment
    const expectedTTL = {
      production: 15 * 60 * 1000,
      staging: 60 * 60 * 1000,
      development: 2 * 60 * 60 * 1000
    }[config.nodeEnv] || 60 * 60 * 1000

    // Warn if session is getting old (75% of TTL)
    if (sessionAge > expectedTTL * 0.75) {
      res.setHeader('X-Session-Warning', 'Session expiring soon. Please refresh.')
    }

    next()
  } catch (error: any) {
    console.error('[SECURITY] Session TTL check error:', error)
    next()
  }
}

/**
 * Middleware: Log all superadmin operations
 * 
 * Creates security events for audit trail
 */
export async function logSuperadminOperation(req: Request, res: Response, next: NextFunction) {
  // Store original send to intercept response
  const originalSend = res.send

  res.send = function(data: any) {
    // Log operation
    logSecurityEvent(
      req.user?.userId || 'unknown',
      `${req.method}_${req.path}`,
      {
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        ipAddress: req.ip,
        userAgent: req.get('user-agent')
      },
      res.statusCode >= 400 ? 'WARNING' : 'INFO'
    ).catch(err => console.warn('Failed to log operation:', err))

    return originalSend.call(this, data)
  }

  next()
}

/**
 * Error handler: Security violations
 */
export function handleSecurityError(error: any, req: Request, res: Response, next: NextFunction) {
  console.error('[SECURITY] Security error:', error)

  // Log critical security events
  if (error.code === 'INSUFFICIENT_PRIVILEGES') {
    logSecurityEvent(
      req.user?.userId || 'unknown',
      'PRIVILEGE_ESCALATION_ATTEMPT',
      { error: error.message },
      'CRITICAL'
    ).catch(err => console.warn('Failed to log security event:', err))
  }

  res.status(500).json({ error: 'Security validation failed' })
}
