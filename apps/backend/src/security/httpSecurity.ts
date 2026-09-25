/**
 * HTTP-level protections: security headers, which browser origins may call
 * the API, which proxies are trusted to report the client's address, and
 * request-rate limits.
 *
 * Rate limits here are per process and per client address. They blunt floods
 * and credential stuffing; they are not what stops password guessing on one
 * account (that is the per-address lockout in authService, stored in the
 * database so it holds across processes and restarts). Behind a school's or
 * company's single NAT address many people share one client address, so the
 * limits are generous and configurable.
 */
import type { Express, RequestHandler } from 'express'
import cors from 'cors'
import helmet from 'helmet'
import { rateLimit } from 'express-rate-limit'

function intEnv(key: string, fallback: number): number {
  const v = parseInt(process.env[key] ?? '', 10)
  return Number.isFinite(v) && v > 0 ? v : fallback
}

const DEV_ORIGINS = [
  'http://localhost:5173', 'http://127.0.0.1:5173',
  'http://localhost:3000', 'http://127.0.0.1:3000',
  'http://localhost:4173', 'http://127.0.0.1:4173',
]

/** Origins allowed to call the API from a browser. */
export function allowedOrigins(): string[] {
  const configured = (process.env.CORS_ORIGINS ?? '')
    .split(',').map(s => s.trim().replace(/\/$/, '')).filter(Boolean)
  if (configured.length > 0) return configured
  return process.env.NODE_ENV === 'production' ? [] : DEV_ORIGINS
}

/**
 * TRUST_PROXY says how many proxies sit in front of the API (e.g. "1" behind
 * one load balancer), or lists their addresses. Unset means none: forwarding
 * headers are ignored and the socket address is the client.
 */
export function trustProxySetting(): boolean | number | string {
  const raw = (process.env.TRUST_PROXY ?? '').trim()
  if (!raw || raw === 'false' || raw === '0') return false
  if (/^\d+$/.test(raw)) return parseInt(raw, 10)
  return raw
}

export function applyHttpSecurity(app: Express) {
  app.disable('x-powered-by')
  app.set('trust proxy', trustProxySetting())

  // The API serves JSON and file downloads, never HTML, so the strictest
  // content policy costs nothing.
  app.use(helmet({
    contentSecurityPolicy: { useDefaults: false, directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: 'same-site' },
  }))

  const origins = new Set(allowedOrigins())
  app.use(cors({
    origin(origin, cb) {
      // No Origin header: not a browser cross-origin request (curl, a server,
      // a same-origin navigation). CORS does not apply to those.
      if (!origin) return cb(null, true)
      cb(null, origins.has(origin.replace(/\/$/, '')))
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-Id', 'X-Bootstrap-Token'],
    exposedHeaders: ['Content-Disposition', 'RateLimit', 'RateLimit-Policy', 'Retry-After'],
    maxAge: 600,
  }))

  app.use('/api', limiter('api', intEnv('RATE_LIMIT_API_PER_MINUTE', 3000), 60_000,
    'Too many requests. Slow down and try again shortly.'))
}

export function limiter(name: string, limit: number, windowMs: number, message: string): RequestHandler {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    identifier: name,
    message: { error: message, code: 'RATE_LIMITED' },
  })
}

/** Sign-in attempts per client address. */
export const loginLimiter = limiter('login', intEnv('RATE_LIMIT_LOGIN_PER_MINUTE', 120), 60_000,
  'Too many sign-in attempts from this network. Try again in a minute.')

/** Token refreshes per client address. */
export const refreshLimiter = limiter('refresh', intEnv('RATE_LIMIT_REFRESH_PER_MINUTE', 600), 60_000,
  'Too many requests. Try again in a minute.')

/** Password-reset requests, activations, resets and registrations per client address. */
export const accountLimiter = limiter('account', intEnv('RATE_LIMIT_ACCOUNT_PER_15MIN', 30), 15 * 60_000,
  'Too many account requests from this network. Try again later.')
