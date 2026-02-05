import { Client } from 'pg';

const client = new Client({
  connectionString: 'postgresql://postgres:seahkrah@localhost:5432/smartattend'
});

await client.connect();

try {
  console.log('=== Cleaning up partial migrations ===\n');
  
  // Drop escalation_events if exists
  try {
    console.log('Dropping escalation_events table...');
    await client.query('DROP TABLE IF EXISTS escalation_events CASCADE;');
    console.log('✓ Dropped');
  } catch (e) {
    console.log('✗ Error:', e.message);
  }
  
  // Drop triggers
  const triggers = [
    'audit_logs_immutable_prevent_updates', 'audit_logs_immutable_prevent_deletes',
    'incident_state_history_immutable_prevent_updates', 'incident_state_history_immutable_prevent_deletes',
    'escalation_events_immutable_prevent_updates', 'escalation_events_immutable_prevent_deletes'
  ];
  
  for (const trigger of triggers) {
    try {
      await client.query(`DROP TRIGGER IF EXISTS ${trigger} ON audit_logs CASCADE;`);
      await client.query(`DROP TRIGGER IF EXISTS ${trigger} ON incident_state_history CASCADE;`);
      await client.query(`DROP TRIGGER IF EXISTS ${trigger} ON escalation_events CASCADE;`);
    } catch (e) {
      // Ignore
    }
  }
  console.log('✓ Dropped triggers');
  
  // Drop function
  try {
    await client.query('DROP FUNCTION IF EXISTS raise_immutability_error() CASCADE;');
    console.log('✓ Dropped function');
  } catch (e) {
    console.log('Error:', e.message);
  }
  
  // Drop platform_id columns
  const tables = ['students', 'corporate_departments'];
  for (const table of tables) {
    try {
      await client.query(`ALTER TABLE ${table} DROP COLUMN IF EXISTS platform_id CASCADE;`);
      console.log(`✓ Dropped ${table}.platform_id`);
    } catch (e) {
      console.log(`  (already dropped or error: ${e.message})`);
    }
  }
  
  // Drop constraints from school_departments
  try {
    await client.query('ALTER TABLE school_departments DROP CONSTRAINT IF EXISTS sch_dept_platform_id_name_unique;');
    await client.query('ALTER TABLE school_departments DROP CONSTRAINT IF EXISTS fk_school_departments_platform;');
    await client.query('ALTER TABLE school_departments DROP COLUMN IF EXISTS platform_id;');
    console.log('✓ Cleaned school_departments');
  } catch (e) {
    console.log(`  (error: ${e.message})`);
  }
  
  console.log('\n✅ Cleanup complete. Ready for fresh Stage 1 deployment.');
  
} catch (error) {
  console.error('❌ Error:', error.message);
} finally {
  await client.end();
}
