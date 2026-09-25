/**
 * Phase 7.1 — Platform Metrics Service
 * Instrument and expose: attendance failure rates, verification mismatch rates,
 * clock drift frequency, API latency. Tenant-aware metrics collection and queries.
 */

import { Pool, QueryResult } from 'pg';
import pool from '../db/connection.js';

// Metric types
export type MetricType = 
  | 'attendance_failure'
  | 'verification_mismatch'
  | 'clock_drift'
  | 'api_latency'
  | 'attendance_success'
  | 'verification_match'
  | 'api_success';

export type MetricCategory = 
  | 'school_attendance'
  | 'corporate_checkin'
  | 'attendance_verification'
  | 'api_request'
  | 'system_health';

// Request/Response types
export interface MetricRecord {
  metric_id: string;
  tenant_id: string;
  platform_type: 'school' | 'corporate';
  metric_type: MetricType;
  metric_category: MetricCategory;
  endpoint?: string;
  http_method?: string;
  status_code?: number;
  response_time_ms?: number;
  attendance_record_id?: string;
  student_or_employee_id?: string;
  failure_reason?: string;
  verification_expected_state?: string;
  verification_actual_state?: string;
  client_clock_ms?: number;
  server_clock_ms?: number;
  clock_drift_ms?: number;
  created_by_user_id?: string;
  created_at: Date;
}

export interface APILatencyMetric {
  endpoint: string;
  http_method: string;
  status_code: number;
  response_time_ms: number;
  tenant_id: string;
  created_by_user_id?: string;
}

export interface AttendanceFailureMetric {
  tenant_id: string;
  platform_type: 'school' | 'corporate';
  attendance_record_id: string;
  student_or_employee_id: string;
  failure_reason: string;
  created_by_user_id?: string;
}

export interface VerificationMismatchMetric {
  tenant_id: string;
  platform_type: 'school' | 'corporate';
  attendance_record_id: string;
  expected_state: string;
  actual_state: string;
  created_by_user_id?: string;
}

export interface ClockDriftMetric {
  tenant_id: string;
  platform_type: 'school' | 'corporate';
  client_clock_ms: number;
  server_clock_ms: number;
  attendance_record_id?: string;
  created_by_user_id?: string;
}

export interface FailureRateResult {
  metric_category: string;
  failure_rate: number;
  total_count: number;
  failure_count: number;
}

export interface LatencyPercentiles {
  endpoint: string;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  max_ms: number;
  avg_ms: number;
}

export interface ClockDriftStats {
  avg_drift_ms: number;
  max_drift_ms: number;
  min_drift_ms: number;
  stddev_drift_ms: number;
  affected_records_count: number;
}

export interface VerificationMismatchDetail {
  record_id: string;
  expected_state: string;
  actual_state: string;
  created_at: Date;
  platform_type: 'school' | 'corporate';
}

export interface PlatformHealthStatus {
  last_hour_failure_rate: number;
  last_24h_failure_rate: number;
  last_hour_avg_latency_ms: number;
  /** Metric rows in the last 24 hours; with none, health is 'no_data', not 'healthy'. */
  samples_24h: number;
  health_status: 'healthy' | 'degraded' | 'critical' | 'no_data';
  last_updated: Date;
}

export interface EarlyWarningSignals {
  open_critical_incidents: number;
  overdue_incidents_1h: number;
  incident_escalations_24h: number;
  privilege_escalations_open: number;
  role_violations_24h: number;
}

// Core metric collection functions
export async function recordAPILatency(metric: APILatencyMetric): Promise<MetricRecord> {
  const hourBucket = new Date(Math.floor(Date.now() / (60 * 60 * 1000)) * (60 * 60 * 1000));
  const dateBucket = new Date(hourBucket);
  dateBucket.setHours(0, 0, 0, 0);

  const query = `
    INSERT INTO platform_metrics (
      tenant_id,
      platform_type,
      metric_type,
      metric_category,
      endpoint,
      http_method,
      status_code,
      response_time_ms,
      hour_bucket,
      date_bucket,
      created_by_user_id,
      created_at
    ) VALUES (
      $1, 'system', $2, 'api_request', $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP
    )
    RETURNING *;
  `;

  const metricType: MetricType = metric.status_code >= 200 && metric.status_code < 300 ? 'api_success' : 'api_latency';

  // One row per request adds up; nothing reads more than 30 days back.
  if (Math.random() < 0.001) {
    pool.query(`DELETE FROM platform_metrics WHERE created_at < NOW() - INTERVAL '30 days'`)
      .catch((e) => console.error('[metrics] retention sweep failed:', e.message));
  }

  const result: QueryResult<MetricRecord> = await pool.query(query, [
    metric.tenant_id,
    metricType,
    metric.endpoint,
    metric.http_method,
    metric.status_code,
    metric.response_time_ms,
    hourBucket,
    dateBucket,
    metric.created_by_user_id || null,
  ]);

  return result.rows[0];
}

export async function recordAttendanceFailure(metric: AttendanceFailureMetric): Promise<MetricRecord> {
  const hourBucket = new Date(Math.floor(Date.now() / (60 * 60 * 1000)) * (60 * 60 * 1000));
  const dateBucket = new Date(hourBucket);
  dateBucket.setHours(0, 0, 0, 0);

  const query = `
    INSERT INTO platform_metrics (
      tenant_id,
      platform_type,
      metric_type,
      metric_category,
      attendance_record_id,
      student_or_employee_id,
      failure_reason,
      hour_bucket,
      date_bucket,
      created_by_user_id,
      created_at
    ) VALUES (
      $1, $2, 'attendance_failure', 'school_attendance', $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP
    )
    RETURNING *;
  `;

  const result: QueryResult<MetricRecord> = await pool.query(query, [
    metric.tenant_id,
    metric.platform_type,
    metric.attendance_record_id,
    metric.student_or_employee_id,
    metric.failure_reason,
    hourBucket,
    dateBucket,
    metric.created_by_user_id || null,
  ]);

  return result.rows[0];
}

export async function recordAttendanceSuccess(
  tenantId: string,
  platformType: 'school' | 'corporate',
  attendanceRecordId: string,
  studentOrEmployeeId: string,
  userId?: string
): Promise<MetricRecord> {
  const hourBucket = new Date(Math.floor(Date.now() / (60 * 60 * 1000)) * (60 * 60 * 1000));
  const dateBucket = new Date(hourBucket);
  dateBucket.setHours(0, 0, 0, 0);

  const category = platformType === 'school' ? 'school_attendance' : 'corporate_checkin';

  const query = `
    INSERT INTO platform_metrics (
      tenant_id,
      platform_type,
      metric_type,
      metric_category,
      attendance_record_id,
      student_or_employee_id,
      hour_bucket,
      date_bucket,
      created_by_user_id,
      created_at
    ) VALUES (
      $1, $2, 'attendance_success', $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP
    )
    RETURNING *;
  `;

  const result: QueryResult<MetricRecord> = await pool.query(query, [
    tenantId,
    platformType,
    category,
    attendanceRecordId,
    studentOrEmployeeId,
    hourBucket,
    dateBucket,
    userId || null,
  ]);

  return result.rows[0];
}

export async function recordVerificationMismatch(metric: VerificationMismatchMetric): Promise<MetricRecord> {
  const hourBucket = new Date(Math.floor(Date.now() / (60 * 60 * 1000)) * (60 * 60 * 1000));
  const dateBucket = new Date(hourBucket);
  dateBucket.setHours(0, 0, 0, 0);

  const query = `
    INSERT INTO platform_metrics (
      tenant_id,
      platform_type,
      metric_type,
      metric_category,
      attendance_record_id,
      verification_expected_state,
      verification_actual_state,
      hour_bucket,
      date_bucket,
      created_by_user_id,
      created_at
    ) VALUES (
      $1, $2, 'verification_mismatch', 'attendance_verification', $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP
    )
    RETURNING *;
  `;

  const result: QueryResult<MetricRecord> = await pool.query(query, [
    metric.tenant_id,
    metric.platform_type,
    metric.attendance_record_id,
    metric.expected_state,
    metric.actual_state,
    hourBucket,
    dateBucket,
    metric.created_by_user_id || null,
  ]);

  return result.rows[0];
}

export async function recordVerificationMatch(
  tenantId: string,
  platformType: 'school' | 'corporate',
  attendanceRecordId: string,
  userId?: string
): Promise<MetricRecord> {
  const hourBucket = new Date(Math.floor(Date.now() / (60 * 60 * 1000)) * (60 * 60 * 1000));
  const dateBucket = new Date(hourBucket);
  dateBucket.setHours(0, 0, 0, 0);

  const query = `
    INSERT INTO platform_metrics (
      tenant_id,
      platform_type,
      metric_type,
      metric_category,
      attendance_record_id,
      hour_bucket,
      date_bucket,
      created_by_user_id,
      created_at
    ) VALUES (
      $1, $2, 'verification_match', 'attendance_verification', $3, $4, $5, $6, CURRENT_TIMESTAMP
    )
    RETURNING *;
  `;

  const result: QueryResult<MetricRecord> = await pool.query(query, [
    tenantId,
    platformType,
    attendanceRecordId,
    hourBucket,
    dateBucket,
    userId || null,
  ]);

  return result.rows[0];
}

export async function recordClockDrift(metric: ClockDriftMetric): Promise<MetricRecord> {
  const clockDriftMs = Math.abs(metric.server_clock_ms - metric.client_clock_ms);
  const hourBucket = new Date(Math.floor(Date.now() / (60 * 60 * 1000)) * (60 * 60 * 1000));
  const dateBucket = new Date(hourBucket);
  dateBucket.setHours(0, 0, 0, 0);

  const query = `
    INSERT INTO platform_metrics (
      tenant_id,
      platform_type,
      metric_type,
      metric_category,
      client_clock_ms,
      server_clock_ms,
      clock_drift_ms,
      attendance_record_id,
      hour_bucket,
      date_bucket,
      created_by_user_id,
      created_at
    ) VALUES (
      $1, $2, 'clock_drift', 'school_attendance', $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP
    )
    RETURNING *;
  `;

  const result: QueryResult<MetricRecord> = await pool.query(query, [
    metric.tenant_id,
    metric.platform_type,
    metric.client_clock_ms,
    metric.server_clock_ms,
    clockDriftMs,
    metric.attendance_record_id || null,
    hourBucket,
    dateBucket,
    metric.created_by_user_id || null,
  ]);

  return result.rows[0];
}

// Query functions with tenant-awareness
export async function getTenantFailureRate(
  tenantId: string,
  hours: number = 24
): Promise<FailureRateResult[]> {

  const query = `
    SELECT * FROM get_tenant_failure_rate($1, $2);
  `;

  const result: QueryResult<FailureRateResult> = await pool.query(query, [tenantId, hours]);
  return result.rows;
}

export async function getAPILatencyPercentiles(
  tenantId: string,
  endpoint?: string,
  hours: number = 1
): Promise<LatencyPercentiles[]> {

  const query = `
    SELECT * FROM get_api_latency_percentiles($1, $2, $3);
  `;

  const result: QueryResult<LatencyPercentiles> = await pool.query(query, [tenantId, endpoint || null, hours]);
  return result.rows;
}

export async function getClockDriftStatistics(
  tenantId: string,
  hours: number = 24
): Promise<ClockDriftStats[]> {

  const query = `
    SELECT * FROM get_clock_drift_statistics($1, $2);
  `;

  const result: QueryResult<ClockDriftStats> = await pool.query(query, [tenantId, hours]);
  return result.rows;
}

export async function getVerificationMismatches(
  tenantId: string,
  limit: number = 100,
  hours: number = 24
): Promise<VerificationMismatchDetail[]> {

  const query = `
    SELECT * FROM get_verification_mismatches($1, $2, $3);
  `;

  const result: QueryResult<VerificationMismatchDetail> = await pool.query(query, [tenantId, limit, hours]);
  return result.rows;
}

/**
 * The tenant's health, computed from its metrics when asked. It used to be
 * maintained by a trigger on every metric insert, which failed on every
 * insert (see migration 060).
 */
export async function getPlatformHealthStatus(tenantId: string): Promise<PlatformHealthStatus | null> {
  const query = `
    WITH recent AS (
      SELECT metric_type::TEXT AS kind, metric_category::TEXT AS category, response_time_ms, created_at
        FROM platform_metrics
       WHERE tenant_id = $1 AND created_at >= NOW() - INTERVAL '24 hours'
    ),
    figures AS (
      SELECT
        COALESCE(ROUND(COUNT(*) FILTER (WHERE kind LIKE '%failure%' AND created_at >= NOW() - INTERVAL '1 hour')::NUMERIC * 100
          / NULLIF(COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '1 hour'), 0), 2), 0) AS last_hour_failure_rate,
        COALESCE(ROUND(COUNT(*) FILTER (WHERE kind LIKE '%failure%')::NUMERIC * 100 / NULLIF(COUNT(*), 0), 2), 0) AS last_24h_failure_rate,
        COALESCE(ROUND(AVG(response_time_ms) FILTER (WHERE category = 'api_request'
          AND created_at >= NOW() - INTERVAL '1 hour'), 2), 0) AS last_hour_avg_latency_ms,
        COUNT(*)::INTEGER AS samples_24h
      FROM recent
    )
    SELECT $1::uuid AS tenant_id, last_hour_failure_rate, last_24h_failure_rate, last_hour_avg_latency_ms,
           samples_24h,
           CASE WHEN samples_24h = 0 THEN 'no_data'
                WHEN last_hour_failure_rate > 15 OR last_hour_avg_latency_ms > 10000 THEN 'critical'
                WHEN last_hour_failure_rate > 5 OR last_hour_avg_latency_ms > 5000 THEN 'degraded'
                ELSE 'healthy' END AS health_status,
           CURRENT_TIMESTAMP AS last_updated
      FROM figures;
  `;

  const result: QueryResult<PlatformHealthStatus> = await pool.query(query, [tenantId]);
  return result.rows[0] || null;
}

/**
 * High-signal, tenant-aware early warning indicators.
 *
 * These derive from existing incident / escalation / role security tables rather than raw logs,
 * so operators can use them as direct inputs into runbooks.
 */
export async function getEarlyWarningSignals(
  tenantId: string
): Promise<EarlyWarningSignals> {
  // This queried two views that do not exist (open_incidents,
  // overdue_incidents) and a column incidents do not have, so it only ever
  // answered 500; and it matched security events on users.platform_id = the
  // tenant id, a platform compared with a tenant, which matches nothing (or,
  // were ids ever to collide, another tenant's users). Security events are now
  // attributed through the affected user's membership of this tenant.
  const query = `
    SELECT
      (SELECT COUNT(*)::INTEGER FROM incidents i
        WHERE i.affected_tenant_id = $1
          AND UPPER(i.severity::TEXT) = 'CRITICAL'
          AND UPPER(i.status::TEXT) NOT IN ('RESOLVED', 'CLOSED'))                      AS open_critical_incidents,
      (SELECT COUNT(*)::INTEGER FROM incidents i
        WHERE i.affected_tenant_id = $1
          AND i.acknowledged_at IS NULL
          AND UPPER(i.status::TEXT) NOT IN ('RESOLVED', 'CLOSED')
          AND i.created_at < CURRENT_TIMESTAMP - INTERVAL '1 hour')                      AS overdue_incidents_1h,
      (SELECT COUNT(*)::INTEGER FROM incident_escalations ie
         JOIN incidents i ON i.id = ie.incident_id
        WHERE i.affected_tenant_id = $1
          AND ie.created_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours')                  AS incident_escalations_24h,
      (SELECT COUNT(*)::INTEGER FROM privilege_escalation_events pee
        WHERE pee.status = 'OPEN'
          AND EXISTS (SELECT 1 FROM user_tenant_memberships m
                       WHERE m.user_id = pee.affected_user_id AND m.tenant_id = $1))   AS privilege_escalations_open,
      (SELECT COUNT(*)::INTEGER FROM role_boundary_violations rbv
        WHERE rbv.created_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours'
          AND EXISTS (SELECT 1 FROM user_tenant_memberships m
                       WHERE m.user_id = rbv.user_id AND m.tenant_id = $1))            AS role_violations_24h
  `;

  const result: QueryResult<EarlyWarningSignals> = await pool.query(query, [tenantId]);
  return result.rows[0];
}

export async function getMetricsSummaryByCategory(
  tenantId: string,
  hours: number = 1
): Promise<
  Array<{
    category: string;
    total_count: number;
    success_count: number;
    failure_count: number;
    success_rate: number;
    failure_rate: number;
  }>
> {

  const query = `
    SELECT 
      (m.metric_category)::TEXT as category,
      COUNT(*)::INTEGER as total_count,
      COUNT(CASE WHEN m.metric_type::TEXT LIKE '%success%' THEN 1 END)::INTEGER as success_count,
      COUNT(CASE WHEN m.metric_type::TEXT LIKE '%failure%' THEN 1 END)::INTEGER as failure_count,
      ROUND(CAST(COUNT(CASE WHEN m.metric_type::TEXT LIKE '%success%' THEN 1 END) AS NUMERIC) * 100 / NULLIF(COUNT(*), 0), 2)::NUMERIC as success_rate,
      ROUND(CAST(COUNT(CASE WHEN m.metric_type::TEXT LIKE '%failure%' THEN 1 END) AS NUMERIC) * 100 / NULLIF(COUNT(*), 0), 2)::NUMERIC as failure_rate
    FROM platform_metrics m
    WHERE m.tenant_id = $1
      AND m.created_at >= NOW() - ($2 || ' hours')::INTERVAL
    GROUP BY m.metric_category
    ORDER BY failure_rate DESC;
  `;

  const result = await pool.query(query, [tenantId, hours]);
  return result.rows;
}

export async function getTopFailureReasons(
  tenantId: string,
  limit: number = 10,
  hours: number = 24
): Promise<
  Array<{
    failure_reason: string;
    count: number;
    percentage: number;
  }>
> {

  const query = `
    SELECT 
      m.failure_reason,
      COUNT(*)::INTEGER as count,
      ROUND(CAST(COUNT(*) AS NUMERIC) * 100 / (SELECT COUNT(*) FROM platform_metrics WHERE tenant_id = $1 AND metric_type = 'attendance_failure' AND created_at >= NOW() - ($3 || ' hours')::INTERVAL), 2)::NUMERIC as percentage
    FROM platform_metrics m
    WHERE m.tenant_id = $1
      AND m.metric_type = 'attendance_failure'
      AND m.failure_reason IS NOT NULL
      AND m.created_at >= NOW() - ($3 || ' hours')::INTERVAL
    GROUP BY m.failure_reason
    ORDER BY count DESC
    LIMIT $2;
  `;

  const result = await pool.query(query, [tenantId, limit, hours]);
  return result.rows;
}

export async function getAPILatencyByEndpoint(
  tenantId: string,
  hours: number = 1
): Promise<
  Array<{
    endpoint: string;
    http_method: string;
    avg_response_time_ms: number;
    p95_response_time_ms: number;
    p99_response_time_ms: number;
    max_response_time_ms: number;
    request_count: number;
    error_count: number;
    error_rate: number;
  }>
> {

  const query = `
    SELECT 
      m.endpoint,
      m.http_method,
      ROUND(AVG(m.response_time_ms), 2)::NUMERIC as avg_response_time_ms,
      PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY m.response_time_ms)::INTEGER as p95_response_time_ms,
      PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY m.response_time_ms)::INTEGER as p99_response_time_ms,
      MAX(m.response_time_ms)::INTEGER as max_response_time_ms,
      COUNT(*)::INTEGER as request_count,
      COUNT(CASE WHEN m.status_code >= 400 THEN 1 END)::INTEGER as error_count,
      ROUND(CAST(COUNT(CASE WHEN m.status_code >= 400 THEN 1 END) AS NUMERIC) * 100 / NULLIF(COUNT(*), 0), 2)::NUMERIC as error_rate
    FROM platform_metrics m
    WHERE m.tenant_id = $1
      AND m.metric_category = 'api_request'
      AND m.created_at >= NOW() - ($2 || ' hours')::INTERVAL
    GROUP BY m.endpoint, m.http_method
    ORDER BY avg_response_time_ms DESC;
  `;

  const result = await pool.query(query, [tenantId, hours]);
  return result.rows;
}

export async function getMostProblematicAttendanceRecords(
  tenantId: string,
  limit: number = 20,
  hours: number = 24
): Promise<
  Array<{
    attendance_record_id: string;
    student_or_employee_id: string;
    failure_count: number;
    mismatch_count: number;
    clock_drift_count: number;
    platform_type: string;
  }>
> {

  const query = `
    SELECT 
      m.attendance_record_id,
      m.student_or_employee_id,
      COUNT(CASE WHEN m.metric_type = 'attendance_failure' THEN 1 END)::INTEGER as failure_count,
      COUNT(CASE WHEN m.metric_type = 'verification_mismatch' THEN 1 END)::INTEGER as mismatch_count,
      COUNT(CASE WHEN m.metric_type = 'clock_drift' THEN 1 END)::INTEGER as clock_drift_count,
      m.platform_type
    FROM platform_metrics m
    WHERE m.tenant_id = $1
      AND m.created_at >= NOW() - ($3 || ' hours')::INTERVAL
      AND m.attendance_record_id IS NOT NULL
    GROUP BY m.attendance_record_id, m.student_or_employee_id, m.platform_type
    -- An output alias cannot appear inside an expression in ORDER BY, so
    -- this raised "column failure_count does not exist" on every call.
    ORDER BY COUNT(*) FILTER (WHERE m.metric_type IN ('attendance_failure', 'verification_mismatch', 'clock_drift')) DESC
    LIMIT $2;
  `;

  const result = await pool.query(query, [tenantId, limit, hours]);
  return result.rows;
}
