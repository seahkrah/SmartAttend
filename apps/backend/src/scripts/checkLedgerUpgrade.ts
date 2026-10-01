/**
 * Proves a database migrated under the old, duplicated migration names
 * upgrades without re-running anything. Run against a fully migrated
 * database (CI does, straight after migrate.ts):
 *
 *   1. rewrites the ledger back to the old names, as an older deploy left it;
 *   2. runs migrate.ts;
 *   3. fails unless every row is back under its current name and no
 *      migration executed.
 *
 * Destructive to the ledger of the database it is pointed at only in the
 * sense that it restores it; never point it at production.
 */
import { execFileSync } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'
import pg from 'pg'
import pool from '../db/connection.js'
import { RENAMED, migrationFiles } from '../db/migrationLedger.js'

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('refusing to run with NODE_ENV=production')

  const before = (await pool.query(`SELECT count(*)::int AS n FROM migrations`)).rows[0].n
  for (const [oldName, newName] of Object.entries(RENAMED)) {
    await pool.query(`UPDATE migrations SET name = $1 WHERE name = $2`, [oldName, newName])
  }
  await pool.end()

  const out = execFileSync(process.execPath, ['--import', 'tsx', 'src/db/migrate.ts'], {
    cwd: backendDir,
    encoding: 'utf8',
    env: process.env,
  })

  const problems: string[] = []
  if (/Executing migration/.test(out)) problems.push('a migration executed during the upgrade')
  if (!out.includes(`Renamed ${Object.keys(RENAMED).length} ledger entries`)) problems.push('ledger entries were not all renamed')

  // The shared pool is ended above; a fresh client sees migrate.ts's commits.
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  const names = new Set((await client.query(`SELECT name FROM migrations`)).rows.map((r: any) => r.name))
  const after = names.size
  const missing = migrationFiles().filter((f) => !names.has(f))
  if (missing.length) problems.push(`not recorded under current names: ${missing.join(', ')}`)
  if (after !== before) problems.push(`ledger has ${after} rows, had ${before}`)
  await client.end()

  if (problems.length) {
    console.error('ledger upgrade FAILED:\n  ' + problems.join('\n  '))
    process.exit(1)
  }
  console.log(`ledger upgrade ok: ${Object.keys(RENAMED).length} renamed, nothing re-ran, ${after} rows`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
