import { Request, Response, NextFunction } from 'express'
import { query } from '../db/connection.js'

/**
 * Rate Limiting Middleware for Destructive Operations
 * Prevents rapid succession of high-impact actions from a single actor
 */

interface RateLimitConfig {
  windowSeconds: number // Time window in seconds
  maxRequests: number // Max requests in window
  destructiveActions: string[] // List of action types to rate limit
}

const DEFAULT_CONFIG: RateLimitConfig = {
  windowSeconds: 60,
  maxRequests: 5,
  destructiveActions: [
    'TENANT_LIFECYCLE_TRANSITION',
    'SESSION_INVALIDATION',
    'CREATE_INFRASTRUCTURE_INCIDENT',
    'UPDATE_INFRASTRUCTURE_INCIDENT',
    'CREATE_ATTENDANCE_FLAG'
  ]
}

// In-memory store for rate limiting (in production, use Redis)
const rateLimitStore = new Map<string, { count: number; resetAt: number }>()

/**
 * Clean up expired entries periodically
 */
setInterval(() => {
  const now = Date.now()
  for (const [key, data] of rateLimitStore.entries()) {
    if (data.resetAt < now) {
      rateLimitStore.delete(key)
    }
  }
}, 30000) // Cleanup every 30 seconds

/**
 * Check rate limit for destructive operations
 */
export function rateLimitMiddleware(
  actionType?: string,
  config: RateLimitConfig = DEFAULT_CONFIG
) {
  return (req: Request, res: Response, next: NextFunction) => {
    // Only rate limit destructive actions
    const currentAction = actionType || (req.body as any)?.actionType
    if (!currentAction || !config.destructiveActions.includes(currentAction)) {
      return next()
    }

    const actorId = req.user?.userId
    if (!actorId) {
      return res.status(401).json({ error: 'Not authenticated' })
    }

    const key = `${actorId}:${currentAction}`
    const now = Date.now()
    const limitData = rateLimitStore.get(key)

    if (!limitData) {
      // First request in window
      rateLimitStore.set(key, { count: 1, resetAt: now + config.windowSeconds * 1000 })
      return next()
    }

    if (limitData.resetAt < now) {
      // Window has expired, reset
      rateLimitStore.set(key, { count: 1, resetAt: now + config.windowSeconds * 1000 })
      return next()
    }

    // Still within window
    if (limitData.count >= config.maxRequests) {
      const secondsUntilReset = Math.ceil((limitData.resetAt - now) / 1000)
      return res.status(429).json({
        error: 'Too many requests',
        message: `Rate limit exceeded for ${currentAction}. Try again in ${secondsUntilReset} seconds.`,
        retryAfter: secondsUntilReset,
        requestsRemaining: 0
      })
    }

    // Increment counter
    limitData.count++
    const requestsRemaining = config.maxRequests - limitData.count

    res.setHeader('X-RateLimit-Limit', config.maxRequests)
    res.setHeader('X-RateLimit-Remaining', requestsRemaining)
    res.setHeader('X-RateLimit-Reset', Math.ceil(limitData.resetAt / 1000))

    next()
  }
}

/**
 * Alternative: Store rate limit data in DB for persistence across restarts
 */
export async function checkRateLimitDB(
  actorId: string,
  actionType: string,
  config: RateLimitConfig = DEFAULT_CONFIG
): Promise<{ allowed: boolean; remaining: number; resetAt: string }> {
  try {
    const now = new Date()
    const windowStart = new Date(now.getTime() - config.windowSeconds * 1000)

    // Count recent actions of this type by this actor
    const countResult = await query(
      `SELECT COUNT(*) as recent_count FROM superadmin_audit_log
       WHERE actor_id = $1 AND action_type = $2 AND timestamp > $3`,
      [actorId, actionType, windowStart.toISOString()]
    )

    const recentCount = parseInt(countResult.rows[0].recent_count, 10) || 0
    const allowed = recentCount < config.maxRequests
    const remaining = Math.max(0, config.maxRequests - recentCount - 1)
    const resetAt = new Date(now.getTime() + config.windowSeconds * 1000)

    return { allowed, remaining, resetAt: resetAt.toISOString() }
  } catch (error) {
    console.error('[RATE_LIMIT] Error checking rate limit:', error)
    // Fail open in case of DB errors
    return { allowed: true, remaining: config.maxRequests, resetAt: new Date().toISOString() }
  }
}
