import { query } from './src/db/connection.js';

async function checkDepartments() {
  // Check if departments table exists
  const tables = await query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE '%department%'`
  );
  console.log('Department-related tables:', tables.rows);

  // Check if department_id FK references anything
  const fks = await query(
    `SELECT tc.constraint_name, ccu.table_name AS foreign_table_name, ccu.column_name AS foreign_column_name
     FROM information_schema.table_constraints AS tc
     JOIN information_schema.constraint_column_usage AS ccu ON ccu.constraint_name = tc.constraint_name
     WHERE tc.table_name = 'students' AND tc.constraint_type = 'FOREIGN KEY' AND ccu.column_name LIKE '%department%' OR tc.table_name = 'students' AND tc.constraint_type = 'FOREIGN KEY'`
  );
  console.log('Students FK constraints:', fks.rows);

  process.exit(0);
}
checkDepartments();
