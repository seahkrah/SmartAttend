-- Per-tenant data keys (envelope encryption).
--
-- Each tenant has its own data key per purpose ('face_template', and later
-- documents and sensitive columns), stored only wrapped by the KMS's
-- key-encryption key (src/security/kms). A ciphertext sealed under tenant A's
-- key does not open under tenant B's, and deleting a tenant's keys makes its
-- sealed data unreadable everywhere, backups included (crypto-shredding).
-- Versions accumulate on rotation: the newest active one seals, every
-- unretired one may still open what it sealed.

CREATE TABLE IF NOT EXISTS tenant_data_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  purpose VARCHAR(40) NOT NULL,
  version INTEGER NOT NULL,
  kms VARCHAR(120) NOT NULL,
  wrapped_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  retired_at TIMESTAMPTZ,
  CONSTRAINT tenant_data_keys_version UNIQUE (tenant_id, purpose, version),
  CONSTRAINT tenant_data_keys_purpose CHECK (purpose ~ '^[a-z][a-z_]{2,39}$'),
  CONSTRAINT tenant_data_keys_positive CHECK (version > 0)
);

-- A key, once stored, is never rewritten: it may only be retired.
CREATE OR REPLACE FUNCTION tenant_data_keys_immutable() RETURNS TRIGGER AS $tdk$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.purpose IS DISTINCT FROM OLD.purpose
     OR NEW.version IS DISTINCT FROM OLD.version OR NEW.kms IS DISTINCT FROM OLD.kms
     OR NEW.wrapped_key IS DISTINCT FROM OLD.wrapped_key OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'A data key cannot be rewritten; rotate to a new version instead'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$tdk$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tenant_data_keys_immutable ON tenant_data_keys;
CREATE TRIGGER trg_tenant_data_keys_immutable
  BEFORE UPDATE ON tenant_data_keys
  FOR EACH ROW EXECUTE FUNCTION tenant_data_keys_immutable();

-- Templates say which of the tenant's key versions sealed them. NULL means
-- the older scheme: sealed under BIOMETRIC_TEMPLATE_KEY from the environment
-- (key_version), which still opens.
ALTER TABLE face_templates ADD COLUMN IF NOT EXISTS dek_version INTEGER;

SELECT app_apply_tenant_rls();
