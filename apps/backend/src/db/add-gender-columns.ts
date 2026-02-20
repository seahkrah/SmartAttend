/**
 * Quick migration script to add gender field to students and faculty tables
 */
import { query } from './connection.js'
import pool from './connection.js'

async function addGenderColumns() {
  console.log('🚀 Adding gender columns to students and faculty tables...')
  
  try {
    // Add gender column to students
    await query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS gender VARCHAR(20)`)
    console.log('✅ Added gender column to students table')
    
    // Add gender column to faculty
    await query(`ALTER TABLE faculty ADD COLUMN IF NOT EXISTS gender VARCHAR(20)`)
    console.log('✅ Added gender column to faculty table')
    
    // Add comments
    await query(`COMMENT ON COLUMN students.gender IS 'Gender of the student (e.g., Male, Female, Other, Prefer not to say)'`)
    await query(`COMMENT ON COLUMN faculty.gender IS 'Gender of the faculty member (e.g., Male, Female, Other, Prefer not to say)'`)
    console.log('✅ Added column comments')
    
    console.log('\n✅ All gender columns added successfully!')
  } catch (error: any) {
    console.error('❌ Error:', error.message)
    throw error
  } finally {
    await pool.end()
  }
}

addGenderColumns().catch(error => {
  console.error('Fatal error:', error)
  process.exit(1)
})
