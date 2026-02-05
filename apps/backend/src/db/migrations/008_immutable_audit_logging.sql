-- ===========================
-- PHASE 4: IMMUTABLE AUDIT LOGGING (SIMPLIFIED)
-- ===========================

-- ===========================
-- A. AUDIT LOGS TABLE
-- ===========================

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_role VARCHAR(100),
  action_type VARCHAR(100),
  action_scope VARCHAR(50),
  resource_type VARCHAR(100),
  resource_id UUID,
  before_state JSONB,
  after_state JSONB,
  justification TEXT,
  request_id VARCHAR(255),
  ip_address INET,
  user_agent VARCHAR(500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_immutable BOOLEAN DEFAULT TRUE,
  checksum VARCHAR(64)
);

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
