import { query } from './dist/db/connection.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const srcDbDir = dirname(__filename);
const migrationsDir = join(srcDbDir, 'src', 'db', 'migrations');

const migrationFile = '006_add_platform_id_to_school_departments.sql';

try {
  console.log(`Testing migration: ${migrationFile}\n`);
  
  // Read the migration file
  const migrationSQL = readFileSync(join(migrationsDir, migrationFile), 'utf-8');
  console.log(`File content length: ${migrationSQL.length} bytes`);
  console.log(`First 200 chars: ${migrationSQL.substring(0, 200)}\n`);
  
  // Try executing
  console.log('Executing migration SQL...');
  const result = await query(migrationSQL);
  console.log('Migration executed successfully!');
  
} catch (error) {
  console.error('Error:', error.message);
  if (error.detail) console.error('Detail:', error.detail);
  if (error.context) console.error('Context:', error.context);
}

process.exit(0);
