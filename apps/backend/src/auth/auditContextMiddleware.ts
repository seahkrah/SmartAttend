import { Request, Response, NextFunction } from 'express'
import { generateRequestId } from '../services/auditService.js'

/**
 * Audit Context Middleware
 * Injects request ID and prepares audit context for downstream handlers
 */

declare global {
  namespace Express {
    interface Request {
      requestId: string
      auditContext?: {
        requestId: string
        actorId: string
        ipAddress: string
        userAgent?: string
      }
    }
  }
}

export function auditContextMiddleware(req: Request, res: Response, next: NextFunction) {
  // Generate request ID if not already set
  if (!req.requestId) {
    req.requestId = generateRequestId()
  }

  // Set up audit context
  if (req.user) {
    req.auditContext = {
      requestId: req.requestId,
      actorId: req.user.userId,
      ipAddress: req.ip || 'unknown',
      userAgent: req.get('user-agent')
    }
  }

  next()
}
