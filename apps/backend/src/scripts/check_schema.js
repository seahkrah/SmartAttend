import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  user: 'postgres',
  password: 'seahkrah',
  host: 'localhost',
  port: 5432,
  database: 'smartattend'
});

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
