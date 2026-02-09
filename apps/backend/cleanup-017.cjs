const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:seahkrah@localhost:5432/smartattend'
});

(async () => {
  try {
    // Delete problematic migrations
    await pool.query('DELETE FROM migrations WHERE name = $1', ['017_face_recognition_and_sessions.sql']);
    
    // Drop tables if they exist from failed 017 run
    await pool.query(`
      DROP TABLE IF EXISTS attendance_with_sessions CASCADE;
      DROP TABLE IF EXISTS course_sessions CASCADE;
      DROP TABLE IF EXISTS face_recognition_verifications CASCADE;
      DROP TABLE IF EXISTS face_recognition_enrollments CASCADE;
    `);
    
    console.log('[OK] Cleaned up migration 017 and related tables');
    process.exit(0);
  } catch (e) {
    console.error('[ERROR]', e.message);
    process.exit(1);
  }
})();
