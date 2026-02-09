const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:seahkrah@localhost:5432/smartattend'
});

(async () => {
  try {
    const result = await pool.query('DELETE FROM migrations WHERE name = $1', ['012_platform_metrics_7_1.sql']);
    console.log('[OK] Database cleaned - migration 012 removed');
    process.exit(0);
  } catch (e) {
    console.error('[ERROR]', e.message);
    process.exit(1);
  }
})();
