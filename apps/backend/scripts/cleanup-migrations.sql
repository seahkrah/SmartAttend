-- ===========================
-- DATABASE CLEANUP SCRIPT
-- Removes failed migrations to allow fresh re-execution
-- ===========================

-- Remove failed migrations that have schema conflicts
DELETE FROM migrations WHERE name = '001_init_schema.sql';
DELETE FROM migrations WHERE name = '004_superadmin_system.sql';

-- Verify migrations were deleted
SELECT * FROM migrations ORDER BY executed_at;

-- Optional: If you need to reset everything (use with caution!)
-- TRUNCATE TABLE migrations CASCADE;
-- This would require re-running ALL migrations from scratch
