-- 061: reviewing clock-drift events.
--
-- POST /api/time/drift/investigate answered as though it had recorded a
-- review ("TODO: Update drift event with investigation status") and stored
-- nothing. drift_audit_log is immutable by design, so a review cannot be
-- written onto the event; it is its own record, appended here and never
-- changed. An event's current state is its latest review.
CREATE TABLE IF NOT EXISTS drift_reviews (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  drift_event_id  UUID NOT NULL REFERENCES drift_audit_log(id) ON DELETE RESTRICT,
  action          VARCHAR(20) NOT NULL CHECK (action IN ('reviewed', 'resolved', 'flagged')),
  notes           TEXT CHECK (notes IS NULL OR length(notes) <= 4000),
  reviewed_by     UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_drift_reviews_event ON drift_reviews (drift_event_id, created_at DESC);

CREATE OR REPLACE FUNCTION guard_drift_reviews() RETURNS TRIGGER AS $g$
BEGIN
  RAISE EXCEPTION 'Drift reviews are a record of what was decided; add a new review instead'
    USING ERRCODE = 'restrict_violation';
END;
$g$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guard_drift_reviews ON drift_reviews;
CREATE TRIGGER trg_guard_drift_reviews BEFORE UPDATE OR DELETE ON drift_reviews
  FOR EACH ROW EXECUTE FUNCTION guard_drift_reviews();
