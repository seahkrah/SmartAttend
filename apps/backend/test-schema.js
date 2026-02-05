import { Client } from 'pg';

const client = new Client({ 
  connectionString: 'postgresql://postgres:seahkrah@localhost:5432/smartattend' 
});

await client.connect();

try {
  console.log('=== Checking Stage 1 Schema Changes ===\n');
  
  // Check students table
  let res = await client.query(`
    SELECT column_name FROM information_schema.columns 
    WHERE table_name='students' AND column_name='platform_id'
  `);
  console.log('✓ students.platform_id:', res.rows.length > 0 ? 'EXISTS' : 'MISSING');
  
  // Check school_departments table
  res = await client.query(`
    SELECT column_name FROM information_schema.columns 
    WHERE table_name='school_departments' AND column_name='platform_id'
  `);
  console.log('✓ school_departments.platform_id:', res.rows.length > 0 ? 'EXISTS' : 'MISSING');
  
  // Check corporate_departments table
  res = await client.query(`
    SELECT column_name FROM information_schema.columns 
    WHERE table_name='corporate_departments' AND column_name='platform_id'
  `);
  console.log('✓ corporate_departments.platform_id:', res.rows.length > 0 ? 'EXISTS' : 'MISSING');
  
  // Check escalation_events table
  res = await client.query(`
    SELECT table_name FROM information_schema.tables 
    WHERE table_name='escalation_events'
  `);
  console.log('✓ escalation_events table:', res.rows.length > 0 ? 'EXISTS' : 'MISSING');
  
  // Check migrations table
  res = await client.query(`
    SELECT name FROM migrations WHERE name LIKE '%platform_id%' OR name LIKE '%immutability%'
  `);
  console.log('\n=== Stage 1 Migrations in DB ===');
  if (res.rows.length > 0) {
    res.rows.forEach(r => console.log('✓', r.name));
  } else {
    console.log('⚠ No Stage 1 migrations found in migrations table');
  }
  
  // Show all recent migrations
  res = await client.query(`
    SELECT name FROM migrations ORDER BY executed_at DESC LIMIT 15
  `);
  console.log('\n=== Last 15 Migrations Applied ===');
  res.rows.forEach(r => console.log('✓', r.name));
  
} catch (error) {
  console.error('Error:', error.message);
} finally {
  await client.end();
}
