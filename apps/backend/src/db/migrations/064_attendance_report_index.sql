-- 064: an index for "the newest attendance at this school".
--
-- The school attendance report returns a school's most recent 1,000 records
-- (ORDER BY attendance_date DESC, marked_at DESC). No index matched that
-- order, so every request sorted the school's whole attendance history —
-- measured at ~1 s p50 under 20 concurrent users with 120,000 records.
-- With this index the newest rows are read in order and the scan stops at
-- the limit.
CREATE INDEX IF NOT EXISTS idx_school_attendance_tenant_recent
  ON school_attendance (tenant_id, attendance_date DESC, marked_at DESC);
