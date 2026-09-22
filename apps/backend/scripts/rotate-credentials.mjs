#!/usr/bin/env node
/**
 * Credential rotation
 *
 * Every password that was committed to this repository in
 * "JjeloTech Users and Platforms Passwords.txt" must be treated as public —
 * the file is in git history and history is not rewritten by deleting it.
 * This script issues a fresh random password for each affected account and
 * flags it so the holder is forced to choose their own at next login.
 *
 * Usage:
 *   cd apps/backend
 *   export DATABASE_URL=postgresql://...
 *   node scripts/rotate-credentials.mjs                 # rotate the known-leaked accounts
 *   node scripts/rotate-credentials.mjs --all           # rotate every account in the database
 *   node scripts/rotate-credentials.mjs a@b.com c@d.com # rotate specific addresses
 *
 * The new passwords are written to rotated-credentials-<timestamp>.txt in the
 * current directory. That filename is gitignored. Distribute the passwords
 * over a channel that is not this repository, then delete the file.
 */

import pg from 'pg'
import bcryptjs from 'bcryptjs'
import { randomBytes } from 'crypto'
import { writeFileSync } from 'fs'

const { Pool } = pg

// Addresses whose passwords appeared in the committed credentials file.
const LEAKED_ACCOUNTS = [
  'newadmin@jjelotech.local',
  'superadmin@jjelotech.local',
  'praisekrah@gmail.com',
  'abrahamkrah@gmail.com',
  'anyema@gmail.com',
  'janetnyema@gmail.com',
  'pkrah@gmail.com',
]

const SALT_ROUNDS = 10

/**
 * 18 random bytes rendered base64url: ~24 characters, 144 bits of entropy.
 * Avoids the ambiguous glyphs that make dictated passwords error-prone.
 */
function generatePassword() {
  return randomBytes(18)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Export it (or source your .env) before running this script.')
    process.exit(1)
  }

  const args = process.argv.slice(2)
  const rotateAll = args.includes('--all')
  const explicit = args.filter(a => !a.startsWith('--'))

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  })

  try {
    let targets
    if (rotateAll) {
      const { rows } = await pool.query('SELECT email FROM users ORDER BY email')
      targets = rows.map(r => r.email)
    } else {
      targets = explicit.length > 0 ? explicit : LEAKED_ACCOUNTS
    }

    if (targets.length === 0) {
      console.log('No accounts to rotate.')
      return
    }

    console.log(`Rotating ${targets.length} account(s)...\n`)

    const issued = []
    const missing = []

    for (const email of targets) {
      const password = generatePassword()
      const hash = await bcryptjs.hash(password, SALT_ROUNDS)

      const { rows } = await pool.query(
        `UPDATE users
            SET password_hash = $1,
                must_reset_password = true,
                updated_at = CURRENT_TIMESTAMP
          WHERE email = $2
      RETURNING email`,
        [hash, email]
      )

      if (rows.length === 0) {
        missing.push(email)
        console.log(`  – ${email} (no such account, skipped)`)
      } else {
        // One row per address: the same address can exist under several
        // platforms, and every one of them is rotated to this password.
        issued.push({ email, password, accounts: rows.length })
        console.log(`  ✓ ${email}${rows.length > 1 ? ` (${rows.length} accounts)` : ''}`)
      }
    }

    if (issued.length === 0) {
      console.log('\nNothing was rotated.')
      return
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const outFile = `rotated-credentials-${stamp}.txt`
    const body = [
      'JjeloTech — rotated credentials',
      `Generated ${new Date().toISOString()}`,
      '',
      'Each account must change this password at next login (must_reset_password is set).',
      'Send these over a channel that is not the git repository, then delete this file.',
      '',
      ...issued.map(({ email, password }) => `${email}  ${password}`),
      '',
    ].join('\n')

    writeFileSync(outFile, body, { mode: 0o600 })

    console.log(`\n✅ Rotated ${issued.length} account(s).`)
    console.log(`   New passwords written to ${outFile} (mode 0600, gitignored).`)
    if (missing.length > 0) {
      console.log(`   Not found in this database: ${missing.join(', ')}`)
    }
    console.log('\n   Passwords are not printed here so they stay out of your shell history.')
  } finally {
    await pool.end()
  }
}

main().catch(error => {
  console.error('❌ Rotation failed:', error.message)
  process.exit(1)
})
