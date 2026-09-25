/**
 * Server-side sessions.
 *
 * A sign-in creates a session. The browser holds a short-lived access token
 * (a JWT naming the session) and an opaque refresh token. Only the refresh
 * token's SHA-256 is stored.
 *
 * Every refresh replaces the refresh token. If a replaced token is presented
 * again after a short grace period, someone has a copy of it: the session is
 * ended, which signs out whoever holds either copy. The grace period exists
 * because a browser with several tabs can fire two refreshes at once; the
 * slower one is told to retry with the new token rather than treated as theft.
 *
 * Every authenticated request checks the session is live and the account
 * active, so logout, a password change, a deactivation or a suspended tenant
 * takes effect at once rather than when a token happens to expire.
 */
import crypto from 'crypto'
import { query } from '../db/connection.js'

export const SESSION_LIFETIME_DAYS = 30
export const REFRESH_RACE_GRACE_SECONDS = 30

export class SessionError extends Error {
  constructor(readonly code: 'invalid' | 'race' | 'reused' | 'inactive', message: string) {
    super(message)
  }
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex')
}

function newToken(): string {
  return crypto.randomBytes(32).toString('base64url')
}

export async function createSession(
  userId: string,
  meta: { ip?: string | null; userAgent?: string | null } = {}
): Promise<{ sessionId: string; refreshToken: string }> {
  const refreshToken = newToken()
  const r = await query(
    `INSERT INTO auth_sessions (user_id, current_token_hash, expires_at, created_ip, user_agent)
     VALUES ($1, $2, CURRENT_TIMESTAMP + ($3 || ' days')::interval, $4, $5)
     RETURNING id`,
    [userId, hashToken(refreshToken), String(SESSION_LIFETIME_DAYS),
     meta.ip?.slice(0, 64) ?? null, meta.userAgent?.slice(0, 255) ?? null]
  )
  // Now and then, forget sessions that ended more than thirty days ago.
  if (Math.random() < 0.02) {
    await query(
      `DELETE FROM auth_sessions
        WHERE COALESCE(revoked_at, expires_at) < CURRENT_TIMESTAMP - INTERVAL '30 days'`
    ).catch(() => undefined)
  }
  return { sessionId: r.rows[0].id, refreshToken }
}

/**
 * Exchanges a refresh token for a new one. Returns the session and user; the
 * caller issues the access token.
 */
export async function rotateSession(refreshToken: string): Promise<{
  sessionId: string
  userId: string
  refreshToken: string
}> {
  if (typeof refreshToken !== 'string' || refreshToken.length < 20 || refreshToken.length > 200) {
    throw new SessionError('invalid', 'Invalid refresh token')
  }
  const h = hashToken(refreshToken)
  const next = newToken()

  // The swap is one statement, so two refreshes racing on the same token
  // cannot both win: the second finds the hash already moved to "previous".
  const r = await query(
    `UPDATE auth_sessions s
        SET previous_token_hash = s.current_token_hash,
            current_token_hash = $2,
            rotated_at = CURRENT_TIMESTAMP,
            last_used_at = CURRENT_TIMESTAMP
       FROM users u
      WHERE s.current_token_hash = $1
        AND u.id = s.user_id
        AND s.revoked_at IS NULL
        AND s.expires_at > CURRENT_TIMESTAMP
        AND u.is_active = TRUE
      RETURNING s.id, s.user_id`,
    [h, hashToken(next)]
  )
  if (r.rows.length > 0) {
    return { sessionId: r.rows[0].id, userId: r.rows[0].user_id, refreshToken: next }
  }

  // Not the current token. Was it the one just replaced?
  const old = await query(
    `SELECT id, rotated_at, revoked_at,
            rotated_at > CURRENT_TIMESTAMP - ($2 || ' seconds')::interval AS in_grace
       FROM auth_sessions WHERE previous_token_hash = $1`,
    [h, String(REFRESH_RACE_GRACE_SECONDS)]
  )
  const row = old.rows[0]
  if (row && !row.revoked_at) {
    if (row.in_grace) {
      throw new SessionError('race', 'This refresh token was just replaced; use the new one')
    }
    await revokeSession(row.id, 'refresh_token_reused')
    throw new SessionError('reused', 'This refresh token was already used; the session has been ended')
  }
  throw new SessionError('invalid', 'Invalid refresh token')
}

export async function revokeSession(sessionId: string, reason: string): Promise<void> {
  await query(
    `UPDATE auth_sessions SET revoked_at = CURRENT_TIMESTAMP, revoked_reason = $2
      WHERE id = $1 AND revoked_at IS NULL`,
    [sessionId, reason.slice(0, 60)]
  )
}

/** Ends every session of a user, optionally keeping one (the caller's own). */
export async function revokeUserSessions(userId: string, reason: string, keep?: string | null): Promise<number> {
  const r = await query(
    `UPDATE auth_sessions SET revoked_at = CURRENT_TIMESTAMP, revoked_reason = $2
      WHERE user_id = $1 AND revoked_at IS NULL AND ($3::uuid IS NULL OR id <> $3::uuid)`,
    [userId, reason.slice(0, 60), keep ?? null]
  )
  return r.rowCount ?? 0
}

/** Whether a session is live and its account active. One indexed lookup. */
export async function sessionIsLive(sessionId: string, userId: string): Promise<boolean> {
  const r = await query(
    `SELECT 1
       FROM auth_sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = $1 AND s.user_id = $2 AND s.revoked_at IS NULL
        AND s.expires_at > CURRENT_TIMESTAMP AND u.is_active = TRUE`,
    [sessionId, userId]
  )
  return r.rows.length > 0
}
