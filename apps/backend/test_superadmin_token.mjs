import pg from 'pg';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
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

async function testSuperadminToken() {
  try {
    console.log('🔍 Testing superadmin token and /auth/me endpoint\n');
    
    // 1. Get the new superadmin user
    const userResult = await pool.query(`
      SELECT u.id, u.email, u.full_name, u.platform_id, u.role_id, r.name as role_name
      FROM users u
      LEFT JOIN roles r ON u.role_id = r.id
      WHERE u.email = 'newadmin@smartattend.local'
    `);
    
    if (userResult.rows.length === 0) {
      console.log('❌ Superadmin user not found');
      await pool.end();
      return;
    }
    
    const user = userResult.rows[0];
    console.log('✅ Found superadmin user:');
    console.log('   ID:', user.id);
    console.log('   Email:', user.email);
    console.log('   Name:', user.full_name);
    console.log('   Role:', user.role_name);
    console.log('   Role ID:', user.role_id);
    console.log('   Platform ID:', user.platform_id);
    
    // 2. Simulate token generation
    const JWT_SECRET = process.env.JWT_SECRET || 'your_super_secret_jwt_key_change_this_in_production';
    const token = jwt.sign(
      { userId: user.id, platformId: user.platform_id, roleId: user.role_id },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    console.log('\n📋 Generated token payload:');
    const decoded = jwt.decode(token);
    console.log('   ', JSON.stringify(decoded, null, 2));
    
    // 3. Simulate what /auth/me does
    console.log('\n🔎 Simulating /auth/me endpoint:');
    const userWithRoleResult = await pool.query(`
      SELECT u.*, r.name as role_name, r.permissions FROM users u
      LEFT JOIN roles r ON u.role_id = r.id
      WHERE u.id = $1
    `, [user.id]);
    
    if (userWithRoleResult.rows.length === 0) {
      console.log('❌ User not found in /auth/me lookup');
      await pool.end();
      return;
    }
    
    const userFromMe = userWithRoleResult.rows[0];
    
    // Get platform name
    const platformResult = await pool.query(
      `SELECT name FROM platforms WHERE id = $1`,
      [userFromMe.platform_id]
    );
    
    const platformName = platformResult.rows[0]?.name || 'unknown';
    
    console.log('✅ /auth/me would return:');
    console.log('   ID:', userFromMe.id);
    console.log('   Email:', userFromMe.email);
    console.log('   Full Name:', userFromMe.full_name);
    console.log('   Role: ' + userFromMe.role_name);
    console.log('   Platform:', platformName);
    console.log('   Permissions:', userFromMe.permissions);
    
    console.log('\n✅ Test complete\n');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

testSuperadminToken();
