-- ============================================================================
-- Migration 026: Notifications (shared infrastructure, tenant-scoped)
-- ============================================================================
-- Notifications are shared infrastructure: both SMS and EMS send them, and
-- both need the same delivery record and audit trail. They are nonetheless
-- tenant-owned — a campaign belongs to one tenant, and a notification for
-- Tenant A must never reach a Tenant B user — so every table here carries
-- tenant_id and is registered as tenant-owned in tenantScoped.ts.

-- ---------------------------------------------------------------------------
-- Campaigns
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notification_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  platform_id UUID NOT NULL REFERENCES platforms(id) ON DELETE RESTRICT,
  name VARCHAR(255) NOT NULL,
  -- Which members the campaign targets. Evaluated server-side against the
  -- tenant's own attendance data; the client never supplies a recipient list.
  criteria VARCHAR(60) NOT NULL,
  target_group VARCHAR(60) NOT NULL DEFAULT 'members',
  message_template TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'SCHEDULED', 'SENT', 'CANCELLED')),
  sent_count INTEGER NOT NULL DEFAULT 0,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  scheduled_for TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_campaigns_tenant ON notification_campaigns(tenant_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_tenant_status ON notification_campaigns(tenant_id, status);

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------
-- One row per notification delivered to one recipient. tenant_id is carried
-- on the notification itself rather than inferred from the recipient, so a
-- later change to someone's memberships cannot retroactively move their
-- notification history into another tenant.
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  recipient_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campaign_id UUID REFERENCES notification_campaigns(id) ON DELETE SET NULL,
  category VARCHAR(50) NOT NULL DEFAULT 'general',
  subject VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  channel VARCHAR(20) NOT NULL DEFAULT 'in_app'
    CHECK (channel IN ('in_app', 'email', 'sms')),
  status VARCHAR(20) NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'sent', 'failed', 'read')),
  error TEXT,
  sent_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_notifications_tenant ON notifications(tenant_id);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(tenant_id, recipient_user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_campaign ON notifications(campaign_id);
CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON notifications(tenant_id, recipient_user_id) WHERE read_at IS NULL;

-- ---------------------------------------------------------------------------
-- Cross-tenant delivery guard
-- ---------------------------------------------------------------------------
-- Defence in depth. The application resolves recipients inside the tenant,
-- but a notification is exactly the kind of record that leaks if a future
-- code path forgets: it carries a message to a person. This trigger refuses
-- at the database level to address a notification to somebody who is not a
-- member of the owning tenant.
CREATE OR REPLACE FUNCTION assert_notification_recipient_in_tenant()
RETURNS TRIGGER AS $guard$
DECLARE
  member_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO member_count
    FROM user_tenant_memberships m
   WHERE m.user_id = NEW.recipient_user_id
     AND m.tenant_id = NEW.tenant_id
     AND m.status = 'active';

  IF member_count = 0 THEN
    RAISE EXCEPTION 'Cross-tenant notification refused: user % is not a member of tenant %',
      NEW.recipient_user_id, NEW.tenant_id;
  END IF;

  RETURN NEW;
END;
$guard$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_notification_recipient_in_tenant ON notifications;
CREATE TRIGGER trg_notification_recipient_in_tenant
BEFORE INSERT OR UPDATE OF recipient_user_id, tenant_id ON notifications
FOR EACH ROW EXECUTE FUNCTION assert_notification_recipient_in_tenant();
