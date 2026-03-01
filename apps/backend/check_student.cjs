const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({ connectionString: 'postgresql://postgres:seahkrah@localhost:5432/smartattend' });

const emails = ['joyneufville@gmail.com', 'anyema@gmail.com'];
const newPassword = 'Student123!';

(async () => {
  try {
    const newHash = await bcrypt.hash(newPassword, 12);
    console.log('New hash generated:', newHash);
    
    // Verify the new hash works
    const verify = await bcrypt.compare(newPassword, newHash);
    console.log('Hash verification:', verify);
    
    for (const email of emails) {
      const result = await pool.query(
        "UPDATE users SET password_hash = $1 WHERE email = $2 RETURNING id, email",
        [newHash, email]
      );
      if (result.rows.length > 0) {
        console.log('Updated:', result.rows[0].email, result.rows[0].id);
        
        // Re-read and verify
        const check = await pool.query("SELECT password_hash FROM users WHERE email = $1", [email]);
        const savedHash = check.rows[0].password_hash;
        const matchAfterSave = await bcrypt.compare(newPassword, savedHash);
        console.log('  Saved hash matches:', matchAfterSave);
        console.log('  Saved hash === generated hash:', savedHash === newHash);
      } else {
        console.log('NOT FOUND:', email);
      }
    }
    
    console.log('\nDone! Students can now log in with:', newPassword);
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await pool.end();
  }
})();
