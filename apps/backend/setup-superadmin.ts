/**
 * Creates the platform's first (or another) superadmin.
 *
 *   SUPERADMIN_EMAIL=ops@example.org SUPERADMIN_NAME="Ama Mensah" npm run setup-superadmin
 *
 * The password is read from SUPERADMIN_PASSWORD or, when unset, typed at a
 * hidden prompt. It must pass the same policy as every other password.
 *
 * This used to create superadmin@jjelotech.local with the fixed password
 * "jjelotech123", print it, and on every later run reset an existing
 * superadmin back to it. An existing account is now left alone unless
 * --reset-password is given, which also ends all of its sessions.
 */
import readline from 'readline'
import { query } from './src/db/connection.js'
import { hashPassword } from './src/auth/authService.js'
import { checkPassword } from './src/auth/passwordPolicy.js'
import { revokeUserSessions } from './src/auth/sessions.js'

function hiddenPrompt(label: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    const out = rl as any
    out.stdoutMuted = true
    out._writeToOutput = (s: string) => { if (!out.stdoutMuted || s.startsWith(label)) process.stdout.write(s) }
    rl.question(label, (answer) => { rl.close(); process.stdout.write('\n'); resolve(answer) })
  })
}

async function main() {
  const reset = process.argv.includes('--reset-password')
  const email = String(process.env.SUPERADMIN_EMAIL ?? '').trim().toLowerCase()
  const name = String(process.env.SUPERADMIN_NAME ?? '').trim()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || name.length < 2) {
    console.error('Set SUPERADMIN_EMAIL and SUPERADMIN_NAME.')
    process.exit(1)
  }

  const platform = await query(`SELECT id FROM platforms WHERE name = 'system'`)
  const role = await query(
    `SELECT r.id FROM roles r JOIN platforms p ON p.id = r.platform_id WHERE p.name = 'system' AND r.name = 'superadmin'`)
  if (platform.rows.length === 0 || role.rows.length === 0) {
    console.error('The system platform or superadmin role is missing. Run the migrations first (npx tsx src/db/migrate.ts).')
    process.exit(1)
  }

  const existing = await query(`SELECT id FROM users WHERE LOWER(email) = $1 AND platform_id = $2`, [email, platform.rows[0].id])
  if (existing.rows.length > 0 && !reset) {
    console.error(`${email} already has a superadmin account. Nothing was changed. Use --reset-password to set a new password.`)
    process.exit(1)
  }

  const password = process.env.SUPERADMIN_PASSWORD ?? await hiddenPrompt('Password: ')
  const problems = checkPassword(password, { email, name })
  if (problems.length > 0) {
    console.error('Choose a stronger password:\n  - ' + problems.join('\n  - '))
    process.exit(1)
  }
  const hash = await hashPassword(password)

  if (existing.rows.length > 0) {
    await query(
      `UPDATE users SET password_hash = $2, password_changed_at = CURRENT_TIMESTAMP, is_active = TRUE,
                        activated_at = COALESCE(activated_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
        WHERE id = $1`,
      [existing.rows[0].id, hash])
    const ended = await revokeUserSessions(existing.rows[0].id, 'password_reset_by_operator')
    console.log(`Password reset for ${email}; ${ended} session(s) ended.`)
  } else {
    await query(
      `INSERT INTO users (platform_id, email, full_name, role_id, password_hash, is_active, activated_at)
       VALUES ($1, $2, $3, $4, $5, TRUE, CURRENT_TIMESTAMP)`,
      [platform.rows[0].id, email, name, role.rows[0].id, hash])
    console.log(`Superadmin ${email} created. Sign in at /login-superadmin.`)
  }
  process.exit(0)
}

main().catch((e) => {
  console.error('Setup failed:', e.message)
  process.exit(1)
})
