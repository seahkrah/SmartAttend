-- Migration: 006_superadmin_security_tables
-- Description: Create tables for superadmin security hardening
-- Features: MFA, sessions, IP allowlisting, rate limiting, confirmation tokens

-- Superadmin Sessions Table
-- superadmin_sessions is created by 006_infrastructure_control_plane.sql,
-- which runs first. CREATE TABLE IF NOT EXISTS therefore silently skipped this
-- definition and left the security columns missing, so the indexes below and
-- superadminSecurityService both failed against the real table.
-- Reconcile instead of redefining: add what the security layer needs.
-- superadmin_sessions is already created by 006_infrastructure_control_plane.sql. CREATE TABLE IF NOT
-- EXISTS would skip this definition silently and leave the columns below
-- missing, so add them to the existing table instead.
ALTER TABLE superadmin_sessions ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

ALTER TABLE superadmin_sessions ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE superadmin_sessions ADD COLUMN IF NOT EXISTS session_token_hash VARCHAR(255);
ALTER TABLE superadmin_sessions ADD COLUMN IF NOT EXISTS ip_address VARCHAR(45);
ALTER TABLE superadmin_sessions ADD COLUMN IF NOT EXISTS user_agent TEXT;
ALTER TABLE superadmin_sessions ADD COLUMN IF NOT EXISTS mfa_verified_at TIMESTAMPTZ;
ALTER TABLE superadmin_sessions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE superadmin_sessions ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE superadmin_sessions ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE superadmin_sessions ADD COLUMN IF NOT EXISTS terminated_at TIMESTAMPTZ;
ALTER TABLE superadmin_sessions ADD COLUMN IF NOT EXISTS terminated_reason VARCHAR(255);

-- The infrastructure migration names the owning user superadmin_user_id and
-- the security layer names it user_id. Keep both populated so neither the
-- service nor the existing tests break, with user_id backfilled from it.
UPDATE superadmin_sessions SET user_id = superadmin_user_id WHERE user_id IS NULL;


CREATE INDEX IF NOT EXISTS idx_superadmin_sessions_user_active ON superadmin_sessions(user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_superadmin_sessions_expires ON superadmin_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_superadmin_sessions_created ON superadmin_sessions(created_at);

-- MFA Challenges Table
CREATE TABLE IF NOT EXISTS mfa_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  method VARCHAR(50) NOT NULL,
  code_hash VARCHAR(255),
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 5,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,
  verified_at TIMESTAMP,
  verified_method VARCHAR(50)
);

CREATE INDEX IF NOT EXISTS idx_mfa_challenges_user_verified ON mfa_challenges(user_id, verified_at);
CREATE INDEX IF NOT EXISTS idx_mfa_challenges_expires ON mfa_challenges(expires_at);

-- IP Allowlist Table
CREATE TABLE IF NOT EXISTS ip_allowlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip_address VARCHAR(45) NOT NULL,
  description VARCHAR(255),
  added_by UUID REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP,
  is_active BOOLEAN DEFAULT true,
  last_used_at TIMESTAMP,
  
  UNIQUE(user_id, ip_address)
);

CREATE INDEX IF NOT EXISTS idx_ip_allowlist_user_active ON ip_allowlist(user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_ip_allowlist_expires ON ip_allowlist(expires_at);

-- Rate Limits Table
CREATE TABLE IF NOT EXISTS rate_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action VARCHAR(100) NOT NULL,
  count INTEGER DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reset_at TIMESTAMP NOT NULL,
  
  UNIQUE(user_id, action, reset_at)
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_user_action_reset ON rate_limits(user_id, action, reset_at);

-- Confirmation Tokens Table
CREATE TABLE IF NOT EXISTS confirmation_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation VARCHAR(100) NOT NULL,
  token_hash VARCHAR(255) NOT NULL UNIQUE,
  context JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,
  is_used BOOLEAN DEFAULT false,
  used_at TIMESTAMP,
  used_by UUID REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_confirmation_tokens_operation_used ON confirmation_tokens(operation, is_used);
CREATE INDEX IF NOT EXISTS idx_confirmation_tokens_expires ON confirmation_tokens(expires_at);

-- Dry-Run Logs Table
CREATE TABLE IF NOT EXISTS dry_run_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation VARCHAR(100) NOT NULL,
  context JSONB,
  validation_result JSONB,
  was_successful BOOLEAN,
  simulation_notes TEXT,
  simulated_by UUID REFERENCES users(id),
  simulated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_dry_run_logs_operation_timestamp ON dry_run_logs(operation, simulated_at);
CREATE INDEX IF NOT EXISTS idx_dry_run_logs_simulated_by ON dry_run_logs(simulated_by);

-- Security Event Logs Table
CREATE TABLE IF NOT EXISTS security_event_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  event_type VARCHAR(100) NOT NULL,
  details JSONB,
  severity VARCHAR(20) NOT NULL,
  ip_address VARCHAR(45),
  user_agent TEXT,
  logged_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_security_logs_user_timestamp ON security_event_logs(user_id, logged_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_logs_event_type_timestamp ON security_event_logs(event_type, logged_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_logs_severity_timestamp ON security_event_logs(severity, logged_at DESC);

-- Add audit triggers for security_event_logs to ensure immutability
CREATE OR REPLACE FUNCTION prevent_security_log_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Security event logs cannot be modified. Operation: %', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS security_log_immutable ON security_event_logs;
CREATE TRIGGER security_log_immutable
BEFORE UPDATE OR DELETE ON security_event_logs
FOR EACH ROW
EXECUTE FUNCTION prevent_security_log_modification();

-- Create indices for faster queries
CREATE INDEX IF NOT EXISTS idx_superadmin_sessions_lookup ON superadmin_sessions(user_id, is_active, expires_at);
CREATE INDEX IF NOT EXISTS idx_mfa_challenges_active ON mfa_challenges(user_id, verified_at) WHERE verified_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ip_allowlist_check ON ip_allowlist(user_id, ip_address, is_active) WHERE is_active = true;
-- No WHERE clause: an index predicate must be IMMUTABLE, and CURRENT_TIMESTAMP
-- is not. A plain index on the same columns serves the same lookups.
CREATE INDEX IF NOT EXISTS idx_rate_limits_check ON rate_limits(user_id, action, reset_at);
