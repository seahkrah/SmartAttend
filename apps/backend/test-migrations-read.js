import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const srcDbDir = dirname(__filename);
const migrationsDir = join(srcDbDir, 'src', 'db', 'migrations');

console.log('Migrations directory:', migrationsDir);
console.log('');

// Check if our new migration files exist
const migrationFiles = [
  '006_add_platform_id_to_school_departments.sql',
  '007_add_platform_id_to_students.sql',
  '008_add_platform_id_to_corporate_departments.sql',
  '008_5_immutability_triggers.sql'
];

for (const file of migrationFiles) {
  const filePath = join(migrationsDir, file);
  try {
    const content = readFileSync(filePath, 'utf-8');
    console.log(`✓ ${file} (${content.length} bytes)`);
  } catch (err) {
    console.log(`✗ ${file}: ${err.message}`);
  }
}
