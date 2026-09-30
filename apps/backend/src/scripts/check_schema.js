import pg from 'pg';
const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Export it (or source your .env) before running this script.');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function checkSchema() {
  try {
    console.log('\n=== SCHOOL_ATTENDANCE COLUMNS ===');
    const cols = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'school_attendance' 
      ORDER BY ordinal_position
    `);
    cols.rows.forEach(c => console.log(`${c.column_name}: ${c.data_type}`));

    await pool.end();
  } catch (error) {
    console.error('Error:', error.message);
    await pool.end();
  }
}

checkSchema();
