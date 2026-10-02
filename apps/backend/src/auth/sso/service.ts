/**
 * Single sign-on per tenant (migration 080): the providers a tenant has
 * configured, the sign-ins in flight, and who a provider's answer is.
 *
 * A provider vouches for an email address. That is accepted only when the
 * provider says it verified the address, the address is in one of the
 * domains the tenant allowed for that provider (when it set any), and an
 * account with that address already exists on the tenant's platform and is
 * a member of this tenant. Nobody is created by signing in, and a provider
 * of school A can never sign anyone in to school B: the match is within the
 * provider's own tenant.
 *
 * After the provider's redirect the browser is given a one-time code (in the
 * URL fragment, so it reaches no server log), which the app trades for its
 * session with POST /api/auth/sso/complete.
 */
import crypto from 'crypto'
import { query } from '../../db/connection.js'
import { runAsSystem } from '../../db/dbContext.js'
import { openForTenant, sealForTenant } from '../../security/kms/dataKeys.js'
import { hashToken } from '../sessions.js'
import { authorizeUrl, discover, exchangeAndVerify, newSignInSecrets, OidcError } from './oidc.js'

function sys(text: string, params?: any[]) {
  return runAsSystem('identity: single sign-on before anyone is known', () => query(text, params))
}

type Runner = { query: (text: string, params?: any[]) => Promise<any> }
const PURPOSE = 'sso_client_secret'
const SIGN_IN_TTL_MINUTES = 10
const HANDOFF_TTL_SECONDS = 60

export class SsoError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
  }
}

export function apiPublicUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.API_PUBLIC_URL || `http://localhost:${env.PORT || 5000}`).replace(/\/$/, '')
}
export const oidcRedirectUri = () => `${apiPublicUrl()}/api/auth/sso/oidc/callback`

function domainsOf(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return [...new Set(raw.map((d) => String(d).trim().toLowerCase().replace(/^@/, '')).filter((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)))]
}

// ── Administration (the tenant's own administrators, on the runtime role) ──

export async function createOidcProvider(runner: Runner, o: {
  tenantId: string; name: unknown; issuer: unknown; clientId: unknown; clientSecret: unknown
  emailDomains?: unknown; trustIdpMfa?: unknown; createdBy: string
}) {
  const name = String(o.name ?? '').trim().slice(0, 80)
  const clientId = String(o.clientId ?? '').trim()
  const clientSecret = String(o.clientSecret ?? '')
  if (!name || !clientId || !clientSecret) throw new SsoError('invalid', 'Give a name, the client id and the client secret')
  const d = await discover(String(o.issuer ?? '')).catch((e) => {
    throw new SsoError('discovery', e instanceof Error ? e.message : String(e))
  })
  const id = crypto.randomUUID()
  const sealed = await sealForTenant(o.tenantId, PURPOSE, Buffer.from(clientSecret), `sso:${id}`)
  const r = await runner.query(
    `INSERT INTO tenant_sso_providers (id, tenant_id, kind, name, issuer, client_id, client_secret_sealed, client_secret_iv,
       client_secret_tag, client_secret_dek_version, authorization_endpoint, token_endpoint, jwks_uri, email_domains,
       trust_idp_mfa, created_by)
     VALUES ($1, $2, 'oidc', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     RETURNING id, kind, name, issuer, client_id, email_domains, trust_idp_mfa, enabled, created_at`,
    [id, o.tenantId, name, d.issuer, clientId, sealed.ciphertext, sealed.iv, sealed.authTag, sealed.dekVersion,
     d.authorization_endpoint, d.token_endpoint, d.jwks_uri, domainsOf(o.emailDomains), o.trustIdpMfa === true, o.createdBy]
  )
  return r.rows[0]
}

// ── Signing in (before anyone is known: the system pool) ─────────────────────

/** The enabled providers of a tenant, by its public code, for the sign-in page. */
export async function providersForTenantCode(code: string) {
  const r = await sys(
    `SELECT p.id, p.name, p.kind FROM tenant_sso_providers p JOIN tenants t ON t.id = p.tenant_id
      WHERE lower(t.code) = lower($1) AND p.enabled AND t.is_active ORDER BY p.name`,
    [String(code ?? '').slice(0, 60)]
  )
  return r.rows
}

/** Starts a sign-in; returns where to send the browser. */
export async function startSignIn(providerId: string): Promise<string> {
  const r = await sys(
    `SELECT p.* FROM tenant_sso_providers p JOIN tenants t ON t.id = p.tenant_id
      WHERE p.id = $1 AND p.enabled AND t.is_active`,
    [providerId]
  )
  const p = r.rows[0]
  if (!p) throw new SsoError('unknown_provider', 'This sign-in option is not available')
  if (p.kind !== 'oidc') throw new SsoError('unsupported', 'This provider type is not supported')
  const s = newSignInSecrets()
  await sys(
    `INSERT INTO sso_sign_ins (provider_id, state_hash, nonce, code_verifier, expires_at)
     VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP + ($5 || ' minutes')::interval)`,
    [p.id, hashToken(s.state), s.nonce, s.verifier, String(SIGN_IN_TTL_MINUTES)]
  )
  if (Math.random() < 0.02) {
    sys(`DELETE FROM sso_sign_ins WHERE expires_at < CURRENT_TIMESTAMP - INTERVAL '1 day'`).catch(() => undefined)
    sys(`DELETE FROM sso_handoffs WHERE expires_at < CURRENT_TIMESTAMP - INTERVAL '1 day'`).catch(() => undefined)
  }
  return authorizeUrl(p, oidcRedirectUri(), s)
}

/** The provider's account, matched to ours within the provider's tenant. */
async function matchAccount(p: any, email: string, verified: boolean): Promise<string> {
  if (!verified) throw new SsoError('unverified_email', 'Your identity provider has not verified your email address')
  const domain = email.split('@')[1] ?? ''
  if (p.email_domains?.length && !p.email_domains.includes(domain)) {
    throw new SsoError('wrong_domain', 'This sign-in option is not for that email address')
  }
  const r = await sys(
    `SELECT u.id FROM users u JOIN tenants t ON t.id = $2
      WHERE lower(u.email) = $1 AND u.platform_id = t.platform_id
        AND EXISTS (SELECT 1 FROM user_tenant_memberships m WHERE m.user_id = u.id AND m.tenant_id = $2 AND m.status = 'active')`,
    [email, p.tenant_id]
  )
  if (r.rows.length !== 1) throw new SsoError('no_account', 'There is no account for that address here. Ask your administrator to add you.')
  return r.rows[0].id
}

/** Finishes an OpenID Connect sign-in; returns the one-time code for the app. */
export async function finishOidc(state: unknown, code: unknown): Promise<string> {
  if (typeof state !== 'string' || typeof code !== 'string' || state.length > 200 || code.length > 2000) {
    throw new SsoError('invalid', 'The sign-in answer was malformed')
  }
  // Spent before the provider is asked anything, so it works once.
  const s = await sys(
    `UPDATE sso_sign_ins SET used_at = CURRENT_TIMESTAMP
      WHERE state_hash = $1 AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP
      RETURNING provider_id, nonce, code_verifier`,
    [hashToken(state)]
  )
  if (!s.rows.length) throw new SsoError('expired', 'This sign-in has expired or was already used. Start again.')
  const { provider_id, nonce, code_verifier } = s.rows[0]
  const p = (await sys(`SELECT * FROM tenant_sso_providers WHERE id = $1 AND enabled`, [provider_id])).rows[0]
  if (!p) throw new SsoError('unknown_provider', 'This sign-in option is no longer available')
  const secret = (await runAsSystem("identity: the tenant's SSO client secret", () =>
    openForTenant(p.tenant_id, PURPOSE, {
      ciphertext: p.client_secret_sealed, iv: p.client_secret_iv, authTag: p.client_secret_tag, dekVersion: p.client_secret_dek_version,
    }, `sso:${p.id}`))).toString()
  let who
  try {
    who = await exchangeAndVerify({ ...p, client_secret: secret }, code, code_verifier, oidcRedirectUri(), nonce)
  } catch (e) {
    throw new SsoError('provider_refused', e instanceof OidcError ? e.message : 'The identity provider could not be reached')
  }
  const userId = await matchAccount(p, who.email, who.emailVerified)
  const mfaDone = p.trust_idp_mfa && who.amr.some((m) => ['mfa', 'otp', 'hwk', 'swk', 'fpt', 'face'].includes(m))
  const handoff = crypto.randomBytes(32).toString('base64url')
  await sys(
    `INSERT INTO sso_handoffs (code_hash, user_id, provider_id, mfa_done, expires_at)
     VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP + ($5 || ' seconds')::interval)`,
    [hashToken(handoff), userId, p.id, mfaDone, String(HANDOFF_TTL_SECONDS)]
  )
  return handoff
}

/** Trades the one-time code for whose sign-in it was. Works once, within a minute. */
export async function spendHandoff(code: unknown): Promise<{ userId: string; mfaDone: boolean; tenantId: string }> {
  if (typeof code !== 'string' || code.length < 20 || code.length > 200) throw new SsoError('invalid', 'This sign-in link is not valid')
  const r = await sys(
    `UPDATE sso_handoffs h SET used_at = CURRENT_TIMESTAMP
       FROM tenant_sso_providers p
      WHERE h.code_hash = $1 AND h.used_at IS NULL AND h.expires_at > CURRENT_TIMESTAMP AND p.id = h.provider_id
      RETURNING h.user_id, h.mfa_done, p.tenant_id`,
    [hashToken(code)]
  )
  if (!r.rows.length) throw new SsoError('expired', 'This sign-in has expired or was already used. Start again.')
  return { userId: r.rows[0].user_id, mfaDone: r.rows[0].mfa_done, tenantId: r.rows[0].tenant_id }
}
