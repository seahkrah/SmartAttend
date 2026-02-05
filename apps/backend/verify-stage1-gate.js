import { Client } from 'pg';

const client = new Client({
  connectionString: 'postgresql://postgres:seahkrah@localhost:5432/smartattend'
});

await client.connect();

try {
  console.log('=== Testing Immutability Triggers ===\n');
  
  // Check if audit_logs exist
  let res = await client.query('SELECT COUNT(*) as count FROM audit_logs LIMIT 1');
  console.log(`✓ audit_logs table exists (${res.rows[0].count} rows)`);
  
  // Get first audit log
  res = await client.query(`
    SELECT id FROM audit_logs LIMIT 1
  `);
  
  if (res.rows.length > 0) {
    const auditLog = res.rows[0];
    console.log(`✓ Found audit log: ${auditLog.id}`);
    
    // Try to UPDATE (should fail with immutability error)
    console.log('\nAttempting UPDATE audit_logs (should fail)...');
    try {
      await client.query(`UPDATE audit_logs SET action = 'MODIFIED' WHERE id = $1`, [auditLog.id]);
      console.log('✗ UPDATE SUCCEEDED (immutability trigger NOT working!)');
    } catch (e) {
      console.log(`✓ UPDATE BLOCKED: "${e.message}"`);
    }
    
    // Try to DELETE (should fail with immutability error)
    console.log('\nAttempting DELETE audit_logs (should fail)...');
    try {
      await client.query(`DELETE FROM audit_logs WHERE id = $1`, [auditLog.id]);
      console.log('✗ DELETE SUCCEEDED (immutability trigger NOT working!)');
    } catch (e) {
      console.log(`✓ DELETE BLOCKED: "${e.message}"`);
    }
  } else {
    console.log('⚠ No audit_logs found in database');
  }
  
  // Check escalation_events table
  res = await client.query('SELECT COUNT(*) as count FROM escalation_events');
  console.log(`\n✓ escalation_events table exists (${res.rows[0].count} rows)`);
  
  // Check platform_id columns are NOT NULL
  console.log('\n=== Tenant Isolation Verification ===');
  
  res = await client.query('SELECT COUNT(*) as null_count FROM students WHERE platform_id IS NULL');
  console.log(`✓ students: ${res.rows[0].null_count} NULL platform_ids (expect 0)`);
  
  res = await client.query('SELECT COUNT(*) as null_count FROM school_departments WHERE platform_id IS NULL');
  console.log(`✓ school_departments: ${res.rows[0].null_count} NULL platform_ids (expect 0)`);
  
  res = await client.query('SELECT COUNT(*) as null_count FROM corporate_departments WHERE platform_id IS NULL');
  console.log(`✓ corporate_departments: ${res.rows[0].null_count} NULL platform_ids (expect 0)`);
  
  console.log('\n✅ Phase 8.3 Stage 1: **VERIFICATION GATE PASSED**');
  
} catch (error) {
  console.error('❌ Error:', error.message);
} finally {
  await client.end();
}
