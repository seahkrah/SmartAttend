import { Request, Response, NextFunction } from 'express'
import { verifyAccessToken } from './authService.js'
import { query } from '../db/connection.js'
import { sessionIsLive } from './sessions.js'

// Extend Express Request to include auth info
declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string
        platformId: string
        roleId: string
        sessionId?: string
        role?: string        // Resolved role name
        platformType?: string // Resolved platform type
      }
    }
  }
}

/**
 * Verifies the access token and that the session it names is still live.
 *
 * A signature alone is not enough: it stays valid for fifteen minutes after
 * a logout, a password change or a deactivation. The session lookup is what
 * makes those take effect on the next request.
 */
export async function authenticateToken(req: Request, res: Response, next: NextFunction) {
  // Several routers apply this per route after a router-level gate already
  // has; the session need only be checked once per request.
  if (req.user?.sessionId) return next()

  const authHeader = req.headers['authorization']
  const token = authHeader && authHeader.split(' ')[1] // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'Access token required' })
  }

  let decoded: any
  try {
    decoded = verifyAccessToken(token)
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }
  if (!decoded?.sid || !decoded?.userId) {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }
  try {
    if (!(await sessionIsLive(decoded.sid, decoded.userId))) {
      return res.status(401).json({ error: 'Your session has ended. Please sign in again.', code: 'SESSION_ENDED' })
    }
  } catch (error) {
    return res.status(500).json({ error: 'Authentication check failed' })
  }
  req.user = {
    userId: decoded.userId,
    platformId: decoded.platformId,
    roleId: decoded.roleId,
    sessionId: decoded.sid,
  }
  next()
}

// Middleware to verify platform access
export function verifyPlatform(requiredPlatform: 'school' | 'corporate' | 'system') {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'User not authenticated' })
    }

    try {
      const result = await query(
        `SELECT name FROM platforms WHERE id = $1`,
        [req.user.platformId]
      )

      if (result.rows.length === 0) {
        return res.status(403).json({ error: 'Platform not found' })
      }

      const platformName = result.rows[0].name
      req.user.platformType = platformName

      if (platformName !== requiredPlatform) {
        return res.status(403).json({ error: 'Access denied: insufficient platform permissions' })
      }

      next()
    } catch (error) {
      return res.status(500).json({ error: 'Platform verification failed' })
    }
  }
}

// Middleware to verify specific role — now actually enforces role checks
export function requireRole(...allowedRoles: string[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'User not authenticated' })
    }

    try {
      const result = await query(
        `SELECT r.name FROM roles r WHERE r.id = $1`,
        [req.user.roleId]
      )

      if (result.rows.length === 0) {
        return res.status(403).json({ error: 'Access denied: role not found' })
      }

      const userRole = result.rows[0].name
      req.user.role = userRole

      if (!allowedRoles.includes(userRole)) {
        return res.status(403).json({ error: 'Access denied: insufficient permissions' })
      }

      next()
    } catch (error) {
      return res.status(500).json({ error: 'Role verification failed' })
    }
  }
}
