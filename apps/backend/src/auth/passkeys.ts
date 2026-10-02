/**
 * WebAuthn passkeys: registering them, signing in with them, and stepping up
 * with them (migration 078; routes/passkeys.ts).
 *
 * Sign-in is "usernameless": the browser offers the passkeys it holds for
 * this site, so nothing about whether an address has an account or a
 * passkey is revealed before the signature checks out. User verification
 * (the device's PIN or biometric) is required, so a passkey is two factors
 * on its own and replaces the password and the authenticator code.
 *
 * Challenges are single-use: each is spent before its answer is checked, so
 * a replayed answer finds it gone. The signature counter must go up; if it
 * does not, the credential may have been cloned and the sign-in is refused
 * by the library.
 *
 * The relying party is the site's registrable host: WEBAUTHN_RP_ID, or the
 * host of PUBLIC_APP_URL. Accepted origins are the API's allowed browser
 * origins (CORS_ORIGINS), or WEBAUTHN_ORIGINS when set.
 */
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server'
import { query } from '../db/connection.js'
import { runAsSystem } from '../db/dbContext.js'
import { allowedOrigins } from '../security/httpSecurity.js'

function sys(text: string, params?: any[]) {
  return runAsSystem('identity: passkey challenges and sign-in before anyone is known', () => query(text, params))
}

const CHALLENGE_TTL_MINUTES = 5
export const RP_NAME = 'JJELOTECH SYSTEMS'

export class PasskeyError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

export function rpId(env: NodeJS.ProcessEnv = process.env): string {
  if (env.WEBAUTHN_RP_ID) return env.WEBAUTHN_RP_ID
  try {
    return new URL(env.PUBLIC_APP_URL || 'http://localhost:5173').hostname
  } catch {
    return 'localhost'
  }
}

export function expectedOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const configured = (env.WEBAUTHN_ORIGINS ?? '').split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean)
  return configured.length ? configured : allowedOrigins()
}

async function saveChallenge(purpose: 'register' | 'sign_in' | 'step_up', challenge: string,
                             userId: string | null, sessionId: string | null): Promise<string> {
  const r = await sys(
    `INSERT INTO webauthn_challenges (user_id, session_id, purpose, challenge, expires_at)
     VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP + ($5 || ' minutes')::interval) RETURNING id`,
    [userId, sessionId, purpose, challenge, String(CHALLENGE_TTL_MINUTES)]
  )
  if (Math.random() < 0.02) {
    sys(`DELETE FROM webauthn_challenges WHERE expires_at < CURRENT_TIMESTAMP - INTERVAL '1 day'`).catch(() => undefined)
  }
  return r.rows[0].id
}

/** Spends a challenge; returns it, or refuses. Spent before checking, so it works once. */
async function spendChallenge(where: { id?: string; userId?: string; sessionId?: string },
                              purpose: 'register' | 'sign_in' | 'step_up'): Promise<string> {
  const r = await sys(
    `UPDATE webauthn_challenges SET used_at = CURRENT_TIMESTAMP
      WHERE id = (SELECT id FROM webauthn_challenges
                   WHERE purpose = $1 AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP
                     AND ($2::uuid IS NULL OR id = $2::uuid)
                     AND ($3::uuid IS NULL OR user_id = $3::uuid)
                     AND ($4::uuid IS NULL OR session_id = $4::uuid)
                   ORDER BY created_at DESC LIMIT 1
                   FOR UPDATE SKIP LOCKED)
      RETURNING challenge`,
    [purpose, where.id ?? null, where.userId ?? null, where.sessionId ?? null]
  )
  if (!r.rows.length) throw new PasskeyError(400, 'This request has expired or was already used. Start again.')
  return r.rows[0].challenge
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ── Registration ────────────────────────────────────────────────────────────

export async function startRegistration(user: { id: string; email: string; full_name: string }, sessionId: string) {
  const existing = await sys(`SELECT credential_id, transports FROM webauthn_credentials WHERE user_id = $1`, [user.id])
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: rpId(),
    userName: user.email,
    userDisplayName: user.full_name,
    // The WebAuthn user handle: the account id's bytes, never the email.
    userID: Buffer.from(user.id.replace(/-/g, ''), 'hex'),
    attestationType: 'none',
    excludeCredentials: existing.rows.map((c: any) => ({ id: c.credential_id, transports: c.transports })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
  })
  await saveChallenge('register', options.challenge, user.id, sessionId)
  return options
}

export async function finishRegistration(userId: string, sessionId: string, response: any, name: unknown) {
  const challenge = await spendChallenge({ userId, sessionId }, 'register')
  let v
  try {
    v = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: expectedOrigins(),
      expectedRPID: rpId(),
      requireUserVerification: true,
    })
  } catch (e) {
    throw new PasskeyError(400, `The passkey could not be verified: ${e instanceof Error ? e.message : 'invalid response'}`)
  }
  if (!v.verified || !v.registrationInfo) throw new PasskeyError(400, 'The passkey could not be verified.')
  const { credential, credentialDeviceType, credentialBackedUp } = v.registrationInfo
  const label = typeof name === 'string' && name.trim() ? name.trim().slice(0, 60) : 'Passkey'
  try {
    const r = await sys(
      `INSERT INTO webauthn_credentials (user_id, credential_id, public_key, counter, transports, device_type, backed_up, name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, name, created_at`,
      [userId, credential.id, Buffer.from(credential.publicKey), credential.counter,
       credential.transports ?? [], credentialDeviceType, credentialBackedUp, label]
    )
    return r.rows[0]
  } catch (e: any) {
    if (e?.code === '23505') throw new PasskeyError(409, 'This passkey is already registered.')
    throw e
  }
}

// ── Signing in, and stepping up ─────────────────────────────────────────────

export async function startSignIn() {
  const options = await generateAuthenticationOptions({ rpID: rpId(), userVerification: 'required' })
  const challengeId = await saveChallenge('sign_in', options.challenge, null, null)
  return { challengeId, options }
}

export async function startStepUp(userId: string, sessionId: string) {
  const creds = await sys(`SELECT credential_id, transports FROM webauthn_credentials WHERE user_id = $1`, [userId])
  if (!creds.rows.length) throw new PasskeyError(400, 'You have no passkey. Use your password or an authenticator code.')
  const options = await generateAuthenticationOptions({
    rpID: rpId(),
    userVerification: 'required',
    allowCredentials: creds.rows.map((c: any) => ({ id: c.credential_id, transports: c.transports })),
  })
  await saveChallenge('step_up', options.challenge, userId, sessionId)
  return options
}

/** Checks an assertion against its spent challenge; returns whose passkey it is. */
async function verifyAssertion(challenge: string, response: any, mustBelongTo: string | null): Promise<string> {
  const credId = typeof response?.id === 'string' ? response.id : ''
  const c = await sys(
    `SELECT id, user_id, credential_id, public_key, counter, transports FROM webauthn_credentials WHERE credential_id = $1`,
    [credId]
  )
  const cred = c.rows[0]
  // Unknown credential and wrong owner read the same.
  if (!cred || (mustBelongTo && cred.user_id !== mustBelongTo)) throw new PasskeyError(401, 'This passkey is not recognised.')
  let v
  try {
    v = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: expectedOrigins(),
      expectedRPID: rpId(),
      credential: {
        id: cred.credential_id,
        publicKey: new Uint8Array(cred.public_key),
        counter: Number(cred.counter),
        transports: cred.transports,
      },
      requireUserVerification: true,
    })
  } catch {
    throw new PasskeyError(401, 'This passkey could not be verified.')
  }
  if (!v.verified) throw new PasskeyError(401, 'This passkey could not be verified.')
  await sys(`UPDATE webauthn_credentials SET counter = $2, last_used_at = CURRENT_TIMESTAMP WHERE id = $1`,
    [cred.id, v.authenticationInfo.newCounter])
  return cred.user_id
}

export async function finishSignIn(challengeId: unknown, response: any): Promise<string> {
  if (typeof challengeId !== 'string' || !UUID.test(challengeId)) throw new PasskeyError(400, 'Start the passkey sign-in again.')
  const challenge = await spendChallenge({ id: challengeId }, 'sign_in')
  return verifyAssertion(challenge, response, null)
}

export async function finishStepUp(userId: string, sessionId: string, response: any): Promise<void> {
  const challenge = await spendChallenge({ userId, sessionId }, 'step_up')
  await verifyAssertion(challenge, response, userId)
}
