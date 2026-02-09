const pg = require('pg');
const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function cleanup() {
  try {
    await client.connect();
    console.log('[OK] Connected to database');
    
    // Remove failed migrations
    await client.query('DELETE FROM migrations WHERE name = $1', ['001_init_schema.sql']);
    console.log('[REMOVED] 001_init_schema.sql');
    
    await client.query('DELETE FROM migrations WHERE name = $1', ['004_superadmin_system.sql']);
    console.log('[REMOVED] 004_superadmin_system.sql');
    
    // Display remaining migrations
    const result = await client.query('SELECT name, executed_at FROM migrations ORDER BY executed_at');
    console.log('');
    console.log('Remaining migrations:');
    if (result.rows.length === 0) {
      console.log('  (none)');
    } else {
      result.rows.forEach(row => {
        console.log('  - ' + row.name);
      });
    }
    
    console.log('');
    console.log('[SUCCESS] Database cleanup completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('[ERROR] Cleanup failed: ' + error.message);
    process.exit(1);
  } finally {
    try {
      await client.end();
    } catch (e) {}
  }
}

cleanup();
