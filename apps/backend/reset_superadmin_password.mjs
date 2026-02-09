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
    
    const newPassword = 'Superadmin@123';
    const saltRounds = 10;
    const hashedPassword = await bcryptjs.hash(newPassword, saltRounds);
    
    // Update the password
    const result = await pool.query(
      `UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE email = $2 AND id = $3 RETURNING email, id`,
      [hashedPassword, 'newadmin@smartattend.local', '42c836f0-527e-4bd8-834c-31f82c2afcb2']
    );
    
    if (result.rows.length === 0) {
      console.log('❌ User not found');
      await pool.end();
      return;
    }
    
    console.log('✅ Password reset successfully\n');
    console.log('━'.repeat(70));
    console.log('📧 Email:    newadmin@smartattend.local');
    console.log('🔑 Password: Superadmin@123');
    console.log('━'.repeat(70));
    console.log('\n✅ Try logging in with these NEW credentials\n');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

resetSuperadminPassword();
