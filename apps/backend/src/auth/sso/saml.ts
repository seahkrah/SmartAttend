/**
 * SAML 2.0, as a service provider, with @node-saml/node-saml (which uses
 * xml-crypto for the XML signatures).
 *
 * The identity provider's assertion must be signed by the certificate the
 * tenant registered (wantAssertionsSigned), be for this service provider
 * (audience), be within its validity window (one minute of clock skew), and
 * answer the very AuthnRequest this sign-in sent (InResponseTo): the request
 * id is kept on the sign-in row, and the cache below only ever recognises the
 * id of the sign-in whose RelayState came back. The RelayState is spent before
 * the response is checked, so a response cannot be replayed.
 */
import crypto from 'crypto'
import { SAML, ValidateInResponseTo, type CacheProvider, type CacheItem, type Profile } from '@node-saml/node-saml'

export class SamlError extends Error {}

export const samlEntityId = (apiUrl: string) => `${apiUrl}/api/auth/sso/saml/metadata`
export const samlAcsUrl = (apiUrl: string) => `${apiUrl}/api/auth/sso/saml/acs`

/** Accepts the IdP's signing certificate (or public key) as PEM; refuses anything else. */
export function normaliseIdpCertificate(raw: unknown): string {
  const pem = String(raw ?? '').trim()
  try {
    if (/BEGIN CERTIFICATE/.test(pem)) {
      const cert = new crypto.X509Certificate(pem)
      if (new Date(cert.validTo) < new Date()) throw new SamlError('That certificate has expired')
      return cert.toString()
    }
    if (/BEGIN PUBLIC KEY/.test(pem)) return crypto.createPublicKey(pem).export({ type: 'spki', format: 'pem' }).toString()
  } catch (e) {
    if (e instanceof SamlError) throw e
  }
  throw new SamlError('Give the identity provider\'s signing certificate in PEM form (-----BEGIN CERTIFICATE-----)')
}

/** Remembers one sign-in's request id, and recognises nothing else. */
class OneSignInCache implements CacheProvider {
  requestId: string | null
  constructor(known: string | null = null) {
    this.requestId = known
  }
  async saveAsync(key: string, value: string): Promise<CacheItem | null> {
    this.requestId = key
    return { value, createdAt: Date.now() }
  }
  async getAsync(key: string): Promise<string | null> {
    // The library reads this as a date; the sign-in row already enforced
    // its ten-minute life, so "now" is the honest answer here.
    return key && key === this.requestId ? new Date().toISOString() : null
  }
  // The library checks InResponseTo on the Response and again on the
  // subject's confirmation, removing the id after the first. Forgetting it
  // here would fail the second check; single use is the sign-in row's job
  // (spent before the response is checked).
  async removeAsync(key: string | null): Promise<string | null> {
    return key
  }
}

function client(p: { idp_sso_url: string; idp_certificate: string; idp_entity_id: string }, apiUrl: string, cache: CacheProvider) {
  return new SAML({
    entryPoint: p.idp_sso_url,
    issuer: samlEntityId(apiUrl),
    callbackUrl: samlAcsUrl(apiUrl),
    idpCert: p.idp_certificate,
    idpIssuer: p.idp_entity_id,
    audience: samlEntityId(apiUrl),
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: false,
    acceptedClockSkewMs: 60_000,
    validateInResponseTo: ValidateInResponseTo.always,
    requestIdExpirationPeriodMs: 10 * 60_000,
    cacheProvider: cache,
    identifierFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
    disableRequestedAuthnContext: true,
    signatureAlgorithm: 'sha256',
  })
}

/** The URL to send the browser to, and the AuthnRequest id to keep with the sign-in. */
export async function samlAuthorizeUrl(p: any, apiUrl: string, relayState: string): Promise<{ url: string; requestId: string }> {
  const cache = new OneSignInCache()
  const url = await client(p, apiUrl, cache).getAuthorizeUrlAsync(relayState, undefined, {})
  if (!cache.requestId) throw new SamlError('Could not build the sign-in request')
  return { url, requestId: cache.requestId }
}

export interface SamlIdentity { email: string; nameId: string }

/** Verifies the posted SAMLResponse for the sign-in that sent requestId. */
export async function samlVerify(p: any, apiUrl: string, requestId: string, samlResponse: unknown): Promise<SamlIdentity> {
  if (typeof samlResponse !== 'string' || samlResponse.length > 200_000) throw new SamlError('The sign-in answer was malformed')
  let profile: Profile | null
  try {
    ({ profile } = await client(p, apiUrl, new OneSignInCache(requestId)).validatePostResponseAsync({ SAMLResponse: samlResponse }))
  } catch (e) {
    throw new SamlError(`The identity provider's answer was refused: ${e instanceof Error ? e.message : e}`)
  }
  if (!profile) throw new SamlError('The identity provider signed nobody in')
  // The library's idpIssuer option does not check the assertion of a
  // response on this path (the sso suite showed another issuer accepted), so
  // it is checked here: the assertion must be from the registered entity.
  if (profile.issuer !== p.idp_entity_id) throw new SamlError(`The assertion is from ${profile.issuer}, not the registered identity provider`)
  const email = String(profile.email ?? profile.mail ?? profile['urn:oid:0.9.2342.19200300.100.1.3']
    ?? (/emailAddress$/.test(profile.nameIDFormat ?? '') ? profile.nameID : '')).trim().toLowerCase()
  if (!email.includes('@')) throw new SamlError('The identity provider did not say which email address this is')
  return { email, nameId: profile.nameID }
}
