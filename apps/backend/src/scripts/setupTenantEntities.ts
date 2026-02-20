/**
 * Setup Tenant Entities and Link Admins
 * 
 * Creates school and corporate entities and links the admin test users to them
 */

import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'smartattend',
  user: 'postgres',
  password: 'seahkrah',
});

async function setupTenantEntities() {
  try {
    console.log('Setting up tenant entities and admin links...\n');
    
    // Get admin users
    const adminsResult = await pool.query(`
      SELECT u.id, u.email, u.full_name, p.name as platform
      FROM users u
      JOIN platforms p ON u.platform_id = p.id
      JOIN roles r ON u.role_id = r.id
      WHERE r.name = 'admin' AND u.email LIKE '%@%.test'
    `);
    
    console.log(`Found ${adminsResult.rows.length} admin users:`,);
    adminsResult.rows.forEach(admin => {
      console.log(`  - ${admin.email} (${admin.platform})`);
    });
    console.log('');
    
    const schoolAdmin = adminsResult.rows.find(a => a.platform === 'school');
    const corporateAdmin = adminsResult.rows.find(a => a.platform === 'corporate');
    
    if (!schoolAdmin) {
      console.log('❌ No school admin found!');
      return;
    }
    
    if (!corporateAdmin) {
      console.log('❌ No corporate admin found!');
      return;
    }
    
    // Create or update school entity
    let schoolEntityId;
    const existingSchool = await pool.query(`
      SELECT id FROM school_entities WHERE admin_user_id = $1
    `, [schoolAdmin.id]);
    
    if (existingSchool.rows.length > 0) {
      schoolEntityId = existingSchool.rows[0].id;
      console.log(`✓ School entity already exists for ${schoolAdmin.email}`);
    } else {
      // Generate SAS code
      const schoolResult = await pool.query(`
        INSERT INTO school_entities (
          name, 
          code, 
          admin_user_id,
          email,
          address,
          is_active
        )
        VALUES ($1, $2, $3, $4, $5, true)
        RETURNING id
      `, [
        'Test School',
        'TS001',
        schoolAdmin.id,
        'admin@testschool.edu',
        '123 Education Ave, Learning City'
      ]);
      
      schoolEntityId = schoolResult.rows[0].id;
      console.log(`✅ Created school entity: Test School (${schoolAdmin.email})`);
    }
    
    // Link school admin to entity via association table
    const existingSchoolAssoc = await pool.query(`
      SELECT id FROM school_user_associations 
      WHERE user_id = $1 AND school_entity_id = $2
    `, [schoolAdmin.id, schoolEntityId]);
    
    if (existingSchoolAssoc.rows.length === 0) {
      await pool.query(`
        INSERT INTO school_user_associations (user_id, school_entity_id, status, assigned_at)
        VALUES ($1, $2, 'active', NOW())
      `, [schoolAdmin.id, schoolEntityId]);
      console.log(`✅ Linked ${schoolAdmin.email} to Test School`);
    } else {
      console.log(`✓ ${schoolAdmin.email} already linked to Test School`);
    }
    
    // Create or update corporate entity
    let corporateEntityId;
    const existingCorporate = await pool.query(`
      SELECT id FROM corporate_entities WHERE admin_user_id = $1
    `, [corporateAdmin.id]);
    
    if (existingCorporate.rows.length > 0) {
      corporateEntityId = existingCorporate.rows[0].id;
      console.log(`✓ Corporate entity already exists for ${corporateAdmin.email}`);
    } else {
      const corporateResult = await pool.query(`
        INSERT INTO corporate_entities (
          name, 
          code, 
          admin_user_id,
          email,
          headquarters_address,
          is_active
        )
        VALUES ($1, $2, $3, $4, $5, true)
        RETURNING id
      `, [
        'Test Corporation',
        'TC001',
        corporateAdmin.id,
        'admin@testcorp.com',
        '456 Business Blvd, Commerce City'
      ]);
      
      corporateEntityId = corporateResult.rows[0].id;
      console.log(`✅ Created corporate entity: Test Corporation (${corporateAdmin.email})`);
    }
    
    // Link corporate admin to entity via association table
    const existingCorpAssoc = await pool.query(`
      SELECT id FROM corporate_user_associations 
      WHERE user_id = $1 AND corporate_entity_id = $2
    `, [corporateAdmin.id, corporateEntityId]);
    
    if (existingCorpAssoc.rows.length === 0) {
      await pool.query(`
        INSERT INTO corporate_user_associations (user_id, corporate_entity_id, status, assigned_at)
        VALUES ($1, $2, 'active', NOW())
      `, [corporateAdmin.id, corporateEntityId]);
      console.log(`✅ Linked ${corporateAdmin.email} to Test Corporation`);
    } else {
      console.log(`✓ ${corporateAdmin.email} already linked to Test Corporation`);
    }
    
    // Link other test users to their entities
    const otherUsersResult = await pool.query(`
      SELECT u.id, u.email, u.full_name, p.name as platform, r.name as role
      FROM users u
      JOIN platforms p ON u.platform_id = p.id
      JOIN roles r ON u.role_id = r.id
      WHERE u.email LIKE '%@%.test' AND r.name != 'admin'
    `);
    
    console.log(`\nLinking ${otherUsersResult.rows.length} other test users to entities...`);
    
    for (const user of otherUsersResult.rows) {
      if (user.platform === 'school') {
        const existingAssoc = await pool.query(`
          SELECT id FROM school_user_associations 
          WHERE user_id = $1 AND school_entity_id = $2
        `, [user.id, schoolEntityId]);
        
        if (existingAssoc.rows.length === 0) {
          await pool.query(`
            INSERT INTO school_user_associations (user_id, school_entity_id, status, assigned_at)
            VALUES ($1, $2, 'active', NOW())
          `, [user.id, schoolEntityId]);
          console.log(`  ✅ Linked ${user.email} (${user.role}) to Test School`);
        }
      } else if (user.platform === 'corporate') {
        const existingAssoc = await pool.query(`
          SELECT id FROM corporate_user_associations 
          WHERE user_id = $1 AND corporate_entity_id = $2
        `, [user.id, corporateEntityId]);
        
        if (existingAssoc.rows.length === 0) {
          await pool.query(`
            INSERT INTO corporate_user_associations (user_id, corporate_entity_id, status, assigned_at)
            VALUES ($1, $2, 'active', NOW())
          `, [user.id, corporateEntityId]);
          console.log(`  ✅ Linked ${user.email} (${user.role}) to Test Corporation`);
        }
      }
    }
    
    console.log('\n✅ Setup complete!');
    console.log('\nYou can now login as:');
    console.log('  - admin@school.test / Test123! (manages Test School)');
    console.log('  - admin@corporate.test / Test123! (manages Test Corporation)');
    
    await pool.end();
  } catch (error) {
    console.error('Error:', error);
    await pool.end();
    process.exit(1);
  }
}

setupTenantEntities();
