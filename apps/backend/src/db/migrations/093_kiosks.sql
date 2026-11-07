-- Phase 4: attendance kiosks (brief 5.5, 5.7).
--
-- A kiosk is a shared device at one of the tenant's sites where employees
-- check in and out. An administrator creates it, bound to a site, with an
-- attendant PIN; the device pairs once with a short-lived code and receives
-- a token. Only the SHA-256 of the pairing code and of the token are kept.
-- The token reaches the kiosk routes and nothing else. Revoking a kiosk ends
-- its token at once and revokes its device registration.
CREATE TABLE IF NOT EXISTS kiosks (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id            UUID NOT NULL REFERENCES checkin_sites(id),
  device_id          VARCHAR(128) NOT NULL,
  label              VARCHAR(120) NOT NULL,
  token_hash         CHAR(64),
  pairing_hash       CHAR(64),
  pairing_expires_at TIMESTAMPTZ,
  pin_hash           TEXT NOT NULL,
  pin_failures       INTEGER NOT NULL DEFAULT 0,
  pin_locked_until   TIMESTAMPTZ,
  created_by         UUID NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  paired_at          TIMESTAMPTZ,
  last_seen_at       TIMESTAMPTZ,
  revoked_at         TIMESTAMPTZ,
  revoked_by         UUID,
  CHECK (pairing_hash IS NULL OR pairing_expires_at IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_kiosks_token ON kiosks (token_hash) WHERE token_hash IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_kiosks_pairing ON kiosks (pairing_hash) WHERE pairing_hash IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_kiosks_device ON kiosks (tenant_id, device_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_kiosks_tenant ON kiosks (tenant_id, created_at DESC);

SELECT app_apply_tenant_rls();
SELECT app_apply_same_tenant_guards();
