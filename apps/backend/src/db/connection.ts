import pg from 'pg'
import dotenv from 'dotenv'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { readFileSync } from 'fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Load .env from backend root
dotenv.config({ path: join(__dirname, '..', '..', '.env') })

const { Pool } = pg

// A DATE column is a calendar day, and is returned as one: 'YYYY-MM-DD'.
// node-postgres otherwise builds a JS Date at the server's local midnight,
// which serialises to the API as '2027-04-12T00:00:00.000Z' (shown raw on
// screens), moves to the previous day when converted anywhere west of the
// server, and turns String(d).slice(0, 10) into a weekday name. Four modules
// had grown their own isoDay() workaround; this makes it true everywhere.
// Timestamps (TIMESTAMP, TIMESTAMPTZ) are unaffected.
const PG_DATE_OID = 1082
pg.types.setTypeParser(PG_DATE_OID, (value: string) => value)

console.log('[DB] DATABASE_URL:', process.env.DATABASE_URL ? '***configured***' : '***NOT SET***')

/**
 * TLS to the database. DATABASE_SSL:
 *   verify  encrypted, and the server's certificate must check out (with
 *           DATABASE_SSL_CA naming a CA file for a private CA). The default
 *           in production.
 *   off     no TLS: only for a database reachable solely on a private
 *           network, such as the compose stack's. The default elsewhere.
 * There is deliberately no "encrypt but trust anything" setting.
 */
export function databaseSsl(env: NodeJS.ProcessEnv = process.env): false | { rejectUnauthorized: true; ca?: string } {
  const mode = (env.DATABASE_SSL ?? (env.NODE_ENV === 'production' ? 'verify' : 'off')).toLowerCase()
  if (mode === 'off') return false
  if (mode !== 'verify') throw new Error(`DATABASE_SSL must be "verify" or "off", not "${mode}"`)
  return env.DATABASE_SSL_CA
    ? { rejectUnauthorized: true, ca: readFileSync(env.DATABASE_SSL_CA, 'utf8') }
    : { rejectUnauthorized: true }
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: databaseSsl(),
})

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err)
  process.exit(-1)
})

export async function query(text: string, params?: any[]) {
  try {
    const res = await pool.query(text, params)
    return res
  } catch (error) {
    // Only log query errors in development, never log query text in production
    if (process.env.NODE_ENV === 'development') {
      console.error('Database query error:', { error: (error as Error).message })
    }
    throw error
  }
}

export async function getConnection() {
  return await pool.connect()
}

export async function initializeDatabase() {
  try {
    const result = await query('SELECT 1')
    console.log('✅ Database connection successful')
    // Migrations are not applied here. They are a deliberate step
    // (`npx tsx src/db/migrate.ts`, run by setup, CI and the deploy docs), and
    // the server used to apply a hardcoded subset of them (001-012) on start,
    // in an order of its own — on a fresh database that ran migrations out of
    // sequence and left a half-built schema that looked like a working one.
    // startServer reports anything pending, and /api/health/ready refuses
    // traffic until it is applied.
  } catch (error) {
    console.error('❌ Database initialization failed:', error)
    throw error
  }
}

export default pool
