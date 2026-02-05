-- Phase 7.1 — Platform Metrics
-- Instrument and expose: attendance failure rates, verification mismatch rates,
-- clock drift frequency, API latency. Tenant-aware metrics storage.

-- Enum for metric types (drop if exists to allow re-runs)
DROP TYPE IF EXISTS metric_type_enum CASCADE;
CREATE TYPE metric_type_enum AS ENUM (
  'attendance_failure',
  'verification_mismatch',
  'clock_drift',
  'api_latency',
  'attendance_success',
  'verification_match',
  'api_success'
);

-- Enum for metric categories
DROP TYPE IF EXISTS metric_category_enum CASCADE;
CREATE TYPE metric_category_enum AS ENUM (
  'school_attendance',
  'corporate_checkin',
  'attendance_verification',
  'api_request',
  'system_health'
);

-- Main metrics table (immutable, append-only)
CREATE TABLE IF NOT EXISTS platform_metrics (
  metric_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES school_entities(id) ON DELETE CASCADE,
  platform_type VARCHAR(50) NOT NULL, -- 'school' or 'corporate'
  metric_type metric_type_enum NOT NULL,
  metric_category metric_category_enum NOT NULL,
  
  -- Metric-specific values
  endpoint VARCHAR(255),
  http_method VARCHAR(10),
  status_code INTEGER,
  response_time_ms INTEGER,
  
  -- Attendance-specific
  attendance_record_id UUID,
  student_or_employee_id UUID,
  failure_reason VARCHAR(255),
  verification_expected_state VARCHAR(50),
  verification_actual_state VARCHAR(50),
  
  -- Clock drift
  client_clock_ms BIGINT,
  server_clock_ms BIGINT,
  clock_drift_ms INTEGER,
  
  -- Dimensions for aggregation
  hour_bucket TIMESTAMP NOT NULL, -- Rounded to hour for efficient aggregations
  date_bucket DATE NOT NULL,
  
  created_by_user_id UUID,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  
  -- Indexed columns for fast queries
  CONSTRAINT positive_response_time CHECK (response_time_ms > 0 OR response_time_ms IS NULL),
  CONSTRAINT valid_status_code CHECK (status_code >= 100 AND status_code < 600 OR status_code IS NULL)
);

-- Indexes for efficient metric queries
CREATE INDEX IF NOT EXISTS idx_metrics_tenant_type ON platform_metrics(tenant_id, metric_type);
CREATE INDEX IF NOT EXISTS idx_metrics_tenant_category ON platform_metrics(tenant_id, metric_category);
CREATE INDEX IF NOT EXISTS idx_metrics_tenant_hour ON platform_metrics(tenant_id, hour_bucket DESC);
CREATE INDEX IF NOT EXISTS idx_metrics_date_bucket ON platform_metrics(date_bucket DESC);
CREATE INDEX IF NOT EXISTS idx_metrics_endpoint ON platform_metrics(endpoint, http_method);
CREATE INDEX IF NOT EXISTS idx_metrics_attendance_record ON platform_metrics(attendance_record_id);
CREATE INDEX IF NOT EXISTS idx_metrics_created_at ON platform_metrics(created_at DESC);

-- Pre-aggregated metrics for fast dashboard queries (updated hourly)
CREATE TABLE IF NOT EXISTS metrics_hourly_aggregate (
  aggregate_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES school_entities(id) ON DELETE CASCADE,
  metric_type metric_type_enum NOT NULL,
  metric_category metric_category_enum NOT NULL,
  
  -- Aggregated counts
  total_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  mismatch_count INTEGER NOT NULL DEFAULT 0,
  
  -- API latency stats
  avg_response_time_ms NUMERIC(10, 2),
  p50_response_time_ms INTEGER,
  p95_response_time_ms INTEGER,
  p99_response_time_ms INTEGER,
  max_response_time_ms INTEGER,
  
  -- Clock drift stats
  avg_clock_drift_ms NUMERIC(10, 2),
  max_clock_drift_ms INTEGER,
  
  -- Rate calculations
  failure_rate NUMERIC(5, 2), -- 0-100
  mismatch_rate NUMERIC(5, 2),
  
  hour_bucket TIMESTAMP NOT NULL,
  date_bucket DATE NOT NULL,
  
  last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  UNIQUE(tenant_id, metric_type, metric_category, hour_bucket)
);

CREATE INDEX IF NOT EXISTS idx_hourly_tenant_hour ON metrics_hourly_aggregate(tenant_id, hour_bucket DESC);
CREATE INDEX IF NOT EXISTS idx_hourly_date_bucket ON metrics_hourly_aggregate(date_bucket DESC);

-- Daily metrics summary (for long-term trend analysis)
CREATE TABLE IF NOT EXISTS metrics_daily_summary (
  summary_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES school_entities(id) ON DELETE CASCADE,
  metric_type metric_type_enum NOT NULL,
  metric_category metric_category_enum NOT NULL,
  
  -- Daily stats
  total_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  
  -- Daily rates
  failure_rate NUMERIC(5, 2),
  success_rate NUMERIC(5, 2),
  
  -- Latency daily stats
  avg_response_time_ms NUMERIC(10, 2),
  p95_response_time_ms INTEGER,
  
  date_bucket DATE NOT NULL,
  
  UNIQUE(tenant_id, metric_type, metric_category, date_bucket)
);

CREATE INDEX IF NOT EXISTS idx_daily_tenant_date ON metrics_daily_summary(tenant_id, date_bucket DESC);

-- Platform health indicators (current status)
CREATE TABLE IF NOT EXISTS platform_health_status (
  status_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES school_entities(id) ON DELETE CASCADE,
  
  -- Last hour metrics
  last_hour_failure_rate NUMERIC(5, 2),
  last_hour_mismatch_rate NUMERIC(5, 2),
  last_hour_avg_latency_ms NUMERIC(10, 2),
  
  -- Last 24 hour metrics
  last_24h_failure_rate NUMERIC(5, 2),
  last_24h_mismatch_rate NUMERIC(5, 2),
  last_24h_avg_latency_ms NUMERIC(10, 2),
  
  -- Health status
  health_status VARCHAR(50) DEFAULT 'healthy', -- 'healthy', 'degraded', 'critical'
  failure_rate_threshold NUMERIC(5, 2) DEFAULT 5.0,
  latency_threshold_ms INTEGER DEFAULT 5000,
  
  last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  
  UNIQUE(tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_health_status_tenant ON platform_health_status(tenant_id);
CREATE INDEX IF NOT EXISTS idx_health_status_health ON platform_health_status(health_status);

-- Tenant-aware metric queries function
CREATE OR REPLACE FUNCTION get_tenant_failure_rate(
  p_tenant_id UUID,
  p_hours INTEGER DEFAULT 24
) RETURNS TABLE(
  metric_category VARCHAR,
  failure_rate NUMERIC,
  total_count INTEGER,
  failure_count INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    (m.metric_category)::TEXT,
    ROUND(CAST(COUNT(CASE WHEN m.metric_type LIKE '%failure%' THEN 1 END) AS NUMERIC) * 100 / NULLIF(COUNT(*), 0), 2) as failure_rate,
    COUNT(*)::INTEGER as total_count,
    COUNT(CASE WHEN m.metric_type LIKE '%failure%' THEN 1 END)::INTEGER as failure_count
  FROM platform_metrics m
  WHERE m.tenant_id = p_tenant_id
    AND m.created_at >= NOW() - (p_hours || ' hours')::INTERVAL
  GROUP BY m.metric_category;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Get API latency percentiles by endpoint
CREATE OR REPLACE FUNCTION get_api_latency_percentiles(
  p_tenant_id UUID,
  p_endpoint VARCHAR,
  p_hours INTEGER DEFAULT 1
) RETURNS TABLE(
  endpoint VARCHAR,
  p50_ms INTEGER,
  p95_ms INTEGER,
  p99_ms INTEGER,
  max_ms INTEGER,
  avg_ms NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    m.endpoint,
    PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY m.response_time_ms)::INTEGER as p50_ms,
    PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY m.response_time_ms)::INTEGER as p95_ms,
    PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY m.response_time_ms)::INTEGER as p99_ms,
    MAX(m.response_time_ms)::INTEGER as max_ms,
    AVG(m.response_time_ms)::NUMERIC as avg_ms
  FROM platform_metrics m
  WHERE m.tenant_id = p_tenant_id
    AND (p_endpoint IS NULL OR m.endpoint = p_endpoint)
    AND m.metric_category = 'api_request'
    AND m.response_time_ms IS NOT NULL
    AND m.created_at >= NOW() - (p_hours || ' hours')::INTERVAL
  GROUP BY m.endpoint;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Get clock drift statistics
CREATE OR REPLACE FUNCTION get_clock_drift_statistics(
  p_tenant_id UUID,
  p_hours INTEGER DEFAULT 24
) RETURNS TABLE(
  avg_drift_ms NUMERIC,
  max_drift_ms INTEGER,
  min_drift_ms INTEGER,
  stddev_drift_ms NUMERIC,
  affected_records_count INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    AVG(ABS(m.clock_drift_ms))::NUMERIC,
    MAX(ABS(m.clock_drift_ms))::INTEGER,
    MIN(ABS(m.clock_drift_ms))::INTEGER,
    STDDEV_POP(ABS(m.clock_drift_ms))::NUMERIC,
    COUNT(*)::INTEGER
  FROM platform_metrics m
  WHERE m.tenant_id = p_tenant_id
    AND m.metric_type = 'clock_drift'
    AND m.clock_drift_ms IS NOT NULL
    AND m.created_at >= NOW() - (p_hours || ' hours')::INTERVAL;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Get verification mismatch details
CREATE OR REPLACE FUNCTION get_verification_mismatches(
  p_tenant_id UUID,
  p_limit INTEGER DEFAULT 100,
  p_hours INTEGER DEFAULT 24
) RETURNS TABLE(
  record_id UUID,
  expected_state VARCHAR,
  actual_state VARCHAR,
  created_at TIMESTAMP,
  platform_type VARCHAR
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    m.attendance_record_id,
    m.verification_expected_state,
    m.verification_actual_state,
    m.created_at,
    m.platform_type
  FROM platform_metrics m
  WHERE m.tenant_id = p_tenant_id
    AND m.metric_type = 'verification_mismatch'
    AND m.created_at >= NOW() - (p_hours || ' hours')::INTERVAL
  ORDER BY m.created_at DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Trigger to update platform health status
CREATE OR REPLACE FUNCTION update_platform_health_status()
RETURNS TRIGGER AS $$
DECLARE
  v_tenant_id UUID;
  v_hour_failure_rate NUMERIC;
  v_24h_failure_rate NUMERIC;
  v_hour_latency NUMERIC;
  v_health_status VARCHAR;
BEGIN
  v_tenant_id := NEW.tenant_id;
  
  -- Calculate last hour failure rate
  SELECT COALESCE(ROUND(CAST(COUNT(CASE WHEN NEW.metric_type LIKE '%failure%' THEN 1 END) AS NUMERIC) * 100 / NULLIF(COUNT(*), 0), 2), 0)
  INTO v_hour_failure_rate
  FROM platform_metrics
  WHERE tenant_id = v_tenant_id
    AND created_at >= NOW() - INTERVAL '1 hour';
  
  -- Calculate last 24h failure rate
  SELECT COALESCE(ROUND(CAST(COUNT(CASE WHEN metric_type LIKE '%failure%' THEN 1 END) AS NUMERIC) * 100 / NULLIF(COUNT(*), 0), 2), 0)
  INTO v_24h_failure_rate
  FROM platform_metrics
  WHERE tenant_id = v_tenant_id
    AND created_at >= NOW() - INTERVAL '24 hours';
  
  -- Calculate last hour average latency
  SELECT COALESCE(AVG(response_time_ms), 0)::NUMERIC
  INTO v_hour_latency
  FROM platform_metrics
  WHERE tenant_id = v_tenant_id
    AND metric_category = 'api_request'
    AND response_time_ms IS NOT NULL
    AND created_at >= NOW() - INTERVAL '1 hour';
  
  -- Determine health status
  IF v_hour_failure_rate > 15.0 OR v_hour_latency > 10000 THEN
    v_health_status := 'critical';
  ELSIF v_hour_failure_rate > 5.0 OR v_hour_latency > 5000 THEN
    v_health_status := 'degraded';
  ELSE
    v_health_status := 'healthy';
  END IF;
  
  -- Upsert health status
  INSERT INTO platform_health_status (
    tenant_id,
    last_hour_failure_rate,
    last_24h_failure_rate,
    last_hour_avg_latency_ms,
    health_status,
    last_updated
  ) VALUES (
    v_tenant_id,
    v_hour_failure_rate,
    v_24h_failure_rate,
    v_hour_latency,
    v_health_status,
    CURRENT_TIMESTAMP
  )
  ON CONFLICT (tenant_id) DO UPDATE SET
    last_hour_failure_rate = EXCLUDED.last_hour_failure_rate,
    last_24h_failure_rate = EXCLUDED.last_24h_failure_rate,
    last_hour_avg_latency_ms = EXCLUDED.last_hour_avg_latency_ms,
    health_status = EXCLUDED.health_status,
    last_updated = CURRENT_TIMESTAMP;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update health status on metric insert
CREATE TRIGGER tr_update_health_on_metric_insert
AFTER INSERT ON platform_metrics
FOR EACH ROW
EXECUTE FUNCTION update_platform_health_status();

COMMIT;
