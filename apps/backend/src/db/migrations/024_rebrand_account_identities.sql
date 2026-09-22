-- Migration 024: Rebrand seeded account identities from SmartAttend to JjeloTech
--
-- 004_superadmin_system.sql and superadminService.ts now seed and look up
-- 'superadmin@jjelotech.local'. Databases migrated before the rebrand still hold
-- the legacy '@smartattend.local' addresses, so move them across here.
--
-- NOTE: the migration runner (src/db/migrate.ts) splits files on ';', so every
-- statement below must be a single statement with no internal semicolons.

UPDATE users u
SET email = replace(u.email, '@smartattend.local', '@jjelotech.local'),
    updated_at = CURRENT_TIMESTAMP
WHERE u.email LIKE '%@smartattend.local'
  AND NOT EXISTS (
    SELECT 1
    FROM users existing
    WHERE existing.platform_id = u.platform_id
      AND existing.email = replace(u.email, '@smartattend.local', '@jjelotech.local')
  )
