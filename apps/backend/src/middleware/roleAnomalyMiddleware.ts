/**
 * ===========================
 * ROLE ANOMALY MIDDLEWARE
 * ===========================
 * 
 * Checks if user's role has been marked as compromised.
 * If yes, forces session revalidation and MFA challenge.
 * 
 * Applied to all protected routes AFTER authentication.
 */

import { Request, Response, NextFunction } from 'express'
import { query } from '../db/connection.js'
import { v4 as uuidv4 } from 'uuid'
import '../types/auth.js' // Import type definitions

declare global {
  namespace Express {
    interface Request {
      userId?: string
      roleCompromised?: boolean
      requiresMfaChallenge?: boolean
    }
  }
}

// ===========================
// ROLE ANOMALY MIDDLEWARE
// ===========================

/**
 * Check if user's role is marked as compromised
 * If yes, invalidate session and require MFA
 */
export async function checkRoleCompromised(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    (req as any).roleCompromised = false;
    (req as any).requiresMfaChallenge = false

    // Only check authenticated requests
    const userId = (req.user as any)?.id || (req.user as any)?.userId
    if (!userId) {
      return next()
    }

    // Query database for role compromise flag
    const result = await query(
      `SELECT 
        role_may_be_compromised,
        last_escalation_event_id,
        is_mfa_enabled
       FROM users 
       WHERE id = $1`,
      [userId]
    )

    if (result.rows.length === 0) {
      // User not found (shouldn't happen if middleware order correct)
      res.status(401).json({
        error: 'INVALID_USER',
        message: 'User not found',
      })
      return
    }

    const user = result.rows[0]

    if (user.role_may_be_compromised) {
      console.warn(
        `[ROLE_ANOMALY] User ${userId}'s role marked as compromised. Escalation event: ${user.last_escalation_event_id}`
      )

      req.roleCompromised = true

      // Check if session is already flagged for revalidation
      const sessionResult = await query(
        `SELECT id, requires_mfa_challenge, role_revalidation_required, is_invalidated
         FROM sessions
         WHERE user_id = $1 AND is_active = TRUE
         ORDER BY created_at DESC
         LIMIT 1`,
        [userId]
      )

      if (sessionResult.rows.length > 0) {
        const session = sessionResult.rows[0]

        if (session.is_invalidated) {
          // Session already invalidated
          console.warn(`[ROLE_ANOMALY] Session ${session.id} already invalidated for user ${userId}`)

          res.status(401).json({
            error: 'SESSION_INVALIDATED',
            message: 'Your session has been invalidated due to security concerns',
            escalationEventId: user.last_escalation_event_id,
          })
          return
        }

        // Mark session for revalidation if not already
        if (!session.role_revalidation_required) {
          await query(
            `UPDATE sessions 
             SET requires_mfa_challenge = TRUE, role_revalidation_required = TRUE
             WHERE id = $1`,
            [session.id]
          )

          console.warn(
            `[ROLE_ANOMALY] Session ${session.id} marked for MFA challenge due to role anomaly`
          )
        }

        req.requiresMfaChallenge = true

        // If MFA enabled, require challenge before proceeding
        if (user.is_mfa_enabled) {
          res.status(403).json({
            error: 'MFA_CHALLENGE_REQUIRED',
            message: 'Your role requires verification. Please complete MFA challenge.',
            escalationEventId: user.last_escalation_event_id,
            requiresMfaChallenge: true,
          })
          return
        }

        // If MFA not enabled, still block but with different message
        res.status(403).json({
          error: 'ROLE_REVALIDATION_REQUIRED',
          message: 'Your role requires revalidation before continuing',
          escalationEventId: user.last_escalation_event_id,
        })
        return
      }
    }

    next()
  } catch (error) {
    console.error('[ROLE_ANOMALY] Error checking role compromise:', error)
    next(error)
  }
}

/**
 * Force session revalidation by invalidating current session
 * User must re-authenticate
 */
export async function invalidateUserSessions(userId: string): Promise<void> {
  try {
    // Mark all user's active sessions as invalid
    await query(
      `UPDATE sessions 
       SET is_invalidated = TRUE, invalidated_at = CURRENT_TIMESTAMP
       WHERE user_id = $1 AND is_active = TRUE`,
      [userId]
    )

    // Clear session data from cache/store
    console.warn(`[ROLE_ANOMALY] Invalidated all sessions for user ${userId}`)
  } catch (error) {
    console.error('[ROLE_ANOMALY] Error invalidating sessions:', error)
    throw error
  }
}

/**
 * Mark session for MFA challenge
 */
export async function markSessionForMfaChallenge(sessionId: string): Promise<void> {
  try {
    await query(
      `UPDATE sessions 
       SET requires_mfa_challenge = TRUE, mfa_challenge_required_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [sessionId]
    )

    console.log(`[ROLE_ANOMALY] Session ${sessionId} marked for MFA challenge`)
  } catch (error) {
    console.error('[ROLE_ANOMALY] Error marking session for MFA:', error)
    throw error
  }
}

/**
 * Clear MFA challenge requirement after successful verification
 */
export async function clearMfaChallenge(sessionId: string): Promise<void> {
  try {
    await query(
      `UPDATE sessions 
       SET requires_mfa_challenge = FALSE, mfa_challenge_verified_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [sessionId]
    )

    console.log(`[ROLE_ANOMALY] MFA challenge cleared for session ${sessionId}`)
  } catch (error) {
    console.error('[ROLE_ANOMALY] Error clearing MFA challenge:', error)
    throw error
  }
}

/**
 * Get session security flags
 */
export async function getSessionSecurityFlags(sessionId: string): Promise<any | null> {
  try {
    const result = await query(
      `SELECT 
        id, user_id, requires_mfa_challenge, role_revalidation_required, is_invalidated,
        invalidated_at, mfa_challenge_required_at, mfa_challenge_verified_at
       FROM sessions
       WHERE id = $1`,
      [sessionId]
    )

    if (result.rows.length === 0) {
      return null
    }

    return result.rows[0]
  } catch (error) {
    console.error('[ROLE_ANOMALY] Error getting session security flags:', error)
    throw error
  }
}

/**
 * Middleware to log anomaly detection in audit trail
 */
export async function logRoleAnomalyAccess(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if ((req as any).roleCompromised && req.user?.id) {
      // Log that user with compromised role tried to access
      const userId = req.user.id || (req.user as any).userId
      await query(
        `INSERT INTO audit_logs (
          action, actor_id, resource_type, details, ip_address, user_agent
        ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          'ANOMALOUS_ROLE_ACCESS_ATTEMPT',
          userId,
          'ROLE_SECURITY',
          JSON.stringify({
            endpoint: req.path,
            method: req.method,
            timestamp: new Date().toISOString(),
          }),
          req.ip || req.socket?.remoteAddress || null,
          req.get('user-agent') || null,
        ]
      )
    }

    next()
  } catch (error) {
    console.error('[ROLE_ANOMALY] Error logging anomaly access:', error)
    next(error)
  }
}

/**
 * Export all middleware as an array for easy chaining
 */
export const roleAnomalyMiddlewareChain = [
  checkRoleCompromised,
  logRoleAnomalyAccess,
]

export default {
  checkRoleCompromised,
  invalidateUserSessions,
  markSessionForMfaChallenge,
  clearMfaChallenge,
  getSessionSecurityFlags,
  logRoleAnomalyAccess,
  roleAnomalyMiddlewareChain,
}
