-- ===========================
-- PHASE 4: ROLE ESCALATION DETECTION (SIMPLIFIED)
-- ===========================

-- ===========================
-- A. ROLE ASSIGNMENT HISTORY
-- ===========================

CREATE TABLE IF NOT EXISTS role_assignment_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  platform_id UUID NOT NULL REFERENCES platforms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  previous_role_id UUID REFERENCES roles(id) ON DELETE SET NULL,
  new_role_id UUID REFERENCES roles(id) ON DELETE SET NULL,
  changed_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  change_reason VARCHAR(255),
  change_source VARCHAR(50),
  ip_address VARCHAR(45),
  user_agent TEXT,
  is_escalation BOOLEAN DEFAULT false,
  is_anomalous BOOLEAN DEFAULT false,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_role_history_user_created ON role_assignment_history(platform_id, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_role_history_anomaly ON role_assignment_history(platform_id, is_anomalous) WHERE is_anomalous = true;
CREATE INDEX IF NOT EXISTS idx_role_history_escalation ON role_assignment_history(platform_id, is_escalation) WHERE is_escalation = true;

-- ===========================
-- B. ROLE ESCALATION EVENTS
-- ===========================

CREATE TABLE IF NOT EXISTS role_escalation_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  platform_id UUID NOT NULL REFERENCES platforms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  escalation_type VARCHAR(50),
  severity VARCHAR(20),
  previous_role_id UUID REFERENCES roles(id) ON DELETE SET NULL,
  new_role_id UUID REFERENCES roles(id) ON DELETE SET NULL,
  detection_timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_resolved BOOLEAN DEFAULT false,
  resolution_note TEXT,
  resolved_at TIMESTAMP,
  resolved_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_escalation_events_user ON role_escalation_events(platform_id, user_id, is_resolved);
CREATE INDEX IF NOT EXISTS idx_escalation_events_severity ON role_escalation_events(platform_id, severity, is_resolved);
CREATE INDEX IF NOT EXISTS idx_escalation_events_unresolved ON role_escalation_events(platform_id, is_resolved) WHERE is_resolved = false;

-- ===========================
-- C. ROLE REVALIDATION QUEUE
-- ===========================

CREATE TABLE IF NOT EXISTS role_revalidation_queue (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  platform_id UUID NOT NULL REFERENCES platforms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason VARCHAR(100),
  escalation_event_id UUID REFERENCES role_escalation_events(id) ON DELETE SET NULL,
  priority VARCHAR(20) DEFAULT 'normal',
  revalidation_status VARCHAR(30) DEFAULT 'pending',
  revalidation_result TEXT,
  revalidated_at TIMESTAMP,
  revalidated_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_revalidation_queue_status ON role_revalidation_queue(platform_id, revalidation_status);
CREATE INDEX IF NOT EXISTS idx_revalidation_queue_priority ON role_revalidation_queue(platform_id, priority, revalidation_status);
CREATE INDEX IF NOT EXISTS idx_revalidation_queue_user ON role_revalidation_queue(platform_id, user_id, revalidation_status);

-- ===========================
-- D. ROLE CHANGE AUDIT LOG
-- ===========================

CREATE TABLE IF NOT EXISTS role_change_audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  platform_id UUID NOT NULL REFERENCES platforms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action_type VARCHAR(50),
  previous_role_id UUID REFERENCES roles(id) ON DELETE SET NULL,
  new_role_id UUID REFERENCES roles(id) ON DELETE SET NULL,
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_role VARCHAR(50),
  change_reason TEXT,
  change_source VARCHAR(50),
  ip_address VARCHAR(45),
  user_agent TEXT,
  timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_role_audit_user ON role_change_audit_log(platform_id, user_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_role_audit_action ON role_change_audit_log(platform_id, action_type, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_role_audit_timestamp ON role_change_audit_log(platform_id, timestamp DESC);

-- ===========================
-- E. ROLE ASSIGNMENT RULES
-- ===========================

CREATE TABLE IF NOT EXISTS role_assignment_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  platform_id UUID NOT NULL REFERENCES platforms(id) ON DELETE CASCADE,
  rule_name VARCHAR(100),
  rule_description TEXT,
  from_role_id UUID REFERENCES roles(id) ON DELETE SET NULL,
  to_role_id UUID REFERENCES roles(id) ON DELETE SET NULL,
  is_allowed BOOLEAN DEFAULT false,
  requires_approval BOOLEAN DEFAULT false,
  approval_required_from_role_id UUID REFERENCES roles(id) ON DELETE SET NULL,
  max_simultaneous_users INT,
  time_window_hours INT,
  enabled BOOLEAN DEFAULT true,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_assignment_rules_to_role ON role_assignment_rules(platform_id, to_role_id, enabled);
CREATE INDEX IF NOT EXISTS idx_assignment_rules_enabled ON role_assignment_rules(platform_id, enabled);

-- ===========================
-- F. ROLE ASSIGNMENT APPROVALS
-- ===========================

CREATE TABLE IF NOT EXISTS role_assignment_approvals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  platform_id UUID NOT NULL REFERENCES platforms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requested_role_id UUID REFERENCES roles(id) ON DELETE SET NULL,
  requested_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  approval_status VARCHAR(30) DEFAULT 'pending',
  approved_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  approval_reason TEXT,
  rejection_reason TEXT,
  expires_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_approvals_status ON role_assignment_approvals(platform_id, approval_status);
CREATE INDEX IF NOT EXISTS idx_approvals_user ON role_assignment_approvals(platform_id, user_id, approval_status);

COMMIT;
