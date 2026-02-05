-- ===========================
-- PHASE 4, STEP 4.2: ROLE ESCALATION DETECTION SCHEMA
-- ===========================

-- Role Assignment History
-- Tracks every role change with full audit trail
CREATE TABLE IF NOT EXISTS role_assignment_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  platform_id UUID NOT NULL REFERENCES platforms(id),
  user_id UUID NOT NULL REFERENCES users(id),
  previous_role_id UUID REFERENCES roles(id),
  new_role_id UUID NOT NULL REFERENCES roles(id),
  changed_by_user_id UUID NOT NULL REFERENCES users(id),
  change_reason VARCHAR(255),
  change_source VARCHAR(50), -- 'manual', 'automatic', 'api', 'system'
  ip_address VARCHAR(45),
  user_agent TEXT,
  is_escalation BOOLEAN DEFAULT false,
  is_anomalous BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(platform_id, user_id, created_at)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_role_history_user_created ON role_assignment_history(platform_id, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_role_history_anomaly ON role_assignment_history(platform_id, is_anomalous) WHERE is_anomalous = true;
CREATE INDEX IF NOT EXISTS idx_role_history_escalation ON role_assignment_history(platform_id, is_escalation) WHERE is_escalation = true;

-- Role Escalation Events
-- Detected escalations that need investigation
CREATE TABLE IF NOT EXISTS role_escalation_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  platform_id UUID NOT NULL REFERENCES platforms(id),
  user_id UUID NOT NULL REFERENCES users(id),
  escalation_type VARCHAR(50) NOT NULL, -- 'unexpected_elevation', 'privilege_jump', 'unauthorized_change', 'timing_anomaly'
  severity VARCHAR(20) NOT NULL, -- 'low', 'medium', 'high', 'critical'
  previous_role_id UUID REFERENCES roles(id),
  new_role_id UUID NOT NULL REFERENCES roles(id),
  detection_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  is_resolved BOOLEAN DEFAULT false,
  resolution_note TEXT,
  resolved_at TIMESTAMP,
  resolved_by_user_id UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indices for fast lookups
CREATE INDEX IF NOT EXISTS idx_escalation_events_user ON role_escalation_events(platform_id, user_id, is_resolved);
CREATE INDEX IF NOT EXISTS idx_escalation_events_severity ON role_escalation_events(platform_id, severity, is_resolved);
CREATE INDEX IF NOT EXISTS idx_escalation_events_unresolved ON role_escalation_events(platform_id, is_resolved) WHERE is_resolved = false;

-- Role Revalidation Queue
-- Tracks users whose roles need to be revalidated
CREATE TABLE IF NOT EXISTS role_revalidation_queue (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  platform_id UUID NOT NULL REFERENCES platforms(id),
  user_id UUID NOT NULL REFERENCES users(id),
  reason VARCHAR(100) NOT NULL, -- 'escalation_detected', 'permission_anomaly', 'manual_request'
  escalation_event_id UUID REFERENCES role_escalation_events(id),
  priority VARCHAR(20) DEFAULT 'normal', -- 'low', 'normal', 'high', 'critical'
  revalidation_status VARCHAR(30) DEFAULT 'pending', -- 'pending', 'in_progress', 'completed', 'failed'
  revalidation_result TEXT,
  revalidated_at TIMESTAMP,
  revalidated_by_user_id UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indices
CREATE INDEX IF NOT EXISTS idx_revalidation_queue_status ON role_revalidation_queue(platform_id, revalidation_status);
CREATE INDEX IF NOT EXISTS idx_revalidation_queue_priority ON role_revalidation_queue(platform_id, priority, revalidation_status);
CREATE INDEX IF NOT EXISTS idx_revalidation_queue_user ON role_revalidation_queue(platform_id, user_id, revalidation_status);

-- Role Change Audit Log
-- Complete audit of all role-related changes
CREATE TABLE IF NOT EXISTS role_change_audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  platform_id UUID NOT NULL REFERENCES platforms(id),
  user_id UUID NOT NULL REFERENCES users(id),
  action_type VARCHAR(50) NOT NULL, -- 'role_assigned', 'role_revoked', 'permission_added', 'permission_removed', 'role_revalidated'
  entity_type VARCHAR(50) NOT NULL, -- 'role', 'permission', 'user'
  entity_id UUID,
  details JSONB,
  initiated_by_user_id UUID NOT NULL REFERENCES users(id),
  ip_address VARCHAR(45),
  user_agent TEXT,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indices
CREATE INDEX IF NOT EXISTS idx_role_audit_user ON role_change_audit_log(platform_id, user_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_role_audit_action ON role_change_audit_log(platform_id, action_type, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_role_audit_timestamp ON role_change_audit_log(platform_id, timestamp DESC);

-- Role Assignment Rules
-- Define expected role assignment patterns for anomaly detection
CREATE TABLE IF NOT EXISTS role_assignment_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  platform_id UUID NOT NULL REFERENCES platforms(id),
  rule_name VARCHAR(100) NOT NULL,
  rule_description TEXT,
  from_role_id UUID REFERENCES roles(id), -- null means any role
  to_role_id UUID NOT NULL REFERENCES roles(id),
  is_allowed BOOLEAN DEFAULT false,
  requires_approval BOOLEAN DEFAULT false,
  approval_required_from_role_id UUID REFERENCES roles(id),
  max_simultaneous_users INT,
  time_window_hours INT, -- 0 means unrestricted
  enabled BOOLEAN DEFAULT true,
  created_by_user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indices
CREATE INDEX IF NOT EXISTS idx_assignment_rules_to_role ON role_assignment_rules(platform_id, to_role_id, enabled);
CREATE INDEX IF NOT EXISTS idx_assignment_rules_enabled ON role_assignment_rules(platform_id, enabled);

-- Role Assignment Approvals
-- Track approvals for role assignments that require it
CREATE TABLE IF NOT EXISTS role_assignment_approvals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  platform_id UUID NOT NULL REFERENCES platforms(id),
  user_id UUID NOT NULL REFERENCES users(id),
  requested_role_id UUID NOT NULL REFERENCES roles(id),
  requested_by_user_id UUID NOT NULL REFERENCES users(id),
  approval_status VARCHAR(30) DEFAULT 'pending', -- 'pending', 'approved', 'rejected', 'expired'
  approved_by_user_id UUID REFERENCES users(id),
  approval_reason TEXT,
  rejection_reason TEXT,
  approval_expiry_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indices
CREATE INDEX IF NOT EXISTS idx_approvals_status ON role_assignment_approvals(platform_id, approval_status);
CREATE INDEX IF NOT EXISTS idx_approvals_user ON role_assignment_approvals(platform_id, user_id, approval_status);

-- Triggers for immutable history
CREATE OR REPLACE FUNCTION enforce_role_history_immutability()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Role assignment history cannot be modified or deleted';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER role_history_immutable
BEFORE UPDATE OR DELETE ON role_assignment_history
FOR EACH ROW
EXECUTE FUNCTION enforce_role_history_immutability();

-- Similar trigger for escalation events
CREATE OR REPLACE FUNCTION enforce_escalation_events_immutability()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Escalation events cannot be deleted';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER escalation_events_immutable
BEFORE DELETE ON role_escalation_events
FOR EACH ROW
EXECUTE FUNCTION enforce_escalation_events_immutability();
