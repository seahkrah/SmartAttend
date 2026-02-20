/**
 * Check specific user details
 */

import { query } from './src/db/connection.js';

async function checkUser() {
  console.log('🔍 Checking user details...\n');

  try {
    const userResult = await query(`
      SELECT u.*, r.name as role_name, p.name as platform_name
      FROM users u
      JOIN roles r ON u.role_id = r.id
      JOIN platforms p ON r.platform_id = p.id
      WHERE u.id = '9fa1368e-ffdb-4f67-be0a-1a9a02bf293e'
    `);
    
    if (userResult.rows.length === 0) {
      console.log('❌ User not found');
    } else {
      const user = userResult.rows[0];
      console.log('User Details:');
      console.log(`  Name: ${user.full_name}`);
      console.log(`  Email: ${user.email}`);
      console.log(`  Platform: ${user.platform_name}`);
      console.log(`  Role: ${user.role_name}`);
      console.log(`  Active: ${user.is_active}`);
    }

    // Check who is currently logged in (last login)
    const recentLogins = await query(`
      SELECT u.email, u.full_name, r.name as role_name, u.last_login
      FROM users u
      JOIN roles r ON u.role_id = r.id
      JOIN platforms p ON r.platform_id = p.id
      WHERE p.name = 'school'
      ORDER BY u.last_login DESC NULLS LAST
      LIMIT 5
    `);

    console.log('\n=== Recent School Platform Logins ===');
    recentLogins.rows.forEach(u => {
      console.log(`${u.full_name} (${u.email}) - Role: ${u.role_name}`);
      console.log(`  Last login: ${u.last_login || 'Never'}`);
    });

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

checkUser();
