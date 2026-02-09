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

async function checkAllEmails() {
  try {
    console.log('🔍 Checking ALL users and their platforms...\n');
    
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
      ORDER BY u.email, p.name
    `);
    
    console.log('Total users: ' + result.rows.length + '\n');
    
    let currentEmail = '';
    for (const row of result.rows) {
      if (row.email !== currentEmail) {
        if (currentEmail !== '') {
          console.log('');
        }
        currentEmail = row.email;
        console.log('📧 ' + row.email);
      }
      console.log('   → ' + (row.platform_name || 'NULL').padEnd(15) + ' | Role: ' + (row.role_name || 'NULL').padEnd(15) + ' | Active: ' + (row.is_active ? 'YES' : 'NO'));
    }
    
    console.log('\n');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

checkAllEmails();
