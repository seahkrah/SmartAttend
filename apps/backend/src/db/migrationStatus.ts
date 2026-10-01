/**
 * Which migrations have not been applied to this database. Used by the
 * readiness check: a server whose schema is behind its code answers requests
 * with errors, so it should not be sent traffic.
 */
import { query } from './connection.js'
import { currentName, migrationFiles } from './migrationLedger.js'

export async function pendingMigrations(): Promise<string[]> {
  const files = migrationFiles()
  let applied = new Set<string>()
  try {
    const r = await query(`SELECT name FROM migrations`)
    // A ledger not yet reconciled by migrate.ts still holds old names.
    applied = new Set(r.rows.map((x: any) => currentName(x.name)))
  } catch {
    // No migrations table: nothing has been applied.
  }
  return files.filter((f) => !applied.has(f))
}
