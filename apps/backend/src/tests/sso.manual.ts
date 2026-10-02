/**
 * Single sign-on per tenant, with an OpenID Connect provider run here.
 *
 * The provider below is what Google Workspace or Microsoft Entra ID would
 * be: a discovery document, an authorization endpoint, a token endpoint that
 * checks the client secret and the PKCE verifier, and RS256-signed ID tokens
 * from a published key. It can be told to misbehave in each way the API must
 * catch: another issuer or audience, a stale nonce, another key, no signature,
 * an expired token, an unverified or foreign address, someone else's school.
 *
 * The second half does the same for SAML 2.0: this suite plays the identity
 * provider, reads the AuthnRequest, and posts back assertions it signs with
 * xml-crypto, good and bad (another key, unsigned, edited after signing,
 * for another audience or request, expired, from another issuer).
 *
 * Suite "sso" in scripts/run-all-e2e.sh. Needs the e2e seed, the API, a KMS
 * (KMS_LOCAL_KEK) for the client secret, and OUTBOUND_ALLOW_HTTP/PRIVATE.
 */
import crypto from 'crypto'
import fs from 'fs'
import http from 'http'
import type { AddressInfo } from 'net'
import path from 'path'
import jwt from 'jsonwebtoken'
import zlib from 'zlib'
import { SignedXml } from 'xml-crypto'

const API = (process.env.API_BASE ?? 'http://127.0.0.1:5000') + '/api'
const dir = process.env.E2E_FIXTURE_DIR ?? path.join(process.cwd(), '.e2e-fixtures')
const seed = JSON.parse(fs.readFileSync(path.join(dir, 'seed.json'), 'utf8'))
const A = seed.A, B = seed.B
const CLIENT_ID = 'jjelotech-e2e'
const CLIENT_SECRET = crypto.randomBytes(24).toString('base64url')

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  ok    ${name}`) } else { fail++; console.log(`  FAIL  ${name} ${detail}`) }
}

// ── The identity provider ───────────────────────────────────────────────────
const key = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
const rogue = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwk = { ...(key.publicKey.export({ format: 'jwk' }) as object), kid: 'k1', use: 'sig', alg: 'RS256' }
let issuer = ''
type Mode = { email?: string; verified?: boolean; iss?: string; aud?: string; nonce?: string; sign?: 'rogue' | 'none' | 'hs256'; exp?: number }
let mode: Mode = {}
const codes = new Map<string, { challenge: string; nonce: string; redirect: string; mode: Mode }>()
const seen = { pkceChecked: 0, secretChecked: 0 }

function idToken(c: { nonce: string; mode: Mode }) {
  const now = Math.floor(Date.now() / 1000)
  const claims = {
    iss: c.mode.iss ?? issuer, aud: c.mode.aud ?? CLIENT_ID, sub: 'idp-' + (c.mode.email ?? 'fac.a@e2e.test'),
    email: c.mode.email ?? 'fac.a@e2e.test', email_verified: c.mode.verified ?? true,
    nonce: c.mode.nonce ?? c.nonce, iat: now, exp: c.mode.exp ?? now + 300, amr: ['pwd'],
  }
  if (c.mode.sign === 'none') {
    const h = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
    return `${h}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.`
  }
  if (c.mode.sign === 'hs256') return jwt.sign(claims, CLIENT_SECRET, { algorithm: 'HS256', keyid: 'k1' })
  return jwt.sign(claims, c.mode.sign === 'rogue' ? rogue.privateKey : key.privateKey, { algorithm: 'RS256', keyid: 'k1' })
}

const idp = http.createServer((req, res) => {
  const u = new URL(req.url ?? '/', issuer)
  const send = (code: number, body: unknown) => { res.writeHead(code, { 'Content-Type': 'application/json' }).end(JSON.stringify(body)) }
  if (u.pathname === '/.well-known/openid-configuration') {
    return send(200, { issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks` })
  }
  if (u.pathname === '/jwks') return send(200, { keys: [jwk] })
  if (u.pathname === '/token' && req.method === 'POST') {
    let body = ''
    req.on('data', (d) => (body += d))
    req.on('end', () => {
      const f = new URLSearchParams(body)
      const c = codes.get(f.get('code') ?? '')
      if (!c || f.get('client_id') !== CLIENT_ID) return send(400, { error: 'invalid_grant' })
      if (f.get('client_secret') !== CLIENT_SECRET) return send(401, { error: 'invalid_client' })
      seen.secretChecked++
      const verifier = f.get('code_verifier') ?? ''
      if (crypto.createHash('sha256').update(verifier).digest('base64url') !== c.challenge) return send(400, { error: 'invalid_grant', why: 'pkce' })
      seen.pkceChecked++
      if (f.get('redirect_uri') !== c.redirect) return send(400, { error: 'invalid_grant', why: 'redirect' })
      codes.delete(f.get('code')!)
      send(200, { access_token: 'at', token_type: 'Bearer', id_token: idToken(c) })
    })
    return
  }
  send(404, {})
})

// ── Driving the browser's part ──────────────────────────────────────────────
async function api(method: string, p: string, body?: unknown, token?: string) {
  const res = await fetch(API + p, {
    method, redirect: 'manual',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let json: any = text
  try { json = JSON.parse(text) } catch { /* not JSON */ }
  return { status: res.status, body: json, location: res.headers.get('location') ?? '' }
}

/** Start, "sign in" at the provider with the current mode, come back. Returns where the API sent the browser. */
async function signInVia(providerId: string, m: Mode, tamper?: (q: URLSearchParams) => void) {
  mode = m
  const start = await api('GET', `/auth/sso/${providerId}/start`)
  const authz = new URL(start.location)
  const q = authz.searchParams
  const code = crypto.randomBytes(16).toString('hex')
  codes.set(code, { challenge: q.get('code_challenge') ?? '', nonce: q.get('nonce') ?? '', redirect: q.get('redirect_uri') ?? '', mode: m })
  const back = new URLSearchParams({ code, state: q.get('state') ?? '' })
  tamper?.(back)
  const cb = await api('GET', `/auth/sso/oidc/callback?${back}`)
  return { start, authz, cb, state: q.get('state') ?? '', code }
}
const errorOf = (loc: string) => { try { return new URL(loc).searchParams.get('sso_error') } catch { return null } }
const handoffOf = (loc: string) => (loc.includes('#code=') ? decodeURIComponent(loc.split('#code=')[1]) : '')

async function main() {
  await new Promise<void>((r) => idp.listen(0, '127.0.0.1', r))
  issuer = `http://127.0.0.1:${(idp.address() as AddressInfo).port}`

  console.log('-- a tenant administrator adds a provider --')
  let r = await api('POST', '/admin/sso', { name: 'School accounts', issuer, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, emailDomains: ['e2e.test'] }, A.facToken)
  check('a lecturer cannot', r.status === 403, `(${r.status})`)
  r = await api('POST', '/admin/sso', { name: 'Imposter', issuer: issuer + '/other', clientId: CLIENT_ID, clientSecret: 'x' }, A.token)
  check('a provider whose discovery does not answer for its issuer is refused', r.status === 400, `(${r.status} ${JSON.stringify(r.body)})`)
  r = await api('POST', '/admin/sso', { name: 'School accounts', issuer, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, emailDomains: ['e2e.test'] }, A.token)
  check("A's administrator adds one", r.status === 201 && r.body.provider?.id, `(${r.status} ${JSON.stringify(r.body)})`)
  const pid: string = r.body.provider?.id
  const list = await api('GET', '/admin/sso', undefined, A.token)
  check('the list never shows the client secret', list.status === 200 && !JSON.stringify(list.body).includes(CLIENT_SECRET))
  const listB = await api('GET', '/admin/sso', undefined, B.token)
  check("B's administrator does not see A's provider", listB.status === 200 && !listB.body.providers.some((p: any) => p.id === pid))
  const pub = await api('GET', '/auth/sso/providers?tenant=E2E-A')
  check("A's sign-in page offers it", pub.status === 200 && pub.body.providers.some((p: any) => p.id === pid))
  const pubB = await api('GET', '/auth/sso/providers?tenant=E2E-B')
  check("B's does not", pubB.status === 200 && !pubB.body.providers.some((p: any) => p.id === pid))

  console.log('-- signing in --')
  const ok = await signInVia(pid, {})
  check('the browser is sent to the provider', ok.start.status === 302 && ok.authz.origin === issuer, ok.start.location)
  check('with a fresh state and nonce, PKCE S256, and the openid scope',
    ok.authz.searchParams.get('code_challenge_method') === 'S256' && !!ok.authz.searchParams.get('nonce')
    && ok.state.length >= 40 && (ok.authz.searchParams.get('scope') ?? '').split(' ').includes('openid'))
  check('and comes back to the app with a one-time code in the fragment', ok.cb.status === 302 && !!handoffOf(ok.cb.location), ok.cb.location)
  check('the API proved the client secret and the PKCE verifier to the provider', seen.secretChecked >= 1 && seen.pkceChecked >= 1)
  const done = await api('POST', '/auth/sso/complete', { code: handoffOf(ok.cb.location) })
  check('the app trades the code for a session', done.status === 200 && !!done.body.accessToken, `(${done.status} ${JSON.stringify(done.body).slice(0, 160)})`)
  check('as the person the provider vouched for', done.body.user?.email === 'fac.a@e2e.test')
  const me = await api('GET', '/auth/me', undefined, done.body.accessToken)
  check('the session works', me.status === 200, `(${me.status})`)
  const again = await api('POST', '/auth/sso/complete', { code: handoffOf(ok.cb.location) })
  check('the one-time code works once', again.status === 400, `(${again.status})`)
  const replay = await api('GET', `/auth/sso/oidc/callback?${new URLSearchParams({ code: ok.code, state: ok.state })}`)
  check('the provider\'s answer cannot be replayed (state spent)', errorOf(replay.location) === 'expired', replay.location)
  const forged = await api('GET', `/auth/sso/oidc/callback?${new URLSearchParams({ code: 'x', state: crypto.randomBytes(32).toString('base64url') })}`)
  check('a state the API never issued is refused', errorOf(forged.location) === 'expired', forged.location)

  console.log('-- what the API must refuse --')
  const cases: Array<[string, Mode, string]> = [
    ['an ID token from another issuer', { iss: 'https://evil.example' }, 'provider_refused'],
    ['an ID token for another client', { aud: 'someone-else' }, 'provider_refused'],
    ['an ID token for another sign-in (nonce)', { nonce: 'stale' }, 'provider_refused'],
    ['an ID token signed by a key the provider does not publish', { sign: 'rogue' }, 'provider_refused'],
    ['an unsigned ID token (alg none)', { sign: 'none' }, 'provider_refused'],
    ['an ID token signed with the client secret (HS256)', { sign: 'hs256' }, 'provider_refused'],
    ['an expired ID token', { exp: Math.floor(Date.now() / 1000) - 3600 }, 'provider_refused'],
    ['an address the provider has not verified', { verified: false }, 'unverified_email'],
    ['an address outside the allowed domains', { email: 'someone@elsewhere.test' }, 'wrong_domain'],
    ["school B's administrator, through school A's provider", { email: 'admin.b@e2e.test' }, 'no_account'],
    ['an address with no account', { email: 'nobody@e2e.test' }, 'no_account'],
  ]
  for (const [name, m, want] of cases) {
    const x = await signInVia(pid, m)
    check(`${name}: refused (${want})`, errorOf(x.cb.location) === want && !handoffOf(x.cb.location), x.cb.location)
  }
  const swapped = await signInVia(pid, {}, (q) => q.set('code', 'not-the-code'))
  check('a code the provider did not issue: refused', errorOf(swapped.cb.location) === 'provider_refused', swapped.cb.location)

  console.log('-- the administrator turns it off --')
  r = await api('DELETE', `/admin/sso/${pid}`, undefined, B.token)
  check("B's administrator cannot remove A's provider", r.status === 404, `(${r.status})`)
  r = await api('PATCH', `/admin/sso/${pid}`, { enabled: false }, A.token)
  check('disabled', r.status === 200 && r.body.provider?.enabled === false, `(${r.status})`)
  const off = await api('GET', `/auth/sso/${pid}/start`)
  check('a disabled provider signs nobody in', errorOf(off.location) === 'unknown_provider', off.location)
  r = await api('DELETE', `/admin/sso/${pid}`, undefined, A.token)
  check('and removed', r.status === 200, `(${r.status})`)
}

// ── SAML ────────────────────────────────────────────────────────────────────
const SAML_IDP = 'https://idp.e2e.test/saml'
const samlKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
const pem = (k: crypto.KeyObject, type: 'spki' | 'pkcs8') => k.export({ type, format: 'pem' }).toString()

type SamlMode = {
  email?: string; key?: 'rogue'; unsigned?: boolean; editAfterSigning?: string; audience?: string
  inResponseTo?: string; expired?: boolean; issuer?: string
}

function samlResponse(req: { id: string; acs: string; sp: string }, m: SamlMode): string {
  const now = new Date()
  const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z')
  const later = new Date(now.getTime() + (m.expired ? -10 * 60_000 : 5 * 60_000))
  const before = new Date(now.getTime() - (m.expired ? 20 * 60_000 : 60_000))
  const irt = m.inResponseTo ?? req.id
  const iss = m.issuer ?? SAML_IDP
  const email = m.email ?? 'fac.a@e2e.test'
  const assertion =
    `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_a${crypto.randomBytes(8).toString('hex')}" Version="2.0" IssueInstant="${iso(now)}">` +
    `<saml:Issuer>${iss}</saml:Issuer>` +
    `<saml:Subject><saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${email}</saml:NameID>` +
    `<saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData NotOnOrAfter="${iso(later)}" Recipient="${req.acs}" InResponseTo="${irt}"/></saml:SubjectConfirmation></saml:Subject>` +
    `<saml:Conditions NotBefore="${iso(before)}" NotOnOrAfter="${iso(later)}"><saml:AudienceRestriction><saml:Audience>${m.audience ?? req.sp}</saml:Audience></saml:AudienceRestriction></saml:Conditions>` +
    `<saml:AuthnStatement AuthnInstant="${iso(now)}" SessionIndex="_s1"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement>` +
    `</saml:Assertion>`
  let signed = assertion
  if (!m.unsigned) {
    const sig = new SignedXml({
      privateKey: pem(m.key === 'rogue' ? rogue.privateKey : samlKey.privateKey, 'pkcs8'),
      canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#',
      signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
    })
    sig.addReference({
      xpath: "//*[local-name(.)='Assertion']",
      transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', 'http://www.w3.org/2001/10/xml-exc-c14n#'],
      digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
    })
    sig.computeSignature(assertion, { location: { reference: "//*[local-name(.)='Issuer']", action: 'after' } })
    signed = sig.getSignedXml()
  }
  if (m.editAfterSigning) signed = signed.replace(email, m.editAfterSigning)
  const xml =
    `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_r${crypto.randomBytes(8).toString('hex')}" Version="2.0" IssueInstant="${iso(now)}" Destination="${req.acs}" InResponseTo="${irt}">` +
    `<saml:Issuer>${iss}</saml:Issuer><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>${signed}</samlp:Response>`
  return Buffer.from(xml).toString('base64')
}

async function samlSignIn(providerId: string, m: SamlMode) {
  const start = await api('GET', `/auth/sso/${providerId}/start`)
  const u = new URL(start.location)
  const request = zlib.inflateRawSync(Buffer.from(u.searchParams.get('SAMLRequest') ?? '', 'base64')).toString()
  const id = /ID="([^"]+)"/.exec(request)?.[1] ?? ''
  const acs = /AssertionConsumerServiceURL="([^"]+)"/.exec(request)?.[1] ?? ''
  const sp = /<saml:Issuer[^>]*>([^<]+)</.exec(request)?.[1] ?? ''
  const relay = u.searchParams.get('RelayState') ?? ''
  const form = new URLSearchParams({ SAMLResponse: samlResponse({ id, acs, sp }, m), RelayState: relay })
  const res = await fetch(API + '/auth/sso/saml/acs', {
    method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form,
  })
  return { start, u, request, id, relay, form, location: res.headers.get('location') ?? '', status: res.status }
}

async function saml() {
  console.log('-- SAML: a tenant administrator adds a provider --')
  let r = await api('POST', '/admin/sso', {
    kind: 'saml', name: 'School SAML', entityId: SAML_IDP, ssoUrl: `${issuer}/saml/sso`, certificate: 'not a certificate',
  }, A.token)
  check('a certificate that is not one is refused', r.status === 400, `(${r.status})`)
  r = await api('POST', '/admin/sso', {
    kind: 'saml', name: 'School SAML', entityId: SAML_IDP, ssoUrl: `${issuer}/saml/sso`,
    certificate: pem(samlKey.publicKey, 'spki'), emailDomains: ['e2e.test'],
  }, A.token)
  check("A's administrator adds a SAML provider", r.status === 201 && r.body.provider?.kind === 'saml', `(${r.status} ${JSON.stringify(r.body)})`)
  const pid: string = r.body.provider?.id
  const meta = await fetch(API + '/auth/sso/saml/metadata').then((x) => x.text())
  check('the service provider publishes its metadata', /AssertionConsumerService/.test(meta) && /WantAssertionsSigned="true"/.test(meta))

  console.log('-- SAML: signing in --')
  const ok = await samlSignIn(pid, {})
  check('the browser is sent to the provider with an AuthnRequest and a RelayState',
    ok.start.status === 302 && !!ok.id && ok.relay.length >= 40, ok.start.location.slice(0, 120))
  check('a signed assertion brings it back with a one-time code', ok.status === 302 && !!handoffOf(ok.location), ok.location)
  const done = await api('POST', '/auth/sso/complete', { code: handoffOf(ok.location) })
  check('which becomes a session for the person named', done.status === 200 && done.body.user?.email === 'fac.a@e2e.test', `(${done.status})`)
  const replay = await fetch(API + '/auth/sso/saml/acs', {
    method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: ok.form,
  })
  check('the same answer posted again is refused', errorOf(replay.headers.get('location') ?? '') === 'expired', replay.headers.get('location') ?? '')

  console.log('-- SAML: what the API must refuse --')
  const other = await samlSignIn(pid, {})
  const cases: Array<[string, SamlMode, string]> = [
    ['an assertion signed by another key', { key: 'rogue' }, 'provider_refused'],
    ['an unsigned assertion', { unsigned: true }, 'provider_refused'],
    ["a signed assertion edited afterwards (to school A's administrator)", { editAfterSigning: 'admin.a@e2e.test' }, 'provider_refused'],
    ['an assertion for another service provider', { audience: 'https://elsewhere.example/sp' }, 'provider_refused'],
    ['an answer to another sign-in request', { inResponseTo: other.id }, 'provider_refused'],
    ['an expired assertion', { expired: true }, 'provider_refused'],
    ['an assertion from another issuer', { issuer: 'https://evil.example/idp' }, 'provider_refused'],
    ["school B's administrator, through school A's provider", { email: 'admin.b@e2e.test' }, 'no_account'],
    ['an address outside the allowed domains', { email: 'x@elsewhere.test' }, 'wrong_domain'],
  ]
  for (const [name, m, want] of cases) {
    const x = await samlSignIn(pid, m)
    check(`${name}: refused (${want})`, errorOf(x.location) === want && !handoffOf(x.location), x.location)
  }
  await api('DELETE', `/admin/sso/${pid}`, undefined, A.token)
}

main()
  .then(saml)
  .catch((e) => { fail++; console.error(e) })
  .finally(() => {
    idp.close()
    console.log(`\n${pass} passed, ${fail} failed`)
    process.exit(fail ? 1 : 0)
  })
