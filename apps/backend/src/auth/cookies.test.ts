import { describe, expect, it, beforeAll } from 'vitest'
import type { Request } from 'express'
import { cookiesOf, cookiesSecure, csrfProblem, csrfTokenFor, csrfTokenMatches } from './cookies.js'

beforeAll(() => {
  process.env.CSRF_SECRET = 'unit-test-csrf-secret-unit-test-csrf-secret'
})

const SID = '0b8e6a3e-6f5c-4c39-9d7a-7d3c1f0e2a11'
const req = (over: Partial<{ method: string; headers: Record<string, string> }>) =>
  ({ method: over.method ?? 'POST', headers: over.headers ?? {} }) as unknown as Request
const ALLOWED = new Set(['http://localhost:5173'])

describe('CSRF token', () => {
  it('is the same for a session every time, and differs between sessions', () => {
    expect(csrfTokenFor(SID)).toBe(csrfTokenFor(SID))
    expect(csrfTokenFor(SID)).not.toBe(csrfTokenFor('1b8e6a3e-6f5c-4c39-9d7a-7d3c1f0e2a11'))
  })
  it('matches only itself', () => {
    const t = csrfTokenFor(SID)
    expect(csrfTokenMatches(SID, t)).toBe(true)
    expect(csrfTokenMatches(SID, t.slice(0, -1) + (t.endsWith('A') ? 'B' : 'A'))).toBe(false)
    expect(csrfTokenMatches(SID, '')).toBe(false)
    expect(csrfTokenMatches(SID, undefined)).toBe(false)
    expect(csrfTokenMatches(SID, ['x'])).toBe(false)
    expect(csrfTokenMatches(SID, 'x'.repeat(500))).toBe(false)
  })
  it('depends on the secret', () => {
    const before = csrfTokenFor(SID)
    process.env.CSRF_SECRET = 'another-secret-another-secret-another'
    expect(csrfTokenFor(SID)).not.toBe(before)
    process.env.CSRF_SECRET = 'unit-test-csrf-secret-unit-test-csrf-secret'
  })
})

describe('csrfProblem', () => {
  const good = { 'x-csrf-token': '' }
  it('lets reads through without a token', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) expect(csrfProblem(req({ method }), SID, ALLOWED)).toBeNull()
  })
  it('refuses a write without the token, or with another session\'s', () => {
    expect(csrfProblem(req({}), SID, ALLOWED)).toMatch(/CSRF/)
    expect(csrfProblem(req({ headers: { 'x-csrf-token': csrfTokenFor('other') } }), SID, ALLOWED)).toMatch(/CSRF/)
  })
  it('allows a write with it', () => {
    good['x-csrf-token'] = csrfTokenFor(SID)
    expect(csrfProblem(req({ headers: good }), SID, ALLOWED)).toBeNull()
    expect(csrfProblem(req({ method: 'DELETE', headers: { ...good, origin: 'http://localhost:5173/' } }), SID, ALLOWED)).toBeNull()
  })
  it('refuses a disallowed origin even with the token', () => {
    expect(csrfProblem(req({ headers: { ...good, origin: 'https://evil.example' } }), SID, ALLOWED)).toMatch(/origin/)
  })
})

describe('cookiesOf', () => {
  it('parses, decodes, keeps the first of a repeated name and skips junk', () => {
    const r = req({ headers: { cookie: 'a=1; jj_at=x%2By; a=2; junk; =v; bad=%E0%A4%A' } })
    expect(cookiesOf(r)).toEqual({ a: '1', jj_at: 'x+y' })
  })
  it('is empty without a header', () => {
    expect(cookiesOf(req({}))).toEqual({})
  })
})

describe('cookiesSecure', () => {
  it('is on in production and cannot be turned off there', () => {
    expect(cookiesSecure({ NODE_ENV: 'production' })).toBe(true)
    expect(cookiesSecure({ NODE_ENV: 'production', COOKIE_SECURE: 'false' })).toBe(true)
  })
  it('is off in development unless asked for', () => {
    expect(cookiesSecure({ NODE_ENV: 'development' })).toBe(false)
    expect(cookiesSecure({ NODE_ENV: 'development', COOKIE_SECURE: 'true' })).toBe(true)
  })
})
