/**
 * Step-up: proving who you are again before a sensitive action.
 *
 * A session remembers when its owner last proved who they are: at sign-in,
 * and at each step-up (password, authenticator code or passkey). Sensitive
 * actions need that to be recent, so an unlocked laptop or a session token
 * copied from a browser is not enough to change an email address, remove a
 * passkey or open break-glass access.
 *
 * The window is five minutes, configurable (STEP_UP_MAX_AGE_SECONDS) so the
 * end-to-end suites can test the refusal without waiting.
 */
import type { NextFunction, Request, Response } from 'express'
import { query } from '../db/connection.js'
import { runAsSystem } from '../db/dbContext.js'

function sys(text: string, params?: any[]) {
  return runAsSystem('identity: when the session last proved who it is', () => query(text, params))
}

export function stepUpMaxAgeSeconds(env: NodeJS.ProcessEnv = process.env): number {
  const v = parseInt(env.STEP_UP_MAX_AGE_SECONDS ?? '', 10)
  return Number.isFinite(v) && v > 0 ? v : 300
}

/** Records that the session's owner has just proved who they are. */
export async function markAuthenticated(sessionId: string): Promise<void> {
  await sys(`UPDATE auth_sessions SET authenticated_at = CURRENT_TIMESTAMP WHERE id = $1 AND revoked_at IS NULL`, [sessionId])
}

/** Seconds since the session last proved who it is, or null for no such live session. */
export async function secondsSinceAuthenticated(sessionId: string): Promise<number | null> {
  const r = await sys(
    `SELECT EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - authenticated_at))::int AS age
       FROM auth_sessions WHERE id = $1 AND revoked_at IS NULL`,
    [sessionId]
  )
  return r.rows.length ? Number(r.rows[0].age) : null
}

/** Refuses a request whose session has not proved who it is in the last few minutes. */
export function requireRecentAuth(req: Request, res: Response, next: NextFunction) {
  const sid = req.user?.sessionId
  if (!sid) return res.status(401).json({ error: 'Not authenticated' })
  secondsSinceAuthenticated(sid).then((age) => {
    if (age === null) return res.status(401).json({ error: 'Your session has ended. Please sign in again.', code: 'SESSION_ENDED' })
    if (age > stepUpMaxAgeSeconds()) {
      return res.status(403).json({
        error: 'Confirm it is you to continue: enter your password, an authenticator code or use your passkey.',
        code: 'STEP_UP_REQUIRED',
      })
    }
    next()
  }, next)
}

/** requireRecentAuth only when `when(req)` holds, e.g. for a setup link the administrator takes to hand over. */
export function requireRecentAuthWhen(when: (req: Request) => boolean) {
  return (req: Request, res: Response, next: NextFunction) => (when(req) ? requireRecentAuth(req, res, next) : next())
}

/** A setup or reset link handed to the administrator is a credential for someone else's account. */
export const handingOverLink = (req: Request) => req.body?.handover === true
