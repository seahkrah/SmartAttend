/**
 * Refuses to start a production server whose configuration would make it
 * insecure or broken. Development keeps working with defaults; production
 * must say what it means.
 */
import { allowedOrigins } from '../security/httpSecurity.js'

const PLACEHOLDER = /change[-_ ]?me|your[-_ ]|example|placeholder|secret123|^secret$|^password$|not[-_ ]a[-_ ]real|ci-only|dev[-_]only/i

export function configProblems(env: NodeJS.ProcessEnv = process.env): string[] {
  const problems: string[] = []
  const secret = (key: string, minLength: number) => {
    const v = env[key]
    if (!v) problems.push(`${key} is not set`)
    else if (v.length < minLength) problems.push(`${key} is shorter than ${minLength} characters`)
    else if (PLACEHOLDER.test(v)) problems.push(`${key} looks like a placeholder value`)
  }

  secret('JWT_SECRET', 32)
  if (!env.DATABASE_URL) problems.push('DATABASE_URL is not set')

  if (!env.PUBLIC_APP_URL) {
    problems.push('PUBLIC_APP_URL is not set (invitation and password-reset links point at it)')
  } else if (!/^https:\/\//.test(env.PUBLIC_APP_URL)) {
    problems.push('PUBLIC_APP_URL must be an https:// address')
  }

  if (env.MFA_ENCRYPTION_KEY && Buffer.from(env.MFA_ENCRYPTION_KEY, 'base64').length !== 32) {
    problems.push('MFA_ENCRYPTION_KEY must be 32 bytes, base64-encoded (openssl rand -base64 32)')
  }

  const origins = allowedOrigins()
  if (origins.length === 0) problems.push('CORS_ORIGINS is not set (no browser could call the API)')
  if (origins.some(o => o === '*')) problems.push('CORS_ORIGINS must list origins, not "*"')

  return problems
}

export function validateProductionConfig(): void {
  if (process.env.NODE_ENV !== 'production') return
  const problems = configProblems()
  if (problems.length > 0) {
    console.error('[CONFIG] Refusing to start in production:\n  - ' + problems.join('\n  - '))
    process.exit(1)
  }
  if (!process.env.MFA_ENCRYPTION_KEY) {
    // Works (the key is derived from JWT_SECRET), but rotating JWT_SECRET
    // would then make every enrolled authenticator unreadable.
    console.warn('[CONFIG] MFA_ENCRYPTION_KEY is not set; two-factor secrets are sealed with a key derived from JWT_SECRET.')
  }
}
