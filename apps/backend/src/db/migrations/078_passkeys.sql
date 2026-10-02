-- Phase 2: WebAuthn passkeys (src/auth/passkeys.ts, routes/passkeys.ts).
--
-- A passkey is a key pair held by the person's device; the server keeps the
-- public key and a signature counter. Sign-in with one is phishing-resistant
-- (the browser binds it to the site) and, since the device checks a PIN or
-- biometric first (user verification), counts as two factors on its own.

CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- The authenticator's credential id, base64url, as the browser reports it.
  credential_id  text NOT NULL UNIQUE,
  public_key     bytea NOT NULL,
  counter        bigint NOT NULL DEFAULT 0,
  transports     text[] NOT NULL DEFAULT '{}',
  device_type    text,
  backed_up      boolean NOT NULL DEFAULT false,
  name           text NOT NULL DEFAULT 'Passkey' CHECK (length(name) BETWEEN 1 AND 60),
  created_at     timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at   timestamptz
);
CREATE INDEX IF NOT EXISTS idx_webauthn_credentials_user ON webauthn_credentials (user_id);
-- A person's passkeys follow their account, as their other credentials do (074).
SELECT app_apply_scoped_rls('webauthn_credentials', '(SELECT app_is_system()) OR app_user_visible(user_id)');

-- Challenges are single-use and short-lived. A sign-in challenge exists
-- before anyone is known, so the table is system-only.
CREATE TABLE IF NOT EXISTS webauthn_challenges (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     uuid REFERENCES users(id) ON DELETE CASCADE,
  session_id  uuid,
  purpose     text NOT NULL CHECK (purpose IN ('register', 'sign_in', 'step_up')),
  challenge   text NOT NULL,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_expires ON webauthn_challenges (expires_at);
SELECT app_apply_scoped_rls('webauthn_challenges', '(SELECT app_is_system())');
