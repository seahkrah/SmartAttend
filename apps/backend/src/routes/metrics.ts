/**
 * Phase 7.1 — Platform Metrics Routes
 * Expose attendance failure rates, verification mismatch rates,
 * clock drift frequency, API latency with tenant-aware filtering
 */

import { Router, Response } from 'express';
import type { ExtendedRequest } from '../types/auth.js';
import { authenticateToken } from '../auth/middleware.js';
import {
  resolveTenantContext,
  requireTenant,
  type TenantRequest,
} from '../auth/tenantContextMiddleware.js';
import {
  getTenantFailureRate,
  getAPILatencyPercentiles,
  getClockDriftStatistics,
  getVerificationMismatches,
  getPlatformHealthStatus,
  getMetricsSummaryByCategory,
  getTopFailureReasons,
  getAPILatencyByEndpoint,
  getMostProblematicAttendanceRecords,
  getEarlyWarningSignals,
} from '../services/metricsService.js';

const router = Router();

/**
 * Every route here filtered on
 *
 *     req.tenantId || req.headers['x-tenant-id']
 *
 * and both halves of that came from the client. tenantIdExtractorMiddleware
 * copies the X-Tenant-Id header onto req.tenantId before authentication has
 * even run, so any authenticated caller could name any tenant and read its
 * failure rates, clock drift, verification mismatches and early-warning
 * signals.
 *
 * The tenant is now resolved from the authenticated identity and the server's
 * own membership records. requireTenant still honours X-Tenant-Id, but only
 * to choose between memberships the server already established — and, for a
 * superadmin, as a deliberate and recorded selection.
 */
router.use(authenticateToken, resolveTenantContext, requireTenant);

/** The server-resolved tenant. Never a value the caller supplied. */
function tenantOf(req: ExtendedRequest): string {
  return (req as unknown as TenantRequest).ctx!.tenantId!;
}

/**
 * GET /api/metrics/failure-rates
 * Get failure rates by category for tenant
 * Query params:
 *   - hours: number (default 24)
 */
router.get('/failure-rates', async (req: ExtendedRequest, res: Response) => {
  try {
    const tenantId = tenantOf(req);

    const hours = parseInt(req.query.hours as string) || 24;

    const failureRates = await getTenantFailureRate(tenantId, hours);

    return res.status(200).json({
      tenant_id: tenantId,
      hours,
      data: failureRates,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error fetching failure rates:', error);
    return res.status(500).json({ error: 'Failed to fetch failure rates' });
  }
});

/**
 * GET /api/metrics/api-latency
 * Get API latency percentiles by endpoint
 * Query params:
 *   - endpoint: string (optional)
 *   - hours: number (default 1)
 */
router.get('/api-latency', async (req: ExtendedRequest, res: Response) => {
  try {
    const tenantId = tenantOf(req);

    const endpoint = req.query.endpoint as string | undefined;
    const hours = parseInt(req.query.hours as string) || 1;

    const latencyData = await getAPILatencyPercentiles(tenantId, endpoint, hours);

    return res.status(200).json({
      tenant_id: tenantId,
      endpoint: endpoint || 'all',
      hours,
      data: latencyData,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error fetching API latency:', error);
    return res.status(500).json({ error: 'Failed to fetch API latency data' });
  }
});

/**
 * GET /api/metrics/api-latency-by-endpoint
 * Get detailed API latency metrics grouped by endpoint
 * Query params:
 *   - hours: number (default 1)
 */
router.get('/api-latency-by-endpoint', async (req: ExtendedRequest, res: Response) => {
  try {
    const tenantId = tenantOf(req);

    const hours = parseInt(req.query.hours as string) || 1;

    const latencyByEndpoint = await getAPILatencyByEndpoint(tenantId, hours);

    return res.status(200).json({
      tenant_id: tenantId,
      hours,
      total_endpoints: latencyByEndpoint.length,
      data: latencyByEndpoint,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error fetching API latency by endpoint:', error);
    return res.status(500).json({ error: 'Failed to fetch endpoint latency data' });
  }
});

/**
 * GET /api/metrics/clock-drift
 * Get clock drift statistics
 * Query params:
 *   - hours: number (default 24)
 */
router.get('/clock-drift', async (req: ExtendedRequest, res: Response) => {
  try {
    const tenantId = tenantOf(req);

    const hours = parseInt(req.query.hours as string) || 24;

    const clockDriftStats = await getClockDriftStatistics(tenantId, hours);

    return res.status(200).json({
      tenant_id: tenantId,
      hours,
      data: clockDriftStats,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error fetching clock drift statistics:', error);
    return res.status(500).json({ error: 'Failed to fetch clock drift data' });
  }
});

/**
 * GET /api/metrics/verification-mismatches
 * Get recent verification mismatch events
 * Query params:
 *   - limit: number (default 100)
 *   - hours: number (default 24)
 */
router.get('/verification-mismatches', async (req: ExtendedRequest, res: Response) => {
  try {
    const tenantId = tenantOf(req);

    const limit = parseInt(req.query.limit as string) || 100;
    const hours = parseInt(req.query.hours as string) || 24;

    const mismatches = await getVerificationMismatches(tenantId, limit, hours);

    return res.status(200).json({
      tenant_id: tenantId,
      hours,
      count: mismatches.length,
      limit,
      data: mismatches,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error fetching verification mismatches:', error);
    return res.status(500).json({ error: 'Failed to fetch mismatch data' });
  }
});

/**
 * GET /api/metrics/health-status
 * Get current platform health status
 */
router.get('/health-status', async (req: ExtendedRequest, res: Response) => {
  try {
    const tenantId = tenantOf(req);

    const healthStatus = await getPlatformHealthStatus(tenantId);

    if (!healthStatus) {
      return res.status(200).json({
        tenant_id: tenantId,
        health_status: 'unknown',
        message: 'No health data available yet',
        timestamp: new Date().toISOString(),
      });
    }

    return res.status(200).json({
      tenant_id: tenantId,
      ...healthStatus,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error fetching health status:', error);
    return res.status(500).json({ error: 'Failed to fetch health status' });
  }
});

/**
 * GET /api/metrics/summary
 * Get metrics summary by category
 * Query params:
 *   - hours: number (default 1)
 */
router.get('/summary', async (req: ExtendedRequest, res: Response) => {
  try {
    const tenantId = tenantOf(req);

    const hours = parseInt(req.query.hours as string) || 1;

    const summary = await getMetricsSummaryByCategory(tenantId, hours);

    return res.status(200).json({
      tenant_id: tenantId,
      hours,
      data: summary,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error fetching metrics summary:', error);
    return res.status(500).json({ error: 'Failed to fetch summary' });
  }
});

/**
 * GET /api/metrics/failure-reasons
 * Get top failure reasons
 * Query params:
 *   - limit: number (default 10)
 *   - hours: number (default 24)
 */
router.get('/failure-reasons', async (req: ExtendedRequest, res: Response) => {
  try {
    const tenantId = tenantOf(req);

    const limit = parseInt(req.query.limit as string) || 10;
    const hours = parseInt(req.query.hours as string) || 24;

    const reasons = await getTopFailureReasons(tenantId, limit, hours);

    return res.status(200).json({
      tenant_id: tenantId,
      hours,
      limit,
      data: reasons,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error fetching failure reasons:', error);
    return res.status(500).json({ error: 'Failed to fetch failure reasons' });
  }
});

/**
 * GET /api/metrics/problematic-records
 * Get attendance records with most issues
 * Query params:
 *   - limit: number (default 20)
 *   - hours: number (default 24)
 */
router.get('/problematic-records', async (req: ExtendedRequest, res: Response) => {
  try {
    const tenantId = tenantOf(req);

    const limit = parseInt(req.query.limit as string) || 20;
    const hours = parseInt(req.query.hours as string) || 24;

    const records = await getMostProblematicAttendanceRecords(tenantId, limit, hours);

    return res.status(200).json({
      tenant_id: tenantId,
      hours,
      limit,
      data: records,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error fetching problematic records:', error);
    return res.status(500).json({ error: 'Failed to fetch problematic records' });
  }
});

/**
 * GET /api/metrics/dashboard
 * Get comprehensive metrics dashboard
 * Combines multiple metrics for single dashboard view
 */
router.get('/dashboard', async (req: ExtendedRequest, res: Response) => {
  try {
    const tenantId = tenantOf(req);

    // Fetch all metrics in parallel
    const [
      failureRates,
      healthStatus,
      latencyByEndpoint,
      clockDriftStats,
      failureReasons,
    ] = await Promise.all([
      getTenantFailureRate(tenantId, 24),
      getPlatformHealthStatus(tenantId),
      getAPILatencyByEndpoint(tenantId, 1),
      getClockDriftStatistics(tenantId, 24),
      getTopFailureReasons(tenantId, 5, 24),
    ]);

    return res.status(200).json({
      tenant_id: tenantId,
      health_overview: healthStatus,
      failure_rates: failureRates,
      api_latency: latencyByEndpoint.slice(0, 10), // Top 10 endpoints
      clock_drift: clockDriftStats[0] || null,
      top_failure_reasons: failureReasons,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error fetching metrics dashboard:', error);
    return res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
});

/**
 * GET /api/metrics/early-signals
 * High-signal, tenant-aware early warning indicators.
 *
 * Designed to power alerts and runbooks:
 * - open_critical_incidents: current critical incidents for this tenant
 * - overdue_incidents_1h: incidents older than 1h without ACK
 * - incident_escalations_24h: escalations in last 24h
 * - privilege_escalations_open: open privilege escalation events
 * - role_violations_24h: role boundary violations in last 24h
 */
router.get('/early-signals', async (req: ExtendedRequest, res: Response) => {
  try {
    const tenantId = tenantOf(req);

    const signals = await getEarlyWarningSignals(tenantId);

    return res.status(200).json({
      tenant_id: tenantId,
      signals,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error fetching early warning signals:', error);
    return res.status(500).json({ error: 'Failed to fetch early warning signals' });
  }
});

export default router;
