import { query } from './src/db/connection.js';

async function checkStudentsTable() {
  const result = await query(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_name='students' ORDER BY ordinal_position`
  );
  console.log('Students table columns:');
  result.rows.forEach(c => console.log(`  - ${c.column_name} (${c.data_type})`));
  process.exit(0);
}
checkStudentsTable();
