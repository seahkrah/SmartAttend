import pg from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env
dotenv.config({ path: join(__dirname, '.env') });

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function checkUsers() {
  try {
    console.log('🔍 Connecting to database...\n');
    
    // Test connection
    const testResult = await pool.query('SELECT 1');
    console.log('✅ Database connection successful\n');
    
    // Query users
    const result = await pool.query(`
      SELECT 
        id,
        email,
        full_name,
        platform_id,
        role_id,
        is_active,
        created_at,
        last_login
      FROM users
      ORDER BY created_at DESC
    `);
    
    console.log(`📊 Total Users: ${result.rows.length}\n`);
    console.log('═'.repeat(130));
    console.log(`Email`.padEnd(40) + `Full Name`.padEnd(30) + `Active`.padEnd(8) + `Created`.padEnd(20) + `Last Login`);
    console.log('═'.repeat(130));
    
    for (const user of result.rows) {
      const email = (user.email || 'N/A').substring(0, 40).padEnd(40);
      const name = (user.full_name || 'N/A').substring(0, 30).padEnd(30);
      const active = user.is_active ? '✅ Yes' : '❌ No';
      const created = user.created_at ? new Date(user.created_at).toISOString().substring(0, 20) : 'N/A';
      const lastLogin = user.last_login ? new Date(user.last_login).toISOString().substring(0, 20) : 'Never';
      
      console.log(`${email} ${name} ${active.padEnd(8)} ${created.padEnd(20)} ${lastLogin}`);
    }
    console.log('═'.repeat(130));
    
    // Get roles info
    console.log('\n📋 Roles by Platform:\n');
    const rolesResult = await pool.query(`
      SELECT 
        p.name as platform_name,
        COUNT(DISTINCT r.id) as role_count,
        STRING_AGG(DISTINCT r.name, ', ' ORDER BY r.name) as role_names
      FROM roles r
      JOIN platforms p ON r.platform_id = p.id
      GROUP BY p.name
      ORDER BY p.name
    `);
    
    for (const row of rolesResult.rows) {
      console.log(`🏢 ${row.platform_name.toUpperCase()}`);
      console.log(`   Roles (${row.role_count}): ${row.role_names}\n`);
    }
    
    // Get user count by platform
    console.log('👥 Users by Platform:\n');
    const platformResult = await pool.query(`
      SELECT 
        COALESCE(p.name, 'unknown') as platform,
        COUNT(*) as user_count,
        SUM(CASE WHEN u.is_active = true THEN 1 ELSE 0 END) as active_count
      FROM users u
      LEFT JOIN platforms p ON u.platform_id = p.id
      GROUP BY p.name
      ORDER BY user_count DESC
    `);
    
    for (const row of platformResult.rows) {
      console.log(`  ${row.platform || 'N/A':<20} ${row.user_count} users (${row.active_count} active)`);
    }
    
    console.log('\n✅ Done\n');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

checkUsers();
