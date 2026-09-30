-- 060: platform metrics that are actually recorded.
--
-- Every API request inserts a latency row into platform_metrics. An AFTER
-- INSERT trigger then recomputed the tenant's health: three aggregate scans
-- over the last 24 hours of that tenant's rows, per request. It also compared
-- the metric_type enum with LIKE, which Postgres has no operator for, so the
-- trigger raised on every insert and rolled the insert back. No latency or
-- attendance metric has ever been stored; the recorder logged the error and
-- carried on. (Its first scan also counted NEW.metric_type instead of each
-- row's, so had it run it would have reported 0% or 100%.)
--
-- Health is now computed when it is read (services/metricsService.ts), from
-- the rows themselves, and inserting a metric costs one insert.
DROP TRIGGER IF EXISTS tr_update_health_on_metric_insert ON platform_metrics;
DROP FUNCTION IF EXISTS update_platform_health_status();

-- Reads filter on tenant and time; retention deletes on time.
CREATE INDEX IF NOT EXISTS idx_metrics_tenant_created ON platform_metrics (tenant_id, created_at DESC);
