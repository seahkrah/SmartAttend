import express, { Request, Response } from 'express'
import { query } from '../db/connection.js'
import { authenticateToken } from '../auth/middleware.js'
import {
  generateAccessToken, issueTokens, noteFailedSignIn, verifyPassword,
} from '../auth/authService.js'
import { base32Encode, hashChallengeToken, newSecret, otpauthUri, requiredRoles, sealSecret } from '../auth/mfa.js'
import {
  answerChallenge, ChallengeError, checkCode, clearMfa, mfaEnabled, replaceRecoveryCodes, spendRecoveryCode,
} from '../auth/mfaService.js'
import { revokeUserSessions } from '../auth/sessions.js'
import { loginLimiter, mfaManageLimiter } from '../security/httpSecurity.js'
import { getClientIp } from '../utils/getClientIp.js'
import { logError } from '../utils/errorMessages.js'

/**
 * Two-factor sign-in, mounted at /api/auth/mfa.
 *
 *   POST /verify           the code step of a sign-in (public; the password
 *                          step returned `mfaToken`)
 *   GET  /                 this account's two-factor status
 *   POST /setup            a new secret to scan (not active until confirmed)
 *   POST /enable           confirm it with a code; returns recovery codes
 *   POST /disable          remove it (password and a code)
 *   POST /recovery-codes   a fresh set of recovery codes (password and a code)
 */
const router = express.Router()

async function accountOf(userId: string) {
  const r = await query(
    `SELECT u.id, u.email, u.full_name, u.phone, u.profile_image_url, u.platform_id, u.role_id, u.is_active,
            u.must_reset_password, u.password_hash, r.name AS role_name, r.permissions, p.name AS platform_name
       FROM users u
       LEFT JOIN roles r ON r.id = u.role_id
       LEFT JOIN platforms p ON p.id = u.platform_id
      WHERE u.id = $1`,
    [userId]
  )
  return r.rows[0] ?? null
}

/** A code or a recovery code from a request body, whichever was sent. */
function answerOf(body: any): { code?: string; recoveryCode?: string } | null {
  const code = typeof body?.code === 'string' ? body.code.trim() : ''
  const recoveryCode = typeof body?.recoveryCode === 'string' ? body.recoveryCode.trim() : ''
  if (recoveryCode) return { recoveryCode }
  if (code) return { code }
  return null
}

router.post('/verify', loginLimiter, async (req: Request, res: Response) => {
  const answer = answerOf(req.body)
  const mfaToken = typeof req.body?.mfaToken === 'string' ? req.body.mfaToken : ''
  if (!mfaToken || !answer) {
    return res.status(400).json({ error: 'Enter the code from your authenticator app.' })
  }
  try {
    const { userId, usedRecoveryCode } = await answerChallenge(mfaToken, answer)
    const user = await accountOf(userId)
    // The account may have been suspended in the minutes since the password.
    if (!user || !user.is_active) {
      return res.status(403).json({ error: 'Your account has been suspended. Please contact your administrator.', code: 'INACTIVE' })
    }
    const { accessToken, refreshToken } = await issueTokens(user, { ip: getClientIp(req), userAgent: String(req.headers['user-agent'] ?? '') })
    await query(`UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1`, [user.id])
    await query(`DELETE FROM auth_failed_logins WHERE email_norm = $1`, [String(user.email).trim().toLowerCase()])
    const left = usedRecoveryCode
      ? (await query(`SELECT COUNT(*)::int AS n FROM user_mfa_recovery_codes WHERE user_id = $1 AND used_at IS NULL`, [user.id])).rows[0].n
      : undefined
    return res.json({
      message: 'Login successful',
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        phone: user.phone,
        platform: user.platform_name,
        role: user.role_name,
        permissions: user.permissions || [],
        profileImage: user.profile_image_url,
        mustResetPassword: user.must_reset_password || false,
      },
      accessToken,
      refreshToken,
      ...(left !== undefined ? { recoveryCodesLeft: left } : {}),
    })
  } catch (error) {
    if (error instanceof ChallengeError) {
      if (error.wrongCode) {
        // Wrong codes count towards the same fifteen-minute lockout as wrong
        // passwords, so a stolen password buys only a handful of guesses.
        const r = await query(
          `SELECT u.email FROM mfa_login_challenges c JOIN users u ON u.id = c.user_id WHERE c.token_hash = $1`,
          [hashChallengeToken(mfaToken)]
        ).catch(() => ({ rows: [] as any[] }))
        if (r.rows[0]) await noteFailedSignIn(r.rows[0].email, getClientIp(req))
      }
      if (error.code === 'invalid_code') {
        return res.status(401).json({ error: error.message, code: 'MFA_INVALID', attemptsLeft: error.attemptsLeft })
      }
      return res.status(401).json({ error: error.message, code: 'MFA_EXPIRED' })
    }
    logError('MFA verify', error)
    return res.status(500).json({ error: 'Sign-in failed. Please try again.' })
  }
})

// Everything below is for a signed-in person managing their own account.
router.use(authenticateToken)

router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId
    const r = await query(
      `SELECT m.enabled_at,
              (SELECT COUNT(*)::int FROM user_mfa_recovery_codes c WHERE c.user_id = m.user_id AND c.used_at IS NULL) AS left
         FROM user_mfa m WHERE m.user_id = $1 AND m.enabled_at IS NOT NULL`,
      [userId]
    )
    const role = await query(`SELECT name FROM roles WHERE id = $1`, [req.user!.roleId])
    return res.json({
      enabled: r.rows.length > 0,
      enabledAt: r.rows[0]?.enabled_at ?? null,
      recoveryCodesLeft: r.rows[0]?.left ?? 0,
      required: requiredRoles().has(role.rows[0]?.name),
    })
  } catch (error) {
    logError('MFA status', error)
    return res.status(500).json({ error: 'Could not load two-factor settings.' })
  }
})

router.post('/setup', mfaManageLimiter, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId
    if (await mfaEnabled(userId)) {
      return res.status(409).json({ error: 'Two-factor sign-in is already on. Turn it off first to move it to a new device.' })
    }
    const user = await accountOf(userId)
    const secret = newSecret()
    const sealed = sealSecret(secret, userId)
    // Starting again replaces an unconfirmed secret; a confirmed one is
    // protected by the check above.
    await query(
      `INSERT INTO user_mfa (user_id, secret_ciphertext, secret_iv, secret_tag)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id) DO UPDATE
         SET secret_ciphertext = EXCLUDED.secret_ciphertext, secret_iv = EXCLUDED.secret_iv,
             secret_tag = EXCLUDED.secret_tag, last_used_step = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE user_mfa.enabled_at IS NULL`,
      [userId, sealed.ciphertext, sealed.iv, sealed.tag]
    )
    const b32 = base32Encode(secret)
    return res.json({ secret: b32, otpauthUri: otpauthUri(b32, user.email) })
  } catch (error) {
    logError('MFA setup', error)
    return res.status(500).json({ error: 'Could not start two-factor setup.' })
  }
})

router.post('/enable', mfaManageLimiter, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId
    const code = typeof req.body?.code === 'string' ? req.body.code : ''
    if (!(await checkCode(userId, code, true))) {
      return res.status(400).json({ error: 'That code is not correct. Check the time on your phone and try the next one.', code: 'MFA_INVALID' })
    }
    await query(`UPDATE user_mfa SET enabled_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE user_id = $1`, [userId])
    const recoveryCodes = await replaceRecoveryCodes(userId)
    // Other sessions were signed in with a password alone; end them.
    await revokeUserSessions(userId, 'mfa_enabled', req.user!.sessionId)
    // This session's token may say "set up two-factor first"; replace it.
    const accessToken = generateAccessToken(userId, req.user!.platformId, req.user!.roleId, req.user!.sessionId!)
    return res.json({ enabled: true, recoveryCodes, accessToken })
  } catch (error) {
    logError('MFA enable', error)
    return res.status(500).json({ error: 'Could not turn on two-factor sign-in.' })
  }
})

/** Password and a current code (or a recovery code): proof for the changes below. */
async function reauthenticate(req: Request, res: Response): Promise<boolean> {
  const userId = req.user!.userId
  const password = typeof req.body?.password === 'string' ? req.body.password : ''
  const answer = answerOf(req.body)
  const user = await accountOf(userId)
  if (!user || !password || !answer || !(await verifyPassword(password, user.password_hash))) {
    res.status(401).json({ error: 'Your password or code is not correct.', code: 'REAUTH_FAILED' })
    return false
  }
  const ok = answer.recoveryCode
    ? await spendRecoveryCode(userId, answer.recoveryCode)
    : await checkCode(userId, answer.code!)
  if (!ok) {
    res.status(401).json({ error: 'Your password or code is not correct.', code: 'REAUTH_FAILED' })
    return false
  }
  return true
}

router.post('/disable', mfaManageLimiter, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId
    if (!(await mfaEnabled(userId))) {
      return res.status(409).json({ error: 'Two-factor sign-in is not on.' })
    }
    const role = await query(`SELECT name FROM roles WHERE id = $1`, [req.user!.roleId])
    if (requiredRoles().has(role.rows[0]?.name)) {
      return res.status(403).json({
        error: 'Your role requires two-factor sign-in. To move it to a new phone, ask another administrator to reset your access.',
        code: 'MFA_REQUIRED',
      })
    }
    if (!(await reauthenticate(req, res))) return
    await clearMfa(null, userId)
    return res.json({ enabled: false })
  } catch (error) {
    logError('MFA disable', error)
    return res.status(500).json({ error: 'Could not turn off two-factor sign-in.' })
  }
})

router.post('/recovery-codes', mfaManageLimiter, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId
    if (!(await mfaEnabled(userId))) {
      return res.status(409).json({ error: 'Two-factor sign-in is not on.' })
    }
    if (!(await reauthenticate(req, res))) return
    return res.json({ recoveryCodes: await replaceRecoveryCodes(userId) })
  } catch (error) {
    logError('MFA recovery codes', error)
    return res.status(500).json({ error: 'Could not create new recovery codes.' })
  }
})

export default router
