import { query } from './src/db/connection.js';

async function checkSystemUsers() {
  try {
    console.log('🔍 Checking all users on System platform...\n');
    
    const result = await query(
      `SELECT u.id, u.email, u.full_name, u.created_at, p.name as platform_name, r.name as role_name
       FROM users u
       JOIN platforms p ON u.platform_id = p.id
       JOIN roles r ON u.role_id = r.id
       WHERE p.name = 'system'
       ORDER BY u.created_at DESC`
    );
    
    if (result.rows.length === 0) {
      console.log('✅ No users found on System platform (all correct!)');
    } else {
      console.log(`Found ${result.rows.length} user(s) on System platform:\n`);
      result.rows.forEach((user, index) => {
        console.log(`${index + 1}. ${user.full_name} (${user.email})`);
        console.log(`   Role: ${user.role_name}`);
        console.log(`   Created: ${user.created_at}`);
        console.log(`   ID: ${user.id}\n`);
      });
    }
    
    // Now check school platform students
    console.log('\n🏫 Checking students on School platform...\n');
    
    const schoolResult = await query(
      `SELECT u.id, u.email, u.full_name, u.created_at, p.name as platform_name, r.name as role_name
       FROM users u
       JOIN platforms p ON u.platform_id = p.id
       JOIN roles r ON u.role_id = r.id
       WHERE p.name = 'school' AND r.name = 'student'
       ORDER BY u.created_at DESC`
    );
    
    if (schoolResult.rows.length === 0) {
      console.log('ℹ️  No students found on School platform yet');
    } else {
      console.log(`Found ${schoolResult.rows.length} student(s) on School platform:\n`);
      schoolResult.rows.forEach((user, index) => {
        console.log(`${index + 1}. ${user.full_name} (${user.email})`);
        console.log(`   Created: ${user.created_at}`);
        console.log(`   ID: ${user.id}\n`);
      });
    }
    
    process.exit(0);
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

checkSystemUsers();
