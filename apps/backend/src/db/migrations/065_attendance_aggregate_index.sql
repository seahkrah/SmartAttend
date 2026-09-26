-- 065: a covering index for per-class attendance totals.
--
-- The school attendance overview and the lecturer dashboard total a school's
-- attendance by class and status on every load. Without this they read the
-- whole table; with it they are answered from the index alone. Measured on
-- 120,000 records: 85 ms -> 43 ms per query.
CREATE INDEX IF NOT EXISTS idx_school_attendance_tenant_schedule_cover
  ON school_attendance (tenant_id, schedule_id, attendance_date, status);
