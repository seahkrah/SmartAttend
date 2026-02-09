/**
 * PHASE 5, STEP 5.3: Platform Readiness Validation Harness
 * Comprehensive test suite for platform production readiness
 *
 * Purpose: Execute end-to-end, time-based, and recovery validation
 * to ensure SmartAttend can be trusted in production
 */

import { runAllScenarios } from './incidentScenarioService.js'
import { runAllSimulations } from './timeBasedSimulationService.js'
import { runRecoveryDrillSuite } from './recoveryDrillService.js'
import { query } from '../db/connection.js'

export interface ValidationReport {
  reportId: string
  timestamp: Date
  status: 'ready' | 'at_risk' | 'not_ready'
  consensus: {
    scenariosReady: boolean
    simulationsReady: boolean
    recoveryReady: boolean
    overallReady: boolean
  }
  results: {
    scenarios: any
    simulations: any
    recovery: any
  }
  recommendations: string[]
  findings: {
    strengths: string[]
    gaps: string[]
    riskFactors: string[]
  }
  executedBy: string
  platformId?: string
}

/**
 * Run comprehensive platform validation
 * This is what makes SmartAttend a production-ready platform
 */
export async function validatePlatformReadiness(
  userId: string,
  platformId: string | null
): Promise<ValidationReport> {
  const reportId = `report_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  const startTime = new Date()

  console.log('\n')
  console.log('╔' + '═' . repeat(78) + '╗')
  console.log('║' + ' ' . repeat(14) + 'SMARTATTEND PLATFORM READINESS VALIDATION' + ' ' . repeat(24) + '║')
  console.log('╚' + '═' . repeat(78) + '╝\n')

  const recommendations: string[] = []
  const strengths: string[] = []
  const gaps: string[] = []
  const riskFactors: string[] = []

  // Use provided platformId or get first platform for testing
  let testPlatformId = platformId
  if (!testPlatformId) {
    const platformResult = await query('SELECT id FROM platforms LIMIT 1').catch(() => {
      // If platforms table doesn't exist, use dummy ID
      return { rows: [{ id: 'local_test' }] }
    })
    testPlatformId = platformResult.rows[0]?.id || 'local_test'
  }

  // PHASE 1: Scenario Testing (End-to-End)
  console.log('PHASE 1: End-to-End Scenario Testing')
  console.log('─' . repeat(80) + '\n')

  let scenarioResults: any
  try {
    scenarioResults = await runAllScenarios(userId, testPlatformId)
    console.log(`\n✓ Scenarios: ${scenarioResults.passed}/${scenarioResults.totalScenarios} passed\n`)

    if (scenarioResults.platformReady) {
      strengths.push('All incident lifecycle scenarios pass')
    } else {
      gaps.push(`Scenario failures: ${scenarioResults.failed} of ${scenarioResults.totalScenarios}`)
      recommendations.push('Review scenario failures in logs and fix state transition handlers')
    }
  } catch (error: any) {
    console.error('Scenario testing failed:', error.message)
    gaps.push(`Scenario suite failed: ${error.message}`)
    riskFactors.push('End-to-end incident workflows may not function correctly')
    scenarioResults = {
      totalScenarios: 0,
      passed: 0,
      failed: 1,
      platformReady: false,
      results: [],
    }
  }

  // PHASE 2: Time-Based Simulations
  console.log('\nPHASE 2: Time-Based Incident Simulations')
  console.log('─' . repeat(80) + '\n')

  let simulationResults: any
  try {
    simulationResults = await runAllSimulations()
    console.log(`\n✓ Simulations: ${simulationResults.completed}/${simulationResults.totalSimulations} completed\n`)

    if (simulationResults.systemStable) {
      strengths.push('System stable across compressed timelines')
    } else {
      gaps.push(`Simulation failures: ${simulationResults.failed} of ${simulationResults.totalSimulations}`)
      riskFactors.push('Time-based incident sequences may cause system instability')
      recommendations.push('Review simulation failures and validate incident state handling under load')
    }
  } catch (error: any) {
    console.error('Simulation testing failed:', error.message)
    gaps.push(`Simulation suite failed: ${error.message}`)
    simulationResults = {
      totalSimulations: 0,
      completed: 0,
      failed: 1,
      systemStable: false,
      results: [],
    }
  }

  // PHASE 3: Recovery Drills
  console.log('\nPHASE 3: Superadmin Recovery Drills')
  console.log('─' . repeat(80) + '\n')

  let recoveryResults: any
  try {
    recoveryResults = await runRecoveryDrillSuite(userId)
    console.log(`✓ Recovery: ${recoveryResults.passed}/${recoveryResults.totalDrills} drills passed\n`)

    if (recoveryResults.platformRecoveryReady) {
      strengths.push('All critical recovery scenarios functional')
    } else {
      gaps.push(`Recovery drill failures: ${recoveryResults.failed} of ${recoveryResults.totalDrills}`)
      riskFactors.push('Platform may not survive critical failure scenarios')
      recommendations.push(
        'Review recovery drill failures and implement additional resilience measures'
      )
    }
  } catch (error: any) {
    console.error('Recovery drill failed:', error.message)
    gaps.push(`Recovery suite failed: ${error.message}`)
    riskFactors.push('Disaster recovery procedures not validated')
    recoveryResults = {
      totalDrills: 0,
      passed: 0,
      partial: 0,
      failed: 1,
      platformRecoveryReady: false,
      results: [],
    }
  }

  // Determine overall status
  const scenariosReady = scenarioResults.platformReady
  const simulationsReady = simulationResults.systemStable
  const recoveryReady = recoveryResults.platformRecoveryReady
  const overallReady = scenariosReady && simulationsReady && recoveryReady

  let status: 'ready' | 'at_risk' | 'not_ready' = 'not_ready'
  if (overallReady) {
    status = 'ready'
  } else if (scenariosReady || simulationsReady || recoveryReady) {
    status = 'at_risk'
  }

  // Build recommendations
  if (status === 'ready') {
    recommendations.push('✓ Platform approved for production deployment')
    recommendations.push('Recommend automated re-validation every 7 days')
  } else if (status === 'at_risk') {
    recommendations.push('⚠ Address gaps before production deployment')
    recommendations.push('Consider staged rollout with additional monitoring')
  } else {
    recommendations.push('✗ Do not deploy to production until all tests pass')
    recommendations.push('Escalate to development team for critical fixes')
  }

  // Additional findings
  if (scenarioResults.totalScenarios > 0) {
    strengths.push(`${scenarioResults.totalScenarios} incident lifecycle scenarios validated`)
  }
  if (simulationResults.totalSimulations > 0) {
    strengths.push(`System tested under ${simulationResults.totalSimulations} compressed timeline simulations`)
  }
  if (recoveryResults.totalDrills > 0) {
    strengths.push(`${recoveryResults.totalDrills} critical recovery procedures verified`)
  }

  const report: ValidationReport = {
    reportId,
    timestamp: startTime,
    status,
    consensus: {
      scenariosReady,
      simulationsReady,
      recoveryReady,
      overallReady,
    },
    results: {
      scenarios: scenarioResults,
      simulations: simulationResults,
      recovery: recoveryResults,
    },
    recommendations,
    findings: {
      strengths,
      gaps,
      riskFactors,
    },
    executedBy: userId,
    platformId: testPlatformId,
  }

  // Store report
  await query(
    `INSERT INTO platform_readiness_reports (report_id, platform_id, overall_status, 
      scenarios_ready, simulations_ready, recovery_ready, report_data, created_at, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT DO NOTHING`,
    [
      reportId,
      testPlatformId,
      status,
      scenariosReady,
      simulationsReady,
      recoveryReady,
      JSON.stringify(report),
      new Date(),
      userId,
    ]
  ).catch(() => {
    console.log('[VALIDATION] Report storage unavailable, continuing')
  })

  // Print final report
  printValidationReport(report)

  return report
}

/**
 * Print formatted validation report
 */
function printValidationReport(report: ValidationReport): void {
  const statusEmoji = {
    ready: '✓',
    at_risk: '⚠',
    not_ready: '✗',
  }

  const statusText = {
    ready: 'READY FOR PRODUCTION',
    at_risk: 'AT RISK',
    not_ready: 'NOT READY',
  }

  console.log('\n' + '╔' + '═' . repeat(78) + '╗')
  console.log('║' + ' ' . repeat(27) + 'VALIDATION REPORT' + ' ' . repeat(35) + '║')
  console.log('╠' + '═' . repeat(78) + '╣')

  // Overall status
  console.log(
    '║ ' +
      statusEmoji[report.status] +
      ' OVERALL STATUS: ' +
      statusText[report.status].padEnd(50) +
      ' ║'
  )

  console.log('║' + ' ' . repeat(78) + '║')

  // Component status
  console.log(
    '║ Scenarios:        ' +
      (report.consensus.scenariosReady ? '✓ READY' : '✗ FAILED').padEnd(57) +
      '║'
  )
  console.log(
    '║ Simulations:      ' +
      (report.consensus.simulationsReady ? '✓ READY' : '✗ FAILED').padEnd(57) +
      '║'
  )
  console.log(
    '║ Recovery Drills:  ' +
      (report.consensus.recoveryReady ? '✓ READY' : '✗ FAILED').padEnd(57) +
      '║'
  )

  console.log('║' + ' ' . repeat(78) + '║')

  // Findings
  if (report.findings.strengths.length > 0) {
    console.log('║ STRENGTHS:' + ' ' . repeat(68) + '║')
    for (const strength of report.findings.strengths) {
      const truncated = strength.substring(0, 66)
      console.log('║   • ' + truncated.padEnd(74) + '║')
    }
    console.log('║' + ' ' . repeat(78) + '║')
  }

  if (report.findings.gaps.length > 0) {
    console.log('║ GAPS:' + ' ' . repeat(73) + '║')
    for (const gap of report.findings.gaps) {
      const truncated = gap.substring(0, 73)
      console.log('║   • ' + truncated.padEnd(74) + '║')
    }
    console.log('║' + ' ' . repeat(78) + '║')
  }

  if (report.findings.riskFactors.length > 0) {
    console.log('║ RISK FACTORS:' + ' ' . repeat(65) + '║')
    for (const risk of report.findings.riskFactors) {
      const truncated = risk.substring(0, 65)
      console.log('║   ⚠ ' + truncated.padEnd(73) + '║')
    }
    console.log('║' + ' ' . repeat(78) + '║')
  }

  if (report.recommendations.length > 0) {
    console.log('║ RECOMMENDATIONS:' + ' ' . repeat(62) + '║')
    for (const rec of report.recommendations) {
      const truncated = rec.substring(0, 72)
      console.log('║   → ' + truncated.padEnd(73) + '║')
    }
  }

  console.log('╚' + '═' . repeat(78) + '╝\n')

  console.log(`Report ID: ${report.reportId}`)
  console.log(`Generated: ${report.timestamp.toISOString()}`)
  console.log()
}

/**
 * Get latest validation report
 */
export async function getLatestValidationReport(platformId?: string): Promise<ValidationReport | null> {
  try {
    const query_result = await query(
      `SELECT report_data FROM platform_readiness_reports 
       ${platformId ? 'WHERE platform_id = $1' : ''}
       ORDER BY created_at DESC
       LIMIT 1`,
      platformId ? [platformId] : []
    )

    if (query_result.rows.length === 0) {
      return null
    }

    return JSON.parse(query_result.rows[0].report_data) as ValidationReport
  } catch (error: any) {
    console.error('Error retrieving validation report:', error)
    return null
  }
}
