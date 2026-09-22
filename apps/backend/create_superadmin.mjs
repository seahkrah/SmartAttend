import pg from 'pg';
import bcrypt from 'bcryptjs';
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

async function createNewSuperadmin() {
  try {
    console.log('🔧 Setting up new superadmin account...\n');
    
    // 1. Ensure system platform exists
    console.log('📍 Ensuring system platform exists...');
    const platformResult = await pool.query(
      `INSERT INTO platforms (name, display_name)
       VALUES ('system', 'System Management')
       ON CONFLICT (name) DO NOTHING
       RETURNING id`
    );
    
    let systemPlatformId = platformResult.rows[0]?.id;
    if (!systemPlatformId) {
      const existing = await pool.query(`SELECT id FROM platforms WHERE name = 'system'`);
      systemPlatformId = existing.rows[0].id;
    }
    console.log('✅ System platform ID: ' + systemPlatformId);
    
    // 2. Create superadmin role
    console.log('📍 Ensuring superadmin role exists...');
    const roleResult = await pool.query(
      `INSERT INTO roles (platform_id, name, description, permissions)
       VALUES ($1, 'superadmin', 'Superadmin - Full Platform Access', $2)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [
        systemPlatformId,
        JSON.stringify([
          'manage_all_entities',
          'manage_all_users',
          'view_all_data',
          'view_all_approvals',
          'approve_all_requests',
          'manage_roles',
          'view_audit_logs',
          'system_settings',
          'view_analytics',
          'manage_platforms'
        ])
      ]
    );
    
    let superadminRoleId = roleResult.rows[0]?.id;
    if (!superadminRoleId) {
      const existing = await pool.query(
        `SELECT id FROM roles WHERE name = 'superadmin' AND platform_id = $1`,
        [systemPlatformId]
      );
      superadminRoleId = existing.rows[0].id;
    }
    console.log('✅ Superadmin role ID: ' + superadminRoleId);
    
    // 3. Create new superadmin user with a fresh email and known password
    console.log('📍 Creating new superadmin user...');
    const newEmail = 'newadmin@jjelotech.local';
    const newPassword = 'NewAdmin123!@#';
    
    // Hash the password using bcrypt
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);
    
    const userResult = await pool.query(
      `INSERT INTO users (platform_id, email, full_name, role_id, password_hash, is_active)
       VALUES ($1, $2, $3, $4, $5, true)
       ON CONFLICT (platform_id, email) DO UPDATE
       SET password_hash = $5, is_active = true, updated_at = CURRENT_TIMESTAMP
       RETURNING id, email`,
      [systemPlatformId, newEmail, 'New System Admin', superadminRoleId, hashedPassword]
    );
    
    const superadminUser = userResult.rows[0];
    console.log('✅ Superadmin user created: ' + superadminUser.email);
    
    console.log('\n' + '═'.repeat(70));
    console.log('🎉 NEW SUPERADMIN ACCOUNT CREATED');
    console.log('═'.repeat(70));
    console.log('\nEmail:    ' + newEmail);
    console.log('Password: ' + newPassword);
    console.log('\n' + '═'.repeat(70));
    console.log('\nYou can now:');
    console.log('1. Login to the app with these credentials');
    console.log('2. Manage or delete the other superadmin accounts');
    console.log('3. Update this password once you regain control');
    console.log('\n✅ Done\n');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

createNewSuperadmin();
