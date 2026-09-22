import { Router, Request, Response } from 'express'
import { authenticateToken } from '../auth/middleware.js'

/**
 * Deprecated user endpoints.
 *
 * This router was a stub that fabricated success: no authentication, no
 * database, and POST returned the request body as though a user had been
 * created. A client could not tell that nothing had happened.
 *
 * User management is tenant-owned, so it belongs behind a resolved tenant.
 * The real implementation is /api/admin/users, which scopes every read and
 * write to the caller's tenant, writes membership from the server context,
 * and refuses to create or grant the admin role.
 *
 * These routes now refuse honestly rather than returning a plausible lie.
 * Kept rather than deleted so an older client gets a clear 410 naming its
 * replacement, instead of a 404 that looks like an outage.
 */

const router = Router()

const GONE = {
  error: 'Gone',
  message:
    'This endpoint returned placeholder data and has been withdrawn. Use /api/admin/users, which is tenant-scoped.',
  replacement: '/api/admin/users',
}

// Authenticated so the response cannot be used to probe the API anonymously.
router.all('/', authenticateToken, (_req: Request, res: Response) => {
  res.status(410).json(GONE)
})

router.all('/:userId', authenticateToken, (_req: Request, res: Response) => {
  res.status(410).json(GONE)
})

export default router
