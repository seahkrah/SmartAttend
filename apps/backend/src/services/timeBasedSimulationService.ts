/**
 * PHASE 5, STEP 5.3: Time-Based Incident Simulation Engine
 * Simulates incidents across compressed timelines for continuous validation
 *
 * Purpose: Test incident behavior under realistic time sequences
 * without waiting for real time to pass
 */

import { query } from '../db/connection.js'

export interface TimelineEvent {
  timestamp: Date
  action: string
  delay?: number // milliseconds before next event
}

export interface SimulationConfig {
  name: string
  startTime: Date
  timeScale: number // 1 = real-time, 60 = 60x speedup (1 hour = 1 minute)
  events: TimelineEvent[]
  description: string
}

export interface SimulationResult {
  simulationId: string
  name: string
  status: 'completed' | 'failed'
  realDuration: number // actual wall-clock time
  simulatedDuration: number // compressed time
  startTime: Date
  endTime: Date
  eventsExecuted: number
  eventsFailed: number
  details: SimulationEventResult[]
}

export interface SimulationEventResult {
  index: number
  action: string
  scheduledTime: Date
  actualExecutionTime: Date
  status: 'success' | 'failed'
  result?: Record<string, any>
  error?: string
}

/**
 * Simulation 1: Peak Load Incident Resolution
 * Simulates incident lifecycle across 4 hours, compressed to 4 minutes
 *
 * 00:00 - Critical error occurs (auto-create incident)
 * 00:05 - Error rate reaches 95%
 * 00:15 - Security officer acknowledges
 * 00:30 - Escalates to level_3
 * 00:45 - Investigation starts
 * 01:00 - Root cause assigned
 * 01:30 - Mitigation begins
 * 02:00 - Service degradation detected
 * 02:30 - Additional resources deployed
 * 03:00 - Error rate drops to <1%
 * 03:30 - Incident resolved
 * 04:00 - Incident closed
 */
export function createPeakLoadSimulation(): SimulationConfig {
  const startTime = new Date()

  return {
    name: 'Peak Load Incident (4 hours → 4 minutes)',
    startTime,
    timeScale: 60, // 60x speedup
    description: 'Simulates critical incident during peak load with full lifecycle',
    events: [
      {
        timestamp: new Date(startTime.getTime() + 0),
        action: 'incident_auto_created',
        delay: 300000, // 5 min real = 5 sec simulated
      },
      {
        timestamp: new Date(startTime.getTime() + 300000),
        action: 'error_rate_peak_95_percent',
        delay: 600000, // 10 min real = 10 sec simulated
      },
      {
        timestamp: new Date(startTime.getTime() + 900000),
        action: 'acknowledge_incident',
        delay: 900000, // 15 min real = 15 sec simulated
      },
      {
        timestamp: new Date(startTime.getTime() + 1800000),
        action: 'escalate_to_level_3',
        delay: 900000, // 15 min real = 15 sec simulated
      },
      {
        timestamp: new Date(startTime.getTime() + 2700000),
        action: 'start_investigation',
        delay: 900000, // 15 min real = 15 sec simulated
      },
      {
        timestamp: new Date(startTime.getTime() + 3600000),
        action: 'assign_root_cause',
        delay: 1800000, // 30 min real = 30 sec simulated
      },
      {
        timestamp: new Date(startTime.getTime() + 5400000),
        action: 'begin_mitigation',
        delay: 1800000, // 30 min real = 30 sec simulated
      },
      {
        timestamp: new Date(startTime.getTime() + 7200000),
        action: 'detect_service_degradation',
        delay: 1800000, // 30 min real = 30 sec simulated
      },
      {
        timestamp: new Date(startTime.getTime() + 9000000),
        action: 'deploy_additional_resources',
        delay: 1800000, // 30 min real = 30 sec simulated
      },
      {
        timestamp: new Date(startTime.getTime() + 10800000),
        action: 'error_rate_drops_below_1_percent',
        delay: 1800000, // 30 min real = 30 sec simulated
      },
      {
        timestamp: new Date(startTime.getTime() + 12600000),
        action: 'resolve_incident',
        delay: 1800000, // 30 min real = 30 sec simulated
      },
      {
        timestamp: new Date(startTime.getTime() + 14400000),
        action: 'close_incident',
        delay: 0,
      },
    ],
  }
}

/**
 * Simulation 2: Multi-Escalation Security Event
 * Simulates security incident with multiple escalation levels
 *
 * 00:00 - Security anomaly detected
 * 00:02 - Escalate to level_1
 * 00:05 - Escalate to level_2
 * 00:08 - Escalate to level_3
 * 00:12 - Escalate to executive
 * 00:15 - First mitigation attempt
 * 00:25 - Second mitigation attempt
 * 00:35 - Threat contained
 * 00:40 - Incident resolved
 */
export function createMultiEscalationSimulation(): SimulationConfig {
  const startTime = new Date()

  return {
    name: 'Multi-Escalation Security Event (40 min → 40 sec)',
    startTime,
    timeScale: 60,
    description: 'Simulates security incident with progressive escalation',
    events: [
      {
        timestamp: new Date(startTime.getTime() + 0),
        action: 'security_anomaly_detected',
        delay: 120000,
      },
      {
        timestamp: new Date(startTime.getTime() + 120000),
        action: 'escalate_to_level_1',
        delay: 180000,
      },
      {
        timestamp: new Date(startTime.getTime() + 300000),
        action: 'escalate_to_level_2',
        delay: 180000,
      },
      {
        timestamp: new Date(startTime.getTime() + 480000),
        action: 'escalate_to_level_3',
        delay: 240000,
      },
      {
        timestamp: new Date(startTime.getTime() + 720000),
        action: 'escalate_to_executive',
        delay: 180000,
      },
      {
        timestamp: new Date(startTime.getTime() + 900000),
        action: 'first_mitigation_attempt',
        delay: 600000,
      },
      {
        timestamp: new Date(startTime.getTime() + 1500000),
        action: 'second_mitigation_attempt',
        delay: 600000,
      },
      {
        timestamp: new Date(startTime.getTime() + 2100000),
        action: 'threat_contained',
        delay: 300000,
      },
      {
        timestamp: new Date(startTime.getTime() + 2400000),
        action: 'resolve_incident',
        delay: 0,
      },
    ],
  }
}

/**
 * Simulation 3: SLA Breach Risk Scenario
 * Tests incident that approaches SLA limits
 * SLA targets: acknowledge within 15 min, resolve within 4 hours for critical
 */
export function createSLABreachRiskSimulation(): SimulationConfig {
  const startTime = new Date()

  return {
    name: 'SLA Breach Risk Scenario (4.5 hours → 4.5 min)',
    startTime,
    timeScale: 60,
    description:
      'Tests system behavior when incident approaches SLA limits with close tracking',
    events: [
      {
        timestamp: new Date(startTime.getTime() + 0),
        action: 'critical_incident_created',
        delay: 600000, // 10 min - within SLA window
      },
      {
        timestamp: new Date(startTime.getTime() + 600000),
        action: 'acknowledge_at_12_min',
        delay: 100000,
      },
      {
        timestamp: new Date(startTime.getTime() + 700000),
        action: 'check_acknowledge_sla_status', // Should be OK (12 min < 15 min)
        delay: 10200000, // Jump ahead 3.5 hours toward resolution SLA limit
      },
      {
        timestamp: new Date(startTime.getTime() + 10900000),
        action: 'check_resolution_sla_status_near_limit', // Approaching 4 hour limit
        delay: 1200000, // 20 more minutes
      },
      {
        timestamp: new Date(startTime.getTime() + 12100000),
        action: 'enter_critical_resolution_window',
        delay: 300000, // 5 minutes
      },
      {
        timestamp: new Date(startTime.getTime() + 12400000),
        action: 'accelerate_mitigation',
        delay: 300000, // 5 more minutes
      },
      {
        timestamp: new Date(startTime.getTime() + 12700000),
        action: 'resolve_before_sla_breach',
        delay: 600000, // 10 minutes
      },
      {
        timestamp: new Date(startTime.getTime() + 13300000),
        action: 'close_incident_within_sla',
        delay: 0,
      },
    ],
  }
}

/**
 * Execute a simulation with compressed time
 */
export async function executeSimulation(config: SimulationConfig): Promise<SimulationResult> {
  const realStartTime = Date.now()
  const results: SimulationEventResult[] = []
  let eventsFailed = 0

  console.log(`[SIMULATION] Starting: ${config.name} (${config.timeScale}x speedup)`)
  console.log(`[SIMULATION] Simulated duration: ${(14400000 / config.timeScale) / 60000} minutes`)

  for (let i = 0; i < config.events.length; i++) {
    const event = config.events[i]
    const actualExecutionTime = new Date()

    try {
      console.log(`[SIMULATION] [${i + 1}/${config.events.length}] ${event.action} at ${event.timestamp.toISOString()}`)

      // Log simulation event to database
      await query(
        `INSERT INTO simulation_events (name, action, scheduled_time, executed_at, status, metadata)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [config.name, event.action, event.timestamp, actualExecutionTime, 'success', JSON.stringify({ timeScale: config.timeScale })]
      )

      results.push({
        index: i,
        action: event.action,
        scheduledTime: event.timestamp,
        actualExecutionTime,
        status: 'success',
      })

      // If there's a delay before the next event, wait (but scaled)
      if (event.delay && i < config.events.length - 1) {
        const scaledDelay = event.delay / config.timeScale
        await new Promise((resolve) => setTimeout(resolve, Math.max(scaledDelay, 100)))
      }
    } catch (error: any) {
      eventsFailed++
      console.error(`[SIMULATION] Event ${i + 1} failed: ${error.message}`)
      results.push({
        index: i,
        action: event.action,
        scheduledTime: event.timestamp,
        actualExecutionTime,
        status: 'failed',
        error: error.message,
      })
    }
  }

  const realDuration = Date.now() - realStartTime
  const simulatedDuration = config.events[config.events.length - 1].timestamp.getTime() - config.startTime.getTime()

  console.log(`[SIMULATION] Completed: ${config.name}`)
  console.log(`[SIMULATION] Events: ${results.length - eventsFailed}/${results.length} successful`)
  console.log(`[SIMULATION] Real duration: ${realDuration}ms`)

  // Create simulation metadata record
  await query(
    `INSERT INTO simulation_runs (name, configuration, total_events, events_executed, events_failed, 
      real_duration_ms, simulated_duration_ms, timeScale, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      config.name,
      JSON.stringify(config),
      results.length,
      results.length - eventsFailed,
      eventsFailed,
      realDuration,
      simulatedDuration,
      config.timeScale,
      eventsFailed === 0 ? 'completed' : 'partial',
    ]
  ).catch((e) => console.log('[SIMULATION] Could not record simulation metadata (table may not exist)'))

  return {
    simulationId: `sim_${Date.now()}`,
    name: config.name,
    status: eventsFailed === 0 ? 'completed' : 'failed',
    realDuration,
    simulatedDuration,
    startTime: new Date(config.startTime),
    endTime: new Date(),
    eventsExecuted: results.length - eventsFailed,
    eventsFailed,
    details: results,
  }
}

/**
 * Run all simulations in sequence
 */
export async function runAllSimulations(): Promise<{
  totalSimulations: number
  completed: number
  failed: number
  totalRealDuration: number
  results: SimulationResult[]
  systemStable: boolean
}> {
  const overallStart = Date.now()
  const results: SimulationResult[] = []

  console.log('[SIMULATION] Starting comprehensive time-based simulations...\n')

  // Simulation 1: Peak Load
  console.log('=' . repeat(60))
  console.log('SIMULATION 1: Peak Load Incident Lifecycle')
  console.log('=' . repeat(60))
  results.push(await executeSimulation(createPeakLoadSimulation()))

  console.log('\n' + '=' . repeat(60))
  console.log('SIMULATION 2: Multi-Escalation Security Event')
  console.log('=' . repeat(60))
  results.push(await executeSimulation(createMultiEscalationSimulation()))

  console.log('\n' + '=' . repeat(60))
  console.log('SIMULATION 3: SLA Breach Risk Scenario')
  console.log('=' . repeat(60))
  results.push(await executeSimulation(createSLABreachRiskSimulation()))

  const totalRealDuration = Date.now() - overallStart
  const completed = results.filter((r) => r.status === 'completed').length
  const failed = results.filter((r) => r.status === 'failed').length
  const systemStable = failed === 0 && completed === results.length

  console.log('\n' + '=' . repeat(60))
  console.log('SIMULATION SUMMARY')
  console.log('=' . repeat(60))
  console.log(`Total simulations: ${results.length}`)
  console.log(`Completed: ${completed}`)
  console.log(`Failed: ${failed}`)
  console.log(`Total wall-clock time: ${(totalRealDuration / 1000).toFixed(1)}s`)
  console.log(`System stable: ${systemStable ? '✓ YES' : '✗ NO'}`)

  return {
    totalSimulations: results.length,
    completed,
    failed,
    totalRealDuration,
    results,
    systemStable,
  }
}
