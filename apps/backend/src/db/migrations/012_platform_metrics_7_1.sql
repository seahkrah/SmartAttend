-- ===========================
-- PHASE 7.1: PLATFORM METRICS (SIMPLIFIED)
-- ===========================

-- ===========================
-- A. CREATE TYPE FOR METRIC CATEGORIES
-- ===========================

CREATE TYPE metric_category_type AS ENUM ('performance', 'reliability', 'usage', 'error');

-- ===========================
-- B. PLATFORM METRICS TABLE
-- ===========================

CREATE TABLE IF NOT EXISTS platform_metrics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES school_entities(id) ON DELETE CASCADE,
  metric_name VARCHAR(100),
  metric_category metric_category_type,
  metric_value DECIMAL(12, 4),
  unit VARCHAR(50),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_platform_metrics_tenant ON platform_metrics(tenant_id);
CREATE INDEX IF NOT EXISTS idx_platform_metrics_name ON platform_metrics(metric_name);
CREATE INDEX IF NOT EXISTS idx_platform_metrics_timestamp ON platform_metrics(recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_metrics_category ON platform_metrics(metric_category);

-- ===========================
-- C. REQUEST PERFORMANCE METRICS
-- ===========================

CREATE TABLE IF NOT EXISTS request_performance_metrics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES school_entities(id) ON DELETE CASCADE,
  endpoint VARCHAR(255),
  method VARCHAR(10),
  response_time_ms DECIMAL(10, 2),
  status_code INTEGER,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_request_perf_tenant ON request_performance_metrics(tenant_id);
CREATE INDEX IF NOT EXISTS idx_request_perf_endpoint ON request_performance_metrics(endpoint);
CREATE INDEX IF NOT EXISTS idx_request_perf_timestamp ON request_performance_metrics(recorded_at DESC);

-- ===========================
-- D. SERVICE HEALTH METRICS
-- ===========================

CREATE TABLE IF NOT EXISTS service_health_metrics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES school_entities(id) ON DELETE CASCADE,
  service_name VARCHAR(100),
  status VARCHAR(50),
  uptime_percentage DECIMAL(5, 2),
  last_health_check TIMESTAMPTZ,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_service_health_tenant ON service_health_metrics(tenant_id);
CREATE INDEX IF NOT EXISTS idx_service_health_service ON service_health_metrics(service_name);
CREATE INDEX IF NOT EXISTS idx_service_health_timestamp ON service_health_metrics(recorded_at DESC);

-- ===========================
-- E. ERROR RATE METRICS
-- ===========================

CREATE TABLE IF NOT EXISTS error_rate_metrics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES school_entities(id) ON DELETE CASCADE,
  error_type VARCHAR(100),
  error_count INTEGER,
  total_requests INTEGER,
  error_rate_percentage DECIMAL(5, 2),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_error_rate_tenant ON error_rate_metrics(tenant_id);
CREATE INDEX IF NOT EXISTS idx_error_rate_type ON error_rate_metrics(error_type);
CREATE INDEX IF NOT EXISTS idx_error_rate_timestamp ON error_rate_metrics(recorded_at DESC);

COMMIT;
