-- ===========================
-- PHASE 4: ROLE BOUNDARIES & PRIVILEGE ESCALATION
-- Migration 018: Role History & Escalation Tracking
-- ===========================
-- Creates immutable audit trail for role changes
-- and infrastructure for escalation detection

BEGIN;

-- ===========================
-- A. ROLE ASSIGNMENT HISTORY (Immutable)
-- ===========================
-- Tracks every role change with full context

CREATE TABLE IF NOT EXISTS role_assignment_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- User and role info
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  
  -- Who made the change?
  assigned_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  
  -- When?
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT TRUE,
  
  -- Context
  reason TEXT,
  severity VARCHAR(50) NOT NULL DEFAULT 'NORMAL', -- SYSTEM_BOOTSTRAP, NORMAL, ESCALATION_SUSPECTED, EMERGENCY
  
  -- Anomaly detection flags (auto-populated)
  detection_flags TEXT[] DEFAULT '{}',
  anomaly_score DECIMAL(5,2) DEFAULT 0,
  
  -- Human verification
  is_verified BOOLEAN DEFAULT FALSE,
  verified_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  verified_at TIMESTAMPTZ,
  verification_notes TEXT,
  
  -- Immutability
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  checksum VARCHAR(64)
);

-- Indexes for queries
CREATE INDEX IF NOT EXISTS idx_role_history_user_id ON role_assignment_history(user_id);
CREATE INDEX IF NOT EXISTS idx_role_history_role_id ON role_assignment_history(role_id);
CREATE INDEX IF NOT EXISTS idx_role_history_assigned_by ON role_assignment_history(assigned_by_user_id);
CREATE INDEX IF NOT EXISTS idx_role_history_assigned_at ON role_assignment_history(assigned_at DESC);
CREATE INDEX IF NOT EXISTS idx_role_history_severity ON role_assignment_history(severity);
CREATE INDEX IF NOT EXISTS idx_role_history_anomaly_score ON role_assignment_history(anomaly_score DESC) 
  WHERE anomaly_score > 0;

-- IMMUTABILITY TRIGGERS
DROP TRIGGER IF EXISTS prevent_role_history_update ON role_assignment_history;
DROP TRIGGER IF EXISTS prevent_role_history_delete ON role_assignment_history;

CREATE OR REPLACE FUNCTION prevent_role_history_update()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Role assignment history is immutable. UPDATE operations are not permitted.';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION prevent_role_history_delete()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Role assignment history is immutable. DELETE operations are not permitted.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER prevent_role_history_update
BEFORE UPDATE ON role_assignment_history
FOR EACH ROW
EXECUTE FUNCTION prevent_role_history_update();

CREATE TRIGGER prevent_role_history_delete
BEFORE DELETE ON role_assignment_history
FOR EACH ROW
EXECUTE FUNCTION prevent_role_history_delete();

-- ===========================
-- B. PRIVILEGE ESCALATION EVENTS
-- ===========================
-- Auto-detected suspicious role changes

CREATE TABLE IF NOT EXISTS privilege_escalation_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- What triggered this?
  role_assignment_id UUID REFERENCES role_assignment_history(id) ON DELETE CASCADE,
  
  -- Who is involved?
  affected_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  affected_role_id UUID REFERENCES roles(id) ON DELETE SET NULL,
  triggered_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  
  -- Classification
  event_type VARCHAR(100) NOT NULL, -- TEMPORAL_CLUSTER, RECURSIVE_ELEVATION, BYPASS_PATTERN, COORDINATED_ELEVATION, UNUSUAL_SUPERADMIN_ACTION
  severity VARCHAR(50) NOT NULL, -- LOW, MEDIUM, HIGH, CRITICAL
  
  -- Details
  description TEXT,
  correlation_flags TEXT[], -- Detection flags (e.g., ['same_second_cluster', 'multiple_assignments'])
  anomaly_score DECIMAL(5,2),
  
  -- Related events (for coordinated detection)
  related_event_ids UUID[] DEFAULT '{}',
  
  -- Status
  status VARCHAR(50) DEFAULT 'OPEN', -- OPEN, INVESTIGATING, RESOLVED_LEGITIMATE, RESOLVED_BLOCKED, ESCALATED
  
  -- Investigation
  investigation_notes TEXT,
  investigated_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  investigated_at TIMESTAMPTZ,
  
  -- Auto-actions taken
  actions_taken TEXT[], -- ['SESSION_INVALIDATED', 'EMAIL_SENT', 'MFA_CHALLENGED', 'ROLE_REVOKED']
  
  -- Immutability
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_escalation_user_id ON privilege_escalation_events(affected_user_id);
CREATE INDEX IF NOT EXISTS idx_escalation_event_type ON privilege_escalation_events(event_type);
CREATE INDEX IF NOT EXISTS idx_escalation_severity ON privilege_escalation_events(severity);
CREATE INDEX IF NOT EXISTS idx_escalation_status ON privilege_escalation_events(status);
CREATE INDEX IF NOT EXISTS idx_escalation_created_at ON privilege_escalation_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_escalation_triggered_by ON privilege_escalation_events(triggered_by_user_id);

-- ===========================
-- C. ROLE BOUNDARY VIOLATIONS
-- ===========================
-- Tracks when role guards blocked unauthorized action

CREATE TABLE IF NOT EXISTS role_boundary_violations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Who tried what?
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_role VARCHAR(100),
  
  -- What were they trying to do?
  action_type VARCHAR(100) NOT NULL, -- e.g., 'MARK_ATTENDANCE', 'GRANT_ADMIN'
  target_resource_type VARCHAR(100), -- e.g., 'ATTENDANCE', 'USER'
  target_resource_id UUID,
  
  -- Why was it blocked?
  reason TEXT,
  severity VARCHAR(50) NOT NULL DEFAULT 'MEDIUM', -- LOW, MEDIUM, HIGH, CRITICAL
  
  -- Context
  ip_address INET,
  user_agent VARCHAR(500),
  request_id VARCHAR(255),
  
  -- Related escalation event
  escalation_event_id UUID REFERENCES privilege_escalation_events(id) ON DELETE SET NULL,
  
  -- Immutability
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_violations_user_id ON role_boundary_violations(user_id);
CREATE INDEX IF NOT EXISTS idx_violations_action_type ON role_boundary_violations(action_type);
CREATE INDEX IF NOT EXISTS idx_violations_created_at ON role_boundary_violations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_violations_severity ON role_boundary_violations(severity);
CREATE INDEX IF NOT EXISTS idx_violations_escalation_id ON role_boundary_violations(escalation_event_id);

-- ===========================
-- D. USER ROLE SECURITY STATE
-- ===========================
-- Track security flags for users (added to users table via migration)

ALTER TABLE users
ADD COLUMN IF NOT EXISTS role_may_be_compromised BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS last_role_change_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS last_role_change_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS total_role_changes INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_escalation_event_id UUID REFERENCES privilege_escalation_events(id) ON DELETE SET NULL;

-- ===========================
-- E. ANALYSIS VIEWS
-- ===========================

-- View: Recent role changes
CREATE OR REPLACE VIEW recent_role_changes AS
SELECT
  rah.id,
  rah.user_id,
  u.email AS user_email,
  r.name AS role_name,
  rah.assigned_by_user_id,
  assigner.email AS assigned_by_email,
  rah.assigned_at,
  rah.revoked_at,
  rah.severity,
  rah.detection_flags,
  rah.anomaly_score,
  rah.is_verified,
  rah.reason,
  (CURRENT_TIMESTAMP - rah.assigned_at) AS age
FROM role_assignment_history rah
JOIN users u ON rah.user_id = u.id
JOIN roles r ON rah.role_id = r.id
LEFT JOIN users assigner ON rah.assigned_by_user_id = assigner.id
WHERE rah.is_active = TRUE
ORDER BY rah.assigned_at DESC;

-- View: Unverified escalations
CREATE OR REPLACE VIEW unverified_escalations AS
SELECT
  id,
  affected_user_id,
  affected_role_id,
  triggered_by_user_id,
  event_type,
  severity,
  status,
  correlation_flags,
  anomaly_score,
  created_at,
  (CURRENT_TIMESTAMP - created_at) AS age
FROM privilege_escalation_events
WHERE status IN ('OPEN', 'INVESTIGATING')
  AND is_verified = FALSE
ORDER BY severity DESC, created_at DESC;

-- View: User privilege history (timeline)
CREATE OR REPLACE VIEW user_privilege_timeline AS
SELECT
  user_id,
  assigned_at,
  r.name AS role_name,
  a.full_name AS assigned_by,
  reason,
  detection_flags,
  anomaly_score,
  'ASSIGNED' AS event_type
FROM role_assignment_history rah
JOIN roles r ON rah.role_id = r.id
LEFT JOIN users a ON rah.assigned_by_user_id = a.id
WHERE rah.is_active = TRUE

UNION ALL

SELECT
  user_id,
  revoked_at,
  r.name AS role_name,
  NULL AS assigned_by,
  reason,
  detection_flags,
  NULL AS anomaly_score,
  'REVOKED' AS event_type
FROM role_assignment_history rah
JOIN roles r ON rah.role_id = r.id
WHERE rah.revoked_at IS NOT NULL

ORDER BY user_id, assigned_at DESC;

-- ===========================
-- F. ROLE PERMISSION MATRIX
-- ===========================
-- Define what each role can/cannot do

CREATE TABLE IF NOT EXISTS role_permissions_matrix (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  
  -- Action being controlled
  action_name VARCHAR(100) NOT NULL, -- e.g., 'MARK_ATTENDANCE', 'GRANT_ADMIN', 'VIEW_LOGS'
  action_resource_type VARCHAR(100), -- e.g., 'ATTENDANCE', 'USER', 'AUDIT_LOG'
  
  -- Permission
  is_allowed BOOLEAN NOT NULL DEFAULT FALSE,
  
  -- Context (e.g., can only do own resources)
  restriction_scope VARCHAR(100), -- 'OWN_ONLY', 'TENANT', 'GLOBAL', 'NONE'
  
  -- Admin notes
  reason TEXT,
  
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE(role_id, action_name, action_resource_type)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_permissions_role_id ON role_permissions_matrix(role_id);
CREATE INDEX IF NOT EXISTS idx_permissions_action ON role_permissions_matrix(action_name);

-- Insert default permissions (can be overridden)
INSERT INTO role_permissions_matrix 
  (role_id, action_name, action_resource_type, is_allowed, restriction_scope, reason)
SELECT r.id, 'MARK_ATTENDANCE', 'ATTENDANCE', 
       r.name IN ('faculty', 'admin'), 
       'TENANT',
       'Only faculty and admins can mark attendance'
FROM roles r
WHERE NOT EXISTS (
  SELECT 1 FROM role_permissions_matrix rpm 
  WHERE rpm.role_id = r.id 
    AND rpm.action_name = 'MARK_ATTENDANCE'
)
ON CONFLICT DO NOTHING;

-- ===========================
-- G. SESSION SECURITY STATE
-- ===========================
-- Track sessions that need revalidation

CREATE TABLE IF NOT EXISTS session_security_flags (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  session_id VARCHAR(255) NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  -- Flags
  requires_mfa_challenge BOOLEAN DEFAULT FALSE,
  role_revalidation_required BOOLEAN DEFAULT FALSE,
  is_invalidated BOOLEAN DEFAULT FALSE,
  
  -- Reason
  reason TEXT,
  triggered_by_escalation_event_id UUID REFERENCES privilege_escalation_events(id) ON DELETE SET NULL,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  invalidated_at TIMESTAMPTZ
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_session_flags_user_id ON session_security_flags(user_id);
CREATE INDEX IF NOT EXISTS idx_session_flags_session_id ON session_security_flags(session_id);
CREATE INDEX IF NOT EXISTS idx_session_flags_is_invalidated ON session_security_flags(is_invalidated);

-- ===========================
-- DOCUMENTATION
-- ===========================

COMMENT ON TABLE role_assignment_history IS
  'Immutable audit trail of role assignments and revocations. Legal defense for role-based disputes.';

COMMENT ON TABLE privilege_escalation_events IS
  'Auto-detected suspicious role changes. Used to flag and investigate potential privilege escalations.';

COMMENT ON TABLE role_boundary_violations IS
  'Tracks attempts to perform actions outside role boundaries. Indicates misconfigurations or attacks.';

COMMENT ON TABLE role_permissions_matrix IS
  'Master list of what each role can/cannot do. Define boundaries at service layer.';

COMMENT ON TABLE session_security_flags IS
  'Track sessions requiring revalidation after anomaly detection. Invalidate compromised sessions.';

-- ===========================
-- VERIFICATION SCRIPT
-- ===========================
/*

-- Test 1: Verify immutability triggers
SELECT trigger_name, event_object_table
FROM information_schema.triggers
WHERE event_object_table IN ('role_assignment_history', 'privilege_escalation_events')
  AND trigger_timing = 'BEFORE';
-- Expected: 2 rows

-- Test 2: View role changes
SELECT * FROM recent_role_changes LIMIT 1;

-- Test 3: Check escalation detection
SELECT * FROM unverified_escalations LIMIT 1;

-- Test 4: Verify permission matrix populated
SELECT COUNT(*) FROM role_permissions_matrix;
-- Expected: >0

*/

COMMIT;
