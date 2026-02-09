import { getConnection } from '../connection.js';

export async function up(): Promise<void> {
  const client = await getConnection();

  try {
    await client.query('BEGIN');

    // ============================================================================
    // PHASE 6: SUPERADMIN OPERATIONAL SAFETY
    // ============================================================================

    // ===== TABLE 1: superadmin_operations (Immutable Audit Log) =====
    await client.query(`
      CREATE TABLE IF NOT EXISTS superadmin_operations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id UUID NOT NULL REFERENCES sessions(id),
        user_id UUID NOT NULL REFERENCES users(id),
        operation_type VARCHAR(50) NOT NULL,
        operation_params JSONB,
        dry_run_result JSONB,
        dry_run_confirmed BOOLEAN DEFAULT false,
        execution_status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
        affected_rows_count INTEGER,
        ip_address INET NOT NULL,
        mfa_verified BOOLEAN NOT NULL DEFAULT false,
        mfa_verified_at TIMESTAMP WITH TIME ZONE,
        performed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMP WITH TIME ZONE,
        notes TEXT,
        reviewed_by UUID REFERENCES users(id),
        reviewed_at TIMESTAMP WITH TIME ZONE,
        checksum TEXT NOT NULL,
        is_immutable BOOLEAN DEFAULT true,
        CONSTRAINT valid_execution_status CHECK (execution_status IN ('PENDING', 'EXECUTING', 'COMPLETED', 'FAILED', 'ROLLED_BACK'))
      ) WITH (autovacuum_vacuum_scale_factor = 0.01);
    `);

    // Create function to prevent updates on superadmin_operations
    await client.query(`
      CREATE OR REPLACE FUNCTION prevent_superadmin_operations_update()
      RETURNS TRIGGER AS $$
      BEGIN
        RAISE EXCEPTION 'Cannot UPDATE superadmin_operations - audit log is immutable';
      END;
      $$ LANGUAGE plpgsql;
    `);

    // Create function to prevent deletes on superadmin_operations
    await client.query(`
      CREATE OR REPLACE FUNCTION prevent_superadmin_operations_delete()
      RETURNS TRIGGER AS $$
      BEGIN
        RAISE EXCEPTION 'Cannot DELETE superadmin_operations - audit log is immutable';
      END;
      $$ LANGUAGE plpgsql;
    `);

    // Create immutability triggers
    await client.query(`
      CREATE TRIGGER prevent_superadmin_operations_update
      BEFORE UPDATE ON superadmin_operations
      FOR EACH ROW EXECUTE FUNCTION prevent_superadmin_operations_update();
    `);

    await client.query(`
      CREATE TRIGGER prevent_superadmin_operations_delete
      BEFORE DELETE ON superadmin_operations
      FOR EACH ROW EXECUTE FUNCTION prevent_superadmin_operations_delete();
    `);

    // Create indexes
    await client.query(`CREATE INDEX idx_superadmin_operations_user_id ON superadmin_operations(user_id);`);
    await client.query(`CREATE INDEX idx_superadmin_operations_operation_type ON superadmin_operations(operation_type);`);
    await client.query(`CREATE INDEX idx_superadmin_operations_performed_at ON superadmin_operations(performed_at DESC);`);
    await client.query(`CREATE INDEX idx_superadmin_operations_execution_status ON superadmin_operations(execution_status);`);
    await client.query(`CREATE INDEX idx_superadmin_operations_session_id ON superadmin_operations(session_id);`);

    // ===== TABLE 2: superadmin_ip_allowlist =====
    await client.query(`
      CREATE TABLE IF NOT EXISTS superadmin_ip_allowlist (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        superadmin_user_id UUID NOT NULL REFERENCES users(id),
        ip_address INET,
        ip_range CIDR,
        label VARCHAR(100),
        added_by UUID NOT NULL REFERENCES users(id),
        added_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        removed_by UUID REFERENCES users(id),
        removed_at TIMESTAMP WITH TIME ZONE,
        is_active BOOLEAN DEFAULT true,
        notes TEXT,
        CONSTRAINT ip_or_range CHECK ((ip_address IS NOT NULL OR ip_range IS NOT NULL))
      );
    `);

    // Create indexes
    await client.query(`CREATE INDEX idx_superadmin_ip_allowlist_user_id ON superadmin_ip_allowlist(superadmin_user_id);`);
    await client.query(`CREATE INDEX idx_superadmin_ip_allowlist_is_active ON superadmin_ip_allowlist(is_active);`);
    await client.query(`CREATE INDEX idx_superadmin_ip_allowlist_superadmin_user ON superadmin_ip_allowlist(superadmin_user_id, is_active);`);

    // ===== TABLE 3: superadmin_ip_violations =====
    await client.query(`
      CREATE TABLE IF NOT EXISTS superadmin_ip_violations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        ip_address INET NOT NULL,
        user_id UUID NOT NULL REFERENCES users(id),
        attempted_operation VARCHAR(200),
        denied_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        alert_sent BOOLEAN DEFAULT false,
        alert_sent_at TIMESTAMP WITH TIME ZONE,
        reviewed_by UUID REFERENCES users(id),
        reviewed_at TIMESTAMP WITH TIME ZONE
      );
    `);

    // Create indexes
    await client.query(`CREATE INDEX idx_superadmin_ip_violations_ip_address ON superadmin_ip_violations(ip_address);`);
    await client.query(`CREATE INDEX idx_superadmin_ip_violations_user_id ON superadmin_ip_violations(user_id);`);
    await client.query(`CREATE INDEX idx_superadmin_ip_violations_denied_at ON superadmin_ip_violations(denied_at DESC);`);

    // ===== TABLE 4: superadmin_mfa_verifications (Immutable) =====
    await client.query(`
      CREATE TABLE IF NOT EXISTS superadmin_mfa_verifications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id UUID NOT NULL REFERENCES sessions(id),
        user_id UUID NOT NULL REFERENCES users(id),
        mfa_method VARCHAR(50),
        verification_result VARCHAR(20) NOT NULL,
        operation_type VARCHAR(50),
        verified_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMP WITH TIME ZONE,
        ip_address INET
      );
    `);

    // Create function to prevent updates on superadmin_mfa_verifications
    await client.query(`
      CREATE OR REPLACE FUNCTION prevent_superadmin_mfa_verifications_update()
      RETURNS TRIGGER AS $$
      BEGIN
        RAISE EXCEPTION 'Cannot UPDATE superadmin_mfa_verifications - verification log is immutable';
      END;
      $$ LANGUAGE plpgsql;
    `);

    // Create immutability trigger for MFA verifications
    await client.query(`
      CREATE TRIGGER prevent_superadmin_mfa_verifications_update
      BEFORE UPDATE ON superadmin_mfa_verifications
      FOR EACH ROW EXECUTE FUNCTION prevent_superadmin_mfa_verifications_update();
    `);

    // Create indexes
    await client.query(`CREATE INDEX idx_superadmin_mfa_verifications_user_id ON superadmin_mfa_verifications(user_id);`);
    await client.query(`CREATE INDEX idx_superadmin_mfa_verifications_verified_at ON superadmin_mfa_verifications(verified_at DESC);`);
    await client.query(`CREATE INDEX idx_superadmin_mfa_verifications_session_id ON superadmin_mfa_verifications(session_id);`);

    // ===== ADD COLUMNS TO sessions TABLE =====
    // Check if columns exist before adding
    const sessionsCheckResult = await client.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name='sessions' AND column_name IN ('superadmin_mfa_verified_at', 'superadmin_session_start_at')
    `);

    if (sessionsCheckResult.rows.length === 0) {
      await client.query(`
        ALTER TABLE sessions
        ADD COLUMN superadmin_mfa_verified_at TIMESTAMP WITH TIME ZONE,
        ADD COLUMN superadmin_session_start_at TIMESTAMP WITH TIME ZONE,
        ADD COLUMN superadmin_ip_address INET;
      `);
    }

    // ===== VIEWS FOR OPERATIONS ANALYSIS =====
    await client.query(`
      CREATE OR REPLACE VIEW superadmin_recent_operations AS
      SELECT
        id,
        user_id,
        operation_type,
        execution_status,
        affected_rows_count,
        ip_address,
        performed_at,
        completed_at,
        checksum
      FROM superadmin_operations
      ORDER BY performed_at DESC
      LIMIT 100;
    `);

    await client.query(`
      CREATE OR REPLACE VIEW superadmin_failed_operations AS
      SELECT
        id,
        user_id,
        operation_type,
        execution_status,
        ip_address,
        performed_at,
        notes,
        checksum
      FROM superadmin_operations
      WHERE execution_status IN ('FAILED', 'ROLLED_BACK')
      ORDER BY performed_at DESC;
    `);

    await client.query(`
      CREATE OR REPLACE VIEW superadmin_pending_operations AS
      SELECT
        id,
        user_id,
        operation_type,
        operation_params,
        dry_run_result,
        dry_run_confirmed,
        ip_address,
        performed_at
      FROM superadmin_operations
      WHERE execution_status = 'PENDING'
      ORDER BY performed_at ASC;
    `);

    await client.query('COMMIT');
    console.log('✅ Migration 020: Superadmin Operational Safety schema created');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Migration 020 failed:', error);
    throw error;
  } finally {
    client.release();
  }
}

export async function down(): Promise<void> {
  const client = await getConnection();

  try {
    await client.query('BEGIN');

    // Drop views
    await client.query(`DROP VIEW IF EXISTS superadmin_pending_operations;`);
    await client.query(`DROP VIEW IF EXISTS superadmin_failed_operations;`);
    await client.query(`DROP VIEW IF EXISTS superadmin_recent_operations;`);

    // Drop triggers
    await client.query(`DROP TRIGGER IF EXISTS prevent_superadmin_mfa_verifications_update ON superadmin_mfa_verifications;`);
    await client.query(`DROP TRIGGER IF EXISTS prevent_superadmin_operations_delete ON superadmin_operations;`);
    await client.query(`DROP TRIGGER IF EXISTS prevent_superadmin_operations_update ON superadmin_operations;`);

    // Drop functions
    await client.query(`DROP FUNCTION IF EXISTS prevent_superadmin_mfa_verifications_update();`);
    await client.query(`DROP FUNCTION IF EXISTS prevent_superadmin_operations_delete();`);
    await client.query(`DROP FUNCTION IF EXISTS prevent_superadmin_operations_update();`);

    // Drop tables
    await client.query(`DROP TABLE IF EXISTS superadmin_mfa_verifications;`);
    await client.query(`DROP TABLE IF EXISTS superadmin_ip_violations;`);
    await client.query(`DROP TABLE IF EXISTS superadmin_ip_allowlist;`);
    await client.query(`DROP TABLE IF EXISTS superadmin_operations;`);

    // Remove columns from sessions
    const sessionsCheckResult = await client.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name='sessions' AND column_name IN ('superadmin_mfa_verified_at', 'superadmin_session_start_at')
    `);

    if (sessionsCheckResult.rows.length > 0) {
      await client.query(`
        ALTER TABLE sessions
        DROP COLUMN IF EXISTS superadmin_mfa_verified_at,
        DROP COLUMN IF EXISTS superadmin_session_start_at,
        DROP COLUMN IF EXISTS superadmin_ip_address;
      `);
    }

    await client.query('COMMIT');
    console.log('✅ Migration 020 rolled back');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Rollback 020 failed:', error);
    throw error;
  } finally {
    client.release();
  }
}
