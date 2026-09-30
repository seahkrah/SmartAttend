import crypto from 'crypto'

/**
 * Two-factor sign-in: time-based one-time passwords (TOTP, RFC 6238), the
 * scheme every authenticator app speaks — Google Authenticator, Microsoft
 * Authenticator, 1Password, Authy, Bitwarden.
 *
 * SHA-1, 6 digits, 30-second steps: the defaults every app assumes when a QR
 * code does not say otherwise. One step either side is accepted, for a phone
 * clock that has drifted; a step once accepted is never accepted again.
 *
 * Written against Node's crypto rather than a package: the algorithm is thirty
 * lines, and the code that decides who signs in is the last place to add a
 * dependency.
 */

export const TOTP = { digits: 6, period: 30, window: 1 } as const
export const ISSUER = 'JJELOTECH SYSTEMS'
export const RECOVERY_CODE_COUNT = 10
export const CHALLENGE_TTL_MINUTES = 5
export const CHALLENGE_MAX_ATTEMPTS = 5

// ---------------------------------------------------------------- base32

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = ''
  for (const byte of buf) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31]
  return out
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=-]/g, '')
  let bits = 0, value = 0
  const out: number[] = []
  for (const ch of clean) {
    const i = B32.indexOf(ch)
    if (i < 0) throw new Error('Not base32')
    value = (value << 5) | i
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

// ---------------------------------------------------------------- TOTP

/** The code for one 30-second step (RFC 4226 HOTP over the step counter). */
export function hotp(secret: Buffer, counter: number): string {
  const msg = Buffer.alloc(8)
  msg.writeBigUInt64BE(BigInt(counter))
  const mac = crypto.createHmac('sha1', secret).update(msg).digest()
  const offset = mac[mac.length - 1] & 0x0f
  const bin = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3]
  return String(bin % 10 ** TOTP.digits).padStart(TOTP.digits, '0')
}

export function currentStep(now = Date.now()): number {
  return Math.floor(now / 1000 / TOTP.period)
}

/**
 * The step a code belongs to, or null. Refuses a step at or before
 * `lastUsedStep`, so a code seen over someone's shoulder cannot be replayed
 * within its 90-second life.
 */
export function verifyTotp(secret: Buffer, code: string, lastUsedStep: number | null, now = Date.now()): number | null {
  const digits = String(code ?? '').replace(/\s/g, '')
  if (!/^\d{6}$/.test(digits)) return null
  const step = currentStep(now)
  for (let d = -TOTP.window; d <= TOTP.window; d++) {
    const s = step + d
    if (lastUsedStep !== null && s <= lastUsedStep) continue
    const expected = hotp(secret, s)
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(digits))) return s
  }
  return null
}

export function newSecret(): Buffer {
  return crypto.randomBytes(20) // 160 bits, as RFC 4226 recommends
}

/** The otpauth:// URI an authenticator app reads from the QR code. */
export function otpauthUri(secretB32: string, account: string): string {
  const label = encodeURIComponent(`${ISSUER}:${account}`)
  const params = new URLSearchParams({
    secret: secretB32, issuer: ISSUER, algorithm: 'SHA1', digits: String(TOTP.digits), period: String(TOTP.period),
  })
  return `otpauth://totp/${label}?${params.toString()}`
}

// ---------------------------------------------------------------- secrets at rest

/**
 * The key that seals authenticator secrets. MFA_ENCRYPTION_KEY (32 bytes,
 * base64) is the one to set; without it a key is derived from JWT_SECRET, so a
 * development machine works out of the box — but then rotating JWT_SECRET
 * would orphan every enrolled authenticator, which is why production should
 * set its own (validateEnv warns).
 */
function sealingKey(): Buffer {
  const configured = process.env.MFA_ENCRYPTION_KEY
  if (configured) {
    const key = Buffer.from(configured, 'base64')
    if (key.length !== 32) throw new Error('MFA_ENCRYPTION_KEY must be 32 bytes, base64-encoded')
    return key
  }
  const base = process.env.JWT_SECRET
  if (!base) throw new Error('Neither MFA_ENCRYPTION_KEY nor JWT_SECRET is set')
  return Buffer.from(crypto.hkdfSync('sha256', base, 'jjelotech', 'mfa-secret-v1', 32))
}

export function sealSecret(secret: Buffer, userId: string): { ciphertext: string; iv: string; tag: string } {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', sealingKey(), iv)
  // Bound to the user: a sealed secret copied onto another account's row
  // does not open.
  cipher.setAAD(Buffer.from(`mfa:${userId}`))
  const ciphertext = Buffer.concat([cipher.update(secret), cipher.final()])
  return { ciphertext: ciphertext.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64') }
}

export function openSecret(row: { secret_ciphertext: string; secret_iv: string; secret_tag: string }, userId: string): Buffer {
  const decipher = crypto.createDecipheriv('aes-256-gcm', sealingKey(), Buffer.from(row.secret_iv, 'base64'))
  decipher.setAAD(Buffer.from(`mfa:${userId}`))
  decipher.setAuthTag(Buffer.from(row.secret_tag, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(row.secret_ciphertext, 'base64')), decipher.final()])
}

// ---------------------------------------------------------------- recovery codes

/** Ten codes like 'K7QX-M2PD', each 40 bits, from an unambiguous alphabet. */
export function newRecoveryCodes(): string[] {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const bytes = crypto.randomBytes(8)
    const s = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')
    return `${s.slice(0, 4)}-${s.slice(4, 8)}`
  })
}

/** Codes are high-entropy random strings, so a plain SHA-256 is the right hash. */
export function hashRecoveryCode(code: string): string {
  return crypto.createHash('sha256').update(String(code).toUpperCase().replace(/[^A-Z0-9]/g, '')).digest('hex')
}

export function hashChallengeToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

// ---------------------------------------------------------------- policy

/**
 * Roles that must use two-factor sign-in. MFA_REQUIRED_ROLES is a comma list
 * ('superadmin,admin'); unset, it is 'superadmin,admin' in production and
 * nobody elsewhere, so development and the test suites are not blocked.
 */
export function requiredRoles(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const raw = env.MFA_REQUIRED_ROLES ?? (env.NODE_ENV === 'production' ? 'superadmin,admin' : '')
  return new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))
}

/** Paths a person who must set up two-factor may still reach to do it. */
export function allowedDuringSetup(path: string): boolean {
  return /^\/api\/auth\/(me|logout|mfa(\/.*)?|sessions(\/.*)?|change-password)$/.test(path)
}
