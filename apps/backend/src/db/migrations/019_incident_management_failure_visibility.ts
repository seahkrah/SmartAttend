/**
 * ===========================
 * MIGRATION 019: INCIDENT MANAGEMENT & FAILURE VISIBILITY
 * ===========================
 * 
 * Phase 5: Incident Management
 * 
 * Creates immutable incident tracking system:
 * - incidents (immutable core)
 * - incident_lifecycle (append-only)
 * - incident_acknowledgments (immutable)
 * - incident_root_causes (immutable)
 * - incident_escalations (append-only)
 * - incident_resolution (immutable, one per incident)
 * 
 * All tables are append-only or immutable via triggers.
 * Designed for maximum tamper-proofing and auditability.
 */

import { query } from '../connection.js'

export async function up() {
  console.log('[MIGRATION 019] Starting: Incident Management & Failure Visibility')

  try {
    // ===========================
    // TABLE: incidents
    // ===========================
    // Core immutable incident records
    await query(`
      CREATE TABLE IF NOT EXISTS incidents (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        incident_type VARCHAR(50) NOT NULL,
        severity VARCHAR(20) NOT NULL,
        description TEXT NOT NULL,
        created_from_error_id VARCHAR,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_by_system BOOLEAN DEFAULT FALSE,
        total_events INT DEFAULT 0,
        current_severity VARCHAR(20),
        checksum VARCHAR(64) NOT NULL,
        created_from_tenant_id UUID,
        
        CONSTRAINT valid_severity CHECK (severity IN ('CRITICAL', 'HIGH', 'MEDIUM')),
        CONSTRAINT valid_type CHECK (incident_type IN ('P0_INCIDENT', 'P1_INCIDENT', 'P2_INCIDENT'))
      )
    `)

    console.log('[MIGRATION 019] Created: incidents table')

    // Immutability trigger on incidents
    await query(`
      CREATE OR REPLACE FUNCTION prevent_incidents_update()
      RETURNS TRIGGER AS $$
      BEGIN
        RAISE EXCEPTION 'Incidents are immutable - cannot modify existing record (id: %)', OLD.id;
      END;
      $$ LANGUAGE plpgsql
    `)

    await query(`
      DROP TRIGGER IF EXISTS prevent_incidents_update ON incidents;
      CREATE TRIGGER prevent_incidents_update
        BEFORE UPDATE ON incidents
        FOR EACH ROW
        EXECUTE FUNCTION prevent_incidents_update()
    `)

    // Delete prevention trigger
    await query(`
      CREATE OR REPLACE FUNCTION prevent_incidents_delete()
      RETURNS TRIGGER AS $$
      BEGIN
        RAISE EXCEPTION 'Incidents cannot be deleted - immutable log (id: %)', OLD.id;
      END;
      $$ LANGUAGE plpgsql
    `)

    await query(`
      DROP TRIGGER IF EXISTS prevent_incidents_delete ON incidents;
      CREATE TRIGGER prevent_incidents_delete
        BEFORE DELETE ON incidents
        FOR EACH ROW
        EXECUTE FUNCTION prevent_incidents_delete()
    `)

    // ===========================
    // TABLE: incident_lifecycle
    // ===========================
    // Append-only log of all state transitions
    await query(`
      CREATE TABLE IF NOT EXISTS incident_lifecycle (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        incident_id UUID NOT NULL REFERENCES incidents(id),
        event_type VARCHAR(50) NOT NULL,
        status_before VARCHAR(50),
        status_after VARCHAR(50) NOT NULL,
        actor_user_id UUID,
        actor_role VARCHAR(50),
        metadata JSONB,
        event_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        checksum VARCHAR(64) NOT NULL,
        
        CONSTRAINT valid_event_type CHECK (
          event_type IN ('REPORTED', 'ACKNOWLEDGED', 'STARTED_INVESTIGATION', 
                        'ROOT_CAUSE_IDENTIFIED', 'RESOLVED', 'CLOSED', 'ESCALATED')
        ),
        CONSTRAINT valid_status CHECK (
          status_after IN ('REPORTED', 'ACKNOWLEDGED', 'INVESTIGATING', 'RESOLVED', 'CLOSED')
        )
      );
      CREATE INDEX IF NOT EXISTS idx_incident_lifecycle_incident_id ON incident_lifecycle(incident_id);
      CREATE INDEX IF NOT EXISTS idx_incident_lifecycle_event_at ON incident_lifecycle(event_at DESC);
      CREATE INDEX IF NOT EXISTS idx_incident_lifecycle_event_type ON incident_lifecycle(event_type);
    `)

    console.log('[MIGRATION 019] Created: incident_lifecycle table')

    // Immutability trigger
    await query(`
      CREATE OR REPLACE FUNCTION prevent_lifecycle_update()
      RETURNS TRIGGER AS $$
      BEGIN
        RAISE EXCEPTION 'Incident lifecycle is append-only (id: %)', OLD.id;
      END;
      $$ LANGUAGE plpgsql
    `)

    await query(`
      DROP TRIGGER IF EXISTS prevent_lifecycle_update ON incident_lifecycle;
      CREATE TRIGGER prevent_lifecycle_update
        BEFORE UPDATE ON incident_lifecycle
        FOR EACH ROW
        EXECUTE FUNCTION prevent_lifecycle_update()
    `)

    // ===========================
    // TABLE: incident_acknowledgments
    // ===========================
    // Immutable acknowledgment records
    await query(`
      CREATE TABLE IF NOT EXISTS incident_acknowledgments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        incident_id UUID NOT NULL UNIQUE REFERENCES incidents(id),
        ack_by_user_id UUID NOT NULL,
        ack_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        ack_notes TEXT,
        severity_at_ack VARCHAR(20),
        checksum VARCHAR(64) NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_incident_ack_incident_id ON incident_acknowledgments(incident_id);
      CREATE INDEX IF NOT EXISTS idx_incident_ack_user_id ON incident_acknowledgments(ack_by_user_id);
    `)

    console.log('[MIGRATION 019] Created: incident_acknowledgments table')

    // ===========================
    // TABLE: incident_root_causes
    // ===========================
    // Immutable root cause analysis
    await query(`
      CREATE TABLE IF NOT EXISTS incident_root_causes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        incident_id UUID NOT NULL UNIQUE REFERENCES incidents(id),
        root_cause_summary TEXT NOT NULL,
        root_cause_category VARCHAR(50),
        identified_by_user_id UUID NOT NULL,
        identified_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        remediation_steps TEXT,
        verified_at TIMESTAMP,
        checksum VARCHAR(64) NOT NULL,
        
        CONSTRAINT valid_category CHECK (
          root_cause_category IN ('USER_ERROR', 'SYSTEM_DEFECT', 'EXTERNAL_DEPENDENCY', 
                                  'CONFIGURATION', 'SECURITY', 'UNKNOWN')
        )
      );
      CREATE INDEX IF NOT EXISTS idx_incident_rc_incident_id ON incident_root_causes(incident_id);
      CREATE INDEX IF NOT EXISTS idx_incident_rc_category ON incident_root_causes(root_cause_category);
    `)

    console.log('[MIGRATION 019] Created: incident_root_causes table')

    // ===========================
    // TABLE: incident_escalations
    // ===========================
    // Append-only escalation log
    await query(`
      CREATE TABLE IF NOT EXISTS incident_escalations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        incident_id UUID NOT NULL REFERENCES incidents(id),
        escalation_reason VARCHAR(100) NOT NULL,
        escalated_to_user_id UUID NOT NULL,
        escalated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        acknowledged_at TIMESTAMP,
        checksum VARCHAR(64) NOT NULL,
        
        CONSTRAINT valid_reason CHECK (
          escalation_reason IN ('NO_ACK_1HR', 'NO_ACK_4HR', 'NO_ROOT_CAUSE_24HR', 
                               'MANUAL_ESCALATION', 'SEVERITY_ESCALATED')
        )
      );
      CREATE INDEX IF NOT EXISTS idx_incident_esc_incident_id ON incident_escalations(incident_id);
      CREATE INDEX IF NOT EXISTS idx_incident_esc_escalated_to ON incident_escalations(escalated_to_user_id);
    `)

    console.log('[MIGRATION 019] Created: incident_escalations table')

    // ===========================
    // TABLE: incident_resolution
    // ===========================
    // Immutable resolution record (one per incident)
    await query(`
      CREATE TABLE IF NOT EXISTS incident_resolution (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        incident_id UUID NOT NULL UNIQUE REFERENCES incidents(id),
        resolved_by_user_id UUID NOT NULL,
        resolved_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        resolution_summary TEXT,
        resolution_notes TEXT,
        impact_assessment TEXT,
        lessons_learned TEXT,
        follow_up_actions TEXT,
        status_after_resolution VARCHAR(50) DEFAULT 'CLOSED',
        checksum VARCHAR(64) NOT NULL,
        
        CONSTRAINT valid_status CHECK (status_after_resolution IN ('CLOSED', 'NEEDS_FOLLOWUP'))
      );
      CREATE INDEX IF NOT EXISTS idx_incident_res_incident_id ON incident_resolution(incident_id);
      CREATE INDEX IF NOT EXISTS idx_incident_res_resolved_by ON incident_resolution(resolved_by_user_id);
    `)

    console.log('[MIGRATION 019] Created: incident_resolution table')

    // ===========================
    // VIEW: current_incident_status
    // ===========================
    // Query current status of incidents quickly
    await query(`
      DROP VIEW IF EXISTS current_incident_status CASCADE;
      CREATE VIEW current_incident_status AS
      SELECT 
        i.id, 
        i.incident_type, 
        i.severity, 
        i.description, 
        i.created_at,
        (SELECT status_after FROM incident_lifecycle 
         WHERE incident_id = i.id 
         ORDER BY event_at DESC LIMIT 1) as current_status,
        (SELECT ack_by_user_id FROM incident_acknowledgments 
         WHERE incident_id = i.id LIMIT 1) as acknowledged_by,
        (SELECT COUNT(*) FROM incident_lifecycle WHERE incident_id = i.id) as event_count,
        (SELECT root_cause_summary FROM incident_root_causes 
         WHERE incident_id = i.id LIMIT 1) as root_cause,
        (SELECT resolution_summary FROM incident_resolution 
         WHERE incident_id = i.id LIMIT 1) as resolution
      FROM incidents i
    `)

    console.log('[MIGRATION 019] Created: current_incident_status view')

    // ===========================
    // VIEW: open_incidents
    // ===========================
    // Incidents not yet closed
    await query(`
      DROP VIEW IF EXISTS open_incidents CASCADE;
      CREATE VIEW open_incidents AS
      SELECT 
        i.id,
        i.incident_type,
        i.severity,
        i.description,
        i.created_at,
        cs.current_status,
        cs.acknowledged_by,
        cs.event_count,
        cs.root_cause,
        EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - i.created_at)) / 3600 as hours_open
      FROM incidents i
      JOIN current_incident_status cs ON i.id = cs.id
      WHERE cs.current_status != 'CLOSED'
      ORDER BY i.created_at DESC
    `)

    console.log('[MIGRATION 019] Created: open_incidents view')

    // ===========================
    // VIEW: overdue_incidents
    // ===========================
    // Incidents overdue for ACK
    await query(`
      DROP VIEW IF EXISTS overdue_incidents CASCADE;
      CREATE VIEW overdue_incidents AS
      SELECT 
        i.id,
        i.incident_type,
        i.severity,
        i.description,
        i.created_at,
        cs.current_status,
        EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - i.created_at)) / 3600 as hours_since_creation
      FROM incidents i
      JOIN current_incident_status cs ON i.id = cs.id
      WHERE cs.current_status = 'REPORTED'
        AND i.created_at < CURRENT_TIMESTAMP - INTERVAL '1 hour'
      ORDER BY i.created_at ASC
    `)

    console.log('[MIGRATION 019] Created: overdue_incidents view')

    // ===========================
    // ADD COLUMNS TO users TABLE
    // ===========================
    // Track last incident acknowledged
    await query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS last_incident_ack_id UUID;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS incident_ack_count INT DEFAULT 0;
    `)

    console.log('[MIGRATION 019] Updated: users table with incident fields')

    // ===========================
    // ADD COLUMNS TO audit_logs TABLE
    // ===========================
    // Track which errors became incidents
    await query(`
      ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS created_incident_id UUID;
      ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS incident_severity VARCHAR(20);
    `)

    console.log('[MIGRATION 019] Updated: audit_logs table with incident reference')

    // ===========================
    // ADD COLUMN TO sessions TABLE
    // ===========================
    // Track if session blocked due to unack'd critical incident
    await query(`
      ALTER TABLE sessions ADD COLUMN IF NOT EXISTS blocked_due_to_incident UUID;
      ALTER TABLE sessions ADD COLUMN IF NOT EXISTS incident_block_reason TEXT;
    `)

    console.log('[MIGRATION 019] Updated: sessions table with incident blocking')

    console.log('[MIGRATION 019] ✅ COMPLETE - All incident management tables created')
  } catch (error) {
    console.error('[MIGRATION 019] ❌ FAILED:', error)
    throw error
  }
}

export async function down() {
  console.log('[MIGRATION 019] Rollback: Incident Management')

  try {
    // Drop views first (dependencies)
    await query(`DROP VIEW IF EXISTS open_incidents CASCADE`)
    await query(`DROP VIEW IF EXISTS overdue_incidents CASCADE`)
    await query(`DROP VIEW IF EXISTS current_incident_status CASCADE`)

    // Drop tables
    await query(`DROP TABLE IF EXISTS incident_resolution`)
    await query(`DROP TABLE IF EXISTS incident_escalations`)
    await query(`DROP TABLE IF EXISTS incident_root_causes`)
    await query(`DROP TABLE IF EXISTS incident_acknowledgments`)
    await query(`DROP TABLE IF EXISTS incident_lifecycle`)
    await query(`DROP TABLE IF EXISTS incidents`)

    // Drop functions
    await query(`DROP FUNCTION IF EXISTS prevent_incidents_update()`)
    await query(`DROP FUNCTION IF EXISTS prevent_incidents_delete()`)
    await query(`DROP FUNCTION IF EXISTS prevent_lifecycle_update()`)

    // Remove columns from other tables
    await query(`ALTER TABLE users DROP COLUMN IF EXISTS last_incident_ack_id`)
    await query(`ALTER TABLE users DROP COLUMN IF EXISTS incident_ack_count`)
    await query(`ALTER TABLE audit_logs DROP COLUMN IF EXISTS created_incident_id`)
    await query(`ALTER TABLE audit_logs DROP COLUMN IF EXISTS incident_severity`)
    await query(`ALTER TABLE sessions DROP COLUMN IF EXISTS blocked_due_to_incident`)
    await query(`ALTER TABLE sessions DROP COLUMN IF EXISTS incident_block_reason`)

    console.log('[MIGRATION 019] ✅ ROLLBACK COMPLETE')
  } catch (error) {
    console.error('[MIGRATION 019] ❌ ROLLBACK FAILED:', error)
    throw error
  }
}
