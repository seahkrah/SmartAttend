-- Phase 2: step-up. A session remembers when its owner last proved who they
-- are (signing in, or POST /api/auth/step-up with a password or an
-- authenticator code); sensitive actions need that to be recent
-- (src/auth/stepUp.ts).
ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS authenticated_at timestamptz;
UPDATE auth_sessions SET authenticated_at = created_at WHERE authenticated_at IS NULL;
ALTER TABLE auth_sessions ALTER COLUMN authenticated_at SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE auth_sessions ALTER COLUMN authenticated_at SET NOT NULL;
