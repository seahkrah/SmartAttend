/**
 * Passkeys end to end, with a software authenticator.
 *
 * The authenticator below does what a phone or security key does: it makes
 * an ES256 key pair, answers registration with a "none" attestation, and
 * signs assertions over the authenticator data and the client data hash,
 * with the user-verified flag set and a counter that goes up. The API checks
 * all of it with @simplewebauthn/server.
 *
 * Suite "webauthn" in scripts/run-all-e2e.sh. Needs the e2e seed and the API.
 */
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import pg from 'pg'

const API = (process.env.API_BASE ?? 'http://127.0.0.1:5000') + '/api'
const ORIGIN = 'http://localhost:5173'
const RP_ID = 'localhost'
const PASSWORD = 'Passw0rd!x'
const dir = process.env.E2E_FIXTURE_DIR ?? path.join(process.cwd(), '.e2e-fixtures')
JSON.parse(fs.readFileSync(path.join(dir, 'seed.json'), 'utf8'))

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  ok    ${name}`) } else { fail++; console.log(`  FAIL  ${name} ${detail}`) }
}

async function owner(sql: string, params: unknown[] = []) {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await c.connect()
  try { return await c.query(sql, params) } finally { await c.end() }
}

async function call(method: string, p: string, body?: unknown, token?: string) {
  const res = await fetch(API + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let json: any = text
  try { json = JSON.parse(text) } catch { /* not JSON */ }
  return { status: res.status, body: json }
}

// ── A minimal CBOR encoder: maps, byte and text strings, small integers ─────
function cbor(v: unknown): Buffer {
  const head = (major: number, n: number) => {
    if (n < 24) return Buffer.from([(major << 5) | n])
    if (n < 256) return Buffer.from([(major << 5) | 24, n])
    if (n < 65536) return Buffer.from([(major << 5) | 25, n >> 8, n & 255])
    throw new Error('too long')
  }
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v)
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v])
  if (typeof v === 'string') { const b = Buffer.from(v, 'utf8'); return Buffer.concat([head(3, b.length), b]) }
  if (v instanceof Map) {
    return Buffer.concat([head(5, v.size), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)])])
  }
  throw new Error('unsupported CBOR value')
}

const b64u = (b: Buffer) => b.toString('base64url')
const sha256 = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest()

class Authenticator {
  readonly credentialId = crypto.randomBytes(16)
  private readonly keys = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
  counter = 0
  userHandle: Buffer | null = null

  private cosePublicKey(): Buffer {
    const jwk = this.keys.publicKey.export({ format: 'jwk' }) as { x: string; y: string }
    return cbor(new Map<number, unknown>([
      [1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')],
    ]))
  }

  private authData(flags: number, attested?: Buffer, rpId = RP_ID): Buffer {
    const count = Buffer.alloc(4)
    count.writeUInt32BE(this.counter)
    return Buffer.concat([sha256(rpId), Buffer.from([flags]), count, ...(attested ? [attested] : [])])
  }

  register(options: any, over: { origin?: string; rpId?: string; uv?: boolean; challenge?: string } = {}) {
    this.userHandle = Buffer.from(options.user.id, 'base64url')
    const clientData = Buffer.from(JSON.stringify({
      type: 'webauthn.create', challenge: over.challenge ?? options.challenge, origin: over.origin ?? ORIGIN, crossOrigin: false,
    }))
    const idLen = Buffer.alloc(2)
    idLen.writeUInt16BE(this.credentialId.length)
    const attested = Buffer.concat([Buffer.alloc(16), idLen, this.credentialId, this.cosePublicKey()])
    // UP (0x01), UV (0x04) unless told otherwise, AT (0x40).
    const flags = 0x01 | (over.uv === false ? 0 : 0x04) | 0x40
    const attestationObject = cbor(new Map<string, unknown>([
      ['fmt', 'none'], ['attStmt', new Map()], ['authData', this.authData(flags, attested, over.rpId)],
    ]))
    return {
      id: b64u(this.credentialId), rawId: b64u(this.credentialId), type: 'public-key',
      response: { clientDataJSON: b64u(clientData), attestationObject: b64u(attestationObject), transports: ['internal'] },
      clientExtensionResults: {},
    }
  }

  assert(challenge: string, over: { origin?: string; uv?: boolean; keepCounter?: boolean; signWith?: crypto.KeyObject } = {}) {
    if (!over.keepCounter) this.counter++
    const clientData = Buffer.from(JSON.stringify({
      type: 'webauthn.get', challenge, origin: over.origin ?? ORIGIN, crossOrigin: false,
    }))
    const authData = this.authData(0x01 | (over.uv === false ? 0 : 0x04))
    const signature = crypto.sign('sha256', Buffer.concat([authData, sha256(clientData)]), over.signWith ?? this.keys.privateKey)
    return {
      id: b64u(this.credentialId), rawId: b64u(this.credentialId), type: 'public-key',
      response: {
        clientDataJSON: b64u(clientData), authenticatorData: b64u(authData), signature: b64u(signature),
        userHandle: this.userHandle ? b64u(this.userHandle) : undefined,
      },
      clientExtensionResults: {},
    }
  }
}

async function signIn(email: string) {
  const r = await call('POST', '/auth/login', { platform: 'school', email, password: PASSWORD })
  if (r.status !== 200) throw new Error(`sign-in ${email}: ${r.status} ${JSON.stringify(r.body)}`)
  return r.body.accessToken as string
}

async function main() {
  const email = 'stu1.a@e2e.test'
  await owner(`DELETE FROM webauthn_credentials WHERE user_id = (SELECT id FROM users WHERE email = $1)`, [email])
  const token = await signIn(email)

  console.log('-- registering a passkey --')
  let r = await call('POST', '/auth/passkeys/register/options', {})
  check('needs a session', r.status === 401, `(${r.status})`)
  r = await call('POST', '/auth/passkeys/register/options', {}, token)
  check('options for a signed-in person', r.status === 200 && !!r.body.challenge, `(${r.status} ${JSON.stringify(r.body).slice(0, 120)})`)
  check('for this site', r.body.rp?.id === RP_ID, JSON.stringify(r.body.rp))
  check('requiring user verification and a discoverable key',
    r.body.authenticatorSelection?.userVerification === 'required' && r.body.authenticatorSelection?.residentKey === 'required')
  const uid = (await owner(`SELECT id FROM users WHERE email = $1`, [email])).rows[0].id as string
  check('the user handle is the account id, not the email',
    Buffer.from(r.body.user.id, 'base64url').toString('hex') === uid.replace(/-/g, ''))

  const auth = new Authenticator()
  const wrongOrigin = await call('POST', '/auth/passkeys/register/verify', { response: auth.register(r.body, { origin: 'https://evil.example' }) }, token)
  check('an answer made for another origin is refused', wrongOrigin.status === 400, `(${wrongOrigin.status})`)
  const replay = await call('POST', '/auth/passkeys/register/verify', { response: auth.register(r.body) }, token)
  check('and its challenge is spent: the same challenge again is refused', replay.status === 400, `(${replay.status})`)

  r = await call('POST', '/auth/passkeys/register/options', {}, token)
  const noUv = await call('POST', '/auth/passkeys/register/verify', { response: auth.register(r.body, { uv: false }) }, token)
  check('a passkey without user verification is refused', noUv.status === 400, `(${noUv.status})`)
  r = await call('POST', '/auth/passkeys/register/options', {}, token)
  const otherRp = await call('POST', '/auth/passkeys/register/verify', { response: auth.register(r.body, { rpId: 'evil.example' }) }, token)
  check('a passkey for another site is refused', otherRp.status === 400, `(${otherRp.status})`)

  r = await call('POST', '/auth/passkeys/register/options', {}, token)
  const ok = await call('POST', '/auth/passkeys/register/verify', { response: auth.register(r.body), name: 'Test phone' }, token)
  check('a proper answer registers the passkey', ok.status === 201 && ok.body.passkey?.name === 'Test phone', `(${ok.status} ${JSON.stringify(ok.body)})`)
  const listed = await call('GET', '/auth/passkeys', undefined, token)
  check('it is listed', listed.status === 200 && listed.body.passkeys?.length === 1, JSON.stringify(listed.body))
  check('the list holds no key material', !/public|credential_id|BEGIN/i.test(JSON.stringify(listed.body)))
  r = await call('POST', '/auth/passkeys/register/options', {}, token)
  check('registering again excludes it', r.body.excludeCredentials?.some((c: any) => c.id === b64u(auth.credentialId)))

  console.log('-- signing in with it --')
  let o = await call('POST', '/auth/passkeys/sign-in/options', {})
  check('sign-in options need no account named', o.status === 200 && !!o.body.challengeId && !o.body.options.allowCredentials?.length,
    JSON.stringify(o.body).slice(0, 160))
  let v = await call('POST', '/auth/passkeys/sign-in/verify', { challengeId: o.body.challengeId, response: auth.assert(o.body.options.challenge) })
  check('signs in', v.status === 200 && !!v.body.accessToken, `(${v.status} ${JSON.stringify(v.body).slice(0, 160)})`)
  check('as the right person', v.body.user?.email === email)
  const accepted = auth.counter
  const me = await call('GET', '/auth/me', undefined, v.body.accessToken)
  check('the session works', me.status === 200 && me.body.user?.email === email, `(${me.status})`)
  const spent = await call('POST', '/auth/passkeys/sign-in/verify', { challengeId: o.body.challengeId, response: auth.assert(o.body.options.challenge) })
  check('the same challenge cannot be used twice', spent.status === 400, `(${spent.status})`)

  o = await call('POST', '/auth/passkeys/sign-in/options', {})
  const thief = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey
  v = await call('POST', '/auth/passkeys/sign-in/verify', { challengeId: o.body.challengeId, response: auth.assert(o.body.options.challenge, { signWith: thief }) })
  check('a signature by another key is refused', v.status === 401, `(${v.status})`)
  // A copy of the key would sign with the counter the server last accepted.
  auth.counter = accepted
  o = await call('POST', '/auth/passkeys/sign-in/options', {})
  v = await call('POST', '/auth/passkeys/sign-in/verify', { challengeId: o.body.challengeId, response: auth.assert(o.body.options.challenge, { keepCounter: true }) })
  check('a counter that did not go up (a cloned key) is refused', v.status === 401, `(${v.status})`)
  auth.counter = accepted + 10
  o = await call('POST', '/auth/passkeys/sign-in/options', {})
  v = await call('POST', '/auth/passkeys/sign-in/verify', { challengeId: o.body.challengeId, response: auth.assert(o.body.options.challenge, { uv: false }) })
  check('an assertion without user verification is refused', v.status === 401, `(${v.status})`)
  o = await call('POST', '/auth/passkeys/sign-in/options', {})
  v = await call('POST', '/auth/passkeys/sign-in/verify', { challengeId: o.body.challengeId, response: auth.assert(o.body.options.challenge, { origin: 'https://evil.example' }) })
  check('an assertion made on another origin is refused (phishing)', v.status === 401, `(${v.status})`)
  o = await call('POST', '/auth/passkeys/sign-in/options', {})
  v = await call('POST', '/auth/passkeys/sign-in/verify', { challengeId: o.body.challengeId, response: new Authenticator().assert(o.body.options.challenge) })
  check('an unknown passkey is refused', v.status === 401, `(${v.status})`)
  v = await call('POST', '/auth/passkeys/sign-in/verify', { challengeId: 'not-a-challenge', response: {} })
  check('a malformed request is refused', v.status === 400, `(${v.status})`)

  await owner(`UPDATE users SET is_active = FALSE WHERE email = $1`, [email])
  o = await call('POST', '/auth/passkeys/sign-in/options', {})
  v = await call('POST', '/auth/passkeys/sign-in/verify', { challengeId: o.body.challengeId, response: auth.assert(o.body.options.challenge) })
  check('a suspended account cannot sign in with its passkey', v.status === 403, `(${v.status} ${JSON.stringify(v.body)})`)
  await owner(`UPDATE users SET is_active = TRUE WHERE email = $1`, [email])

  console.log('-- step-up with it --')
  const sid = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sid
  await owner(`UPDATE auth_sessions SET authenticated_at = CURRENT_TIMESTAMP - INTERVAL '1 day' WHERE id = $1`, [sid])
  const del = await call('DELETE', `/auth/passkeys/${ok.body.passkey.id}`, undefined, token)
  check('removing a passkey from an aged session needs step-up', del.status === 403 && del.body.code === 'STEP_UP_REQUIRED', `(${del.status})`)
  let s = await call('POST', '/auth/passkeys/step-up/options', {}, token)
  check('step-up options name only this person\'s passkeys', s.status === 200 && s.body.allowCredentials?.length === 1, JSON.stringify(s.body).slice(0, 160))
  let sv = await call('POST', '/auth/passkeys/step-up/verify', { response: auth.assert(s.body.challenge, { signWith: thief }) }, token)
  check('a wrong signature does not step up', sv.status === 403 && sv.body.code === 'STEP_UP_FAILED', `(${sv.status})`)
  s = await call('POST', '/auth/passkeys/step-up/options', {}, token)
  sv = await call('POST', '/auth/passkeys/step-up/verify', { response: auth.assert(s.body.challenge) }, token)
  check('the passkey steps up', sv.status === 200 && sv.body.steppedUp === true, `(${sv.status} ${JSON.stringify(sv.body)})`)

  console.log('-- someone else\'s passkey --')
  const other = await signIn('stu2.a@e2e.test')
  const theirs = await call('GET', '/auth/passkeys', undefined, other)
  check('another person does not see it', theirs.status === 200 && theirs.body.passkeys.length === 0, JSON.stringify(theirs.body))
  const theirsDel = await call('DELETE', `/auth/passkeys/${ok.body.passkey.id}`, undefined, other)
  check('and cannot remove it', theirsDel.status === 404, `(${theirsDel.status})`)
  const sOther = await call('POST', '/auth/passkeys/step-up/options', {}, other)
  check('nor step up with it', sOther.status === 400, `(${sOther.status})`)

  console.log('-- removing it --')
  const gone = await call('DELETE', `/auth/passkeys/${ok.body.passkey.id}`, undefined, token)
  check('the owner removes it after stepping up', gone.status === 200, `(${gone.status})`)
  o = await call('POST', '/auth/passkeys/sign-in/options', {})
  v = await call('POST', '/auth/passkeys/sign-in/verify', { challengeId: o.body.challengeId, response: auth.assert(o.body.options.challenge) })
  check('a removed passkey no longer signs in', v.status === 401, `(${v.status})`)
}

main()
  .catch((e) => { fail++; console.error(e) })
  .finally(() => {
    console.log(`\n${pass} passed, ${fail} failed`)
    process.exit(fail ? 1 : 0)
  })
