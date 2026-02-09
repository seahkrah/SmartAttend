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

async function main() {
  try {
    console.log('🔍 Connecting to database...\n');
    
    const result = await pool.query('SELECT COUNT(*) as count FROM users');
    const count = result.rows[0].count;
    console.log('Total Users: ' + count + '\n');
    
    const users = await pool.query('SELECT id, email, full_name, is_active, created_at FROM users ORDER BY created_at DESC');
    
    console.log('Users in database:');
    console.log('─'.repeat(100));
    for (const user of users.rows) {
      const active = user.is_active ? '✅' : '❌';
      console.log(active + ' ' + user.email + ' | ' + (user.full_name || 'N/A'));
    }
    console.log('─'.repeat(100));
    
    const platforms = await pool.query('SELECT DISTINCT platform_id FROM users');
    console.log('\nPlatforms: ' + platforms.rows.length);
    
    const roles = await pool.query('SELECT p.name, COUNT(DISTINCT u.id) as user_count FROM users u LEFT JOIN platforms p ON u.platform_id = p.id GROUP BY p.name');
    console.log('\nUsers by Platform:');
    for (const row of roles.rows) {
      console.log('  - ' + (row.name || 'System') + ': ' + row.user_count + ' users');
    }
    
    console.log('\n✅ Done');
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await pool.end();
  }
}

main();
