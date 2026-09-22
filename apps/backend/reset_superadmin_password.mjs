import pg from 'pg';
import bcryptjs from 'bcryptjs';
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

async function resetSuperadminPassword() {
  try {
    console.log('🔄 Resetting superadmin password...\n');
    
    const newPassword = process.env.NEW_PASSWORD;
    if (!newPassword) {
      console.error('Set NEW_PASSWORD before running this script.');
      await pool.end();
      process.exit(1);
    }
    const saltRounds = 10;
    const hashedPassword = await bcryptjs.hash(newPassword, saltRounds);
    
    // Update the password
    const result = await pool.query(
      `UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE email = $2 AND id = $3 RETURNING email, id`,
      [hashedPassword, process.env.TARGET_EMAIL, process.env.TARGET_USER_ID]
    );
    
    if (result.rows.length === 0) {
      console.log('❌ User not found');
      await pool.end();
      return;
    }
    
    console.log('✅ Password reset successfully\n');
    console.log('━'.repeat(70));
    console.log(`📧 Email:    ${result.rows[0].email}`);
    console.log('🔑 Password: (the value you passed in NEW_PASSWORD)');
    console.log('━'.repeat(70));
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

resetSuperadminPassword();
