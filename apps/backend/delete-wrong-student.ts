import { query } from './src/db/connection.js';

async function deleteWrongStudent() {
  try {
    console.log('🔍 Looking for wrongly created student (Augustine D. Nyema)...');
    
    // Find the user
    const userResult = await query(
      `SELECT u.id, u.email, u.full_name, p.name as platform_name, r.name as role_name
       FROM users u
       JOIN platforms p ON u.platform_id = p.id
       JOIN roles r ON u.role_id = r.id
       WHERE u.email = $1`,
      ['anyema@gmail.com']
    );
    
    if (userResult.rows.length === 0) {
      console.log('✅ User not found (may have been deleted already)');
      process.exit(0);
    }
    
    const user = userResult.rows[0];
    console.log('\n📋 Found user:');
    console.log('  - ID:', user.id);
    console.log('  - Name:', user.full_name);
    console.log('  - Email:', user.email);
    console.log('  - Platform:', user.platform_name);
    console.log('  - Role:', user.role_name);
    
    // Check if student record exists
    const studentResult = await query(
      `SELECT id FROM students WHERE user_id = $1`,
      [user.id]
    );
    
    console.log('\n🎓 Student record:', studentResult.rows.length > 0 ? 'EXISTS' : 'MISSING');
    
    // Delete in correct order to respect foreign keys
    console.log('\n🗑️  Deleting...');
    
    // 1. Delete student record if exists
    if (studentResult.rows.length > 0) {
      await query(`DELETE FROM students WHERE user_id = $1`, [user.id]);
      console.log('  ✅ Deleted student record');
    }
    
    // 2. Delete school associations
    const schoolAssoc = await query(`DELETE FROM school_user_associations WHERE user_id = $1`, [user.id]);
    if (schoolAssoc.rowCount && schoolAssoc.rowCount > 0) {
      console.log('  ✅ Deleted school associations');
    }
    
    // 3. Delete corporate associations (just in case)
    const corpAssoc = await query(`DELETE FROM corporate_user_associations WHERE user_id = $1`, [user.id]);
    if (corpAssoc.rowCount && corpAssoc.rowCount > 0) {
      console.log('  ✅ Deleted corporate associations');
    }
    
    // 4. Delete user
    await query(`DELETE FROM users WHERE id = $1`, [user.id]);
    console.log('  ✅ Deleted user account');
    
    console.log('\n✅ Successfully deleted wrongly created student!');
    console.log('📝 You can now create the student again with the corrected code.\n');
    
    process.exit(0);
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

deleteWrongStudent();
