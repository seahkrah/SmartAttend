-- 037: the access log keeps its actor.
--
-- audit_access_log.actor_id was ON DELETE SET NULL while the table carries
-- immutability triggers that refuse every UPDATE. The cascade fires an UPDATE,
-- the trigger rejects it, and the delete fails: no user who had ever read an
-- audit log could be removed from the system at all. The two rules were
-- written against each other.
--
-- The immutability wins, because a log of who read the audit trail is worth
-- nothing if the reader can be erased from it. RESTRICT says plainly what was
-- already true in practice — such an account cannot be deleted — and matches
-- audit_logs.user_id, which has behaved this way all along.

ALTER TABLE audit_access_log
  DROP CONSTRAINT IF EXISTS audit_access_log_actor_id_fkey;

ALTER TABLE audit_access_log
  ADD CONSTRAINT audit_access_log_actor_id_fkey
  FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE RESTRICT;
