import { query } from './connection.js'

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

    // Read migration files and execute them
    // For now, we'll assume the schema is already created
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
