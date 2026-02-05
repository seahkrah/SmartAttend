-- ================================================================
-- MIGRATION 008: Add platform_id to corporate_departments
-- ================================================================
-- Purpose: Enforce tenant isolation for corporate department records
-- Rule: Every corporate department must belong to 'corporate' platform
-- Immutability: platform_id is immutable once set.
-- Status: EXPLICIT, no assumptions

-- Step 1: Add platform_id column (nullable initially for existing data)
ALTER TABLE corporate_departments ADD COLUMN platform_id UUID;

-- Step 2: Set platform_id for existing corporate records to 'corporate' platform
UPDATE corporate_departments 
SET platform_id = (SELECT id FROM platforms WHERE name = 'corporate' LIMIT 1)
WHERE platform_id IS NULL;

-- Step 3: Set NOT NULL constraint on platform_id column
ALTER TABLE corporate_departments 
ALTER COLUMN platform_id SET NOT NULL;

-- Step 4: Add foreign key constraint
ALTER TABLE corporate_departments 
ADD CONSTRAINT fk_corporate_departments_platform 
FOREIGN KEY (platform_id) REFERENCES platforms(id);

-- Step 5: Make platform_id immutable (unique constraint on platform_id + name)
ALTER TABLE corporate_departments 
DROP CONSTRAINT IF EXISTS corporate_departments_name_key;

ALTER TABLE corporate_departments 
ADD CONSTRAINT corp_dept_platform_id_name_unique 
UNIQUE(platform_id, name);

-- Step 6: Create index for tenant queries
CREATE INDEX idx_corporate_departments_platform_id ON corporate_departments(platform_id);

-- Verification: SELECT COUNT(*) FROM corporate_departments WHERE platform_id IS NULL; -- Expected: 0
