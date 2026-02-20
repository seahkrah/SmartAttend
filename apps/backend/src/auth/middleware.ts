import { Request, Response, NextFunction } from 'express'
import { verifyAccessToken } from './authService.js'
import { query } from '../db/connection.js'

// Extend Express Request to include auth info
declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string
        platformId: string
        roleId: string
        role?: string        // Resolved role name
        platformType?: string // Resolved platform type
      }
    }
  }
}

// Middleware to verify JWT token
export function authenticateToken(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers['authorization']
  const token = authHeader && authHeader.split(' ')[1] // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'Access token required' })
  }

  try {
    const decoded = verifyAccessToken(token)
    req.user = decoded
    next()
  } catch (error: any) {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }
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
