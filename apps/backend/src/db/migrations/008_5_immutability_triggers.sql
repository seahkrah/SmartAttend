-- ================================================================
-- MIGRATION 008_5: Immutability Enforcement via Database Triggers
-- ================================================================
-- Purpose: Enforce write-once semantics on critical tables
-- This implements SEC-002: Audit-first enforcement
-- Status: EXPLICIT, no assumptions

-- Create function to raise immutability error
CREATE OR REPLACE FUNCTION raise_immutability_error()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Immutable record: % records cannot be modified after creation', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

-- Make audit_logs immutable (write-once)
CREATE TRIGGER audit_logs_immutable_prevent_updates
BEFORE UPDATE ON audit_logs
FOR EACH ROW
EXECUTE FUNCTION raise_immutability_error();

CREATE TRIGGER audit_logs_immutable_prevent_deletes
BEFORE DELETE ON audit_logs
FOR EACH ROW
EXECUTE FUNCTION raise_immutability_error();

-- Make incident_state_history immutable (write-once)
CREATE TRIGGER incident_state_history_immutable_prevent_updates
BEFORE UPDATE ON incident_state_history
FOR EACH ROW
EXECUTE FUNCTION raise_immutability_error();

CREATE TRIGGER incident_state_history_immutable_prevent_deletes
BEFORE DELETE ON incident_state_history
FOR EACH ROW
EXECUTE FUNCTION raise_immutability_error();

-- Create escalation_events table for SEC-001: Escalation Detection
-- This table captures all escalation events and is immutable
CREATE TABLE IF NOT EXISTS escalation_events (
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

-- Create indexes for escalation queries
CREATE INDEX IF NOT EXISTS idx_escalation_events_platform_id ON escalation_events(platform_id);
CREATE INDEX IF NOT EXISTS idx_escalation_events_incident_id ON escalation_events(incident_id);
CREATE INDEX IF NOT EXISTS idx_escalation_events_user_id ON escalation_events(user_id);
CREATE INDEX IF NOT EXISTS idx_escalation_events_created_at ON escalation_events(created_at);

-- Make escalation_events immutable (write-once)
CREATE TRIGGER escalation_events_immutable_prevent_updates
BEFORE UPDATE ON escalation_events
FOR EACH ROW
EXECUTE FUNCTION raise_immutability_error();

CREATE TRIGGER escalation_events_immutable_prevent_deletes
BEFORE DELETE ON escalation_events
FOR EACH ROW
EXECUTE FUNCTION raise_immutability_error();

-- Verification: These queries should work
-- SELECT * FROM audit_logs LIMIT 1;
-- SELECT * FROM incident_state_history LIMIT 1;
-- SELECT * FROM escalation_events LIMIT 1;
--
-- This query should FAIL with error "Immutable record":
-- UPDATE audit_logs SET action='MODIFIED' WHERE id=(SELECT id FROM audit_logs LIMIT 1);
