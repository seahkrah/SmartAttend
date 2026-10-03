/**
 * Long suites outlive the seeds' access tokens, which last 15 minutes. The
 * seeds run once at the start of scripts/run-all-e2e.sh, and the
 * cross-tenant fuzz runs last: by then every caller's token had expired, and
 * the fuzz rightly failed on 401s that prove nothing.
 *
 * reissue() signs a new access token for the same live session (the token's
 * sid), the same account and role, as the API itself does on refresh. A
 * session that has ended stays ended: the API still checks it on every
 * request. keepFresh() does this for a set of callers every few minutes.
 *
 * Needs the API's JWT_SECRET in the environment, as the seeds do.
 */
import jwt from 'jsonwebtoken'
import { generateAccessToken } from '../auth/authService.js'

export function reissue(token: string): string {
  const t = jwt.decode(token) as { userId: string; platformId: string; roleId: string; sid: string; mfa?: string } | null
  if (!t?.userId || !t.sid) throw new Error('not an access token this API issued')
  return generateAccessToken(t.userId, t.platformId, t.roleId, t.sid, t.mfa === 'setup')
}

/** Reissues every caller's token now and every `minutes`; returns a stop function. */
export function keepFresh(callers: Array<{ token: string }>, minutes = 5): () => void {
  const renew = () => {
    for (const c of callers) c.token = reissue(c.token)
  }
  renew()
  const timer = setInterval(renew, minutes * 60_000)
  timer.unref()
  return () => clearInterval(timer)
}
