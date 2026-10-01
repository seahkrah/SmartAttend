-- ================================================================
-- MIGRATION 007: Add platform_id to students
-- ================================================================
-- Purpose: Enforce tenant isolation for student records
-- Rule: Every student must belong to a platform via users table
-- Immutability: platform_id is immutable once set.
-- Status: EXPLICIT, derived from users.platform_id

-- Step 1: Add platform_id column (nullable initially)
ALTER TABLE students ADD COLUMN platform_id UUID;

-- Step 2: Populate platform_id from users table (students belong to users)
UPDATE students 
SET platform_id = users.platform_id
FROM users
WHERE students.user_id = users.id;

-- Step 3: Set NOT NULL constraint on platform_id column
ALTER TABLE students 
ALTER COLUMN platform_id SET NOT NULL;

-- Step 4: Add foreign key constraint to platforms
ALTER TABLE students 
ADD CONSTRAINT fk_students_platform 
FOREIGN KEY (platform_id) REFERENCES platforms(id);

-- Step 5: Create indexes for tenant queries and user-platform consistency
CREATE INDEX IF NOT EXISTS idx_students_platform_id ON students(platform_id);
CREATE INDEX IF NOT EXISTS idx_students_user_id_platform ON students(user_id, platform_id);

-- Verification: SELECT COUNT(*) FROM students WHERE platform_id IS NULL; -- Expected: 0
