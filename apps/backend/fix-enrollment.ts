import { query } from './src/db/connection.js';

async function fixSchema() {
  await query('ALTER TABLE students ALTER COLUMN enrollment_year DROP NOT NULL');
  console.log('✅ enrollment_year is now nullable');
  await query('ALTER TABLE students ALTER COLUMN is_currently_enrolled DROP NOT NULL');
  console.log('✅ is_currently_enrolled is now nullable');
  process.exit(0);
}
fixSchema();
