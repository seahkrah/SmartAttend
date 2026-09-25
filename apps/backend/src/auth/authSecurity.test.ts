import { describe, it, expect } from 'vitest'
import express from 'express'
import type { AddressInfo } from 'net'
import { checkPassword, PASSWORD_MIN } from './passwordPolicy.js'
import { configProblems } from '../config/validateEnv.js'
import { limiter, allowedOrigins, trustProxySetting } from '../security/httpSecurity.js'
import { hashToken } from './sessions.js'

describe('password policy', () => {
  it('accepts a long passphrase with no composition rules', () => {
    expect(checkPassword('correct horse battery staple')).toEqual([])
  })
  it(`refuses anything shorter than ${PASSWORD_MIN} characters`, () => {
    expect(checkPassword('Ab1!xyz')).toContain(`Use at least ${PASSWORD_MIN} characters`)
  })
  it('refuses common passwords, including with punctuation added', () => {
    expect(checkPassword('password123').length).toBeGreaterThan(0)
    expect(checkPassword('Password123!').some(p => p.includes('commonly used'))).toBe(true)
    expect(checkPassword('1234567890').some(p => p.includes('commonly used'))).toBe(true)
  })
  it('refuses a password containing the email name', () => {
    expect(checkPassword('kwame.mensah-2026', { email: 'kwame.mensah@school.edu.gh' }))
      .toContain('Do not include your email name in your password')
  })
  it('refuses one character repeated', () => {
    expect(checkPassword('zzzzzzzzzzzz')).toContain('Do not repeat a single character')
  })
  it("refuses passwords built from the system's own name", () => {
    expect(checkPassword('jjelotech123')).toContain('Do not build your password from the name of this system')
    expect(checkPassword('Smart-Attend-2026!')).toContain('Do not build your password from the name of this system')
  })
  it('refuses a non-string', () => {
    expect(checkPassword(undefined)).toEqual(['A password is required'])
    expect(checkPassword({ length: 20 })).toEqual(['A password is required'])
  })
  it('refuses more than 128 characters', () => {
    expect(checkPassword('a b'.repeat(50))).toContain('Use at most 128 characters')
  })
})

describe('production configuration', () => {
  const good = {
    NODE_ENV: 'production',
    JWT_SECRET: 'k'.repeat(20) + 'Q7v9Zr2mX4pL8sT1wY6n',
    DATABASE_URL: 'postgresql://app@db/app',
    PUBLIC_APP_URL: 'https://app.example.edu',
    CORS_ORIGINS: 'https://app.example.edu',
  }
  it('passes a complete configuration', () => {
    const saved = process.env.CORS_ORIGINS
    process.env.CORS_ORIGINS = good.CORS_ORIGINS
    try {
      expect(configProblems(good as any)).toEqual([])
    } finally {
      if (saved === undefined) delete process.env.CORS_ORIGINS
      else process.env.CORS_ORIGINS = saved
    }
  })
  it('refuses a placeholder or short secret', () => {
    expect(configProblems({ ...good, JWT_SECRET: 'change-me-change-me-change-me-change-me' } as any).join())
      .toMatch(/placeholder/)
    expect(configProblems({ ...good, JWT_SECRET: 'short' } as any).join()).toMatch(/shorter/)
    expect(configProblems({ ...good, JWT_SECRET: undefined } as any).join()).toMatch(/JWT_SECRET is not set/)
  })
  it('requires an https app URL for the links it emails', () => {
    expect(configProblems({ ...good, PUBLIC_APP_URL: 'http://app.example.edu' } as any).join())
      .toMatch(/https/)
  })
})

describe('CORS and proxy settings', () => {
  it('uses configured origins and ignores trailing slashes', () => {
    const saved = process.env.CORS_ORIGINS
    process.env.CORS_ORIGINS = 'https://a.example/, https://b.example'
    try {
      expect(allowedOrigins()).toEqual(['https://a.example', 'https://b.example'])
    } finally {
      if (saved === undefined) delete process.env.CORS_ORIGINS
      else process.env.CORS_ORIGINS = saved
    }
  })
  it('trusts no proxy unless told to', () => {
    const saved = process.env.TRUST_PROXY
    delete process.env.TRUST_PROXY
    expect(trustProxySetting()).toBe(false)
    process.env.TRUST_PROXY = '1'
    expect(trustProxySetting()).toBe(1)
    if (saved === undefined) delete process.env.TRUST_PROXY
    else process.env.TRUST_PROXY = saved
  })
})

describe('rate limiter', () => {
  it('answers 429 once the limit is spent, and says so in the standard headers', async () => {
    const app = express()
    app.use(limiter('probe', 3, 60_000, 'slow down'))
    app.get('/', (_req, res) => res.json({ ok: true }))
    const server = app.listen(0)
    try {
      const { port } = server.address() as AddressInfo
      const codes: number[] = []
      let last: Response | null = null
      for (let i = 0; i < 5; i++) {
        last = await fetch(`http://127.0.0.1:${port}/`)
        codes.push(last.status)
      }
      expect(codes).toEqual([200, 200, 200, 429, 429])
      expect(await last!.json()).toEqual({ error: 'slow down', code: 'RATE_LIMITED' })
      expect(last!.headers.get('ratelimit-policy')).toMatch(/"probe"; q=3/)
    } finally {
      server.close()
    }
  })
})

describe('token hashing', () => {
  it('stores a digest, not the token', () => {
    const h = hashToken('abc')
    expect(h).toMatch(/^[0-9a-f]{64}$/)
    expect(h).not.toContain('abc')
    expect(hashToken('abc')).toBe(h)
  })
})
