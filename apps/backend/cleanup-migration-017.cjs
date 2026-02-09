const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:seahkrah@localhost:5432/smartattend'
});

(async () => {
  try {
    // Delete migration 017
    const result = await pool.query('DELETE FROM migrations WHERE name = $1', ['017_face_recognition_and_sessions.sql']);
    console.log(`[OK] Deleted migration 017 - ${result.rowCount} rows deleted`);
    
    // Drop tables that were partially created
    await pool.query(`
      DROP TABLE IF EXISTS face_recognition_verifications CASCADE;
      DROP TABLE IF EXISTS face_recognition_enrollments CASCADE;
      DROP TABLE IF EXISTS course_sessions CASCADE;
    `);
    console.log('[OK] Dropped partial tables from failed migration');
    
    process.exit(0);
  } catch (e) {
    console.error('[ERROR]', e.message);
    process.exit(1);
  }
})();
