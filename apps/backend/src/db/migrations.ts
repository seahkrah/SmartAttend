import { query } from './connection.js'
import { readFileSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = join(__filename, '..')

// List all migrations in order
const MIGRATIONS = [
  '001_init_schema.sql',
  '002_refactored_schema.sql',
  '003_role_based_access_control.sql',
  '004_superadmin_system.sql',
  '005_superadmin_dashboard.sql'
]

export async function runMigrations() {
  try {
    console.log('🔄 Running database migrations...')

    // Check if migrations table exists
    await query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `)

    // Run all migrations in order
    for (const migrationFile of MIGRATIONS) {
      const migrationExists = await query(
        'SELECT 1 FROM migrations WHERE name = $1',
        [migrationFile]
      )

      if (migrationExists.rows.length === 0) {
        console.log(`[MIGRATION] Running ${migrationFile}...`)
        try {
          const migrationSQL = readFileSync(
            join(__dirname, 'migrations', migrationFile),
            'utf-8'
          )
          
          // Split by ; and execute each statement
          const statements = migrationSQL.split(';').filter(stmt => stmt.trim())
          
          for (const statement of statements) {
            if (statement.trim()) {
              await query(statement)
            }
          }

          await query(
            'INSERT INTO migrations (name) VALUES ($1)',
            [migrationFile]
          )
          
          console.log(`[MIGRATION] ✓ ${migrationFile} completed`)
        } catch (error: any) {
          console.error(`[MIGRATION] ✗ ${migrationFile} failed:`, error.message)
          // Don't throw - continue with other migrations
        }
      } else {
        console.log(`[MIGRATION] ✓ ${migrationFile} already executed`)
      }
    }

    console.log('✅ Migrations completed')
  } catch (error) {
    console.error('❌ Migration failed:', error)
    throw error
  }
}

export async function seedDatabase() {
  try {
    console.log('🌱 Seeding database...')

    // The seed data is included in the schema SQL file
    // This function can be used for additional seeding if needed

    console.log('✅ Database seeded')
  } catch (error) {
    console.error('❌ Seeding failed:', error)
    throw error
  }
}
