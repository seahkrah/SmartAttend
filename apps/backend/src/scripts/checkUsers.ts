/**
 * Check Users Script
 * 
 * Simple Node.js script to check if there are users in the database
 * Run with: node apps/backend/dist/scripts/checkUsers.js
 */

import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'smartattend',
  user: 'smartattend_user',
  password: 'smartattend_password',
});

async function checkUsers() {
  try {
    console.log('Checking users in database...\n');
    
    // Get all users
    const usersResult = await pool.query(`
      SELECT 
        u.id, 
        u.email, 
        u.full_name, 
        u.is_active,
        r.name as role,
        p.name as platform
      FROM users u
      LEFT JOIN roles r ON u.role_id = r.id
      LEFT JOIN platforms p ON u.platform_id = p.id
      ORDER BY u.created_at DESC
      LIMIT 20
    `);
    
    if (usersResult.rows.length === 0) {
      console.log('❌ No users found in database!');
      console.log('\nYou need to create a user first.');
      console.log('Options:');
      console.log('1. Register via the frontend (school/corporate users)');
      console.log('2. Create a superadmin via /register-superadmin endpoint');
    } else {
      console.log(`✅ Found ${usersResult.rows.length} users:\n`);
      console.table(usersResult.rows);
      
      // Check for specific test users
      const testUsers = usersResult.rows.filter(u => 
        u.email.includes('test') || 
        u.email.includes('admin') ||
        u.email.includes('demo')
      );
      
      if (testUsers.length > 0) {
        console.log('\n🔍 Test/Admin users found:');
        testUsers.forEach(u => {
          console.log(`  - ${u.email} (${u.role}, ${u.platform}) - ${u.is_active ? 'ACTIVE' : 'INACTIVE'}`);
        });
      }
    }
    
    // Check platforms
    const platformsResult = await pool.query('SELECT * FROM platforms');
    console.log('\n📋 Platforms:');
    console.table(platformsResult.rows);
    
    // Check roles
    const rolesResult = await pool.query('SELECT * FROM roles');
    console.log('\n👥 Roles:');
    console.table(rolesResult.rows);
    
    await pool.end();
  } catch (error) {
    console.error('Error checking users:', error);
    await pool.end();
    process.exit(1);
  }
}

checkUsers();
