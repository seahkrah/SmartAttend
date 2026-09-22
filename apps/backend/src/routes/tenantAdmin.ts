/**
 * Withdrawn tenant-admin endpoints.
 *
 * This router offered eight endpoints — school and corporate stats, user
 * listing, user update and user deletion — that duplicated functionality now
 * provided properly elsewhere. Retiring it rather than rewriting it: three
 * implementations of "list this tenant's users" is the problem, not the fix.
 *
 * What was wrong with it:
 *
 *   * Authority came from school_entities.admin_user_id (and the corporate
 *     equivalent), which is NULL for every entity in the schema. The gate
 *     could never pass, so all eight endpoints answered 403 and had never
 *     worked.
 *
 *   * Nothing was tenant-scoped. The file contains no tenant_id at all,
 *     despite its name — the user queries joined on the entity from the gate,
 *     and the stats queried columns (`created_at` on a bare aggregate,
 *     `status` on corporate check-ins) that do not exist, so even reviving
 *     the gate would have produced a 500 or a cross-tenant read.
 *
 * Where the functionality lives now:
 *
 *   stats            GET   /api/auth/admin/school/stats
 *   list users       GET   /api/admin/users
 *   create user      POST  /api/admin/users
 *   update user      PUT   /api/admin/users/:userId
 *   delete user      DELETE /api/admin/users/:userId
 *
 * All of those resolve the tenant from the authenticated identity, confirm
 * ownership before acting on an id, and work for both platforms.
 *
 * The routes answer 410 rather than being deleted outright, so an older
 * client gets a clear message naming its replacement instead of a 404 that
 * looks like an outage. They authenticate first so the response cannot be
 * used to probe the API anonymously.
 */

import { Router, Request, Response } from 'express'
import { authenticateToken } from '../auth/middleware.js'

const router = Router()

const REPLACEMENTS: Record<string, string> = {
  stats: '/api/auth/admin/school/stats',
  users: '/api/admin/users',
}

function gone(replacement: string) {
  return (_req: Request, res: Response) => {
    res.status(410).json({
      error: 'Gone',
      message:
        'This endpoint was never operational — its authority check could not pass and its ' +
        'queries were not tenant-scoped. Use the tenant-scoped replacement.',
      replacement,
    })
  }
}

router.use(authenticateToken)

router.all('/school/stats', gone(REPLACEMENTS.stats))
router.all('/corporate/stats', gone(REPLACEMENTS.stats))
router.all('/school/users', gone(REPLACEMENTS.users))
router.all('/corporate/users', gone(REPLACEMENTS.users))
router.all('/school/users/:userId', gone(REPLACEMENTS.users))
router.all('/corporate/users/:userId', gone(REPLACEMENTS.users))

export default router
