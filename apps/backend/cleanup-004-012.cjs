const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:seahkrah@localhost:5432/smartattend'
});

(async () => {
  try {
    // Delete problematic migrations
    await pool.query('DELETE FROM migrations WHERE name IN ($1, $2)', ['004_superadmin_system.sql', '012_platform_metrics_7_1.sql']);
    
    console.log('[OK] Cleaned up migrations 004 and 012');
    process.exit(0);
  } catch (e) {
    console.error('[ERROR]', e.message);
    process.exit(1);
  }
})();
