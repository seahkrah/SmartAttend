/**
 * Has this password appeared in a known data breach?
 *
 * NIST SP 800-63B §5.1.1.2 asks that new passwords be compared against values
 * known to be compromised. The bundled list in passwordPolicy.ts covers the
 * most common ones always. When configured, the password is also checked
 * against a k-anonymity range service (the Pwned Passwords API by default):
 * only the first five hex characters of its SHA-1 leave the server, the
 * service answers with every suffix that shares them, and the match is made
 * here. The service never learns the password or whether it matched.
 *
 * PASSWORD_BREACH_CHECK=range turns the lookup on (the default in
 * production); off turns it off. PASSWORD_BREACH_RANGE_URL points it at
 * another service with the same interface. When the service cannot be
 * reached within two and a half seconds the password is judged on the
 * bundled list alone and a warning is logged: a sign-up is not held hostage
 * to a third party's availability.
 */
import crypto from 'crypto'
import { checkPassword } from './passwordPolicy.js'

export interface BreachResult {
  breached: boolean
  /** How often the service has seen it; absent when not checked or not found. */
  count?: number
  checked: boolean
}

function enabled(env: NodeJS.ProcessEnv): boolean {
  const v = (env.PASSWORD_BREACH_CHECK ?? '').toLowerCase()
  if (v === 'off') return false
  if (v === 'range') return true
  return env.NODE_ENV === 'production'
}

export async function breachedPassword(
  password: string,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch
): Promise<BreachResult> {
  if (!enabled(env)) return { breached: false, checked: false }
  const sha1 = crypto.createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase()
  const prefix = sha1.slice(0, 5)
  const suffix = sha1.slice(5)
  const base = (env.PASSWORD_BREACH_RANGE_URL || 'https://api.pwnedpasswords.com/range/').replace(/\/?$/, '/')
  try {
    const res = await fetchImpl(base + prefix, {
      // Padding makes every answer about the same size, so the length of the
      // response does not hint at the prefix either.
      headers: { 'Add-Padding': 'true', 'User-Agent': 'jjelotech-password-check' },
      signal: AbortSignal.timeout(2500),
    })
    if (!res.ok) throw new Error(`range service answered ${res.status}`)
    const body = await res.text()
    for (const line of body.split('\n')) {
      const [s, n] = line.trim().split(':')
      if (s === suffix) {
        const count = parseInt(n, 10) || 0
        // Padding entries carry a count of zero and are not real passwords.
        if (count > 0) return { breached: true, count, checked: true }
      }
    }
    return { breached: false, checked: true }
  } catch (e) {
    console.warn('[passwords] breached-password range lookup unavailable; the bundled list alone applied:',
      e instanceof Error ? e.message : String(e))
    return { breached: false, checked: false }
  }
}

/**
 * Everything wrong with a new password: the policy (passwordPolicy.ts) and,
 * when it passes, a known breach. Every place a password is chosen uses this.
 */
export async function passwordProblems(
  password: unknown,
  context: { email?: string | null; name?: string | null } = {}
): Promise<string[]> {
  const problems = checkPassword(password, context)
  if (problems.length > 0 || typeof password !== 'string') return problems
  const b = await breachedPassword(password)
  if (b.breached) {
    problems.push('This password has appeared in a known data breach, so attackers try it first; choose another')
  }
  return problems
}
