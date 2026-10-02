-- Phase 2: the audit trail as a hash chain per tenant
-- (docs/security/threat-models/phase-2-identity-and-sessions.md, "Repudiation").
--
-- Rows of audit_logs were immutable (triggers refuse UPDATE and DELETE) and
-- carried a checksum of their own content (050). Neither shows a row that
-- has gone: the owner role can disable the triggers and delete one, and a
-- checksum only vouches for the row it sits on.
--
-- Now each tenant's rows form a chain, and platform rows (tenant_id NULL) a
-- chain of their own. A row stores its position (chain_seq), the hash of the
-- row before it (prev_hash, 64 zeros for the first) and its own hash
-- (row_hash): SHA-256 of a canonical text of its content, its position and
-- prev_hash. audit_chain_heads holds each chain's last position and hash.
-- Deleting, editing or reordering any row breaks a link the verifier
-- (src/scripts/verifyAuditChain.ts) reports. Removing the very last rows and
-- rewinding the head is caught against a checkpoint the verifier saved, or
-- against an export or the stream (the rows already sent out).

ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS chain_seq bigint;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS prev_hash text;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS row_hash text;

CREATE TABLE IF NOT EXISTS audit_chain_heads (
  -- The tenant's id, or the nil UUID for the platform chain.
  chain       uuid PRIMARY KEY,
  -- The same id for a tenant chain, NULL for the platform's: the tenant
  -- policy (row-level security) shows a tenant its own head only.
  tenant_id   uuid,
  seq         bigint NOT NULL,
  head_hash   text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- What a row's hash covers, in a fixed order, as a JSON array: unambiguous
-- (a NULL stays null rather than vanishing) and the same text every time.
-- The timestamp is formatted explicitly so no session setting changes it.
CREATE OR REPLACE FUNCTION audit_row_canonical(r audit_logs) RETURNS text
  LANGUAGE sql STABLE AS
$$
  SELECT jsonb_build_array(
    r.chain_seq, r.prev_hash, r.id, r.tenant_id, r.platform_id,
    to_char(r.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.US'),
    r.actor_id, r.actor_role, r.action_type, r.action_scope, r.resource_type, r.resource_id,
    r.user_id, r.action, r.entity_type, r.entity_id,
    r.old_values, r.new_values, r.before_state, r.after_state,
    r.justification, r.ip_address, r.request_id, r.user_agent
  )::text
$$;

CREATE OR REPLACE FUNCTION audit_logs_chain() RETURNS trigger
  LANGUAGE plpgsql AS
$$
DECLARE
  k uuid := COALESCE(NEW.tenant_id, '00000000-0000-0000-0000-000000000000'::uuid);
  h record;
BEGIN
  INSERT INTO audit_chain_heads (chain, tenant_id, seq, head_hash)
  VALUES (k, NEW.tenant_id, 0, repeat('0', 64))
  ON CONFLICT (chain) DO NOTHING;
  -- Locked until the transaction ends, so two writers in one tenant cannot
  -- both take the same position; a rollback gives the position back.
  SELECT seq, head_hash INTO h FROM audit_chain_heads WHERE chain = k FOR UPDATE;
  NEW.chain_seq := h.seq + 1;
  NEW.prev_hash := h.head_hash;
  NEW.row_hash := encode(digest(audit_row_canonical(NEW), 'sha256'), 'hex');
  UPDATE audit_chain_heads SET seq = NEW.chain_seq, head_hash = NEW.row_hash, updated_at = CURRENT_TIMESTAMP
   WHERE chain = k;
  RETURN NEW;
END
$$;

-- ── Chain the rows already there, oldest first, per tenant ──────────────────
-- The immutability triggers refuse every UPDATE; they are off for exactly
-- this backfill, inside the migration's transaction.
ALTER TABLE audit_logs DISABLE TRIGGER USER;
DO $$
DECLARE
  r audit_logs;
  k uuid;
  cur_chain uuid := NULL;
  seq bigint := 0;
  prev text := repeat('0', 64);
BEGIN
  FOR r IN
    SELECT * FROM audit_logs WHERE chain_seq IS NULL
     ORDER BY COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), created_at, id
  LOOP
    k := COALESCE(r.tenant_id, '00000000-0000-0000-0000-000000000000'::uuid);
    IF cur_chain IS DISTINCT FROM k THEN
      cur_chain := k;
      SELECT h.seq, h.head_hash INTO seq, prev FROM audit_chain_heads h WHERE h.chain = k;
      IF NOT FOUND THEN seq := 0; prev := repeat('0', 64); END IF;
    END IF;
    r.chain_seq := seq + 1;
    r.prev_hash := prev;
    r.row_hash := encode(digest(audit_row_canonical(r), 'sha256'), 'hex');
    UPDATE audit_logs SET chain_seq = r.chain_seq, prev_hash = r.prev_hash, row_hash = r.row_hash WHERE id = r.id;
    seq := r.chain_seq;
    prev := r.row_hash;
    INSERT INTO audit_chain_heads (chain, tenant_id, seq, head_hash)
    VALUES (k, r.tenant_id, seq, prev)
    ON CONFLICT (chain) DO UPDATE SET seq = EXCLUDED.seq, head_hash = EXCLUDED.head_hash, updated_at = CURRENT_TIMESTAMP;
  END LOOP;
END
$$;
ALTER TABLE audit_logs ENABLE TRIGGER USER;

DROP TRIGGER IF EXISTS trg_audit_logs_chain ON audit_logs;
CREATE TRIGGER trg_audit_logs_chain
  BEFORE INSERT ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_chain();

CREATE UNIQUE INDEX IF NOT EXISTS uq_audit_logs_chain_position
  ON audit_logs (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), chain_seq);

-- The tenant policy on the heads (tenant_id), like every tenant table; the
-- runtime role may move its tenant's head (the trigger does, as the writer)
-- but not delete it.
SELECT app_apply_tenant_rls();
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jjelotech_app') THEN
    REVOKE DELETE ON audit_chain_heads FROM jjelotech_app;
  END IF;
END
$$;

-- ── Streaming the trail to the tenant's own collector ───────────────────────
-- A tenant administrator names an HTTPS endpoint (their SIEM, a log
-- collector); every audit row of the tenant is posted to it in chain order,
-- signed with a secret only the tenant holds (src/services/auditStream.ts).
-- The secret is sealed under the tenant's data key (072).
CREATE TABLE IF NOT EXISTS audit_stream_targets (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  url              text NOT NULL CHECK (length(url) <= 500),
  secret_sealed    bytea NOT NULL,
  secret_iv        bytea NOT NULL,
  secret_tag       bytea NOT NULL,
  secret_dek_version integer NOT NULL,
  enabled          boolean NOT NULL DEFAULT true,
  -- The last chain position delivered. A new target starts from now, unless
  -- created with from_start, which sends the whole history.
  last_seq         bigint NOT NULL DEFAULT 0,
  failures         integer NOT NULL DEFAULT 0,
  last_error       text,
  last_delivered_at timestamptz,
  next_attempt_at  timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_audit_stream_targets_due ON audit_stream_targets (next_attempt_at) WHERE enabled;
SELECT app_apply_tenant_rls();
