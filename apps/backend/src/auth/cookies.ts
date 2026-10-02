/**
 * Browser sessions in cookies.
 *
 * The browser app never holds a token. Signing in with `X-Auth-Transport:
 * cookie` sets two cookies the page's scripts cannot read (httpOnly):
 *
 *   jj_at  the 15-minute access token, sent to /api
 *   jj_rt  the refresh token, sent only to /api/auth (refresh, sign-out)
 *
 * Both are SameSite=Strict, so another site's page cannot make the browser
 * send them, and Secure wherever the API is served over HTTPS.
 *
 * SameSite is not the whole defence: a sibling subdomain counts as the same
 * site. So a state-changing request authenticated by cookie must also carry
 * X-CSRF-Token, an HMAC of its session id that the app receives when it signs
 * in (or from GET /api/auth/csrf) and keeps in memory. A forged request
 * cannot know it, and cannot read it: CORS lets only the allowed origins
 * read API answers. Its Origin, when the browser sends one, must be allowed.
 *
 * API clients (scripts, kiosks, tests) keep using `Authorization: Bearer`.
 * The browser never attaches that header by itself, so it needs no CSRF token.
 */
import crypto from 'crypto'
import type { CookieOptions, Request, Response } from 'express'
import { SESSION_LIFETIME_DAYS } from './sessions.js'

export const ACCESS_COOKIE = 'jj_at'
export const REFRESH_COOKIE = 'jj_rt'
const ACCESS_MAX_AGE_MS = 15 * 60_000

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

function secret(): string {
  const s = process.env.CSRF_SECRET || process.env.JWT_SECRET
  if (!s) throw new Error('[SECURITY] CSRF_SECRET (or JWT_SECRET) is required')
  return s
}

/** Secure unless explicitly turned off, which only local development over plain HTTP needs. */
export function cookiesSecure(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.COOKIE_SECURE === 'false') return env.NODE_ENV === 'production'
  if (env.COOKIE_SECURE === 'true') return true
  return env.NODE_ENV === 'production'
}

function base(): CookieOptions {
  return { httpOnly: true, secure: cookiesSecure(), sameSite: 'strict' }
}

/** Whether the client asked for a cookie session (the browser app does). */
export function wantsCookies(req: Request): boolean {
  return String(req.headers['x-auth-transport'] ?? '').toLowerCase() === 'cookie'
}

export function csrfTokenFor(sessionId: string): string {
  return crypto.createHmac('sha256', secret()).update(`csrf:${sessionId}`).digest('base64url')
}

export function csrfTokenMatches(sessionId: string, presented: unknown): boolean {
  if (typeof presented !== 'string' || presented.length > 100) return false
  const want = Buffer.from(csrfTokenFor(sessionId))
  const got = Buffer.from(presented)
  return want.length === got.length && crypto.timingSafeEqual(want, got)
}

/** Replaces only the access token, e.g. when two-factor is turned on mid-session. */
export function setAccessCookie(res: Response, accessToken: string): void {
  res.cookie(ACCESS_COOKIE, accessToken, { ...base(), path: '/api', maxAge: ACCESS_MAX_AGE_MS })
}

/** Sets the session cookies and answers what the app may hold instead of tokens. */
export function setSessionCookies(
  res: Response,
  tokens: { accessToken: string; refreshToken: string; sessionId: string }
): { csrfToken: string } {
  setAccessCookie(res, tokens.accessToken)
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
    ...base(), path: '/api/auth', maxAge: SESSION_LIFETIME_DAYS * 24 * 3600_000,
  })
  return { csrfToken: csrfTokenFor(tokens.sessionId) }
}

/**
 * A finished sign-in's tokens, delivered as the client asked: in cookies the
 * page cannot read (the browser app, `X-Auth-Transport: cookie`), or in the
 * body for API clients. Spread the result into the response.
 */
export function deliverTokens(
  req: Request,
  res: Response,
  tokens: { accessToken: string; refreshToken: string; sessionId: string }
): Record<string, string> {
  if (wantsCookies(req)) return setSessionCookies(res, tokens)
  return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken }
}

export function clearSessionCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE, { ...base(), path: '/api' })
  res.clearCookie(REFRESH_COOKIE, { ...base(), path: '/api/auth' })
}

/** The request's cookies, parsed. Express has no parser by default. */
export function cookiesOf(req: Request): Record<string, string> {
  const out: Record<string, string> = {}
  const raw = req.headers.cookie
  if (!raw) return out
  for (const piece of raw.split(';')) {
    const part = piece.trim()
    const i = part.indexOf('=')
    if (i < 1) continue
    const k = part.slice(0, i).trim()
    if (!k) continue
    if (k in out) continue // the first one wins, as browsers send the most specific first
    try {
      out[k] = decodeURIComponent(part.slice(i + 1).trim())
    } catch {
      // A malformed value is ignored rather than trusted half-decoded.
    }
  }
  return out
}

/**
 * Why a cookie-authenticated request may not proceed, or null when it may.
 * Only state-changing methods are checked: reads change nothing a forger
 * could see, since CORS keeps the answer from them.
 */
export function csrfProblem(req: Request, sessionId: string, allowedOrigins: Set<string>): string | null {
  if (SAFE_METHODS.has(req.method)) return null
  const origin = req.headers.origin
  if (origin && !allowedOrigins.has(String(origin).replace(/\/$/, ''))) return 'This origin may not call the API'
  if (!csrfTokenMatches(sessionId, req.headers['x-csrf-token'])) return 'Missing or wrong CSRF token'
  return null
}
