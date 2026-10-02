-- Phase 2: rate-limit counters shared by every API replica
-- (src/security/rateLimitStore.ts). One row per limiter and client address;
-- a window that has ended starts again. Not tenant data: system-only.
CREATE TABLE IF NOT EXISTS http_rate_limits (
  key       text PRIMARY KEY,
  hits      integer NOT NULL,
  reset_at  timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_http_rate_limits_reset_at ON http_rate_limits (reset_at);
SELECT app_apply_scoped_rls('http_rate_limits', '(SELECT app_is_system())');
