-- 034: a setting outlives the person who last changed it.
--
-- tenant_settings.updated_by referenced users with the default NO ACTION, so
-- removing an administrator was blocked by every setting they had ever saved.
-- The attribution is useful history, not a reason to keep an account alive or
-- to discard the school's configuration, so it clears to NULL instead.

ALTER TABLE tenant_settings
  DROP CONSTRAINT IF EXISTS tenant_settings_updated_by_fkey;

ALTER TABLE tenant_settings
  ADD CONSTRAINT tenant_settings_updated_by_fkey
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL;
