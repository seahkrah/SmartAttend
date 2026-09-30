-- 059: an account that has been sent a message can be deleted.
--
-- notification_messages.recipient_user_id is ON DELETE SET NULL, but the
-- outbox's immutability guard treated any change to it as re-addressing the
-- message and refused. So deleting any user who had ever been notified
-- (every student with an invoice, every invited account) failed. Invitations
-- made that universal and the fixtures tripped over it.
--
-- Unlinking the account is not re-addressing: the destination the message
-- went to is kept and still cannot change. Pointing a message at a different
-- account remains refused.
CREATE OR REPLACE FUNCTION guard_notification_message()
RETURNS TRIGGER AS $guard$
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
     OR (NEW.recipient_user_id IS DISTINCT FROM OLD.recipient_user_id
         AND NEW.recipient_user_id IS NOT NULL) THEN
    RAISE EXCEPTION 'What a message says and where it goes are fixed once it is queued'
      USING ERRCODE = 'restrict_violation';
  END IF;

  NEW.updated_at := CURRENT_TIMESTAMP;
  RETURN NEW;
END;$guard$ LANGUAGE plpgsql;
