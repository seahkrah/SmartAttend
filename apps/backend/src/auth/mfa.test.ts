import { describe, it, expect } from 'vitest'
import {
  allowedDuringSetup, base32Decode, base32Encode, hashRecoveryCode, hotp, newRecoveryCodes, openSecret,
  otpauthUri, requiredRoles, sealSecret, verifyTotp,
} from './mfa.js'

// RFC 6238 appendix B: the SHA-1 test secret and its expected 8-digit codes;
// the last 6 digits are what a 6-digit authenticator shows.
const RFC_SECRET = Buffer.from('12345678901234567890')
const RFC_VECTORS: Array<[number, string]> = [
  [59, '94287082'],
  [1111111109, '07081804'],
  [1111111111, '14050471'],
  [1234567890, '89005924'],
  [2000000000, '69279037'],
  [20000000000, '65353130'],
]

describe('TOTP', () => {
  it('matches the RFC 6238 test vectors', () => {
    for (const [seconds, code] of RFC_VECTORS) {
      expect(hotp(RFC_SECRET, Math.floor(seconds / 30))).toBe(code.slice(-6))
    }
  })

  it('accepts one step either side and nothing further', () => {
    const now = 1_700_000_000_000
    const step = Math.floor(now / 30_000)
    for (const d of [-1, 0, 1]) {
      expect(verifyTotp(RFC_SECRET, hotp(RFC_SECRET, step + d), null, now)).toBe(step + d)
    }
    for (const d of [-2, 2]) {
      expect(verifyTotp(RFC_SECRET, hotp(RFC_SECRET, step + d), null, now)).toBeNull()
    }
  })

  it('refuses a step already used, and any before it', () => {
    const now = 1_700_000_000_000
    const step = Math.floor(now / 30_000)
    expect(verifyTotp(RFC_SECRET, hotp(RFC_SECRET, step), step, now)).toBeNull()
    expect(verifyTotp(RFC_SECRET, hotp(RFC_SECRET, step - 1), step, now)).toBeNull()
    expect(verifyTotp(RFC_SECRET, hotp(RFC_SECRET, step + 1), step, now)).toBe(step + 1)
  })

  it('refuses anything that is not six digits', () => {
    for (const bad of ['', '12345', '1234567', 'abcdef', '12 34 5']) {
      expect(verifyTotp(RFC_SECRET, bad, null)).toBeNull()
    }
  })
})

describe('base32', () => {
  it('round-trips and matches RFC 4648', () => {
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI')
    expect(base32Decode('MZXW6YTBOI').toString()).toBe('foobar')
    expect(base32Decode('mzxw 6ytb oi').toString()).toBe('foobar')
  })
})

describe('secrets at rest', () => {
  process.env.JWT_SECRET ??= 'unit-test-secret'

  it('opens only for the account it was sealed for', () => {
    const secret = Buffer.from('0123456789abcdefghij')
    const s = sealSecret(secret, 'user-a')
    const row = { secret_ciphertext: s.ciphertext, secret_iv: s.iv, secret_tag: s.tag }
    expect(openSecret(row, 'user-a').equals(secret)).toBe(true)
    expect(() => openSecret(row, 'user-b')).toThrow()
  })
})

describe('recovery codes', () => {
  it('are ten distinct codes, and hash the same however they are typed', () => {
    const codes = newRecoveryCodes()
    expect(codes).toHaveLength(10)
    expect(new Set(codes).size).toBe(10)
    for (const c of codes) expect(c).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/)
    expect(hashRecoveryCode(codes[0].toLowerCase().replace('-', ' '))).toBe(hashRecoveryCode(codes[0]))
  })
})

describe('policy', () => {
  it('requires admins and superadmins in production by default, nobody elsewhere', () => {
    expect([...requiredRoles({ NODE_ENV: 'production' } as any)].sort()).toEqual(['admin', 'superadmin'])
    expect(requiredRoles({ NODE_ENV: 'development' } as any).size).toBe(0)
    expect([...requiredRoles({ NODE_ENV: 'production', MFA_REQUIRED_ROLES: 'superadmin' } as any)]).toEqual(['superadmin'])
    expect(requiredRoles({ NODE_ENV: 'production', MFA_REQUIRED_ROLES: '' } as any).size).toBe(0)
  })

  it('leaves only the setup paths open to someone who must set it up', () => {
    for (const ok of ['/api/auth/me', '/api/auth/logout', '/api/auth/mfa', '/api/auth/mfa/setup', '/api/auth/sessions/abc']) {
      expect(allowedDuringSetup(ok)).toBe(true)
    }
    for (const no of ['/api/auth/admin/school/students', '/api/superadmin/tenants', '/api/auth/mfa-x', '/api/auth/me/../x']) {
      expect(allowedDuringSetup(no)).toBe(false)
    }
  })

  it('builds an otpauth URI authenticator apps read', () => {
    const uri = otpauthUri('MZXW6YTBOI', 'root@example.com')
    expect(uri.startsWith('otpauth://totp/JJELOTECH%20SYSTEMS%3Aroot%40example.com?')).toBe(true)
    expect(uri).toContain('secret=MZXW6YTBOI')
    expect(uri).toContain('issuer=JJELOTECH+SYSTEMS')
  })
})
