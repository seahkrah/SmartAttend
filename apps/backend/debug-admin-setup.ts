/**
 * Debug: Check admin user's platform and available roles
 */

import { query } from './src/db/connection.js';

async function debugAdminSetup() {
  console.log('🔍 Debugging admin setup for student creation...\n');

  try {
    // Get the school admin (most recent login)
    const adminResult = await query(`
      SELECT u.id, u.email, u.full_name, p.name as platform_name, r.name as role_name
      FROM users u
      JOIN platforms p ON u.platform_id = p.id
      JOIN roles r ON u.role_id = r.id
      WHERE r.name = 'admin' AND p.name = 'school'
      ORDER BY u.last_login DESC NULLS LAST
      LIMIT 1
    `);

    if (adminResult.rows.length === 0) {
      console.log('❌ No school admin found!');
      return;
    }

    const admin = adminResult.rows[0];
    console.log('=== Admin User ===');
    console.log(`Name: ${admin.full_name} (${admin.email})`);
    console.log(`Platform: ${admin.platform_name}`);
    console.log(`Role: ${admin.role_name}`);
    console.log(`User ID: ${admin.id}`);
    console.log('');

    // Check school entity association
    const entityResult = await query(`
      SELECT se.id, se.name, se.is_active
      FROM school_entities se
      WHERE se.admin_user_id = $1
    `, [admin.id]);

    console.log('=== School Entity ===');
    if (entityResult.rows.length === 0) {
      console.log('❌ Admin not assigned to any school entity!');
    } else {
      const entity = entityResult.rows[0];
      console.log(`School: ${entity.name}`);
      console.log(`Entity ID: ${entity.id}`);
      console.log(`Active: ${entity.is_active}`);
    }
    console.log('');

    // Get admin's platform details
    const platformResult = await query(`
      SELECT u.platform_id, p.name as platform_name
      FROM users u
      JOIN platforms p ON u.platform_id = p.id
      WHERE u.id = $1
    `, [admin.id]);

    const adminPlatform = platformResult.rows[0];
    console.log('=== Admin Platform Details ===');
    console.log(`Platform ID: ${adminPlatform.platform_id}`);
    console.log(`Platform Name: ${adminPlatform.platform_name}`);
    console.log('');

    // Check if student role exists for this platform
    const studentRoleResult = await query(`
      SELECT id, name, platform_id
      FROM roles
      WHERE name = 'student' AND platform_id = $1
    `, [adminPlatform.platform_id]);

    console.log('=== Student Role Check ===');
    if (studentRoleResult.rows.length === 0) {
      console.log('❌ Student role NOT FOUND for platform:', adminPlatform.platform_name);
      
      // Show all roles for this platform
      const allRolesResult = await query(`
        SELECT name FROM roles WHERE platform_id = $1
      `, [adminPlatform.platform_id]);
      
      console.log('Available roles for this platform:');
      allRolesResult.rows.forEach(r => console.log(`  - ${r.name}`));
    } else {
      console.log('✅ Student role exists');
      console.log(`   Role ID: ${studentRoleResult.rows[0].id}`);
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

debugAdminSetup();
