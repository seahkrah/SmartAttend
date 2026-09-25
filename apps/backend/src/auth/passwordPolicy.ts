/**
 * What a password must be.
 *
 * Length is what matters most (NIST SP 800-63B §5.1.1.2): at least 10
 * characters, at most 128, no composition rules that push people towards
 * "Password1!". Refused outright: passwords on a list of the most common ones,
 * and passwords that contain the account's own email name.
 */

export const PASSWORD_MIN = 10
export const PASSWORD_MAX = 128

// The most common passwords in public breach corpora, lower-cased. A short
// list catches the attempts that matter; length does the rest.
const COMMON = new Set([
  '123456', '1234567890', '12345678910', '123456789', '1234567', '12345678', 'password', 'password1',
  'password12', 'password123', 'password1234', 'passw0rd', 'p@ssw0rd', 'p@ssword1', 'qwerty', 'qwerty123',
  'qwertyuiop', 'qwerty1234', '1q2w3e4r5t', '1q2w3e4r', 'q1w2e3r4t5', 'zaq12wsx', 'zaq1zaq1', 'asdfghjkl',
  'asdfghjkl1', 'iloveyou', 'iloveyou1', 'iloveyou12', 'admin', 'admin123', 'admin1234', 'administrator',
  'welcome', 'welcome1', 'welcome123', 'welcome2024', 'welcome2025', 'welcome2026', 'letmein', 'letmein123',
  'monkey', 'monkey123', 'dragon', 'dragon123', 'football', 'football1', 'baseball', 'sunshine', 'sunshine1',
  'princess', 'princess1', 'superman', 'superman1', 'batman', 'trustno1', 'abc123', 'abcd1234', 'abcdef123',
  'changeme', 'changeme123', 'default', 'secret', 'secret123', 'master', 'master123', 'shadow', 'michael',
  'jennifer', 'jordan23', 'liverpool', 'chelsea1', 'arsenal1', 'manchester', 'starwars', 'pokemon',
  'computer', 'internet', 'whatever', 'freedom', 'nothing', 'samsung', 'google', 'facebook', 'linkedin',
  'student', 'student123', 'teacher', 'teacher123', 'school', 'school123', 'employee', 'employee123',
  '11111111', '111111111', '1111111111', '00000000', '0000000000', '88888888', '99999999', '12341234',
  '11223344', '123123123', '123321123', 'aaaaaaaa', 'aaaaaaaaaa', 'abcdefgh', 'abcdefghij',
])

export function checkPassword(password: unknown, context: { email?: string | null; name?: string | null } = {}): string[] {
  const problems: string[] = []
  if (typeof password !== 'string') return ['A password is required']
  if (password.length < PASSWORD_MIN) problems.push(`Use at least ${PASSWORD_MIN} characters`)
  if (password.length > PASSWORD_MAX) problems.push(`Use at most ${PASSWORD_MAX} characters`)
  const lower = password.toLowerCase()
  if (COMMON.has(lower) || COMMON.has(lower.replace(/[^a-z0-9@]/g, ''))) {
    problems.push('This password is one of the most commonly used; choose another')
  }
  const local = String(context.email ?? '').split('@')[0].toLowerCase()
  if (local.length >= 4 && lower.includes(local)) {
    problems.push('Do not include your email name in your password')
  }
  if (/^(.)\1+$/.test(password)) problems.push('Do not repeat a single character')
  return problems
}
