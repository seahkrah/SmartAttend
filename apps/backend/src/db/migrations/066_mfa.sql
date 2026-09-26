-- 066: two-factor sign-in (TOTP, RFC 6238).
--
-- A person may add an authenticator app to their account; administrators and
-- superadmins can be required to (MFA_REQUIRED_ROLES). Three tables:
--
--   user_mfa                the authenticator secret, encrypted at rest
--                           (AES-256-GCM), and the last time step accepted,
--                           so a code cannot be used twice.
--   user_mfa_recovery_codes single-use codes for a lost device, stored only
--                           as SHA-256 hashes; shown to the person once.
--   mfa_login_challenges    the step between password and code: created when
--                           the password is right, spent when the code is,
--                           expires in five minutes and allows five tries.
--
-- None is tenant-owned: a sign-in belongs to a person, not to a school.
--
-- Migration 006 created an unrelated `mfa_challenges` table for a design that
-- was never built; nothing reads it. It is left alone rather than dropped in
-- a migration about something else.

CREATE TABLE IF NOT EXISTS user_mfa (
  user_id          UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secret_ciphertext TEXT NOT NULL,
  secret_iv        TEXT NOT NULL,
  secret_tag       TEXT NOT NULL,
  -- Null while being set up: the secret exists but no code has confirmed it.
  enabled_at       TIMESTAMPTZ,
  last_used_step   BIGINT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_mfa_recovery_codes (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash  CHAR(64) NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT user_mfa_recovery_codes_unique UNIQUE (user_id, code_hash)
);

CREATE TABLE IF NOT EXISTS mfa_login_challenges (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- The token handed to the client is random; only its hash is kept.
  token_hash  CHAR(64) NOT NULL UNIQUE,
  attempts    INTEGER NOT NULL DEFAULT 0,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_ip  VARCHAR(64),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_mfa_login_challenges_user ON mfa_login_challenges (user_id, created_at DESC);
