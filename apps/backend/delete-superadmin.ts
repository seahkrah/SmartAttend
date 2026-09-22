import { query } from './src/db/connection.js'

async function deleteSuperadmin() {
  try {
    console.log('🗑️  Deleting current superadmin user...')

    // Find and delete the superadmin user
    const result = await query(
      `DELETE FROM users 
       WHERE email = 'superadmin@jjelotech.local'
       RETURNING id, email`
    )

    if (result.rows.length > 0) {
      console.log(`✅ Deleted superadmin user: ${result.rows[0].email}`)
    } else {
      console.log('ℹ️  No superadmin user found to delete')
    }

    console.log('\n✅ Superadmin deletion complete')
    process.exit(0)
  } catch (error) {
    console.error('❌ Failed to delete superadmin:', error)
    process.exit(1)
  }
}

deleteSuperadmin()
