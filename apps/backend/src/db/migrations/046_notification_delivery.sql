-- 046: notification delivery.
--
-- Three modules in a row have now stopped at the same wall. Admissions cannot
-- tell an applicant they have an offer. Fees cannot remind anyone that a term
-- bill is overdue. Leave cannot tell a manager a request is waiting. The
-- platform has had a `notifications` table since the beginning, but nothing
-- ever left the building: every writer inserted the row with status 'sent'
-- already set, which is a record that something was decided, not evidence
-- that anybody was told.
--
-- What is added here is the part that was missing — an outbox, transports
-- that actually send, and an honest account of what happened to each message.
--
--   notification_channels      how this tenant sends: provider and settings
--   notification_templates     what it says; defaults live in code
--   notification_messages      the outbox — one row per message per channel
--   notification_deliveries    every attempt, append-only
--   notification_preferences   what a person has agreed to receive
--   notification_suppressions  addresses that must not be written to again
--
-- Two deliberate absences:
--
--   1. No secret is stored here. A channel names an environment variable that
--      holds its password or API key; the value never enters the database.
--      A shared table that many tenant administrators can read is the wrong
--      place for an SMTP password, and encrypting it in the same database
--      that holds the key is theatre.
--
--   2. No row has a NULL tenant_id. Default templates live in code, not as
--      platform-owned rows, so there is no shared row for a tenant to reach
--      and no exception to the ownership rule to reason about.

-- ---------------------------------------------------------------------------
-- Channels
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS notification_channels (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  channel         VARCHAR(20) NOT NULL,
  provider        VARCHAR(20) NOT NULL,
  is_enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  -- Non-secret settings only: host, port, from address, relay URL.
  config          JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- The NAME of an environment variable holding the credential. Never the
  -- credential. A channel whose variable is unset cannot send, and says so.
  secret_env_var  VARCHAR(100),
  -- What a reply goes to, and who the recipient sees it from.
  from_name       VARCHAR(255),
  from_address    VARCHAR(255),
  reply_to        VARCHAR(255),
  -- A ceiling on what this tenant may send per hour, so one tenant's mistake
  -- cannot exhaust a shared relay for everyone else.
  hourly_limit    INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT notification_channels_channel
    CHECK (channel IN ('email', 'sms', 'push', 'in_app')),
  CONSTRAINT notification_channels_provider
    CHECK (provider IN ('smtp', 'webhook', 'in_app', 'log')),
  CONSTRAINT notification_channels_limit
    CHECK (hourly_limit IS NULL OR hourly_limit > 0),
  -- in_app is delivered by writing a row in this database; anything else is
  -- a transport, and pairing them the other way round would mean a channel
  -- that claims to send email by inserting a row.
  CONSTRAINT notification_channels_provider_fits_channel CHECK (
    (channel = 'in_app' AND provider IN ('in_app', 'log'))
    OR (channel = 'email' AND provider IN ('smtp', 'webhook', 'log'))
    OR (channel IN ('sms', 'push') AND provider IN ('webhook', 'log'))
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_channels_tenant
  ON notification_channels (tenant_id, channel);

-- ---------------------------------------------------------------------------
-- Templates
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS notification_templates (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_key   VARCHAR(100) NOT NULL,
  channel     VARCHAR(20) NOT NULL,
  locale      VARCHAR(10) NOT NULL DEFAULT 'en',
  subject     VARCHAR(255),
  body        TEXT NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT notification_templates_channel
    CHECK (channel IN ('email', 'sms', 'push', 'in_app')),
  -- A template with nothing in it would render an empty message and still
  -- report success.
  CONSTRAINT notification_templates_body CHECK (LENGTH(TRIM(body)) > 0),
  -- Email is the only channel with a subject line; requiring one elsewhere
  -- would push callers into inventing subjects nobody reads.
  CONSTRAINT notification_templates_email_has_subject
    CHECK (channel <> 'email' OR (subject IS NOT NULL AND LENGTH(TRIM(subject)) > 0))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_templates_key
  ON notification_templates (tenant_id, event_key, channel, locale);

CREATE INDEX IF NOT EXISTS idx_notification_templates_tenant
  ON notification_templates (tenant_id, event_key);

-- ---------------------------------------------------------------------------
-- The outbox
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS notification_messages (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  channel             VARCHAR(20) NOT NULL,
  category            VARCHAR(50) NOT NULL DEFAULT 'general',
  event_key           VARCHAR(100),
  -- Null for a recipient with no account: an applicant, a parent, a bank.
  recipient_user_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  -- The address as it was at the moment of sending. Kept verbatim, because
  -- "we emailed you" has to survive the recipient later changing their
  -- address, and because chasing the current value at read time would show
  -- a different answer from the one that was actually used.
  destination         VARCHAR(320) NOT NULL,
  recipient_name      VARCHAR(255),
  subject             VARCHAR(255),
  body                TEXT NOT NULL,
  status              VARCHAR(20) NOT NULL DEFAULT 'pending',
  priority            SMALLINT NOT NULL DEFAULT 5,
  attempts            INTEGER NOT NULL DEFAULT 0,
  max_attempts        INTEGER NOT NULL DEFAULT 5,
  scheduled_for       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  next_attempt_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Which transport took it, and what that transport called it. Without the
  -- provider's own id there is no way to answer "did it actually arrive".
  provider            VARCHAR(20),
  provider_message_id VARCHAR(255),
  last_error          TEXT,
  -- Two runs of the same overdue-fees sweep must not send the bill twice.
  dedupe_key          VARCHAR(200),
  related_type        VARCHAR(50),
  related_id          UUID,
  created_by          UUID REFERENCES users(id) ON DELETE SET NULL,
  sent_at             TIMESTAMPTZ,
  failed_at           TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT notification_messages_channel
    CHECK (channel IN ('email', 'sms', 'push', 'in_app')),
  -- 'simulated' is its own status and not a kind of 'sent'. A message the log
  -- provider handled was rendered, addressed and recorded, and went nowhere;
  -- reporting that as sent is the exact dishonesty this table exists to end.
  CONSTRAINT notification_messages_status CHECK (status IN (
    'pending', 'sending', 'sent', 'simulated', 'failed', 'cancelled', 'suppressed'
  )),
  CONSTRAINT notification_messages_priority CHECK (priority BETWEEN 1 AND 9),
  CONSTRAINT notification_messages_attempts
    CHECK (attempts >= 0 AND max_attempts >= 1),
  CONSTRAINT notification_messages_body CHECK (LENGTH(TRIM(body)) > 0),
  CONSTRAINT notification_messages_destination CHECK (LENGTH(TRIM(destination)) > 0),
  CONSTRAINT notification_messages_sent_has_time
    CHECK (status NOT IN ('sent', 'simulated') OR sent_at IS NOT NULL),
  CONSTRAINT notification_messages_failed_has_reason
    CHECK (status <> 'failed' OR (failed_at IS NOT NULL AND last_error IS NOT NULL))
);

-- One message per dedupe key per tenant. The key is chosen by the caller and
-- describes the thing being announced — 'invoice-overdue:<id>:2026-09' — so a
-- sweep that runs twice in a morning enqueues once.
CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_messages_dedupe
  ON notification_messages (tenant_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

-- The dispatcher's claim query reads exactly this.
CREATE INDEX IF NOT EXISTS idx_notification_messages_due
  ON notification_messages (next_attempt_at, priority)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_notification_messages_tenant
  ON notification_messages (tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notification_messages_recipient
  ON notification_messages (recipient_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notification_messages_related
  ON notification_messages (tenant_id, related_type, related_id);

-- Counting a tenant's sends in the last hour, for the rate ceiling.
CREATE INDEX IF NOT EXISTS idx_notification_messages_rate
  ON notification_messages (tenant_id, channel, sent_at)
  WHERE sent_at IS NOT NULL;

-- A message is addressed once, to one recipient, by the server. Neither the
-- destination nor the body may change afterwards: the outbox is the evidence
-- of what was sent, and evidence that can be edited afterwards is not
-- evidence.
CREATE OR REPLACE FUNCTION guard_notification_message() RETURNS TRIGGER AS $notifmsg$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'A message cannot be moved between tenants'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF OLD.status IN ('sent', 'simulated')
     AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Message % has already been delivered and cannot be re-staged', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW.destination IS DISTINCT FROM OLD.destination
     OR NEW.body IS DISTINCT FROM OLD.body
     OR NEW.subject IS DISTINCT FROM OLD.subject
     OR NEW.channel IS DISTINCT FROM OLD.channel
     OR NEW.recipient_user_id IS DISTINCT FROM OLD.recipient_user_id THEN
    RAISE EXCEPTION 'What a message says and where it goes are fixed once it is queued'
      USING ERRCODE = 'restrict_violation';
  END IF;

  NEW.updated_at := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$notifmsg$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_notification_messages_guard ON notification_messages;
CREATE TRIGGER trg_notification_messages_guard
  BEFORE UPDATE ON notification_messages
  FOR EACH ROW EXECUTE FUNCTION guard_notification_message();

-- A message addressed to a user must be addressed to a user of this tenant.
-- The existing notifications table has had this guard since the beginning;
-- the outbox needs it more, because it can reach outside the system.
CREATE OR REPLACE FUNCTION check_message_recipient_in_tenant() RETURNS TRIGGER AS $notifrcpt$
BEGIN
  IF NEW.recipient_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM user_tenant_memberships m
     WHERE m.user_id = NEW.recipient_user_id AND m.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'Recipient % is not a member of tenant %',
      NEW.recipient_user_id, NEW.tenant_id
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$notifrcpt$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_notification_messages_recipient ON notification_messages;
CREATE TRIGGER trg_notification_messages_recipient
  BEFORE INSERT ON notification_messages
  FOR EACH ROW EXECUTE FUNCTION check_message_recipient_in_tenant();

-- ---------------------------------------------------------------------------
-- Delivery attempts
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS notification_deliveries (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  message_id          UUID NOT NULL REFERENCES notification_messages(id) ON DELETE CASCADE,
  attempt             INTEGER NOT NULL,
  status              VARCHAR(20) NOT NULL,
  provider            VARCHAR(20) NOT NULL,
  provider_message_id VARCHAR(255),
  -- What the transport said. A bounce message is the only thing that explains
  -- why a parent never heard about their child's offer.
  provider_response   TEXT,
  error               TEXT,
  duration_ms         INTEGER,
  occurred_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT notification_deliveries_attempt CHECK (attempt >= 1),
  CONSTRAINT notification_deliveries_status
    CHECK (status IN ('sent', 'simulated', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_message
  ON notification_deliveries (message_id, attempt);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_tenant
  ON notification_deliveries (tenant_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION prevent_delivery_change() RETURNS TRIGGER AS $delchg$
BEGIN
  RAISE EXCEPTION 'Delivery attempts are immutable. % is not permitted.', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$delchg$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_notification_deliveries_no_update ON notification_deliveries;
DROP TRIGGER IF EXISTS trg_notification_deliveries_no_delete ON notification_deliveries;

CREATE TRIGGER trg_notification_deliveries_no_update
  BEFORE UPDATE ON notification_deliveries
  FOR EACH ROW EXECUTE FUNCTION prevent_delivery_change();

-- Removing the message, or the tenant, cascades; a direct delete is refused.
CREATE TRIGGER trg_notification_deliveries_no_delete
  BEFORE DELETE ON notification_deliveries
  FOR EACH ROW
  WHEN (pg_trigger_depth() = 0)
  EXECUTE FUNCTION prevent_delivery_change();

-- ---------------------------------------------------------------------------
-- Preferences
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS notification_preferences (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category    VARCHAR(50) NOT NULL,
  channel     VARCHAR(20) NOT NULL,
  is_enabled  BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT notification_preferences_channel
    CHECK (channel IN ('email', 'sms', 'push', 'in_app'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_preferences
  ON notification_preferences (tenant_id, user_id, category, channel);

-- ---------------------------------------------------------------------------
-- Suppressions
-- ---------------------------------------------------------------------------

-- An address that bounced hard, or a person who asked not to be written to.
-- Sending to a known-bad address repeatedly is how a school's domain ends up
-- on a blocklist and stops reaching anybody.
CREATE TABLE IF NOT EXISTS notification_suppressions (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  channel      VARCHAR(20) NOT NULL,
  destination  VARCHAR(320) NOT NULL,
  reason       VARCHAR(30) NOT NULL,
  note         TEXT,
  created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  -- Null means indefinitely.
  expires_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT notification_suppressions_channel
    CHECK (channel IN ('email', 'sms', 'push', 'in_app')),
  CONSTRAINT notification_suppressions_reason
    CHECK (reason IN ('hard_bounce', 'complaint', 'unsubscribed', 'invalid', 'manual'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_suppressions
  ON notification_suppressions (tenant_id, channel, LOWER(destination));

CREATE INDEX IF NOT EXISTS idx_notification_suppressions_tenant
  ON notification_suppressions (tenant_id, channel);

-- ---------------------------------------------------------------------------
-- The in-app inbox
-- ---------------------------------------------------------------------------

-- The existing notifications table becomes the in-app channel's delivered
-- output rather than a thing writers insert into directly. Linking it back to
-- the outbox means an in-app notice and the email about the same event are
-- visibly one message that went two ways.
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS message_id UUID REFERENCES notification_messages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_message ON notifications (message_id);

-- Reading an inbox is a per-user query and had no index for it.
CREATE INDEX IF NOT EXISTS idx_notifications_recipient
  ON notifications (recipient_user_id, created_at DESC);
