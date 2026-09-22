/**
 * Phase 7.2 — Failure Simulation Routes
 * Test endpoints for running failure scenarios and validating system resilience
 */

import { Router, Response, NextFunction } from 'express';
import type { ExtendedRequest } from '../types/auth.js';
import { authenticateToken } from '../auth/middleware.js';
import {
  resolveTenantContext,
  requireTenant,
  type TenantRequest,
} from '../auth/tenantContextMiddleware.js';
import { query } from '../db/connection.js';
import {
  simulateTimeDrift,
  simulatePartialOutage,
  simulateNetworkInstability,
  runComprehensiveSimulation,
  generateSimulationReport,
} from '../services/failureSimulationService.js';

const router = Router();

/**
 * Failure simulations: deliberately stressing the platform to see how it
 * behaves. These are operational tools, not tenant features.
 *
 * Two things were wrong. Every route filtered on req.tenantId, which
 * tenantIdExtractorMiddleware copied from the X-Tenant-Id header before
 * authentication had run, so any authenticated caller could name any tenant
 * and run a simulation against it. And the only role check was "is there a
 * token", so any student or lecturer could trigger one.
 *
 * The tenant now comes from the resolved context — for a superadmin, from an
 * explicit and recorded X-Tenant-Id selection that requireTenant validates —
 * and the whole router is reserved to superadmins, because running a failure
 * scenario against live data is not something a tenant administrator should
 * be able to do to their own institution, let alone anyone else's.
 */
router.use(authenticateToken, resolveTenantContext);

router.use((req, res: Response, next: NextFunction) => {
  if (!(req as TenantRequest).ctx?.isSuperadmin) {
    res.status(403).json({ error: 'Failure simulations are superadmin only' });
    return;
  }
  next();
});

router.use(requireTenant);

/** The server-resolved tenant. Never a value the caller supplied. */
function tenantOf(req: ExtendedRequest): string {
  return (req as unknown as TenantRequest).ctx!.tenantId!;
}

/**
 * POST /api/simulations/time-drift
 * Simulate clock drift between client and server
 * Query params:
 *   - max_drift_ms: number (default 5000)
 *   - iterations: number (default 5)
 */
router.post('/time-drift', async (req: ExtendedRequest, res: Response) => {
  try {
    const tenantId = tenantOf(req);

    const maxDrift = parseInt(req.query.max_drift_ms as string) || 5000;
    const iterations = parseInt(req.query.iterations as string) || 5;

    const result = await simulateTimeDrift(tenantId, {
      max_drift_ms: maxDrift,
      affected_records: maxDrift * iterations,
      iterations,
    });

    return res.status(200).json({
      simulation: 'time_drift',
      tenant_id: tenantId,
      result,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Time drift simulation error:', error);
    return res.status(500).json({ error: 'Simulation failed', details: error.message });
  }
});

/**
 * POST /api/simulations/partial-outage
 * Simulate partial outage on specific endpoint
 * Query params:
 *   - endpoint: string (default /api/school/attendance)
 *   - recovery_attempts: number (default 10)
 */
router.post('/partial-outage', async (req: ExtendedRequest, res: Response) => {
  try {
    const tenantId = tenantOf(req);

    const endpoint = (req.query.endpoint as string) || '/api/school/attendance';
    const recoveryAttempts = parseInt(req.query.recovery_attempts as string) || 10;

    const result = await simulatePartialOutage(tenantId, {
      outage_duration_ms: 5000,
      recovery_attempts: recoveryAttempts,
      affected_endpoint: endpoint,
    });

    return res.status(200).json({
      simulation: 'partial_outage',
      tenant_id: tenantId,
      endpoint,
      result,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Partial outage simulation error:', error);
    return res.status(500).json({ error: 'Simulation failed', details: error.message });
  }
});

/**
 * POST /api/simulations/duplicate-storm
 * Simulate rapid duplicate attendance submissions
 * Query params:
 *   - duplicates: number (default 50)
 *   - batch_size: number (default 10)
 *   - interval_ms: number (default 100)
 */
router.post('/duplicate-storm', async (_req: ExtendedRequest, res: Response) => {
  // simulateDuplicateStorm writes a test row into school_attendance naming
  // school_id, is_present, marked_by_user_id and face_verification_at — none
  // of which that table has — and passes string literals into uuid columns.
  // The insert throws, so the scenario has never exercised anything; it
  // reports "failed" with its own error in issues_found, which reads exactly
  // like a genuine finding about the platform.
  //
  // Refusing plainly is better than a simulation that cannot run reporting a
  // fault it invented. It also happens to be the only scenario that writes to
  // real attendance data, so it stays off until it is written against the
  // schema that exists.
  res.status(501).json({
    error: 'Not implemented',
    message:
      'The duplicate-storm scenario is written against columns school_attendance does not have, ' +
      'so it cannot run. The other scenarios are read-only probes and are unaffected.',
  });
});

/**
 * POST /api/simulations/network-instability
 * Simulate network instability with failures, latency spikes, timeouts
 * Query params:
 *   - failure_rate: number 0-100 (default 10)
 *   - latency_spike_ms: number (default 3000)
 *   - timeout_probability: number 0-100 (default 5)
 *   - iterations: number (default 50)
 */
router.post('/network-instability', async (req: ExtendedRequest, res: Response) => {
  try {
    const tenantId = tenantOf(req);

    const failureRate = Math.min(100, parseInt(req.query.failure_rate as string) || 10);
    const latencySpike = parseInt(req.query.latency_spike_ms as string) || 3000;
    const timeoutProbability = Math.min(100, parseInt(req.query.timeout_probability as string) || 5);
    const iterations = parseInt(req.query.iterations as string) || 50;

    const result = await simulateNetworkInstability(tenantId, {
      failure_rate: failureRate,
      latency_spike_ms: latencySpike,
      timeout_probability: timeoutProbability,
      iterations,
    });

    return res.status(200).json({
      simulation: 'network_instability',
      tenant_id: tenantId,
      parameters: {
        failure_rate: failureRate,
        latency_spike_ms: latencySpike,
        timeout_probability: timeoutProbability,
        iterations,
      },
      result,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Network instability simulation error:', error);
    return res.status(500).json({ error: 'Simulation failed', details: error.message });
  }
});

/**
 * POST /api/simulations/comprehensive
 * Run complete failure simulation suite
 * Tests all 4 scenarios and generates comprehensive report
 */
router.post('/comprehensive', async (req: ExtendedRequest, res: Response) => {
  try {
    const tenantId = tenantOf(req);

    console.log(`[API] Starting comprehensive simulation for tenant ${tenantId}`);
    
    const suite = await runComprehensiveSimulation(tenantId);
    const report = generateSimulationReport(suite);

    return res.status(200).json({
      simulation: 'comprehensive',
      tenant_id: tenantId,
      suite,
      report,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Comprehensive simulation error:', error);
    return res.status(500).json({ error: 'Simulation failed', details: error.message });
  }
});

/**
 * POST /api/simulations/stress-test
 * High-intensity stress test: maximum load across all endpoints
 * Tests system under extreme conditions
 */
router.post('/stress-test', async (req: ExtendedRequest, res: Response) => {
  try {
    const tenantId = tenantOf(req);

    console.log(`[API] Starting stress test for tenant ${tenantId}`);

    // Run multiple intensive simulations in parallel
    const stressResults = await Promise.all([
      // High failure rate
      simulateNetworkInstability(tenantId, {
        failure_rate: 50,
        latency_spike_ms: 5000,
        timeout_probability: 25,
        iterations: 100,
      }),
      // Maximum clock drift
      simulateTimeDrift(tenantId, {
        max_drift_ms: 10000,
        affected_records: 500,
        iterations: 10,
      }),
      // The duplicate storm is omitted: it is written against columns
      // school_attendance does not have, so including it only contributed its
      // own failure to the totals below and made the stress test look like it
      // had found a fault.
      // Sustained outage
      simulatePartialOutage(tenantId, {
        outage_duration_ms: 10000,
        recovery_attempts: 20,
        affected_endpoint: '/api/school/attendance',
      }),
    ]);

    const report = {
      total_tests: stressResults.reduce((sum, r) => sum + r.tests_run, 0),
      total_passed: stressResults.reduce((sum, r) => sum + r.tests_passed, 0),
      total_failed: stressResults.reduce((sum, r) => sum + r.tests_failed, 0),
      metrics_collected: stressResults.reduce((sum, r) => sum + r.metrics_collected, 0),
      all_issues: stressResults.flatMap(r => r.issues_found),
      results: stressResults,
    };

    return res.status(200).json({
      simulation: 'stress_test',
      tenant_id: tenantId,
      report,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Stress test error:', error);
    return res.status(500).json({ error: 'Stress test failed', details: error.message });
  }
});

/**
 * GET /api/simulations/status
 * Get status of last simulations run
 */
router.get('/status', async (req: ExtendedRequest, res: Response) => {
  try {
    const tenantId = tenantOf(req);

    // Get metrics from last hour
    const metricsHealth = await query(
      `SELECT 
        COUNT(*) as total_metrics,
        COUNT(CASE WHEN metric_type LIKE '%failure%' THEN 1 END) as failures,
        COUNT(CASE WHEN metric_type LIKE '%success%' THEN 1 END) as successes,
        AVG(response_time_ms) as avg_latency_ms
      FROM platform_metrics
      WHERE tenant_id = $1
      AND created_at >= NOW() - INTERVAL '1 hour'`,
      [tenantId]
    );

    return res.status(200).json({
      tenant_id: tenantId,
      metrics_summary: metricsHealth.rows[0],
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Status check error:', error);
    return res.status(500).json({ error: 'Failed to get status', details: error.message });
  }
});

export default router;
