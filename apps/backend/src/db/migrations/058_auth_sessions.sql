-- 058: sessions that can end, sign-in that resists guessing, and accounts
-- that are activated by their owner rather than handed a password.
--
-- Before this:
--   * a refresh token was a signed JWT valid for seven days with nothing on
--     the server behind it, so logout did nothing, a changed password left
--     every other device signed in, and a deactivated account could keep
--     minting access tokens until the week was up;
--   * sign-in had no limit on attempts;
--   * new accounts were created with a password the administrator chose or
--     was shown (in one place, first initial + surname + "123"), so the
--     administrator knew every user's first password.

-- ---------------------------------------------------------------------------
-- Sessions. One row per sign-in. The refresh token is opaque and random; only
-- its SHA-256 is stored. Each refresh replaces it; presenting a replaced token
-- after the grace window means it was copied, and the session is ended.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS auth_sessions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  current_token_hash   TEXT NOT NULL UNIQUE,
  previous_token_hash  TEXT,
  rotated_at           TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at           TIMESTAMPTZ NOT NULL,
  revoked_at           TIMESTAMPTZ,
  revoked_reason       VARCHAR(60),
  created_ip           VARCHAR(64),
  user_agent           VARCHAR(255)
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions (user_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_auth_sessions_previous ON auth_sessions (previous_token_hash)
  WHERE previous_token_hash IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Failed sign-ins, by the address that was tried (whether or not it exists)
-- and where from. Five in fifteen minutes pauses sign-in for that address.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS auth_failed_logins (
  id            BIGSERIAL PRIMARY KEY,
  email_norm    VARCHAR(255) NOT NULL,
  ip            VARCHAR(64),
  attempted_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_auth_failed_logins_email ON auth_failed_logins (email_norm, attempted_at DESC);

-- ---------------------------------------------------------------------------
-- Single-use tokens for activating an account and resetting a password. Only
-- the SHA-256 is stored; the token itself exists in the email and nowhere else.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS auth_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose     VARCHAR(30) NOT NULL CHECK (purpose IN ('account_activation', 'password_reset')),
  token_hash  TEXT NOT NULL UNIQUE,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_user ON auth_tokens (user_id, purpose) WHERE used_at IS NULL;

-- ---------------------------------------------------------------------------
-- Activation. An invited account cannot sign in until its owner has chosen a
-- password. Existing accounts are treated as activated when they were made.
-- An account created with a password its owner chose (self-registration) is
-- active from the start, hence the default; an invitation clears it until
-- the invitation is used (auth/accountTokens.ts).
-- ---------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ;
UPDATE users SET activated_at = COALESCE(created_at, CURRENT_TIMESTAMP) WHERE activated_at IS NULL;
ALTER TABLE users ALTER COLUMN activated_at SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;
