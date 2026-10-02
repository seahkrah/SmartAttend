/**
 * Passkeys, mounted at /api/auth/passkeys (auth/passkeys.ts).
 *
 *   GET    /                    the caller's passkeys
 *   POST   /register/options    start adding one (needs a recent sign-in)
 *   POST   /register/verify     finish adding it
 *   DELETE /:id                 remove one (needs a recent sign-in)
 *   POST   /sign-in/options     start a sign-in (no account named)
 *   POST   /sign-in/verify      finish it: the session, as /auth/login gives it
 *   POST   /step-up/options     start a step-up with a passkey
 *   POST   /step-up/verify      finish it (auth/stepUp.ts)
 */
import express, { Request, Response } from 'express'
import { query } from '../db/connection.js'
import { authenticateToken } from '../auth/middleware.js'
import { accountForSignIn, assertMaySignIn, issueTokens, LoginError, recordSignIn } from '../auth/authService.js'
import {
  finishRegistration, finishSignIn, finishStepUp, PasskeyError, startRegistration, startSignIn, startStepUp,
} from '../auth/passkeys.js'
import { markAuthenticated, requireRecentAuth } from '../auth/stepUp.js'
import { deliverTokens } from '../auth/cookies.js'
import { loginLimiter, mfaManageLimiter } from '../security/httpSecurity.js'
import { getClientIp } from '../utils/getClientIp.js'
import { logError } from '../utils/errorMessages.js'

const router = express.Router()

function refuse(res: Response, error: unknown, what: string) {
  if (error instanceof PasskeyError) return res.status(error.status).json({ error: error.message, code: 'PASSKEY' })
  if (error instanceof LoginError) return res.status(403).json({ error: error.message, code: error.code.toUpperCase() })
  logError(what, error)
  return res.status(500).json({ error: 'Something went wrong with the passkey. Please try again.' })
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

router.get('/', authenticateToken, async (req: Request, res: Response) => {
  try {
    // The runtime role: row-level security shows the caller their own.
    const r = await query(
      `SELECT id, name, device_type, backed_up, created_at, last_used_at
         FROM webauthn_credentials WHERE user_id = $1 ORDER BY created_at`,
      [req.user!.userId]
    )
    return res.json({
      passkeys: r.rows.map((p: any) => ({
        id: p.id, name: p.name, synced: p.backed_up, deviceType: p.device_type,
        createdAt: p.created_at, lastUsedAt: p.last_used_at,
      })),
    })
  } catch (error) {
    return refuse(res, error, 'List passkeys')
  }
})

router.post('/register/options', mfaManageLimiter, authenticateToken, requireRecentAuth, async (req: Request, res: Response) => {
  try {
    const u = await query(`SELECT id, email, full_name FROM users WHERE id = $1`, [req.user!.userId])
    if (!u.rows.length) return res.status(404).json({ error: 'No such account' })
    return res.json(await startRegistration(u.rows[0], req.user!.sessionId!))
  } catch (error) {
    return refuse(res, error, 'Passkey registration options')
  }
})

router.post('/register/verify', mfaManageLimiter, authenticateToken, async (req: Request, res: Response) => {
  try {
    const p = await finishRegistration(req.user!.userId, req.user!.sessionId!, req.body?.response, req.body?.name)
    return res.status(201).json({ passkey: { id: p.id, name: p.name, createdAt: p.created_at } })
  } catch (error) {
    return refuse(res, error, 'Passkey registration')
  }
})

router.delete('/:id', mfaManageLimiter, authenticateToken, requireRecentAuth, async (req: Request, res: Response) => {
  try {
    if (!UUID.test(req.params.id)) return res.status(404).json({ error: 'Passkey not found' })
    const r = await query(`DELETE FROM webauthn_credentials WHERE id = $1 AND user_id = $2 RETURNING id`,
      [req.params.id, req.user!.userId])
    if (!r.rows.length) return res.status(404).json({ error: 'Passkey not found' })
    return res.json({ removed: true })
  } catch (error) {
    return refuse(res, error, 'Remove passkey')
  }
})

router.post('/sign-in/options', loginLimiter, async (_req: Request, res: Response) => {
  try {
    return res.json(await startSignIn())
  } catch (error) {
    return refuse(res, error, 'Passkey sign-in options')
  }
})

router.post('/sign-in/verify', loginLimiter, async (req: Request, res: Response) => {
  try {
    const userId = await finishSignIn(req.body?.challengeId, req.body?.response)
    const user = await accountForSignIn(userId)
    if (!user) throw new PasskeyError(401, 'This passkey is not recognised.')
    await assertMaySignIn(user, user.role_name === 'superadmin' && user.platform_name === 'system')
    // The device checked a PIN or biometric: this is already two factors.
    const tokens = await issueTokens(user, { ip: getClientIp(req), userAgent: String(req.headers['user-agent'] ?? '') })
    await recordSignIn(user.id)
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
      ...deliverTokens(req, res, tokens),
    })
  } catch (error) {
    return refuse(res, error, 'Passkey sign-in')
  }
})

router.post('/step-up/options', loginLimiter, authenticateToken, async (req: Request, res: Response) => {
  try {
    return res.json(await startStepUp(req.user!.userId, req.user!.sessionId!))
  } catch (error) {
    return refuse(res, error, 'Passkey step-up options')
  }
})

router.post('/step-up/verify', loginLimiter, authenticateToken, async (req: Request, res: Response) => {
  try {
    await finishStepUp(req.user!.userId, req.user!.sessionId!, req.body?.response)
    await markAuthenticated(req.user!.sessionId!)
    return res.json({ steppedUp: true })
  } catch (error) {
    // 403, not 401, for a refused passkey: the session itself is fine.
    if (error instanceof PasskeyError && error.status === 401) {
      return res.status(403).json({ error: error.message, code: 'STEP_UP_FAILED' })
    }
    return refuse(res, error, 'Passkey step-up')
  }
})

export default router
