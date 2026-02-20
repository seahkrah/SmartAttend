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

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : false,
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
