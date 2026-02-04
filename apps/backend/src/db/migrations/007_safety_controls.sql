-- ===========================
-- SAFETY CONTROLS: IP ALLOWLIST & MFA TRACKING
-- Migration: 007_safety_controls.sql
-- ===========================
-- Adds IP allowlisting and MFA audit tracking for enhanced superadmin security

-- ===========================
-- A. IP ALLOWLIST (Per-Superadmin)
-- ===========================

CREATE TABLE IF NOT EXISTS superadmin_ip_allowlist (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  superadmin_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  ip_address INET NOT NULL,
  ip_range CIDR, -- Optional CIDR range
  description TEXT,
  
  added_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  added_by_superadmin_id UUID REFERENCES users(id) ON DELETE SET NULL,
  
  expires_at TIMESTAMPTZ, -- Optional expiration date
  is_active BOOLEAN DEFAULT TRUE,
  
  UNIQUE(superadmin_user_id, ip_address)
);

CREATE INDEX IF NOT EXISTS idx_ip_allowlist_user ON superadmin_ip_allowlist(superadmin_user_id);
CREATE INDEX IF NOT EXISTS idx_ip_allowlist_active ON superadmin_ip_allowlist(is_active) WHERE is_active = TRUE;

-- ===========================
-- B. MFA AUDIT TRACKING
-- ===========================

CREATE TABLE IF NOT EXISTS mfa_audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  superadmin_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  event_type VARCHAR(50) NOT NULL CHECK (event_type IN ('CHALLENGE_CREATED', 'CHALLENGE_VERIFIED', 'CHALLENGE_FAILED', 'VERIFICATION_EXPIRED')),
  mfa_method VARCHAR(20) NOT NULL CHECK (mfa_method IN ('TOTP', 'SMS', 'EMAIL')),
  
  challenge_id VARCHAR(255),
  result VARCHAR(20) NOT NULL CHECK (result IN ('SUCCESS', 'FAILURE', 'EXPIRED')),
  
  ip_address INET,
  user_agent VARCHAR(500),
  
  timestamp TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_mfa_audit_user ON mfa_audit_log(superadmin_user_id);
CREATE INDEX IF NOT EXISTS idx_mfa_audit_timestamp ON mfa_audit_log(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_mfa_audit_event ON mfa_audit_log(event_type);

-- ===========================
-- C. RATE LIMIT ENFORCEMENT LOG
-- ===========================

CREATE TABLE IF NOT EXISTS rate_limit_violations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  superadmin_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action_type VARCHAR(100) NOT NULL,
  
  window_seconds INTEGER NOT NULL,
  max_requests INTEGER NOT NULL,
  request_count INTEGER NOT NULL,
  
  first_attempt_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  violation_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  ip_address INET
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_user ON rate_limit_violations(superadmin_user_id);
CREATE INDEX IF NOT EXISTS idx_rate_limit_action ON rate_limit_violations(action_type);
CREATE INDEX IF NOT EXISTS idx_rate_limit_timestamp ON rate_limit_violations(violation_at DESC);

-- ===========================
-- D. ANOMALY DETECTION BASELINE
-- ===========================

-- Track normal behavior patterns to detect anomalies
CREATE TABLE IF NOT EXISTS superadmin_behavior_baseline (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  superadmin_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  -- Geographic/temporal patterns
  typical_ip_addresses INET[],
  typical_access_hours VARCHAR(50), -- e.g., "09:00-17:00 UTC"
  typical_actions VARCHAR(100)[], -- Frequently performed actions
  
  -- Update tracking
  last_updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  learning_period_days INTEGER DEFAULT 30,
  
  is_locked_in BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_behavior_baseline_user ON superadmin_behavior_baseline(superadmin_user_id);

-- ===========================
-- E. ANOMALY LOG
-- ===========================

CREATE TABLE IF NOT EXISTS anomaly_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  superadmin_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  anomaly_type VARCHAR(50) NOT NULL CHECK (anomaly_type IN (
    'UNUSUAL_TIME',
    'UNUSUAL_LOCATION',
    'UNUSUAL_ACTION',
    'RAPID_ESCALATION',
    'MASS_OPERATION'
  )),
  
  severity VARCHAR(20) NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  state VARCHAR(20) NOT NULL DEFAULT 'OPEN' CHECK (state IN ('OPEN', 'INVESTIGATING', 'FALSE_POSITIVE', 'RESOLVED')),
  
  details JSONB NOT NULL,
  ip_address INET,
  
  detected_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  investigated_at TIMESTAMPTZ,
  investigated_by_superadmin_id UUID REFERENCES users(id) ON DELETE SET NULL,
  investigation_notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_anomaly_user ON anomaly_log(superadmin_user_id);
CREATE INDEX IF NOT EXISTS idx_anomaly_type ON anomaly_log(anomaly_type);
CREATE INDEX IF NOT EXISTS idx_anomaly_state ON anomaly_log(state);
CREATE INDEX IF NOT EXISTS idx_anomaly_severity ON anomaly_log(severity);
CREATE INDEX IF NOT EXISTS idx_anomaly_timestamp ON anomaly_log(detected_at DESC);

COMMIT;
