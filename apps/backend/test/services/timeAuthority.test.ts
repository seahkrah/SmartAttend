/**
 * ===========================
 * TIME AUTHORITY SERVICE TESTS
 * ===========================
 * 
 * Integration tests for time authority and clock drift tracking.
 * Tests cover drift calculation, classification, logging, incidents, and enforcement.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Client } from 'pg'
import {

  validateTimeAuthority,
  calculateClockDrift,
  classifyDriftSeverity,
  extractClientTimestamp,
  validateClientTime,
  formatDrift,
  getServerTime,
  getUserClockDriftHistory,
  getCriticalDriftEvents,
  shouldBlockAttendanceAction,
  TimeAuthorityContext,
  DriftCalculation,
} from '../../src/services/timeAuthorityService.js'
// The drift log's user_id is a uuid column; these were string literals, so
// every test that recorded a drift event threw and was caught by the
// service's own error handling. Fixed values, so a failure names the same
// account each run.
const USER_123 = 'b51cd8ea-2a7b-5f08-b22f-b32cd3e80322'
const USER_456 = 'c7842578-9d70-57ee-9287-b1097706a525'
const USER_789 = '40464d86-9562-5f9a-8d59-743bd4f1edab'
const USER_AHEAD = '2720560b-c47f-5756-9e11-cbd842b95567'
const USER_BEHIND = 'e0da2484-4e4b-59b5-b905-61151aec0e36'
const USER_CRITICAL = 'ca9cf2a2-3fdf-5f56-b6e0-bc51a4cfe423'

const CRITICAL_USER = '3141d932-5e98-580e-9d7c-d671b9897452'
const DEVICE_TRACKING_USER = '7c559e61-dd37-5df8-8f0c-79b44c241ed7'
const FORENSIC_USER = '7eaa01e5-5adc-5d19-aa20-718cefb91366'
const HISTORY_TEST_USER = '0f32e398-093e-5d5d-996a-15ddf728032d'
const TEST_USER_IDS = [
  USER_123, USER_456, USER_789, USER_AHEAD, USER_BEHIND, USER_CRITICAL,
  CRITICAL_USER, DEVICE_TRACKING_USER, FORENSIC_USER, HISTORY_TEST_USER,
]


describe('Time Authority Service', () => {
  let db: Client
  let platformName: string

  beforeEach(async () => {
    // new Client() with no arguments connects to localhost:5432 with the OS
    // user, ignoring DATABASE_URL entirely — so this suite has only ever
    // worked on a machine that happened to have a default Postgres there.
    db = new Client({ connectionString: process.env.DATABASE_URL })
    await db.connect()

    // drift_audit_log.user_id is a foreign key. Without real accounts behind
    // these ids, every logged drift event violated it and the service's own
    // catch swallowed the error — so the tests saw a null result and no
    // explanation.
    platformName = `tas-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
    const platform = await db.query(
      `INSERT INTO platforms (name, display_name) VALUES ($1, $1) RETURNING id`,
      [platformName]
    )
    const role = await db.query(
      `INSERT INTO roles (platform_id, name, permissions) VALUES ($1, 'user', '["read"]'::jsonb)
       RETURNING id`,
      [platform.rows[0].id]
    )
    for (const id of TEST_USER_IDS) {
      await db.query(
        // $1 cannot be both a uuid and a text operand in one statement;
        // Postgres refuses to deduce a single type for it (42P08).
        `INSERT INTO users (id, platform_id, email, full_name, role_id, password_hash, is_active)
         VALUES ($1, $2, $4, 'Drift Test', $3, 'x', TRUE)
         ON CONFLICT (id) DO NOTHING`,
        [id, platform.rows[0].id, role.rows[0].id, `${id}@ut.test`]
      )
    }
  })

  afterEach(async () => {
    // Leaves nothing behind: the next run starts from the same place.
    await db.query(`DELETE FROM drift_audit_log WHERE user_id = ANY($1::uuid[])`,
      [TEST_USER_IDS]).catch(() => undefined)
    await db.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`,
      [TEST_USER_IDS]).catch(() => undefined)
    await db.query(
      `DELETE FROM roles WHERE platform_id IN (SELECT id FROM platforms WHERE name = $1)`,
      [platformName]
    ).catch(() => undefined)
    await db.query(`DELETE FROM platforms WHERE name = $1`, [platformName])
      .catch(() => undefined)
    await db.end()
  })

  // ===========================
  // DRIFT CALCULATION TESTS
  // ===========================

  describe('Drift Calculation', () => {
    it('should calculate positive drift (client ahead)', () => {
      const server = new Date('2024-01-01T12:00:00Z')
      const client = new Date('2024-01-01T12:00:10Z') // 10 seconds ahead

      const drift = calculateClockDrift(client, server)
      expect(drift).toBe(10)
    })

    it('should calculate negative drift (client behind)', () => {
      const server = new Date('2024-01-01T12:00:00Z')
      const client = new Date('2024-01-01T11:59:50Z') // 10 seconds behind

      const drift = calculateClockDrift(client, server)
      expect(drift).toBe(-10)
    })

    it('should return zero drift when times match', () => {
      const time = new Date('2024-01-01T12:00:00Z')
      const drift = calculateClockDrift(time, time)
      expect(drift).toBe(0)
    })

    it('should handle large drift values', () => {
      const server = new Date('2024-01-01T00:00:00Z')
      const client = new Date('2024-01-02T00:00:00Z') // 24 hours ahead

      const drift = calculateClockDrift(client, server)
      expect(drift).toBe(86400) // 86400 seconds in 24 hours
    })
  })

  // ===========================
  // DRIFT CLASSIFICATION TESTS
  // ===========================

  describe('Drift Classification (Legacy)', () => {
    it('should classify normal drift as INFO', () => {
      expect(classifyDriftSeverity(0)).toBe('INFO')
      expect(classifyDriftSeverity(3)).toBe('INFO')
      expect(classifyDriftSeverity(-5)).toBe('INFO')
    })

    it('should classify suspicious drift as WARNING', () => {
      expect(classifyDriftSeverity(10)).toBe('WARNING')
      expect(classifyDriftSeverity(-30)).toBe('WARNING')
      expect(classifyDriftSeverity(60)).toBe('WARNING')
    })

    it('should classify significant drift as CRITICAL', () => {
      expect(classifyDriftSeverity(61)).toBe('CRITICAL')
      expect(classifyDriftSeverity(-300)).toBe('CRITICAL')
      expect(classifyDriftSeverity(3600)).toBe('CRITICAL')
    })
  })

  // ===========================
  // VALIDATION TESTS
  // ===========================

  describe('Client Time Validation', () => {
    it('should validate acceptable client time', () => {
      const serverTime = getServerTime()
      const clientTime = new Date(serverTime.getTime() + 3000) // 3 seconds ahead

      const result = validateClientTime(clientTime)
      expect(result.isValid).toBe(true)
      expect(Math.abs(result.drift)).toBe(3)
    })

    it('should reject unacceptable client time', () => {
      const serverTime = getServerTime()
      const clientTime = new Date(serverTime.getTime() + 400000) // 400 seconds ahead

      const result = validateClientTime(clientTime, 300) // 5 minute threshold
      expect(result.isValid).toBe(false)
      expect(result.drift > 300).toBe(true)
    })

    it('should respect custom threshold', () => {
      const serverTime = getServerTime()
      const clientTime = new Date(serverTime.getTime() + 150000) // 150 seconds

      const result = validateClientTime(clientTime, 60) // 1 minute threshold
      expect(result.isValid).toBe(false)
      expect(result.drift).toBe(150)
    })
  })

  // ===========================
  // FORMATTING TESTS
  // ===========================

  describe('Drift Formatting', () => {
    it('should format small drift correctly', () => {
      expect(formatDrift(5)).toBe('5s ahead')
      expect(formatDrift(-3)).toBe('3s behind')
    })

    it('should format minute-scale drift correctly', () => {
      expect(formatDrift(120)).toBe('2m ahead')
      expect(formatDrift(-300)).toBe('5m behind')
    })

    it('should format hour-scale drift correctly', () => {
      expect(formatDrift(7200)).toBe('2h ahead')
      expect(formatDrift(-3600)).toBe('1h behind')
    })
  })

  // ===========================
  // ATTENDANCE ACTION TESTS
  // ===========================

  describe('Attendance Action Enforcement', () => {
    it('should not block small drift for attendance', () => {
      const result = shouldBlockAttendanceAction(30, 'ATTENDANCE_MARK')
      expect(result.shouldBlock).toBe(false)
    })

    it('should block large drift for attendance', () => {
      const result = shouldBlockAttendanceAction(400, 'ATTENDANCE_MARK')
      expect(result.shouldBlock).toBe(true)
      expect(result.reason).toContain('exceeds threshold')
    })

    it('should not block large drift for non-attendance actions', () => {
      const result = shouldBlockAttendanceAction(400, 'OTHER_ACTION')
      expect(result.shouldBlock).toBe(false)
    })

    it('should use correct threshold (5 minutes)', () => {
      const result305 = shouldBlockAttendanceAction(305, 'ATTENDANCE_MARK')
      const result299 = shouldBlockAttendanceAction(299, 'ATTENDANCE_MARK')

      expect(result305.shouldBlock).toBe(true)
      expect(result299.shouldBlock).toBe(false)
    })
  })

  // ===========================
  // TIME AUTHORITY VALIDATION TESTS (FULL FLOW)
  // ===========================

  describe('Full Time Authority Validation', () => {
    it('should handle ACCEPTABLE drift', async () => {
      const serverTime = getServerTime()
      const clientTime = new Date(serverTime.getTime() + 3000)

      const context: TimeAuthorityContext = {
        clientTime,
        serverTime,
        deviceInfo: {
          device_id: 'test-device-001',
          device_model: 'iPhone 13',
          platform: 'MOBILE_IOS',
        },
        userId: USER_123,
        actionType: 'ATTENDANCE_MARK',
      }

      const result = await validateTimeAuthority(context)

      expect(result.drift.category).toBe('ACCEPTABLE')
      expect(result.drift.actionTaken).toBe('PROCEED_SILENT')
      expect(result.shouldProceed).toBe(true)
      expect(result.logId).toBeDefined()
    })

    it('should handle WARNING drift', async () => {
      const serverTime = getServerTime()
      const clientTime = new Date(serverTime.getTime() + 150000) // 150 seconds

      const context: TimeAuthorityContext = {
        clientTime,
        serverTime,
        deviceInfo: {
          device_id: 'test-device-002',
          platform: 'MOBILE_ANDROID',
        },
        userId: USER_456,
        actionType: 'ATTENDANCE_MARK',
      }

      const result = await validateTimeAuthority(context)

      expect(result.drift.category).toBe('WARNING')
      expect(result.drift.actionTaken).toBe('PROCEED_WITH_WARNING')
      expect(result.shouldProceed).toBe(true)
      expect(result.incidentId).toBeDefined()
    })

    it('should handle BLOCKED drift', async () => {
      const serverTime = getServerTime()
      const clientTime = new Date(serverTime.getTime() + 450_000) // 450s: BLOCKED band (300-600s)

      const context: TimeAuthorityContext = {
        clientTime,
        serverTime,
        deviceInfo: {
          device_id: 'test-device-003',
          platform: 'WEB_BROWSER',
        },
        userId: USER_789,
        actionType: 'ATTENDANCE_MARK',
      }

      const result = await validateTimeAuthority(context)

      expect(result.drift.category).toBe('BLOCKED')
      expect(result.drift.actionTaken).toBe('BLOCKED')
      expect(result.shouldProceed).toBe(false)
      expect(result.incidentId).toBeDefined()
    })

    it('should handle CRITICAL drift', async () => {
      const serverTime = getServerTime()
      const clientTime = new Date(serverTime.getTime() + 5_000_000) // 5000s: CRITICAL band (>600s)

      const context: TimeAuthorityContext = {
        clientTime,
        serverTime,
        deviceInfo: {
          device_id: 'test-device-critical',
          platform: 'KIOSK_DEVICE',
        },
        userId: USER_CRITICAL,
        actionType: 'ATTENDANCE_MARK',
      }

      const result = await validateTimeAuthority(context)

      expect(result.drift.category).toBe('CRITICAL')
      expect(result.drift.actionTaken).toBe('ESCALATED')
      expect(result.shouldProceed).toBe(false)
      expect(result.incidentId).toBeDefined()
      expect(result.drift.incidentSeverity).toBe('CRITICAL')
    })

    it('should detect direction correctly', async () => {
      const serverTime = getServerTime()
      const aheadClient = new Date(serverTime.getTime() + 20000)
      const behindClient = new Date(serverTime.getTime() - 20000)

      const aheadResult = await validateTimeAuthority({
        clientTime: aheadClient,
        serverTime,
        deviceInfo: { device_id: 'dev-ahead', platform: 'WEB_BROWSER' },
        userId: USER_AHEAD,
        actionType: 'TEST',
      })

      const behindResult = await validateTimeAuthority({
        clientTime: behindClient,
        serverTime,
        deviceInfo: { device_id: 'dev-behind', platform: 'WEB_BROWSER' },
        userId: USER_BEHIND,
        actionType: 'TEST',
      })

      expect(aheadResult.drift.direction).toBe('AHEAD')
      expect(behindResult.drift.direction).toBe('BEHIND')
    })
  })

  // ===========================
  // DATABASE IMMUTABILITY TESTS
  // ===========================

  describe('Drift Audit Log Immutability', () => {
    it('should prevent UPDATE on drift_audit_log', async () => {
      const result = await db.query(
        `SELECT id FROM drift_audit_log ORDER BY created_at DESC LIMIT 1`
      )

      if (result.rows.length === 0) {
        console.log('No drift records to test immutability')
        return
      }

      const recordId = result.rows[0].id

      try {
        await db.query(`UPDATE drift_audit_log SET is_immutable = FALSE WHERE id = $1`, [
          recordId,
        ])
        throw new Error('UPDATE should have failed due to trigger')
      } catch (error: any) {
        expect(error.message).toContain('immutable')
      }
    })

    it('should prevent DELETE on drift_audit_log', async () => {
      const result = await db.query(
        `SELECT id FROM drift_audit_log ORDER BY created_at DESC LIMIT 1`
      )

      if (result.rows.length === 0) {
        console.log('No drift records to test immutability')
        return
      }

      const recordId = result.rows[0].id

      try {
        await db.query(`DELETE FROM drift_audit_log WHERE id = $1`, [recordId])
        throw new Error('DELETE should have failed due to trigger')
      } catch (error: any) {
        expect(error.message).toContain('immutable')
      }
    })
  })

  // ===========================
  // FORENSIC INDICATOR TESTS
  // ===========================

  describe('Forensic Indicators', () => {
    it('should flag extreme drift', async () => {
      const serverTime = getServerTime()
      const clientTime = new Date(serverTime.getTime() + 5000000) // >1 hour

      const context: TimeAuthorityContext = {
        clientTime,
        serverTime,
        deviceInfo: { device_id: 'forensic-test', platform: 'MOBILE_IOS' },
        userId: FORENSIC_USER,
        actionType: 'ATTENDANCE',
      }

      const result = await validateTimeAuthority(context)

      expect(result.drift.category).toBe('CRITICAL')
      // Forensic flags should be populated
      expect(result.logId).toBeDefined()
    })
  })

  // ===========================
  // DEVICE INFO TRACKING TESTS
  // ===========================

  describe('Device Information Tracking', () => {
    it('should log all device info', async () => {
      const serverTime = getServerTime()
      const clientTime = new Date(serverTime.getTime() + 1000)

      const context: TimeAuthorityContext = {
        clientTime,
        serverTime,
        deviceInfo: {
          device_id: 'precise-device-id',
          device_model: 'Samsung Galaxy S21',
          app_version: '2.1.0',
          os_version: '12.0',
          platform: 'MOBILE_ANDROID',
        },
        userId: DEVICE_TRACKING_USER,
        actionType: 'ATTENDANCE_MARK',
        ipAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0...',
        networkType: '5g',
      }

      const result = await validateTimeAuthority(context)

      // Verify record was logged with all info
      expect(result.logId).toBeDefined()

      // Query back to verify
      const logRecord = await db.query(
        `SELECT * FROM drift_audit_log WHERE id = $1`,
        [result.logId]
      )

      expect(logRecord.rows[0].device_model).toBe('Samsung Galaxy S21')
      expect(logRecord.rows[0].app_version).toBe('2.1.0')
      expect(logRecord.rows[0].network_type).toBe('5g')
    })
  })

  // ===========================
  // HISTORICAL QUERIES TESTS
  // ===========================

  describe('Historical Queries', () => {
    it('should retrieve user drift history', async () => {
      const userId = HISTORY_TEST_USER

      // Log a few drift events
      for (let i = 0; i < 3; i++) {
        const serverTime = getServerTime()
        const clientTime = new Date(serverTime.getTime() + 5000 * i)

        await validateTimeAuthority({
          clientTime,
          serverTime,
          deviceInfo: { device_id: `history-dev-${i}`, platform: 'WEB_BROWSER' },
          userId,
          actionType: 'ATTENDANCE_MARK',
        })
      }

      const history = await getUserClockDriftHistory(userId, 10)
      expect(history.length).toBeGreaterThanOrEqual(3)
      expect(history[0].user_id).toBe(userId)
    })

    it('should retrieve critical drift events', async () => {
      const serverTime = getServerTime()
      const criticalTime = new Date(serverTime.getTime() + 10000000) // Way ahead

      await validateTimeAuthority({
        clientTime: criticalTime,
        serverTime,
        deviceInfo: { device_id: 'critical-device', platform: 'MOBILE_IOS' },
        userId: CRITICAL_USER,
        actionType: 'CRITICAL_TEST',
      })

      const criticalEvents = await getCriticalDriftEvents(100)
      expect(criticalEvents.some(e => e.drift_category === 'CRITICAL')).toBe(true)
    })
  })

  // ===========================
  // STATISTICS AGGREGATION TESTS
  // ===========================

  describe('Statistics Aggregation', () => {
    it('should calculate drift statistics correctly', async () => {
      // Note: This test will work on existing data in the database
      // In a real test, you'd create specific test data

      const result = await db.query(
        `SELECT 
          COUNT(*)::int as total_events,
          -- AVG and MAX over numeric come back as strings for the same
          -- reason COUNT does; cast so the comparisons below are numeric
          -- rather than lexicographic.
          COALESCE(AVG(ABS(drift_seconds)), 0)::float8 as avg_drift,
          COALESCE(MAX(ABS(drift_seconds)), 0)::float8 as max_drift
         FROM drift_audit_log
         LIMIT 1`
      )

      if (result.rows[0].total_events > 0) {
        expect(result.rows[0].avg_drift).toBeGreaterThanOrEqual(0)
        expect(result.rows[0].max_drift).toBeGreaterThanOrEqual(result.rows[0].avg_drift)
      }
    })
  })
})
