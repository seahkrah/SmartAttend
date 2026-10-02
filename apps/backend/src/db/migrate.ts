/**
 * Database Migration Runner
 * 
 * Execute pending migrations in order
 * Tracks executed migrations to prevent re-execution
 */

import { query } from '../db/connection.js'
import pool from '../db/connection.js'
import { splitStatements } from './splitStatements.js'
import { migrationFiles, migrationsDir, reconcileLedger } from './migrationLedger.js'
import * as fs from 'fs'
import * as path from 'path'
import { runAsSystem } from '../db/dbContext.js'

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
function getPendingMigrations(executedMigrations: MigrationRecord[]): string[] {
  const executedNames = new Set(executedMigrations.map(m => m.name))
  return migrationFiles().filter(f => !executedNames.has(f))
}

/**
 * Execute migration
 */
async function executeMigration(filename: string): Promise<void> {
  const filepath = path.join(migrationsDir, filename)

  console.log(`\n📝 Executing migration: ${filename}`)

  const sql = fs.readFileSync(filepath, 'utf-8')

  // Semicolons inside dollar-quoted bodies, strings and comments are not
  // statement terminators — see splitStatements.
  const statements = splitStatements(sql)

  // One transaction per migration: a failure half way through must not leave
  // the schema partly changed but the migration unrecorded, which is what
  // makes a failed run impossible to retry cleanly.
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    for (const statement of statements) {
      await client.query(statement)
    }

    await client.query(`INSERT INTO migrations (name) VALUES ($1)`, [filename])
    await client.query('COMMIT')

    console.log(`✅ Successfully executed: ${filename} (${statements.length} statements)`)
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => {
      /* the connection may already be unusable */
    })
    console.error(`❌ Error executing ${filename}:`, error.message)
    throw error
  } finally {
    client.release()
  }
}

/**
 * Run all pending migrations
 */
async function runMigrations(): Promise<void> {
  console.log('🚀 Starting database migrations...\n')

  try {
    await getExecutedMigrations() // creates the ledger table on a fresh database

    // Old names of renumbered migrations become the current ones before
    // anything is compared; see migrationLedger.ts.
    const ledgerClient = await pool.connect()
    try {
      const renamed = await reconcileLedger(ledgerClient)
      if (renamed) console.log(`🔁 Renamed ${renamed} ledger entries to their renumbered filenames`)
    } finally {
      ledgerClient.release()
    }

    const executed = await getExecutedMigrations()
    console.log(`📊 Previously executed migrations: ${executed.length}`)
    executed.forEach(m => console.log(`  ✓ ${m.name}`))

    // Get pending migrations
    const pending = getPendingMigrations(executed)

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
runAsSystem('apply schema migrations as the owner', runMigrations).catch(error => {
  console.error('Fatal error:', error)
  process.exit(1)
})
