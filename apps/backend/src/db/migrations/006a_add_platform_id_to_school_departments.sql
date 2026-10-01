-- ================================================================
-- MIGRATION 006: Add platform_id to school_departments
-- ================================================================
-- Purpose: Enforce tenant isolation at schema level
-- Rule: Every row must belong to a platform. No exceptions.
-- Immutability: platform_id is immutable once set.
-- Status: EXPLICIT, no assumptions

-- Step 1: Add platform_id column (nullable initially for existing data)
ALTER TABLE school_departments ADD COLUMN platform_id UUID;

-- Step 2: Set platform_id for existing school records to 'school' platform
UPDATE school_departments 
SET platform_id = (SELECT id FROM platforms WHERE name = 'school' LIMIT 1)
WHERE platform_id IS NULL;

-- Step 3: Set NOT NULL constraint on platform_id column
ALTER TABLE school_departments 
ALTER COLUMN platform_id SET NOT NULL;

-- Step 4: Add foreign key constraint
ALTER TABLE school_departments 
ADD CONSTRAINT fk_school_departments_platform 
FOREIGN KEY (platform_id) REFERENCES platforms(id);

-- Step 5: Make platform_id immutable (unique constraint on platform_id + name)
ALTER TABLE school_departments 
DROP CONSTRAINT IF EXISTS school_departments_name_key;

ALTER TABLE school_departments 
ADD CONSTRAINT sch_dept_platform_id_name_unique 
UNIQUE(platform_id, name);

-- Verification: SELECT COUNT(*) FROM school_departments WHERE platform_id IS NULL; -- Expected: 0
