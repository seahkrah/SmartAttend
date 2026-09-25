/**
 * Which migrations have not been applied to this database. Used by the
 * readiness check: a server whose schema is behind its code answers requests
 * with errors, so it should not be sent traffic.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { query } from './connection.js'

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations')

export async function pendingMigrations(): Promise<string[]> {
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql') && !f.endsWith('_OLD.sql'))
  let applied = new Set<string>()
  try {
    const r = await query(`SELECT name FROM migrations`)
    applied = new Set(r.rows.map((x: any) => x.name))
  } catch {
    // No migrations table: nothing has been applied.
  }
  return files.filter((f) => !applied.has(f)).sort()
}
