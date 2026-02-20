-- Add forced password reset field to users table
-- Users created by admins will have this flag set to true

ALTER TABLE users ADD COLUMN IF NOT EXISTS must_reset_password BOOLEAN DEFAULT false;

-- Update existing users with NULL password_hash to require password reset
UPDATE users SET must_reset_password = true WHERE password_hash IS NULL;

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_users_must_reset_password ON users(must_reset_password) WHERE must_reset_password = true;
