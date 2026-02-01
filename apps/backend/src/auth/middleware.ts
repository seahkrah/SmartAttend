import { Request, Response, NextFunction } from 'express'
import { verifyAccessToken } from './authService.js'

// Extend Express Request to include auth info
declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string
        platformId: string
        roleId: string
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
    return res.status(403).json({ error: error.message || 'Invalid token' })
  }
}

// Middleware to verify platform access (optional - checks if user is on correct platform)
export function verifyPlatform(requiredPlatform: 'school' | 'corporate') {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'User not authenticated' })
    }

    // You would need to query the platform from platformId
    // For now, this is a placeholder
    next()
  }
}

// Middleware to verify specific role
export function requireRole(...allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'User not authenticated' })
    }

    // You would need to query user's role from roleId
    // For now, this is a placeholder that will be enhanced
    next()
  }
}
