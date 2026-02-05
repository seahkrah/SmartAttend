import pg from 'pg'
import dotenv from 'dotenv'
import { runMigrations } from './migrations.js'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Load .env from backend root
dotenv.config({ path: join(__dirname, '..', '..', '.env') })

const { Pool } = pg

console.log('[DB] DATABASE_URL:', process.env.DATABASE_URL ? '***configured***' : '***NOT SET***')
console.log('[DB] NODE_ENV:', process.env.NODE_ENV)

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
})

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err)
  process.exit(-1)
})

export async function query(text: string, params?: any[]) {
  const start = Date.now()
  try {
    const res = await pool.query(text, params)
    const duration = Date.now() - start
    console.log('Executed query', { text, duration, rows: res.rowCount })
    return res
  } catch (error) {
    console.error('Database query error:', error)
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
