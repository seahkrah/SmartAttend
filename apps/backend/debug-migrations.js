import { Client } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';

const client = new Client({ 
  connectionString: 'postgresql://postgres:seahkrah@localhost:5432/smartattend' 
});

await client.connect();

try {
  const stageMigrations = [
    '006_add_platform_id_to_school_departments.sql',
    '007_add_platform_id_to_students.sql',
    '008_add_platform_id_to_corporate_departments.sql',
    '008_5_immutability_triggers.sql'
  ];
  
  const migrationsDir = 'c:\\smartattend\\apps\\backend\\src\\db\\migrations';
  
  for (const migFile of stageMigrations) {
    console.log(`\n=== Testing ${migFile} ===`);
    
    const content = readFileSync(join(migrationsDir, migFile), 'utf-8');
    // Split by semicolons to get individual statements
    const statements = content.split(';').map(s => s.trim()).filter(s => s && !s.startsWith('--'));
    
    console.log(`Found ${statements.length} statements`);
    
    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];
      if (stmt.length < 50) {
        console.log(`[${i+1}] ${stmt.substring(0, 50)}...`);
      } else {
        console.log(`[${i+1}] ${stmt.substring(0, 50)}...`);
      }
      
      try {
        const result = await client.query(stmt);
        console.log(`    ✓ Success (${result.rows.length} rows)`);
      } catch (err) {
        console.log(`    ✗ ERROR: ${err.message}`);
        console.log(`      Statement: ${stmt.substring(0, 80)}...`);
      }
    }
  }
  
} catch (error) {
  console.error('Fatal error:', error.message);
} finally {
  await client.end();
}
