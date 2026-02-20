/**
 * Debug script to check created users and their platforms
 */

import { query } from './src/db/connection.js';

async function checkRecentUsers() {
  console.log('🔍 Checking recently created users...\n');

  try {
    const usersResult = await query(`
      SELECT u.id, u.email, u.full_name, u.is_active, 
             p.name as platform_name, r.name as role_name,
             u.created_at
      FROM users u
      JOIN platforms p ON u.platform_id = p.id
      JOIN roles r ON u.role_id = r.id
      ORDER BY u.created_at DESC
      LIMIT 10
    `);

    console.log('=== Recent Users ===');
    usersResult.rows.forEach(u => {
      console.log(`${u.full_name} (${u.email})`);
      console.log(`  Platform: ${u.platform_name}`);
      console.log(`  Role: ${u.role_name}`);
      console.log(`  Active: ${u.is_active}`);
      console.log(`  Created: ${u.created_at}`);
      console.log('');
    });

    // Check school_user_associations
    const associationsResult = await query(`
      SELECT sua.*, u.email, u.full_name, se.name as school_name
      FROM school_user_associations sua
      JOIN users u ON sua.user_id = u.id
      JOIN school_entities se ON sua.school_entity_id = se.id
      ORDER BY u.created_at DESC
      LIMIT 10
    `);

    console.log('=== Recent School Associations ===');
    if (associationsResult.rows.length === 0) {
      console.log('❌ No school associations found!');
    } else {
      associationsResult.rows.forEach(a => {
        console.log(`${a.full_name} (${a.email})`);
        console.log(`  School: ${a.school_name}`);
        console.log(`  Status: ${a.status}`);
        console.log('');
      });
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

checkRecentUsers();
