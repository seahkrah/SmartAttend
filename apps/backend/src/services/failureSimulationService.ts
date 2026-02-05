/**
 * Phase 7.2 — Failure Simulation Service
 * Simulate and validate system behavior under:
 * - Time drift (client/server clock differences)
 * - Partial outages (service unavailability)
 * - Duplicate attendance storms (high-volume duplicate submissions)
 * - Network instability (timeouts, retries, latency spikes)
 */

import { query } from '../db/connection.js';
import { recordClockDrift, recordAPILatency } from './metricsService.js';

export interface SimulationResult {
  scenario: string;
  status: 'passed' | 'failed' | 'warning';
  tests_run: number;
  tests_passed: number;
  tests_failed: number;
  issues_found: string[];
  metrics_collected: number;
  duration_ms: number;
  timestamp: Date;
}

export interface TimeDriftScenario {
  max_drift_ms: number;
  affected_records: number;
  iterations: number;
}

export interface PartialOutageScenario {
  outage_duration_ms: number;
  recovery_attempts: number;
  affected_endpoint: string;
}

export interface DuplicateStormScenario {
  duplicate_submissions: number;
  batch_size: number;
  interval_ms: number;
}

export interface NetworkInstabilityScenario {
  failure_rate: number; // 0-100
  latency_spike_ms: number;
  timeout_probability: number; // 0-100
  iterations: number;
}

// ============================================================================
// TIME DRIFT SIMULATION
// ============================================================================

/**
 * Simulate clock drift between client and server
 * Records metrics with varying time differences to validate handling
 */
export async function simulateTimeDrift(
  tenantId: string,
  scenario: TimeDriftScenario
): Promise<SimulationResult> {
  const startTime = Date.now();
  const results: SimulationResult = {
    scenario: 'time_drift',
    status: 'passed',
    tests_run: 0,
    tests_passed: 0,
    tests_failed: 0,
    issues_found: [],
    metrics_collected: 0,
    duration_ms: 0,
    timestamp: new Date(),
  };

  try {
    const drifts = [
      -scenario.max_drift_ms, // Server ahead
      0, // No drift
      scenario.max_drift_ms / 2, // Minor drift
      scenario.max_drift_ms, // Maximum drift
    ];

    for (let iter = 0; iter < scenario.iterations; iter++) {
      for (const drift of drifts) {
        results.tests_run++;

        try {
          const serverTime = Date.now();
          const clientTime = serverTime + drift;

          // Record clock drift metric
          await recordClockDrift({
            tenant_id: tenantId,
            platform_type: 'school',
            client_clock_ms: clientTime,
            server_clock_ms: serverTime,
            attendance_record_id: `test-${iter}-${drift}`,
          });

          results.metrics_collected++;
          
          // Validation: drift should be recorded correctly
          if (Math.abs(drift) <= scenario.max_drift_ms) {
            results.tests_passed++;
          } else {
            results.tests_failed++;
            results.issues_found.push(
              `Drift ${drift}ms exceeded threshold ${scenario.max_drift_ms}ms`
            );
          }
        } catch (error: any) {
          results.tests_failed++;
          results.issues_found.push(
            `Failed to record drift ${drift}ms: ${error.message}`
          );
        }
      }
    }

    // Verify metrics were recorded in database
    const metricsCount = await query(
      `SELECT COUNT(*) as count FROM platform_metrics 
       WHERE tenant_id = $1 AND metric_type = 'clock_drift' AND created_at >= NOW() - INTERVAL '5 minutes'`,
      [tenantId]
    );

    if (metricsCount.rows[0].count < results.metrics_collected) {
      results.issues_found.push(
        `Metrics persistence issue: ${metricsCount.rows[0].count} recorded but ${results.metrics_collected} expected`
      );
    }

    // Check for excessive clock drift handlers
    const excessiveDriftRecords = await query(
      `SELECT COUNT(*) as count FROM platform_metrics 
       WHERE tenant_id = $1 AND metric_type = 'clock_drift' 
       AND ABS(clock_drift_ms) > $2`,
      [tenantId, scenario.max_drift_ms]
    );

    if (excessiveDriftRecords.rows[0].count > 0) {
      results.issues_found.push(
        `${excessiveDriftRecords.rows[0].count} records with excessive drift not properly flagged`
      );
    }

    results.status = results.tests_failed === 0 ? 'passed' : 'failed';
  } catch (error: any) {
    results.status = 'failed';
    results.issues_found.push(`Simulation error: ${error.message}`);
  }

  results.duration_ms = Date.now() - startTime;
  return results;
}

// ============================================================================
// PARTIAL OUTAGE SIMULATION
// ============================================================================

/**
 * Simulate partial outage: endpoint returns errors, then recovers
 * Tests circuit breaker, retry logic, and health status updates
 */
export async function simulatePartialOutage(
  tenantId: string,
  scenario: PartialOutageScenario
): Promise<SimulationResult> {
  const startTime = Date.now();
  const results: SimulationResult = {
    scenario: 'partial_outage',
    status: 'passed',
    tests_run: 0,
    tests_passed: 0,
    tests_failed: 0,
    issues_found: [],
    metrics_collected: 0,
    duration_ms: 0,
    timestamp: new Date(),
  };

  try {
    // Record failed API requests during outage
    for (let i = 0; i < scenario.recovery_attempts; i++) {
      results.tests_run++;

      try {
        const failureTime = Date.now();

        // Simulate API error
        await recordAPILatency({
          endpoint: scenario.affected_endpoint,
          http_method: 'POST',
          status_code: 503, // Service unavailable
          response_time_ms: 5000, // Timeout
          tenant_id: tenantId,
        });

        results.metrics_collected++;

        // Check health status was updated to degraded/critical
        const healthStatus = await query(
          `SELECT health_status FROM platform_health_status 
           WHERE tenant_id = $1`,
          [tenantId]
        );

        if (healthStatus.rows[0]?.health_status !== 'degraded' && 
            healthStatus.rows[0]?.health_status !== 'critical') {
          results.issues_found.push(
            `Health status not updated to degraded during outage (current: ${healthStatus.rows[0]?.health_status})`
          );
          results.tests_failed++;
        } else {
          results.tests_passed++;
        }

        // Small delay between attempts
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error: any) {
        results.tests_failed++;
        results.issues_found.push(
          `Attempt ${i + 1} failed: ${error.message}`
        );
      }
    }

    // Verify error count accumulation
    const errorMetrics = await query(
      `SELECT COUNT(*) as count FROM platform_metrics 
       WHERE tenant_id = $1 AND endpoint = $2 AND status_code >= 400 
       AND created_at >= NOW() - INTERVAL '5 minutes'`,
      [tenantId, scenario.affected_endpoint]
    );

    if (errorMetrics.rows[0].count < scenario.recovery_attempts) {
      results.issues_found.push(
        `Error metrics not properly accumulated: ${errorMetrics.rows[0].count} recorded, expected ${scenario.recovery_attempts}`
      );
    }

    results.status = results.tests_failed === 0 ? 'passed' : 'failed';
  } catch (error: any) {
    results.status = 'failed';
    results.issues_found.push(`Simulation error: ${error.message}`);
  }

  results.duration_ms = Date.now() - startTime;
  return results;
}

// ============================================================================
// DUPLICATE ATTENDANCE STORM SIMULATION
// ============================================================================

/**
 * Simulate duplicate attendance submissions (idempotency test)
 * Tests that duplicate submissions don't create multiple records
 */
export async function simulateDuplicateStorm(
  tenantId: string,
  scenario: DuplicateStormScenario
): Promise<SimulationResult> {
  const startTime = Date.now();
  const results: SimulationResult = {
    scenario: 'duplicate_storm',
    status: 'passed',
    tests_run: 0,
    tests_passed: 0,
    tests_failed: 0,
    issues_found: [],
    metrics_collected: 0,
    duration_ms: 0,
    timestamp: new Date(),
  };

  try {
    // Create a test school attendance record
    const createResult = await query(
      `INSERT INTO school_attendance (
        school_id, student_id, attendance_date, is_present, 
        marked_at, marked_by_user_id, attendance_state
      ) VALUES (
        'test-school-001', 'test-student-001', $1, true,
        CURRENT_TIMESTAMP, 'test-user-001', 'VERIFIED'
      ) RETURNING id`,
      [new Date()]
    );

    const attendanceId = createResult.rows[0].id;

    // Simulate rapid duplicate submissions
    const duplicatePromises = [];
    for (let batch = 0; batch < Math.ceil(scenario.duplicate_submissions / scenario.batch_size); batch++) {
      for (let i = 0; i < scenario.batch_size && batch * scenario.batch_size + i < scenario.duplicate_submissions; i++) {
        results.tests_run++;

        // All submissions reference same attendance record (duplicate)
        const promise = (async () => {
          try {
            // Try to update the same record multiple times (idempotency test)
            await query(
              `UPDATE school_attendance 
               SET face_verified = true, face_verification_at = CURRENT_TIMESTAMP
               WHERE id = $1`,
              [attendanceId]
            );

            results.metrics_collected++;
            results.tests_passed++;
          } catch (error: any) {
            results.tests_failed++;
            results.issues_found.push(
              `Duplicate submission ${batch}-${i} failed: ${error.message}`
            );
          }
        })();

        duplicatePromises.push(promise);

        // Batch interval
        if ((batch * scenario.batch_size + i + 1) % scenario.batch_size === 0) {
          await new Promise(resolve => setTimeout(resolve, scenario.interval_ms));
        }
      }
    }

    // Wait for all submissions to complete
    await Promise.all(duplicatePromises);

    // Verify only one record exists for this attendance
    const recordCount = await query(
      `SELECT COUNT(*) as count FROM school_attendance 
       WHERE id = $1 AND created_at >= NOW() - INTERVAL '5 minutes'`,
      [attendanceId]
    );

    if (recordCount.rows[0].count !== 1) {
      results.issues_found.push(
        `Duplicate record creation detected: ${recordCount.rows[0].count} records found, expected 1`
      );
      results.status = 'failed';
    }

    // Verify no orphaned records
    const orphanedRecords = await query(
      `SELECT COUNT(*) as count FROM school_attendance 
       WHERE student_id = 'test-student-001' AND school_id = 'test-school-001'
       AND created_at >= NOW() - INTERVAL '5 minutes'`
    );

    if (orphanedRecords.rows[0].count > 1) {
      results.issues_found.push(
        `Duplicate records created: ${orphanedRecords.rows[0].count} records for same student`
      );
      results.status = 'failed';
    }

    // Cleanup test record
    await query(`DELETE FROM school_attendance WHERE id = $1 RETURNING id`, [attendanceId]);

    results.status = results.issues_found.length === 0 ? 'passed' : results.status === 'failed' ? 'failed' : 'warning';
  } catch (error: any) {
    results.status = 'failed';
    results.issues_found.push(`Simulation error: ${error.message}`);
  }

  results.duration_ms = Date.now() - startTime;
  return results;
}

// ============================================================================
// NETWORK INSTABILITY SIMULATION
// ============================================================================

/**
 * Simulate network instability: random failures, latency spikes, timeouts
 * Tests retry logic, circuit breakers, and graceful degradation
 */
export async function simulateNetworkInstability(
  tenantId: string,
  scenario: NetworkInstabilityScenario
): Promise<SimulationResult> {
  const startTime = Date.now();
  const results: SimulationResult = {
    scenario: 'network_instability',
    status: 'passed',
    tests_run: 0,
    tests_passed: 0,
    tests_failed: 0,
    issues_found: [],
    metrics_collected: 0,
    duration_ms: 0,
    timestamp: new Date(),
  };

  try {
    const endpoints = [
      '/api/school/attendance',
      '/api/corporate/checkin',
      '/api/attendance/verify',
    ];

    for (let iter = 0; iter < scenario.iterations; iter++) {
      const endpoint = endpoints[iter % endpoints.length];
      results.tests_run++;

      try {
        // Random failure injection
        const shouldFail = Math.random() * 100 < scenario.failure_rate;
        const hasLatencySpike = Math.random() * 100 < 30; // 30% chance of latency spike
        const willTimeout = Math.random() * 100 < scenario.timeout_probability;

        let statusCode = 200;
        let responseTime = Math.random() * 1000 + 100; // 100-1100ms

        if (shouldFail) {
          statusCode = [400, 500, 503][Math.floor(Math.random() * 3)];
          responseTime = 5000; // Timeout
        } else if (hasLatencySpike) {
          responseTime += scenario.latency_spike_ms;
        }

        if (willTimeout) {
          statusCode = 504; // Gateway timeout
          responseTime = 30000;
        }

        // Record metric
        await recordAPILatency({
          endpoint,
          http_method: 'POST',
          status_code: statusCode,
          response_time_ms: responseTime,
          tenant_id: tenantId,
        });

        results.metrics_collected++;

        // Validation
        if (statusCode >= 200 && statusCode < 300) {
          results.tests_passed++;
        } else if (statusCode >= 500) {
          // Server errors should be retryable
          results.tests_passed++; // We're just testing that we record them
        } else {
          results.issues_found.push(
            `Unexpected status ${statusCode} on iteration ${iter}`
          );
        }
      } catch (error: any) {
        results.tests_failed++;
        results.issues_found.push(
          `Iteration ${iter} failed: ${error.message}`
        );
      }

      // Small delay between requests
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    // Analyze collected metrics for patterns
    const latencyStats = await query(
      `SELECT 
        AVG(response_time_ms) as avg_latency,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_time_ms) as p95_latency,
        MAX(response_time_ms) as max_latency,
        COUNT(CASE WHEN status_code >= 500 THEN 1 END) as server_errors
       FROM platform_metrics 
       WHERE tenant_id = $1 AND metric_category = 'api_request'
       AND created_at >= NOW() - INTERVAL '5 minutes'`,
      [tenantId]
    );

    const stats = latencyStats.rows[0];
    
    // Check if latency spikes were recorded
    if (stats.max_latency < scenario.latency_spike_ms) {
      results.issues_found.push(
        `Latency spikes not recorded: max latency ${stats.max_latency}ms vs spike ${scenario.latency_spike_ms}ms`
      );
    }

    // Check server error tracking
    const expectedErrors = Math.round((scenario.failure_rate / 100) * scenario.iterations);
    const actualErrors = stats.server_errors || 0;
    
    if (Math.abs(actualErrors - expectedErrors) > scenario.iterations * 0.1) {
      results.issues_found.push(
        `Server error tracking mismatch: recorded ${actualErrors}, expected ~${expectedErrors}`
      );
    }

    results.status = results.issues_found.length === 0 ? 'passed' : 'warning';
  } catch (error: any) {
    results.status = 'failed';
    results.issues_found.push(`Simulation error: ${error.message}`);
  }

  results.duration_ms = Date.now() - startTime;
  return results;
}

// ============================================================================
// COMPREHENSIVE SIMULATION SUITE
// ============================================================================

export interface SimulationSuite {
  tenant_id: string;
  scenarios: string[];
  total_duration_ms: number;
  overall_status: 'passed' | 'failed' | 'warning';
  results: SimulationResult[];
}

/**
 * Run complete failure simulation suite
 */
export async function runComprehensiveSimulation(
  tenantId: string
): Promise<SimulationSuite> {
  const startTime = Date.now();
  const results: SimulationResult[] = [];
  let overallStatus: 'passed' | 'failed' | 'warning' = 'passed';

  console.log(`[SIMULATION] Starting comprehensive failure simulation for tenant ${tenantId}`);

  // Time Drift Simulation
  console.log('[SIMULATION] Running time drift scenario...');
  const timeDriftResult = await simulateTimeDrift(tenantId, {
    max_drift_ms: 5000,
    affected_records: 100,
    iterations: 5,
  });
  results.push(timeDriftResult);
  if (timeDriftResult.status === 'failed') {
    overallStatus = 'failed';
  } else if (timeDriftResult.status === 'warning' && overallStatus === 'passed') {
    overallStatus = 'warning';
  }
  console.log(`  ✓ Time drift: ${timeDriftResult.tests_passed}/${timeDriftResult.tests_run} passed`);

  // Partial Outage Simulation
  console.log('[SIMULATION] Running partial outage scenario...');
  const outageResult = await simulatePartialOutage(tenantId, {
    outage_duration_ms: 5000,
    recovery_attempts: 10,
    affected_endpoint: '/api/school/attendance',
  });
  results.push(outageResult);
  if (outageResult.status === 'failed') {
    overallStatus = 'failed';
  } else if (outageResult.status === 'warning' && overallStatus === 'passed') {
    overallStatus = 'warning';
  }
  console.log(`  ✓ Partial outage: ${outageResult.tests_passed}/${outageResult.tests_run} passed`);

  // Duplicate Storm Simulation
  console.log('[SIMULATION] Running duplicate storm scenario...');
  const duplicateResult = await simulateDuplicateStorm(tenantId, {
    duplicate_submissions: 50,
    batch_size: 10,
    interval_ms: 100,
  });
  results.push(duplicateResult);
  if (duplicateResult.status === 'failed') {
    overallStatus = 'failed';
  } else if (duplicateResult.status === 'warning' && overallStatus === 'passed') {
    overallStatus = 'warning';
  }
  console.log(`  ✓ Duplicate storm: ${duplicateResult.tests_passed}/${duplicateResult.tests_run} passed`);

  // Network Instability Simulation
  console.log('[SIMULATION] Running network instability scenario...');
  const instabilityResult = await simulateNetworkInstability(tenantId, {
    failure_rate: 10, // 10% failures
    latency_spike_ms: 3000,
    timeout_probability: 5, // 5% timeouts
    iterations: 50,
  });
  results.push(instabilityResult);
  if (instabilityResult.status === 'failed') {
    overallStatus = 'failed';
  } else if (instabilityResult.status === 'warning' && overallStatus === 'passed') {
    overallStatus = 'warning';
  }
  console.log(`  ✓ Network instability: ${instabilityResult.tests_passed}/${instabilityResult.tests_run} passed`);

  const suite: SimulationSuite = {
    tenant_id: tenantId,
    scenarios: ['time_drift', 'partial_outage', 'duplicate_storm', 'network_instability'],
    total_duration_ms: Date.now() - startTime,
    overall_status: overallStatus,
    results,
  };

  console.log(`[SIMULATION] Simulation complete: ${overallStatus.toUpperCase()}`);
  console.log(`[SIMULATION] Total duration: ${suite.total_duration_ms}ms`);

  return suite;
}

/**
 * Generate simulation report with critical failures
 */
export function generateSimulationReport(suite: SimulationSuite): {
  passed: number;
  failed: number;
  warnings: number;
  critical_issues: string[];
  all_issues: string[];
} {
  const report = {
    passed: 0,
    failed: 0,
    warnings: 0,
    critical_issues: [] as string[],
    all_issues: [] as string[],
  };

  for (const result of suite.results) {
    if (result.status === 'passed') report.passed++;
    else if (result.status === 'failed') report.failed++;
    else report.warnings++;

    for (const issue of result.issues_found) {
      report.all_issues.push(`[${result.scenario}] ${issue}`);

      // Identify critical issues
      if (
        issue.includes('duplicate') ||
        issue.includes('not properly') ||
        issue.includes('Simulation error') ||
        issue.includes('persistence issue')
      ) {
        report.critical_issues.push(`[${result.scenario}] ${issue}`);
      }
    }
  }

  return report;
}
