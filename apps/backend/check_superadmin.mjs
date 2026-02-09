import pg from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '.env') });

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function checkSuperadminAccount() {
  try {
    console.log('🔍 Checking superadmin account in all platforms...\n');
    
    // Find all instances of newadmin account
    const result = await pool.query(`
      SELECT 
        u.id,
        u.email,
        u.full_name,
        u.platform_id,
        p.name as platform_name,
        r.name as role_name,
        u.is_active
      FROM users u
      LEFT JOIN platforms p ON u.platform_id = p.id
      LEFT JOIN roles r ON u.role_id = r.id
      WHERE u.email = 'newadmin@smartattend.local'
      ORDER BY p.name
    `);
    
    console.log('Found ' + result.rows.length + ' account(s) with email newadmin@smartattend.local:\n');
    
    for (const row of result.rows) {
      console.log('━'.repeat(70));
      console.log('ID:        ' + row.id);
      console.log('Email:     ' + row.email);
      console.log('Name:      ' + row.full_name);
      console.log('Platform:  ' + (row.platform_name || 'NULL'));
      console.log('Role:      ' + (row.role_name || 'NULL'));
      console.log('Active:    ' + (row.is_active ? 'YES' : 'NO'));
    }
    
    console.log('\n' + '━'.repeat(70));
    
    if (result.rows.length > 1) {
      console.log('\n❌ ERROR: Same email on multiple platforms!');
      console.log('This is the problem - the user can login with different roles on different platforms.');
      console.log('\nSolution: Delete the duplicate accounts on school/corporate platforms.');
    } else if (result.rows.length === 0) {
      console.log('\n❌ ERROR: No superadmin account found!');
    } else {
      const row = result.rows[0];
      if (row.platform_name !== 'system') {
        console.log('\n❌ ERROR: Superadmin is on ' + row.platform_name + ' platform, not SYSTEM platform!');
        console.log('Superadmin users MUST be on the SYSTEM platform only.');
      } else if (row.role_name !== 'superadmin') {
        console.log('\n❌ ERROR: User has role: ' + row.role_name + ', not superadmin!');
      } else {
        console.log('\n✅ Superadmin account looks correct');
      }
    }
    
    console.log('\n');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

checkSuperadminAccount();
