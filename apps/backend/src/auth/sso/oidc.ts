/**
 * OpenID Connect, as a relying party: authorization code flow with PKCE.
 *
 *   discover()        reads the provider's discovery document when an
 *                     administrator adds it; the issuer it states must be the
 *                     one given.
 *   authorizeUrl()    where the browser is sent: state, nonce and an S256
 *                     code challenge, all fresh for this sign-in.
 *   exchangeAndVerify()  trades the code (with the verifier) for tokens and
 *                     verifies the ID token: signature by a key from the
 *                     provider's JWKS (RS256 or ES256 only), issuer, audience,
 *                     expiry, and the nonce of this very sign-in.
 *
 * No library: the moving parts are few, and each check is spelled out here
 * where it can be read and tested (tests/sso.manual.ts runs a provider).
 */
import crypto from 'crypto'
import jwt from 'jsonwebtoken'
import { checkOutboundUrl } from '../../security/outbound.js'

export class OidcError extends Error {}

export interface Discovery {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  jwks_uri: string
}

async function getJson(url: string): Promise<any> {
  const res = await fetch(await checkOutboundUrl(url), { redirect: 'manual', signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new OidcError(`${new URL(url).host} answered ${res.status}`)
  return res.json()
}

export async function discover(issuer: string): Promise<Discovery> {
  const base = String(issuer ?? '').replace(/\/$/, '')
  const d = await getJson(`${base}/.well-known/openid-configuration`).catch((e) => {
    throw new OidcError(`Could not read the provider's discovery document: ${e instanceof Error ? e.message : e}`)
  })
  // The document must speak for the issuer that was asked: otherwise one
  // provider could stand in for another.
  if (String(d.issuer ?? '').replace(/\/$/, '') !== base) throw new OidcError('The discovery document names a different issuer')
  for (const k of ['authorization_endpoint', 'token_endpoint', 'jwks_uri'] as const) {
    if (typeof d[k] !== 'string') throw new OidcError(`The discovery document has no ${k}`)
    await checkOutboundUrl(d[k])
  }
  return { issuer: d.issuer, authorization_endpoint: d.authorization_endpoint, token_endpoint: d.token_endpoint, jwks_uri: d.jwks_uri }
}

const b64u = (b: Buffer) => b.toString('base64url')

export function newSignInSecrets() {
  const verifier = b64u(crypto.randomBytes(32))
  return {
    state: b64u(crypto.randomBytes(32)),
    nonce: b64u(crypto.randomBytes(24)),
    verifier,
    challenge: b64u(crypto.createHash('sha256').update(verifier).digest()),
  }
}

export function authorizeUrl(p: { authorization_endpoint: string; client_id: string }, redirectUri: string,
                             s: { state: string; nonce: string; challenge: string }): string {
  const u = new URL(p.authorization_endpoint)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('client_id', p.client_id)
  u.searchParams.set('redirect_uri', redirectUri)
  u.searchParams.set('scope', 'openid email profile')
  u.searchParams.set('state', s.state)
  u.searchParams.set('nonce', s.nonce)
  u.searchParams.set('code_challenge', s.challenge)
  u.searchParams.set('code_challenge_method', 'S256')
  return u.toString()
}

const jwksCache = new Map<string, { at: number; keys: any[] }>()

async function keyFor(jwksUri: string, kid: string | undefined): Promise<crypto.KeyObject> {
  const find = (keys: any[]) => keys.find((k) => (kid ? k.kid === kid : true) && k.use !== 'enc')
  let cached = jwksCache.get(jwksUri)
  let k = cached && Date.now() - cached.at < 10 * 60_000 ? find(cached.keys) : undefined
  if (!k) {
    // A key we have not seen: the provider may have rotated. Fetch again.
    const doc = await getJson(jwksUri)
    cached = { at: Date.now(), keys: Array.isArray(doc.keys) ? doc.keys : [] }
    jwksCache.set(jwksUri, cached)
    k = find(cached.keys)
  }
  if (!k) throw new OidcError('The ID token was signed with a key the provider does not publish')
  return crypto.createPublicKey({ key: k, format: 'jwk' })
}

export interface VerifiedIdentity {
  subject: string
  email: string
  emailVerified: boolean
  amr: string[]
}

export async function exchangeAndVerify(
  p: { issuer: string; client_id: string; client_secret: string; token_endpoint: string; jwks_uri: string },
  code: string, verifier: string, redirectUri: string, expectedNonce: string
): Promise<VerifiedIdentity> {
  const res = await fetch(await checkOutboundUrl(p.token_endpoint), {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'authorization_code', code, redirect_uri: redirectUri,
      client_id: p.client_id, client_secret: p.client_secret, code_verifier: verifier,
    }),
    signal: AbortSignal.timeout(8000),
  })
  const tokens: any = await res.json().catch(() => ({}))
  if (!res.ok || typeof tokens.id_token !== 'string') throw new OidcError('The provider did not give an ID token for this code')

  const header = jwt.decode(tokens.id_token, { complete: true })?.header
  if (!header || !['RS256', 'ES256'].includes(header.alg)) throw new OidcError('The ID token is not signed with RS256 or ES256')
  const key = await keyFor(p.jwks_uri, header.kid)
  let claims: any
  try {
    claims = jwt.verify(tokens.id_token, key, {
      algorithms: [header.alg as jwt.Algorithm],
      issuer: p.issuer,
      audience: p.client_id,
      clockTolerance: 60,
    })
  } catch (e) {
    throw new OidcError(`The ID token was refused: ${e instanceof Error ? e.message : e}`)
  }
  if (claims.nonce !== expectedNonce) throw new OidcError('The ID token was not issued for this sign-in (nonce)')
  if (typeof claims.email !== 'string' || !claims.email.includes('@')) throw new OidcError('The provider did not say which email address this is')
  if (typeof claims.sub !== 'string' || !claims.sub) throw new OidcError('The ID token has no subject')
  return {
    subject: claims.sub,
    email: claims.email.trim().toLowerCase(),
    emailVerified: claims.email_verified === true || claims.email_verified === 'true',
    amr: Array.isArray(claims.amr) ? claims.amr.map(String) : [],
  }
}
