/**
 * Check if platforms and roles are seeded in the database
 */

import { query } from './src/db/connection.js';

async function checkSeedData() {
  console.log('🔍 Checking database seed data...\n');

  try {
    // Check platforms
    const platformResult = await query(`SELECT * FROM platforms ORDER BY name`);
    console.log('=== Platforms ===');
    if (platformResult.rows.length === 0) {
      console.log('❌ No platforms found! Database needs seeding.');
    } else {
      platformResult.rows.forEach(p => {
        console.log(`✅ ${p.name} (${p.display_name})`);
      });
    }

    // Check roles
    const roleResult = await query(`
      SELECT r.name, p.name as platform_name 
      FROM roles r 
      JOIN platforms p ON r.platform_id = p.id 
      ORDER BY p.name, r.name
    `);
    console.log('\n=== Roles ===');
    if (roleResult.rows.length === 0) {
      console.log('❌ No roles found! Database needs seeding.');
    } else {
      roleResult.rows.forEach(r => {
        console.log(`✅ ${r.platform_name}: ${r.name}`);
      });
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Error checking seed data:', error);
    process.exit(1);
  }
}

checkSeedData();
