/**
 * Phase 7.1 — Platform Metrics Routes
 * Expose attendance failure rates, verification mismatch rates,
 * clock drift frequency, API latency with tenant-aware filtering
 */

import { Router, Response } from 'express';
import type { ExtendedRequest } from '../types/auth.js';
import { authenticateToken } from '../auth/middleware.js';
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
} from '../services/metricsService.js';

const router = Router();

/**
 * GET /api/metrics/failure-rates
 * Get failure rates by category for tenant
 * Query params:
 *   - hours: number (default 24)
 */
router.get('/failure-rates', authenticateToken, async (req: ExtendedRequest, res: Response) => {
  try {
    const tenantId = req.tenantId || (req.headers['x-tenant-id'] as string);
    if (!tenantId) {
      return res.status(400).json({ error: 'Tenant ID required' });
    }

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
router.get('/api-latency', authenticateToken, async (req: ExtendedRequest, res: Response) => {
  try {
    const tenantId = req.tenantId || (req.headers['x-tenant-id'] as string);
    if (!tenantId) {
      return res.status(400).json({ error: 'Tenant ID required' });
    }

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
router.get('/api-latency-by-endpoint', authenticateToken, async (req: ExtendedRequest, res: Response) => {
  try {
    const tenantId = req.tenantId || (req.headers['x-tenant-id'] as string);
    if (!tenantId) {
      return res.status(400).json({ error: 'Tenant ID required' });
    }

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
router.get('/clock-drift', authenticateToken, async (req: ExtendedRequest, res: Response) => {
  try {
    const tenantId = req.tenantId || (req.headers['x-tenant-id'] as string);
    if (!tenantId) {
      return res.status(400).json({ error: 'Tenant ID required' });
    }

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
router.get('/verification-mismatches', authenticateToken, async (req: ExtendedRequest, res: Response) => {
  try {
    const tenantId = req.tenantId || (req.headers['x-tenant-id'] as string);
    if (!tenantId) {
      return res.status(400).json({ error: 'Tenant ID required' });
    }

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
router.get('/health-status', authenticateToken, async (req: ExtendedRequest, res: Response) => {
  try {
    const tenantId = req.tenantId || (req.headers['x-tenant-id'] as string);
    if (!tenantId) {
      return res.status(400).json({ error: 'Tenant ID required' });
    }

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
router.get('/summary', authenticateToken, async (req: ExtendedRequest, res: Response) => {
  try {
    const tenantId = req.tenantId || (req.headers['x-tenant-id'] as string);
    if (!tenantId) {
      return res.status(400).json({ error: 'Tenant ID required' });
    }

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
router.get('/failure-reasons', authenticateToken, async (req: ExtendedRequest, res: Response) => {
  try {
    const tenantId = req.tenantId || (req.headers['x-tenant-id'] as string);
    if (!tenantId) {
      return res.status(400).json({ error: 'Tenant ID required' });
    }

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
router.get('/problematic-records', authenticateToken, async (req: ExtendedRequest, res: Response) => {
  try {
    const tenantId = req.tenantId || (req.headers['x-tenant-id'] as string);
    if (!tenantId) {
      return res.status(400).json({ error: 'Tenant ID required' });
    }

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
router.get('/dashboard', authenticateToken, async (req: ExtendedRequest, res: Response) => {
  try {
    const tenantId = req.tenantId || (req.headers['x-tenant-id'] as string);
    if (!tenantId) {
      return res.status(400).json({ error: 'Tenant ID required' });
    }

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

export default router;
