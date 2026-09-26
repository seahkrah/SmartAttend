import crypto from 'crypto'
import { query } from '../db/connection.js'
import {
  CHALLENGE_MAX_ATTEMPTS, CHALLENGE_TTL_MINUTES, hashChallengeToken, hashRecoveryCode, newRecoveryCodes,
  openSecret, requiredRoles, verifyTotp,
} from './mfa.js'

/**
 * Two-factor state in the database. The algorithms are in mfa.ts; this is who
 * has what, and the sign-in challenge between password and code.
 */

export async function mfaEnabled(userId: string): Promise<boolean> {
  const r = await query(`SELECT 1 FROM user_mfa WHERE user_id = $1 AND enabled_at IS NOT NULL`, [userId])
  return (r.rowCount ?? 0) > 0
}

/**
 * Whether this person must set up two-factor before doing anything else:
 * their role is one that requires it and they have not. Carried in the access
 * token (claim `mfa: 'setup'`) so enforcement costs no query per request.
 */
export async function mfaSetupPending(userId: string, roleId: string): Promise<boolean> {
  const roles = requiredRoles()
  if (roles.size === 0) return false
  const r = await query(
    `SELECT r.name,
            EXISTS (SELECT 1 FROM user_mfa m WHERE m.user_id = $1 AND m.enabled_at IS NOT NULL) AS enabled
       FROM roles r WHERE r.id = $2`,
    [userId, roleId]
  )
  if (r.rows.length === 0) return false
  return roles.has(r.rows[0].name) && !r.rows[0].enabled
}

/** Starts the code step of a sign-in. The returned token is shown once. */
export async function createChallenge(userId: string, ip?: string | null): Promise<string> {
  const token = crypto.randomBytes(32).toString('base64url')
  await query(
    `INSERT INTO mfa_login_challenges (user_id, token_hash, expires_at, created_ip)
     VALUES ($1, $2, CURRENT_TIMESTAMP + ($3 || ' minutes')::interval, $4)`,
    [userId, hashChallengeToken(token), String(CHALLENGE_TTL_MINUTES), ip?.slice(0, 64) ?? null]
  )
  // Nothing older than a day is ever consulted.
  if (Math.random() < 0.02) {
    await query(`DELETE FROM mfa_login_challenges WHERE created_at < CURRENT_TIMESTAMP - INTERVAL '1 day'`)
  }
  return token
}

export class ChallengeError extends Error {
  constructor(
    readonly code: 'expired' | 'invalid_code',
    message: string,
    readonly attemptsLeft = 0,
    /** A code was entered and was wrong: counts towards the sign-in lockout. */
    readonly wrongCode = false
  ) {
    super(message)
  }
}

/**
 * Takes one try at a challenge. An attempt is counted before the code is
 * checked, so parallel guesses cannot exceed the limit, and a challenge is
 * spent by its first success.
 */
export async function answerChallenge(
  token: string,
  answer: { code?: string; recoveryCode?: string }
): Promise<{ userId: string; usedRecoveryCode: boolean }> {
  const taken = await query(
    `UPDATE mfa_login_challenges SET attempts = attempts + 1
      WHERE token_hash = $1 AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP AND attempts < $2
      RETURNING id, user_id, attempts`,
    [hashChallengeToken(String(token ?? '')), CHALLENGE_MAX_ATTEMPTS]
  )
  if (taken.rows.length === 0) {
    throw new ChallengeError('expired', 'This sign-in has expired. Please enter your password again.')
  }
  const { id, user_id: userId, attempts } = taken.rows[0]
  const left = CHALLENGE_MAX_ATTEMPTS - attempts

  const ok = answer.recoveryCode
    ? await spendRecoveryCode(userId, answer.recoveryCode)
    : await checkCode(userId, String(answer.code ?? ''))
  if (!ok) {
    if (left <= 0) {
      throw new ChallengeError('expired', 'Too many incorrect codes. Please sign in again.', 0, true)
    }
    throw new ChallengeError('invalid_code', 'That code is not correct.', left, true)
  }

  const spent = await query(
    `UPDATE mfa_login_challenges SET used_at = CURRENT_TIMESTAMP WHERE id = $1 AND used_at IS NULL RETURNING id`, [id]
  )
  if (spent.rows.length === 0) {
    throw new ChallengeError('expired', 'This sign-in has already been completed.')
  }
  return { userId, usedRecoveryCode: Boolean(answer.recoveryCode) }
}

/**
 * Checks an authenticator code against a person's secret — confirmed or, with
 * `pending`, the one being set up — and records its time step so it cannot be
 * used again. The conditional update makes two simultaneous uses of one code
 * resolve to a single success.
 */
export async function checkCode(userId: string, code: string, pending = false): Promise<boolean> {
  const r = await query(
    `SELECT secret_ciphertext, secret_iv, secret_tag, last_used_step FROM user_mfa
      WHERE user_id = $1 AND (enabled_at IS NOT NULL) = $2`,
    [userId, !pending]
  )
  if (r.rows.length === 0) return false
  const row = r.rows[0]
  let secret: Buffer
  try {
    secret = openSecret(row, userId)
  } catch {
    // The sealing key changed. Nothing the person types can succeed; an
    // administrator's reset is the way back.
    console.error('[MFA] Cannot open a stored authenticator secret: has MFA_ENCRYPTION_KEY changed?')
    return false
  }
  const last = row.last_used_step === null ? null : Number(row.last_used_step)
  const step = verifyTotp(secret, code, last)
  if (step === null) return false
  const claimed = await query(
    `UPDATE user_mfa SET last_used_step = $2, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $1 AND (last_used_step IS NULL OR last_used_step < $2) RETURNING user_id`,
    [userId, step]
  )
  return (claimed.rowCount ?? 0) > 0
}

export async function spendRecoveryCode(userId: string, code: string): Promise<boolean> {
  const r = await query(
    `UPDATE user_mfa_recovery_codes SET used_at = CURRENT_TIMESTAMP
      WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL
        AND EXISTS (SELECT 1 FROM user_mfa m WHERE m.user_id = $1 AND m.enabled_at IS NOT NULL)
      RETURNING id`,
    [userId, hashRecoveryCode(code)]
  )
  return (r.rowCount ?? 0) > 0
}

/** A fresh set of recovery codes; any earlier set stops working. */
export async function replaceRecoveryCodes(userId: string): Promise<string[]> {
  const codes = newRecoveryCodes()
  await query(`DELETE FROM user_mfa_recovery_codes WHERE user_id = $1`, [userId])
  await query(
    `INSERT INTO user_mfa_recovery_codes (user_id, code_hash)
     SELECT $1, h FROM unnest($2::text[]) AS h`,
    [userId, codes.map(hashRecoveryCode)]
  )
  return codes
}

/** Removes two-factor from an account (the person's choice, or an administrator's reset). */
export async function clearMfa(
  runner: { query: (text: string, params?: any[]) => Promise<any> } | null,
  userId: string
): Promise<boolean> {
  const q = runner ? (text: string, params?: any[]) => runner.query(text, params) : query
  await q(`DELETE FROM user_mfa_recovery_codes WHERE user_id = $1`, [userId])
  await q(`DELETE FROM mfa_login_challenges WHERE user_id = $1`, [userId])
  const r = await q(`DELETE FROM user_mfa WHERE user_id = $1 RETURNING user_id`, [userId])
  return (r.rowCount ?? 0) > 0
}
