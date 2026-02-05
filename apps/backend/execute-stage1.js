import { Client } from 'pg';

const client = new Client({
  connectionString: 'postgresql://postgres:seahkrah@localhost:5432/smartattend'
});

await client.connect();

try {
  console.log('=== Executing Stage 1 Migrations ===\n');
  
  // Migration 006
  console.log('[006] Adding platform_id to school_departments...');
  try {
    await client.query('ALTER TABLE school_departments ADD COLUMN platform_id UUID;');
  } catch (e) {
    if (!e.message.includes('already exists')) throw e;
    console.log('  (column already exists)');
  }
  await client.query(`UPDATE school_departments SET platform_id = (SELECT id FROM platforms WHERE name = 'school' LIMIT 1) WHERE platform_id IS NULL;`);
  try {
    await client.query('ALTER TABLE school_departments ALTER COLUMN platform_id SET NOT NULL;');
  } catch (e) {
    console.log('  (column already NOT NULL)');
  }
  try {
    await client.query('ALTER TABLE school_departments DROP CONSTRAINT school_departments_name_key CASCADE;');
  } catch (e) {
    console.log('  (constraint not found or different name)');
  }
  await client.query('ALTER TABLE school_departments ADD CONSTRAINT sch_dept_platform_id_name_unique UNIQUE(platform_id, name);');
  await client.query('ALTER TABLE school_departments ADD CONSTRAINT fk_school_departments_platform FOREIGN KEY (platform_id) REFERENCES platforms(id);');
  console.log('✓ 006 completed');
  
  // Migration 007
  console.log('[007] Adding platform_id to students...');
  try {
    await client.query('ALTER TABLE students ADD COLUMN platform_id UUID;');
  } catch (e) {
    if (!e.message.includes('already exists')) throw e;
    console.log('  (column already exists)');
  }
  await client.query(`UPDATE students SET platform_id = users.platform_id FROM users WHERE students.user_id = users.id;`);
  try {
    await client.query('ALTER TABLE students ALTER COLUMN platform_id SET NOT NULL;');
  } catch (e) {
    console.log('  (column already NOT NULL)');
  }
  await client.query('ALTER TABLE students ADD CONSTRAINT fk_students_platform FOREIGN KEY (platform_id) REFERENCES platforms(id);');
  await client.query('CREATE INDEX idx_students_platform_id ON students(platform_id);');
  await client.query('CREATE INDEX idx_students_user_id_platform ON students(user_id, platform_id);');
  console.log('✓ 007 completed');
  
  // Migration 008
  console.log('[008] Adding platform_id to corporate_departments...');
  try {
    await client.query('ALTER TABLE corporate_departments ADD COLUMN platform_id UUID;');
  } catch (e) {
    if (!e.message.includes('already exists')) throw e;
    console.log('  (column already exists)');
  }
  await client.query(`UPDATE corporate_departments SET platform_id = (SELECT id FROM platforms WHERE name = 'corporate' LIMIT 1) WHERE platform_id IS NULL;`);
  try {
    await client.query('ALTER TABLE corporate_departments ALTER COLUMN platform_id SET NOT NULL;');
  } catch (e) {
    console.log('  (column already NOT NULL)');
  }
  await client.query('ALTER TABLE corporate_departments ADD CONSTRAINT fk_corporate_departments_platform FOREIGN KEY (platform_id) REFERENCES platforms(id);');
  try {
    await client.query('ALTER TABLE corporate_departments DROP CONSTRAINT corporate_departments_name_key CASCADE;');
  } catch (e) {
    console.log('  (constraint not found)');
  }
  await client.query('ALTER TABLE corporate_departments ADD CONSTRAINT corp_dept_platform_id_name_unique UNIQUE(platform_id, name);');
  await client.query('CREATE INDEX idx_corporate_departments_platform_id ON corporate_departments(platform_id);');
  console.log('✓ 008 completed');
  
  // Migration 008_5
  console.log('[008_5] Creating immutability triggers and escalation_events table...');
  
  // Create the function
  try {
    await client.query(`
      CREATE OR REPLACE FUNCTION raise_immutability_error()
      RETURNS TRIGGER AS $$
      BEGIN
        RAISE EXCEPTION 'Immutable record: % records cannot be modified after creation', TG_TABLE_NAME;
      END;
      $$ LANGUAGE plpgsql;
    `);
  } catch (e) {
    console.log('  (function already exists)');
  }
  
  // Add triggers
  try {
    await client.query('CREATE TRIGGER audit_logs_immutable_prevent_updates BEFORE UPDATE ON audit_logs FOR EACH ROW EXECUTE FUNCTION raise_immutability_error();');
  } catch (e) {
    console.log('  (trigger already exists)');
  }
  try {
    await client.query('CREATE TRIGGER audit_logs_immutable_prevent_deletes BEFORE DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION raise_immutability_error();');
  } catch (e) {
    console.log('  (trigger already exists)');
  }
  try {
    await client.query('CREATE TRIGGER incident_state_history_immutable_prevent_updates BEFORE UPDATE ON incident_state_history FOR EACH ROW EXECUTE FUNCTION raise_immutability_error();');
  } catch (e) {
    console.log('  (trigger already exists)');
  }
  try {
    await client.query('CREATE TRIGGER incident_state_history_immutable_prevent_deletes BEFORE DELETE ON incident_state_history FOR EACH ROW EXECUTE FUNCTION raise_immutability_error();');
  } catch (e) {
    console.log('  (trigger already exists)');
  }
  
  // Create table
  try {
    await client.query(`
      CREATE TABLE escalation_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        platform_id UUID NOT NULL REFERENCES platforms(id),
        incident_id UUID NOT NULL REFERENCES incidents(id),
        user_id UUID NOT NULL REFERENCES users(id),
        escalation_type VARCHAR(50) NOT NULL,
        severity_level INT CHECK (severity_level >= 1 AND severity_level <= 5),
        detection_method VARCHAR(100) NOT NULL,
        details JSONB NOT NULL,
        action_taken VARCHAR(200),
        status VARCHAR(50) DEFAULT 'PENDING',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        created_by UUID NOT NULL REFERENCES users(id)
      );
    `);
  } catch (e) {
    if (!e.message.includes('already exists')) throw e;
    console.log('  (table already exists)');
  }
  
  // Indexes
  try {
    await client.query('CREATE INDEX idx_escalation_events_platform_id ON escalation_events(platform_id);');
  } catch (e) {
    console.log('  (index already exists)');
  }
  try {
    await client.query('CREATE INDEX idx_escalation_events_incident_id ON escalation_events(incident_id);');
  } catch (e) {
    console.log('  (index already exists)');
  }
  try {
    await client.query('CREATE INDEX idx_escalation_events_user_id ON escalation_events(user_id);');
  } catch (e) {
    console.log('  (index already exists)');
  }
  try {
    await client.query('CREATE INDEX idx_escalation_events_created_at ON escalation_events(created_at);');
  } catch (e) {
    console.log('  (index already exists)');
  }
  
  // Triggers on escalation table
  try {
    await client.query('CREATE TRIGGER escalation_events_immutable_prevent_updates BEFORE UPDATE ON escalation_events FOR EACH ROW EXECUTE FUNCTION raise_immutability_error();');
  } catch (e) {
    console.log('  (trigger already exists)');
  }
  try {
    await client.query('CREATE TRIGGER escalation_events_immutable_prevent_deletes BEFORE DELETE ON escalation_events FOR EACH ROW EXECUTE FUNCTION raise_immutability_error();');
  } catch (e) {
    console.log('  (trigger already exists)');
  }
  
  console.log('✓ 008_5 completed');
  
  // Record migrations in DB
  const migrations = ['006_add_platform_id_to_school_departments.sql', '007_add_platform_id_to_students.sql', '008_add_platform_id_to_corporate_departments.sql', '008_5_immutability_triggers.sql'];
  for (const mig of migrations) {
    await client.query('INSERT INTO migrations (name) VALUES ($1) ON CONFLICT DO NOTHING', [mig]);
  }
  
  console.log('\n✅ All Stage 1 migrations completed successfully!');
  
} catch (error) {
  console.error('❌ Error:', error.message);
  console.error(error);
} finally {
  await client.end();
}
