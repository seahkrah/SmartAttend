#!/usr/bin/env node

/**
 * Database Setup Script
 * Run this to initialize the PostgreSQL database and load the schema
 * 
 * Requirements:
 * - PostgreSQL installed and running
 * - psql CLI available
 * - .env file configured with DATABASE_URL
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { execSync } from 'child_process'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const schemaPath = path.join(__dirname, 'migrations', '001_init_schema.sql')

console.log('🚀 SMARTATTEND Database Setup')
console.log('=' .repeat(50))

// Check if schema file exists
if (!fs.existsSync(schemaPath)) {
  console.error('❌ Schema file not found:', schemaPath)
  process.exit(1)
}

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  console.error('❌ DATABASE_URL environment variable not set')
  console.log('   Set it in .env file or run: export DATABASE_URL="postgresql://..."')
  process.exit(1)
}

try {
  console.log('📖 Reading schema file...')
  const schema = fs.readFileSync(schemaPath, 'utf8')
  
  console.log('🔄 Running migrations...')
  // Using psql with connection string
  execSync(`psql "${databaseUrl}" -f "${schemaPath}"`, { stdio: 'inherit' })
  
  console.log('\n✅ Database setup completed successfully!')
  console.log('   You can now start the server with: npm run dev')
} catch (error) {
  console.error('\n❌ Database setup failed!')
  console.error((error as Error).message)
  console.log('\n📝 Make sure PostgreSQL is running and DATABASE_URL is correct')
  process.exit(1)
}
