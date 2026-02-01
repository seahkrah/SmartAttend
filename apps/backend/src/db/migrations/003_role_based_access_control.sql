-- ===========================
-- ROLE-BASED ACCESS CONTROL WITH APPROVAL WORKFLOW
-- Migration: 003_role_based_access_control.sql
-- ===========================

-- Add new IT role for School platform
INSERT INTO roles (platform_id, name, description, permissions) 
SELECT id, 'it', 'IT Administrator Role', '["manage_system", "manage_users", "view_reports", "manage_infrastructure"]'::jsonb
FROM platforms WHERE name = 'school' ON CONFLICT DO NOTHING;

-- Add new IT and HR roles for Corporate platform
INSERT INTO roles (platform_id, name, description, permissions) 
SELECT id, 'it', 'IT Administrator Role', '["manage_system", "manage_users", "view_reports"]'::jsonb
FROM platforms WHERE name = 'corporate' ON CONFLICT DO NOTHING;

INSERT INTO roles (platform_id, name, description, permissions) 
SELECT id, 'hr', 'HR Administrator Role', '["manage_employees", "manage_policies", "view_all_attendance", "manage_approvals"]'::jsonb
FROM platforms WHERE name = 'corporate' ON CONFLICT DO NOTHING;

-- ===========================
-- ENTITY MANAGEMENT TABLES
-- ===========================

-- Schools (one or more school entities using the platform)
CREATE TABLE IF NOT EXISTS school_entities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL UNIQUE,
  code VARCHAR(50) UNIQUE,
  address TEXT,
  phone VARCHAR(20),
  email VARCHAR(255),
  admin_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Corporate Entities (one or more corporate entities using the platform)
CREATE TABLE IF NOT EXISTS corporate_entities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL UNIQUE,
  code VARCHAR(50) UNIQUE,
  industry VARCHAR(100),
  headquarters_address TEXT,
  phone VARCHAR(20),
  email VARCHAR(255),
  admin_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ===========================
-- USER REGISTRATION STATUS
-- ===========================

-- User Registration Requests (tracks pending approvals)
CREATE TABLE IF NOT EXISTS user_registration_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  platform_id UUID NOT NULL REFERENCES platforms(id),
  entity_id UUID, -- school_entities.id or corporate_entities.id
  requested_role VARCHAR(100) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
  requested_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  rejection_reason TEXT,
  submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ===========================
-- USER ENTITY ASSOCIATIONS
-- ===========================

-- School User Associations (which school(s) a user belongs to)
CREATE TABLE IF NOT EXISTS school_user_associations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  school_entity_id UUID NOT NULL REFERENCES school_entities(id) ON DELETE CASCADE,
  status VARCHAR(50) NOT NULL DEFAULT 'active', -- 'active', 'inactive', 'suspended'
  assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, school_entity_id)
);

-- Corporate User Associations (which corporate entity a user belongs to)
CREATE TABLE IF NOT EXISTS corporate_user_associations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  corporate_entity_id UUID NOT NULL REFERENCES corporate_entities(id) ON DELETE CASCADE,
  department_id UUID REFERENCES corporate_departments(id) ON DELETE SET NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'active', -- 'active', 'inactive', 'suspended'
  assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, corporate_entity_id)
);

-- ===========================
-- APPROVAL WORKFLOWS
-- ===========================

-- Pending Approvals for Faculty/IT in Schools
CREATE TABLE IF NOT EXISTS school_user_approvals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  school_entity_id UUID NOT NULL REFERENCES school_entities(id) ON DELETE CASCADE,
  requested_role VARCHAR(100) NOT NULL, -- 'faculty' or 'it'
  status VARCHAR(50) NOT NULL DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
  requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  approved_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMP,
  rejection_reason TEXT,
  UNIQUE(user_id, school_entity_id, requested_role)
);

-- Pending Approvals for IT/HR in Corporate
CREATE TABLE IF NOT EXISTS corporate_user_approvals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  corporate_entity_id UUID NOT NULL REFERENCES corporate_entities(id) ON DELETE CASCADE,
  requested_role VARCHAR(100) NOT NULL, -- 'it' or 'hr'
  status VARCHAR(50) NOT NULL DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
  requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  approved_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMP,
  rejection_reason TEXT,
  UNIQUE(user_id, corporate_entity_id, requested_role)
);

-- ===========================
-- INDEXES FOR PERFORMANCE
-- ===========================

CREATE INDEX IF NOT EXISTS idx_school_entities_admin_user_id ON school_entities(admin_user_id);
CREATE INDEX IF NOT EXISTS idx_corporate_entities_admin_user_id ON corporate_entities(admin_user_id);
CREATE INDEX IF NOT EXISTS idx_user_registration_requests_user_id ON user_registration_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_user_registration_requests_status ON user_registration_requests(status);
CREATE INDEX IF NOT EXISTS idx_user_registration_requests_entity_id ON user_registration_requests(entity_id);
CREATE INDEX IF NOT EXISTS idx_school_user_associations_user_id ON school_user_associations(user_id);
CREATE INDEX IF NOT EXISTS idx_school_user_associations_school_entity_id ON school_user_associations(school_entity_id);
CREATE INDEX IF NOT EXISTS idx_corporate_user_associations_user_id ON corporate_user_associations(user_id);
CREATE INDEX IF NOT EXISTS idx_corporate_user_associations_corporate_entity_id ON corporate_user_associations(corporate_entity_id);
CREATE INDEX IF NOT EXISTS idx_school_user_approvals_status ON school_user_approvals(status);
CREATE INDEX IF NOT EXISTS idx_school_user_approvals_school_entity_id ON school_user_approvals(school_entity_id);
CREATE INDEX IF NOT EXISTS idx_corporate_user_approvals_status ON corporate_user_approvals(status);
CREATE INDEX IF NOT EXISTS idx_corporate_user_approvals_corporate_entity_id ON corporate_user_approvals(corporate_entity_id);

-- ===========================
-- SEED INITIAL ENTITIES
-- ===========================

-- Sample School Entity (will have its own admin)
INSERT INTO school_entities (name, code, address, email, is_active) 
VALUES 
  ('Primary University', 'PU-001', '123 Main St, City', 'admin@university.edu', true),
  ('Secondary University', 'SU-001', '456 Oak Ave, Town', 'admin@secondary.edu', true)
ON CONFLICT DO NOTHING;

-- Sample Corporate Entity (will have its own admin)
INSERT INTO corporate_entities (name, code, industry, headquarters_address, email, is_active)
VALUES 
  ('Tech Corp Inc', 'TC-001', 'Technology', '789 Business Blvd, Metro', 'admin@techcorp.com', true),
  ('Finance Solutions Ltd', 'FS-001', 'Finance', '321 Commerce St, Finance Hub', 'admin@finanance.com', true)
ON CONFLICT DO NOTHING;
