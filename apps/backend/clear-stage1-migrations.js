import { Client } from 'pg';

const client = new Client({ 
  connectionString: 'postgresql://postgres:seahkrah@localhost:5432/smartattend' 
});

await client.connect();

try {
  // Get all current migrations
  let res = await client.query(`SELECT * FROM migrations ORDER BY executed_at ASC`);
  console.log('Current migrations in DB:');
  res.rows.forEach(r => console.log(`  ${r.name}`));
  
  // Delete any failed Stage 1 migrations that might be stuck
  const stage1Migrations = [
    '006_add_platform_id_to_school_departments.sql',
    '007_add_platform_id_to_students.sql',
    '008_add_platform_id_to_corporate_departments.sql',
    '008_5_immutability_triggers.sql'
  ];
  
  console.log('\nClearing any previous Stage 1 entries...');
  for (const mig of stage1Migrations) {
    await client.query(`DELETE FROM migrations WHERE name = $1`, [mig]);
    console.log(`  Cleared: ${mig}`);
  }
  
  // Verify
  res = await client.query(`SELECT COUNT(*) as count FROM migrations`);
  console.log(`\nTotal migrations remaining: ${res.rows[0].count}`);
  
} catch (error) {
  console.error('Error:', error.message);
} finally {
  await client.end();
}
