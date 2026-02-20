/**
 * Add must_reset_password column to users table
 */

import { query } from './src/db/connection.js';

async function addPasswordResetColumn() {
  console.log('🔧 Adding must_reset_password column to users table...\n');

  try {
    // Add column if not exists
    await query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS must_reset_password BOOLEAN DEFAULT false
    `);
    console.log('✅ Column added successfully');

    // Check if column exists
    const checkResult = await query(`
      SELECT column_name, data_type, column_default
      FROM information_schema.columns
      WHERE table_name = 'users' AND column_name = 'must_reset_password'
    `);

    if (checkResult.rows.length > 0) {
      console.log('✅ Verified: must_reset_password column exists');
      console.log('   Type:', checkResult.rows[0].data_type);
      console.log('   Default:', checkResult.rows[0].column_default);
    } else {
      console.log('❌ Column not found after creation!');
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

addPasswordResetColumn();
