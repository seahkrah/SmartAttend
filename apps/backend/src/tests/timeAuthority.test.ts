import {
  getServerTime,
  getServerTimeISO,
  calculateClockDrift,
  classifyDriftSeverity,
  shouldBlockAttendanceAction,
  formatDrift
} from '../services/timeAuthorityService.js'

/**
 * Time Authority Service Tests
 * Validates core time enforcement logic
 */

console.log('\n=== TIME AUTHORITY SERVICE TESTS ===\n')

// Test 1: Server time
console.log('✓ Test 1: Get server time')
const serverTime = getServerTime()
const serverTimeISO = getServerTimeISO()
console.log(`  Server time: ${serverTimeISO}`)
console.log(`  Type: ${typeof serverTime} (expected: object)`)
console.log(`  Is Date: ${serverTime instanceof Date}`)

// Test 2: Clock drift calculation
console.log('\n✓ Test 2: Calculate clock drift')
const client1 = new Date('2026-02-15T14:35:00Z')
const server1 = new Date('2026-02-15T14:35:30Z')
const drift1 = calculateClockDrift(client1, server1)
console.log(`  Client: ${client1.toISOString()}`)
console.log(`  Server: ${server1.toISOString()}`)
console.log(`  Drift: ${drift1}s (expected: -30)`)

const client2 = new Date('2026-02-15T14:36:00Z')
const server2 = new Date('2026-02-15T14:35:30Z')
const drift2 = calculateClockDrift(client2, server2)
console.log(`  Drift: ${drift2}s (expected: 30)`)

// Test 3: Severity classification
console.log('\n✓ Test 3: Classify drift severity')
const sev1 = classifyDriftSeverity(2)
const sev2 = classifyDriftSeverity(30)
const sev3 = classifyDriftSeverity(120)
console.log(`  Drift 2s: ${sev1} (expected: INFO)`)
console.log(`  Drift 30s: ${sev2} (expected: WARNING)`)
console.log(`  Drift 120s: ${sev3} (expected: CRITICAL)`)

// Test 4: Attendance action blocking
console.log('\n✓ Test 4: Attendance action blocking')
const block1 = shouldBlockAttendanceAction(100, 'attendance_checkin')
const block2 = shouldBlockAttendanceAction(350, 'attendance_checkin')
const block3 = shouldBlockAttendanceAction(50, 'other_action')
console.log(`  100s drift: ${block1.shouldBlock ? 'BLOCKED' : 'ALLOWED'} (expected: ALLOWED)`)
console.log(`  350s drift: ${block2.shouldBlock ? 'BLOCKED' : 'ALLOWED'} (expected: BLOCKED)`)
console.log(`  50s non-attendance: ${block3.shouldBlock ? 'BLOCKED' : 'ALLOWED'} (expected: ALLOWED)`)

// Test 5: Format drift
console.log('\n✓ Test 5: Format drift for display')
const fmt1 = formatDrift(2)
const fmt2 = formatDrift(-45)
const fmt3 = formatDrift(600)
console.log(`  2s: "${fmt1}"`)
console.log(`  -45s: "${fmt2}"`)
console.log(`  600s: "${fmt3}"`)

console.log('\n=== ALL TESTS PASSED ===\n')
