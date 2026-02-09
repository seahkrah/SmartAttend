const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:seahkrah@localhost:5432/smartattend'
});

(async () => {
  try {
    // Get all table names
    const tablesResult = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
    `);
    
    // Drop all tables
    for (const row of tablesResult.rows) {
      console.log(`[DROP] ${row.table_name}`);
      await pool.query(`DROP TABLE IF EXISTS ${row.table_name} CASCADE`);
    }
    
    // Drop all types
    const typesResult = await pool.query(`
      SELECT type_name
      FROM information_schema.user_defined_types
      WHERE type_schema = 'public'
    `);
    
    for (const row of typesResult.rows) {
      console.log(`[DROP TYPE] ${row.type_name}`);
      await pool.query(`DROP TYPE IF EXISTS ${row.type_name} CASCADE`);
    }
    
    console.log('[OK] Database completely reset - all tables and types dropped');
    process.exit(0);
  } catch (e) {
    console.error('[ERROR]', e.message);
    process.exit(1);
  }
})();
