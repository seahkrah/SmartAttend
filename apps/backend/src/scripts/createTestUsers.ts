/**
 * Create Test User Script
 * 
 * Creates a test user for each platform to use for login testing
 */

import pkg from 'pg';
import bcrypt from 'bcryptjs';
const { Pool } = pkg;

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'smartattend',
  user: 'postgres',
  password: 'seahkrah',
});

async function createTestUsers() {
  try {
    console.log('Creating test users...\n');
    
    // Get platform IDs
    const platformsResult = await pool.query('SELECT id, name FROM platforms');
    const platforms = Object.fromEntries(
      platformsResult.rows.map(p => [p.name, p.id])
    );
    
    // Get role IDs
    const rolesResult = await pool.query('SELECT id, name FROM roles');
    const roles = Object.fromEntries(
      rolesResult.rows.map(r => [r.name, r.id])
    );
    
    console.log('Platforms:', platforms);
    console.log('Roles:', roles);
    console.log('');
    
    const testPassword = 'Test123!';
    const passwordHash = await bcrypt.hash(testPassword, 10);
    
    const testUsers = [
      {
        email: 'admin@school.test',
        full_name: 'School Admin Test',
        platform: 'school',
        role: 'admin',
        password: testPassword,
      },
      {
        email: 'admin@corporate.test',
        full_name: 'Corporate Admin Test',
        platform: 'corporate',
        role: 'admin',
        password: testPassword,
      },
      {
        email: 'faculty@school.test',
        full_name: 'Faculty Test User',
        platform: 'school',
        role: 'faculty',
        password: testPassword,
      },
      {
        email: 'student@school.test',
        full_name: 'Student Test User',
        platform: 'school',
        role: 'student',
        password: testPassword,
      },
      {
        email: 'employee@corporate.test',
        full_name: 'Employee Test User',
        platform: 'corporate',
        role: 'employee',
        password: testPassword,
      },
    ];
    
    for (const user of testUsers) {
      const platformId = platforms[user.platform];
      const roleId = roles[user.role];
      
      if (!platformId || !roleId) {
        console.log(`❌ Skipping ${user.email} - platform or role not found`);
        continue;
      }
      
      try {
        // Check if user already exists
        const existingUser = await pool.query(
          'SELECT id, email FROM users WHERE email = $1',
          [user.email]
        );
        
        if (existingUser.rows.length > 0) {
          console.log(`⚠️  ${user.email} already exists (${user.role}, ${user.platform})`);
          // Update password to ensure it matches
          await pool.query(
            'UPDATE users SET password_hash = $1 WHERE email = $2',
            [passwordHash, user.email]
          );
          console.log(`   ✓ Password updated to: ${testPassword}`);
        } else {
          await pool.query(
            `INSERT INTO users (email, full_name, password_hash, platform_id, role_id, is_active)
             VALUES ($1, $2, $3, $4, $5, true)`,
            [user.email, user.full_name, passwordHash, platformId, roleId]
          );
          console.log(`✅ Created ${user.email} (${user.role}, ${user.platform})`);
          console.log(`   Password: ${testPassword}`);
        }
      } catch (error) {
        console.error(`❌ Error creating ${user.email}:`, error.message);
      }
    }
    
    console.log('\n✅ Test user creation complete!');
    console.log('\nYou can now login with:');
    console.log('Email: admin@school.test or admin@corporate.test');
    console.log(`Password: ${testPassword}`);
    
    await pool.end();
  } catch (error) {
    console.error('Error:', error);
    await pool.end();
    process.exit(1);
  }
}

createTestUsers();
