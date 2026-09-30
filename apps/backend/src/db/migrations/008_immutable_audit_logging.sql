-- ===========================
-- PHASE 4: IMMUTABLE AUDIT LOGGING (SIMPLIFIED)
-- ===========================

-- ===========================
-- A. AUDIT LOGS TABLE
-- ===========================

-- audit_logs is already created by 001/002 with a different shape
-- (platform_id, user_id, action, entity_type, old_values, new_values).
-- CREATE TABLE IF NOT EXISTS therefore skipped this definition silently and
-- the indexes below failed on the missing columns.
-- Add the immutable-audit columns to whichever table is present instead.
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4()
);

ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS actor_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS actor_role VARCHAR(100);
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS action_type VARCHAR(100);
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS action_scope VARCHAR(50);
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS resource_type VARCHAR(100);
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS resource_id UUID;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS before_state JSONB;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS after_state JSONB;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS justification TEXT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS request_id VARCHAR(255);
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS ip_address INET;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS user_agent VARCHAR(500);
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS is_immutable BOOLEAN DEFAULT TRUE;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS checksum VARCHAR(64);

CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_id ON audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action_type ON audit_logs(action_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action_scope ON audit_logs(action_scope);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_request_id ON audit_logs(request_id);

-- ===========================
-- B. AUDIT LOG UPDATE PREVENTION (via trigger)
-- ===========================

-- Create function FIRST before using it in trigger
CREATE OR REPLACE FUNCTION prevent_audit_logs_update()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Audit logs are immutable. UPDATE operations are not permitted.';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION prevent_audit_logs_delete()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Audit logs are immutable. DELETE operations are not permitted.';
END;
$$ LANGUAGE plpgsql;

-- Drop and recreate triggers to ensure clean state
DROP TRIGGER IF EXISTS prevent_audit_logs_update_trigger ON audit_logs;
DROP TRIGGER IF EXISTS prevent_audit_logs_delete_trigger ON audit_logs;

CREATE TRIGGER prevent_audit_logs_update_trigger
BEFORE UPDATE ON audit_logs
FOR EACH ROW
EXECUTE FUNCTION prevent_audit_logs_update();

CREATE TRIGGER prevent_audit_logs_delete_trigger
BEFORE DELETE ON audit_logs
FOR EACH ROW
EXECUTE FUNCTION prevent_audit_logs_delete();

-- ===========================
-- C. SYSTEM AUDIT LOG
-- ===========================

CREATE TABLE IF NOT EXISTS system_audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  component VARCHAR(100),
  event_type VARCHAR(100),
  event_description TEXT,
  severity VARCHAR(20),
  event_timestamp TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  metadata JSONB,
  is_error BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_system_audit_component ON system_audit_log(component);
CREATE INDEX IF NOT EXISTS idx_system_audit_timestamp ON system_audit_log(event_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_system_audit_severity ON system_audit_log(severity);

-- ===========================
-- D. CHANGE LOG
-- ===========================

CREATE TABLE IF NOT EXISTS change_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entity_type VARCHAR(100),
  entity_id UUID,
  operation VARCHAR(20),
  changed_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
  change_timestamp TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  old_values JSONB,
  new_values JSONB,
  change_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_change_log_entity ON change_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_change_log_timestamp ON change_log(change_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_change_log_changed_by ON change_log(changed_by_id);

COMMIT;
