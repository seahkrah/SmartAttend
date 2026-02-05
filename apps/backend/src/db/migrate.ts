/**
 * Database Migration Runner
 * 
 * Execute pending migrations in order
 * Tracks executed migrations to prevent re-execution
 */

import { query } from '../db/connection.js'
import pool from '../db/connection.js'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

interface MigrationRecord {
  name: string
  executed_at: string
}

/**
 * Get list of executed migrations
 */
async function getExecutedMigrations(): Promise<MigrationRecord[]> {
  try {
    // Create migrations table if it doesn't exist
    await query(`
      CREATE TABLE IF NOT EXISTS migrations (
        name VARCHAR(255) PRIMARY KEY,
        executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `)

    const result = await query(`
      SELECT name, executed_at FROM migrations ORDER BY executed_at
    `)

    return result.rows
  } catch (error) {
    console.error('Error getting executed migrations:', error)
    throw error
  }
}

/**
 * Get list of pending migrations
 */
async function getPendingMigrations(executedMigrations: MigrationRecord[]): Promise<string[]> {
  const migrationsDir = path.join(__dirname, 'migrations')

  // Get all SQL files
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql'))

  // Filter out already executed
  const executedNames = new Set(executedMigrations.map(m => m.name))

  return files.filter(f => !executedNames.has(f)).sort()
}

/**
 * Execute migration
 */
async function executeMigration(filename: string): Promise<void> {
  const migrationsDir = path.join(__dirname, 'migrations')
  const filepath = path.join(migrationsDir, filename)

  console.log(`\n📝 Executing migration: ${filename}`)

  try {
    // Read migration file
    const sql = fs.readFileSync(filepath, 'utf-8')

    // Split by semicolons and filter empty statements
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0)

    // Execute each statement
    for (const statement of statements) {
      await query(statement)
    }

    // Record migration
    await query(
      `INSERT INTO migrations (name) VALUES ($1)`,
      [filename]
    )

    console.log(`✅ Successfully executed: ${filename}`)
  } catch (error: any) {
    console.error(`❌ Error executing ${filename}:`, error.message)
    throw error
  }
}

/**
 * Run all pending migrations
 */
async function runMigrations(): Promise<void> {
  console.log('🚀 Starting database migrations...\n')

  try {
    // Get executed migrations
    const executed = await getExecutedMigrations()
    console.log(`📊 Previously executed migrations: ${executed.length}`)
    executed.forEach(m => console.log(`  ✓ ${m.name}`))

    // Get pending migrations
    const pending = await getPendingMigrations(executed)

    if (pending.length === 0) {
      console.log('\n✅ No pending migrations. Database is up to date.')
      return
    }

    console.log(`\n⏳ Pending migrations: ${pending.length}`)
    pending.forEach(m => console.log(`  ○ ${m}`))

    // Execute each pending migration
    for (const migration of pending) {
      await executeMigration(migration)
    }

    console.log('\n✅ All migrations completed successfully!')
  } catch (error) {
    console.error('\n❌ Migration failed:', error)
    throw error
  } finally {
    await pool.end()
  }
}

// Run migrations
runMigrations().catch(error => {
  console.error('Fatal error:', error)
  process.exit(1)
})
