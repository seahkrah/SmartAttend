import { query } from './src/db/connection.js';

async function checkSchoolDepartments() {
  // Check school_departments columns
  const cols = await query(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_name='school_departments' ORDER BY ordinal_position`
  );
  console.log('school_departments columns:');
  cols.rows.forEach(c => console.log(`  - ${c.column_name} (${c.data_type})`));

  // Check existing departments
  const deps = await query(`SELECT * FROM school_departments LIMIT 10`);
  console.log('\nExisting departments:', deps.rows);

  process.exit(0);
}
checkSchoolDepartments();
