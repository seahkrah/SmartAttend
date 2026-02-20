/**
 * Check school admin associations
 */

import { query } from './src/db/connection.js';

async function checkAdminAssociation() {
  console.log('🔍 Checking school admin associations...\n');

  try {
    // Check school_entities table
    const entitiesResult = await query(`
      SELECT se.*, u.email as admin_email, u.full_name
      FROM school_entities se
      LEFT JOIN users u ON se.admin_user_id = u.id
      ORDER BY se.created_at
    `);
    
    console.log('=== School Entities ===');
    if (entitiesResult.rows.length === 0) {
      console.log('❌ No school entities found!');
    } else {
      entitiesResult.rows.forEach(e => {
        console.log(`School: ${e.name}`);
        console.log(`  Admin: ${e.full_name || 'NOT ASSIGNED'} (${e.admin_email || 'N/A'})`);
        console.log(`  Admin User ID: ${e.admin_user_id || 'NULL'}`);
        console.log('');
      });
    }

    // Check all users with role 'admin' in school platform
    const adminsResult = await query(`
      SELECT u.id, u.email, u.full_name, r.name as role_name, p.name as platform_name
      FROM users u
      JOIN roles r ON u.role_id = r.id
      JOIN platforms p ON r.platform_id = p.id
      WHERE p.name = 'school' AND r.name = 'admin'
    `);

    console.log('=== School Admin Users ===');
    if (adminsResult.rows.length === 0) {
      console.log('❌ No school admin users found!');
    } else {
      adminsResult.rows.forEach(admin => {
        console.log(`✅ ${admin.full_name} (${admin.email})`);
        console.log(`   User ID: ${admin.id}`);
      });
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

checkAdminAssociation();
