import { query } from './connection.js'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
// Navigate from dist/db/migrations.js back to project root, then to src/db/migrations
const srcDbDir = dirname(__filename)
// Go up 2 levels (dist/db -> dist -> root), then into src/db/migrations
const migrationsDir = join(srcDbDir, '..', '..', 'src', 'db', 'migrations')

// List all migrations in order
// Starting with core migrations that have minimal dependencies
const MIGRATIONS: string[] = [
  '001_init_schema.sql',
  '002_refactored_schema.sql',
  '003_role_based_access_control.sql',
  '004_superadmin_system.sql',
  '005_superadmin_dashboard.sql',
  // Phase 8.3 Stage 1: Schema Foundation (Tenant Isolation + Immutability)
  '006_add_platform_id_to_school_departments.sql',
  '007_add_platform_id_to_students.sql',
  '008_add_platform_id_to_corporate_departments.sql',
  '008_5_immutability_triggers.sql',
  // Phase 5: Incident Lifecycle
  '009_incident_lifecycle_5_2.sql',
  // Phase 6: Attendance State Machine
  '010_attendance_state_machine_6_1.sql',
  '011_immutable_correction_history_6_2.sql',
  // Phase 7.1: Platform Metrics (disabled - reference table pending)
  // '012_platform_metrics_7_1.sql',
]

// Parse SQL statements properly, handling dollar-quoted strings
function parseSQLStatements(sqlContent: string): string[] {
  const statements: string[] = []
  let currentStatement = ''
  let inDollarQuote = false
  let dollarQuoteTag = ''
  let i = 0

  while (i < sqlContent.length) {
    const char = sqlContent[i]

    // Check for dollar quote start/end
    if (char === '$') {
      // Look ahead for the dollar quote tag
      let j = i + 1
      let tag = ''
      while (j < sqlContent.length && sqlContent[j] !== '$') {
        tag += sqlContent[j]
        j++
      }
      
      if (j < sqlContent.length) {
        // Found closing $
        const fullTag = '$' + tag + '$'
        
        if (!inDollarQuote) {
          // Starting a dollar quote
          inDollarQuote = true
          dollarQuoteTag = fullTag
          currentStatement += fullTag
          i = j + 1
          continue
        } else if (fullTag === dollarQuoteTag) {
          // Ending a dollar quote
          inDollarQuote = false
          currentStatement += fullTag
          i = j + 1
          continue
        }
      }
    }

    // Handle statement terminator
    if (char === ';' && !inDollarQuote) {
      currentStatement += char
      const trimmed = currentStatement.trim()
      if (trimmed) {
        statements.push(trimmed)
      }
      currentStatement = ''
      i++
      continue
    }

    currentStatement += char
    i++
  }

  // Add any remaining statement
  const trimmed = currentStatement.trim()
  if (trimmed) {
    statements.push(trimmed)
  }

  return statements
}

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
            join(migrationsDir, migrationFile),
            'utf-8'
          )
          
          // Parse SQL statements properly, handling dollar-quoted strings
          const statements = parseSQLStatements(migrationSQL)
          
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
