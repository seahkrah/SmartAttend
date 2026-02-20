-- ===========================
-- TENANT STATUS MANAGEMENT
-- Migration: 020_tenant_status_management.sql
-- Adds status column to school_entities and corporate_entities
-- Status values: 'active', 'suspended', 'disabled'
-- ===========================

-- Add status column to school_entities
ALTER TABLE school_entities
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active';

-- Add status column to corporate_entities
ALTER TABLE corporate_entities
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active';

-- Sync existing is_active=false rows to 'disabled' status
UPDATE school_entities SET status = 'disabled' WHERE is_active = false AND (status IS NULL OR status = 'active');
UPDATE corporate_entities SET status = 'disabled' WHERE is_active = false AND (status IS NULL OR status = 'active');

-- Indexes
CREATE INDEX IF NOT EXISTS idx_school_entities_status ON school_entities(status);
CREATE INDEX IF NOT EXISTS idx_corporate_entities_status ON corporate_entities(status);
