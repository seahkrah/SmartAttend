import pg from 'pg';

const connectionString = 'postgresql://smartattend_user:smartattend_password@localhost:5432/smartattend_db';
const pool = new pg.Pool({ connectionString });

async function checkMigrations() {
  try {
    const result = await pool.query('SELECT name, completed_at FROM migrations ORDER BY name');
    console.log('\n=== Migration Status ===\n');
    result.rows.forEach(row => {
      const status = row.completed_at ? '✅' : '❌';
      console.log(`${status} ${row.name}`);
    });
    console.log('\nMigrations executed: ' + result.rows.filter(r => r.completed_at).length + '/' + result.rows.length);
    await pool.end();
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

checkMigrations();
