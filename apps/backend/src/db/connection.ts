import pg from 'pg'
import dotenv from 'dotenv'
import { runMigrations } from './migrations.js'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { readFileSync } from 'fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Load .env from backend root
dotenv.config({ path: join(__dirname, '..', '..', '.env') })

const { Pool } = pg

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
    
    // Run migrations
    await runMigrations()
  } catch (error) {
    console.error('❌ Database initialization failed:', error)
    throw error
  }
}

export default pool
