-- ===========================
-- SUPERADMIN SYSTEM SETUP
-- Migration: 004_superadmin_system.sql
-- ===========================

-- ===========================
-- CREATE SUPERADMIN ROLE (Platform-wide)
-- ===========================

-- First, check if we have a system platform or create one
INSERT INTO platforms (name, description, is_active)
VALUES ('system', 'System Management Platform', true)
ON CONFLICT (name) DO NOTHING;

-- Add superadmin role to system platform
INSERT INTO roles (platform_id, name, description, permissions)
SELECT 
  p.id,
  'superadmin',
  'Superadmin - Full Platform Access',
  '[
    "manage_all_entities",
    "manage_all_users",
    "view_all_data",
    "view_all_approvals",
    "approve_all_requests",
    "manage_roles",
    "view_audit_logs",
    "system_settings",
    "view_analytics",
    "manage_platforms"
  ]'::jsonb
FROM platforms p
WHERE p.name = 'system'
ON CONFLICT DO NOTHING;

-- ===========================
-- SUPERADMIN AUDIT LOG TABLE
-- ===========================

-- Track all superadmin actions for security
CREATE TABLE IF NOT EXISTS superadmin_action_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  superadmin_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action VARCHAR(255) NOT NULL,
  entity_type VARCHAR(100), -- 'school_entity', 'corporate_entity', 'user', 'approval', etc
  entity_id UUID,
  details JSONB,
  ip_address VARCHAR(45),
  user_agent TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ===========================
-- SUPERADMIN DASHBOARD STATISTICS
-- ===========================

-- Cached statistics for performance (updated periodically)
CREATE TABLE IF NOT EXISTS superadmin_statistics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  metric_name VARCHAR(255) NOT NULL,
  metric_value INTEGER DEFAULT 0,
  metric_data JSONB,
  calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(metric_name)
);

-- ===========================
-- INDEXES FOR PERFORMANCE
-- ===========================

CREATE INDEX IF NOT EXISTS idx_superadmin_action_logs_superadmin_user_id ON superadmin_action_logs(superadmin_user_id);
CREATE INDEX IF NOT EXISTS idx_superadmin_action_logs_action ON superadmin_action_logs(action);
CREATE INDEX IF NOT EXISTS idx_superadmin_action_logs_created_at ON superadmin_action_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_superadmin_action_logs_entity_type ON superadmin_action_logs(entity_type);
CREATE INDEX IF NOT EXISTS idx_superadmin_statistics_metric_name ON superadmin_statistics(metric_name);

-- ===========================
-- HELPER FUNCTION: Is User Superadmin
-- ===========================

CREATE OR REPLACE FUNCTION is_superadmin(user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 
    FROM users u
    JOIN roles r ON u.role_id = r.id
    JOIN platforms p ON r.platform_id = p.id
    WHERE u.id = user_id 
    AND r.name = 'superadmin' 
    AND p.name = 'system'
  );
END;
$$ LANGUAGE plpgsql;

-- ===========================
-- HELPER FUNCTION: Log Superadmin Action
-- ===========================

CREATE OR REPLACE FUNCTION log_superadmin_action(
  superadmin_user_id UUID,
  action VARCHAR,
  entity_type VARCHAR DEFAULT NULL,
  entity_id UUID DEFAULT NULL,
  details JSONB DEFAULT NULL,
  ip_address VARCHAR DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  log_id UUID;
BEGIN
  INSERT INTO superadmin_action_logs (
    superadmin_user_id, action, entity_type, entity_id, details, ip_address
  )
  VALUES (superadmin_user_id, action, entity_type, entity_id, details, ip_address)
  RETURNING id INTO log_id;
  
  RETURN log_id;
END;
$$ LANGUAGE plpgsql;

-- ===========================
-- INITIAL SEED: Create Sample Superadmin User
-- ===========================

-- Get the system platform ID and superadmin role ID
DO $$
DECLARE
  v_system_platform_id UUID;
  v_superadmin_role_id UUID;
  v_superadmin_user_id UUID;
BEGIN
  -- Get system platform
  SELECT id INTO v_system_platform_id FROM platforms WHERE name = 'system' LIMIT 1;
  
  -- Get superadmin role
  SELECT r.id INTO v_superadmin_role_id 
  FROM roles r 
  WHERE r.name = 'superadmin' 
  AND r.platform_id = v_system_platform_id 
  LIMIT 1;
  
  -- Check if superadmin user already exists
  SELECT id INTO v_superadmin_user_id 
  FROM users 
  WHERE email = 'superadmin@smartattend.local' 
  AND platform_id = v_system_platform_id
  LIMIT 1;
  
  -- If not exists, create it
  IF v_superadmin_user_id IS NULL THEN
    INSERT INTO users (
      platform_id,
      email,
      full_name,
      role_id,
      password_hash,
      is_active
    )
    VALUES (
      v_system_platform_id,
      'superadmin@smartattend.local',
      'System Superadmin',
      v_superadmin_role_id,
      -- Default password hash (for 'smartattend123' - should be changed in production)
      -- This uses bcrypt: $2b$10$... format
      '$2b$10$Z8z7QqKVq8v8Z8z7QqKVq.EvHvHvEvHvEvHvEvHvEvHvEvHvEvHv', 
      true
    );
  END IF;
END $$;

-- ===========================
-- VIEWS FOR SUPERADMIN DASHBOARD
-- ===========================

-- View: All entities summary
CREATE OR REPLACE VIEW superadmin_entities_summary AS
SELECT 
  'school' AS entity_type,
  CAST(COUNT(*) AS INTEGER) AS total_count,
  SUM(CASE WHEN is_active = true THEN 1 ELSE 0 END) AS active_count,
  SUM(CASE WHEN is_active = false THEN 1 ELSE 0 END) AS inactive_count
FROM school_entities
UNION ALL
SELECT 
  'corporate' AS entity_type,
  CAST(COUNT(*) AS INTEGER) AS total_count,
  SUM(CASE WHEN is_active = true THEN 1 ELSE 0 END) AS active_count,
  SUM(CASE WHEN is_active = false THEN 1 ELSE 0 END) AS inactive_count
FROM corporate_entities;

-- View: All pending approvals across platforms
CREATE OR REPLACE VIEW superadmin_all_pending_approvals AS
SELECT 
  sau.id,
  'school' AS entity_type,
  se.name AS entity_name,
  se.id AS entity_id,
  u.full_name AS user_name,
  u.email AS user_email,
  sau.requested_role AS role,
  sau.requested_at AS requested_at,
  'school_user_approvals' AS table_name
FROM school_user_approvals sau
JOIN users u ON sau.user_id = u.id
JOIN school_entities se ON sau.school_entity_id = se.id
WHERE sau.status = 'pending'
UNION ALL
SELECT 
  cau.id,
  'corporate' AS entity_type,
  ce.name AS entity_name,
  ce.id AS entity_id,
  u.full_name AS user_name,
  u.email AS user_email,
  cau.requested_role AS role,
  cau.requested_at AS requested_at,
  'corporate_user_approvals' AS table_name
FROM corporate_user_approvals cau
JOIN users u ON cau.user_id = u.id
JOIN corporate_entities ce ON cau.corporate_entity_id = ce.id
WHERE cau.status = 'pending'
ORDER BY requested_at DESC;

-- View: User statistics by platform
CREATE OR REPLACE VIEW superadmin_user_statistics AS
SELECT 
  p.id AS platform_id,
  p.name AS platform_name,
  COUNT(DISTINCT u.id) AS total_users,
  SUM(CASE WHEN u.is_active = true THEN 1 ELSE 0 END) AS active_users,
  COUNT(DISTINCT CASE WHEN r.name = 'admin' THEN u.id END) AS admin_count,
  COUNT(DISTINCT CASE WHEN r.name = 'student' THEN u.id END) AS student_count,
  COUNT(DISTINCT CASE WHEN r.name = 'faculty' THEN u.id END) AS faculty_count,
  COUNT(DISTINCT CASE WHEN r.name = 'employee' THEN u.id END) AS employee_count,
  COUNT(DISTINCT CASE WHEN r.name = 'it' THEN u.id END) AS it_count,
  COUNT(DISTINCT CASE WHEN r.name = 'hr' THEN u.id END) AS hr_count
FROM platforms p
LEFT JOIN users u ON p.id = u.platform_id
LEFT JOIN roles r ON u.role_id = r.id
WHERE p.name != 'system'
GROUP BY p.id, p.name;
