/**
 * Quick migration script to add profile photo support to students table
 */
import { query } from './connection.js'
import pool from './connection.js'

async function addPhotoColumns() {
  console.log('🚀 Adding photo columns to students table...')
  
  try {
    // Add columns
    await query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS profile_photo_url TEXT`)
    console.log('✅ Added profile_photo_url column')
    
    await query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS phone TEXT`)
    console.log('✅ Added phone column')
    
    await query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS address TEXT`)
    console.log('✅ Added address column')
    
    // Add index
    await query(`CREATE INDEX IF NOT EXISTS idx_students_profile_photo ON students(id) WHERE profile_photo_url IS NOT NULL`)
    console.log('✅ Added index')
    
    // Add comment
    await query(`COMMENT ON COLUMN students.profile_photo_url IS 'URL of the student profile photo (stored in static files or cloud storage)'`)
    console.log('✅ Added column comment')
    
    console.log('\n✅ All changes applied successfully!')
  } catch (error: any) {
    console.error('❌ Error:', error.message)
    throw error
  } finally {
    await pool.end()
  }
}

addPhotoColumns().catch(error => {
  console.error('Fatal error:', error)
  process.exit(1)
})
