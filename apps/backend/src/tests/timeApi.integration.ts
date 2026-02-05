/**
 * TIME API INTEGRATION TESTS
 * Tests the /api/time routes for correct behavior
 */

// Using native fetch available in Node.js 18+

const BASE_URL = 'http://localhost:3000'
const TEST_TOKEN = 'test-token' // Will need real token for auth tests

console.log('\n=== TIME API INTEGRATION TESTS ===\n')

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn()
    console.log(`✓ ${name}`)
  } catch (error) {
    console.error(`✗ ${name}`)
    console.error(`  Error: ${(error as Error).message}`)
  }
}

async function runTests() {
  // Test 1: GET /api/time/sync (public)
  await test('GET /api/time/sync returns 200', async () => {
    const res = await fetch(`${BASE_URL}/api/time/sync`)
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`)
    const data = (await res.json()) as any
    if (!data.timestamp) throw new Error('Missing timestamp')
    if (!data.iso) throw new Error('Missing iso')
    if (!data.unix) throw new Error('Missing unix')
  })

  // Test 2: GET /api/time/sync/precise (public)
  await test('GET /api/time/sync/precise returns 200', async () => {
    const res = await fetch(`${BASE_URL}/api/time/sync/precise`)
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`)
    const data = (await res.json()) as any
    if (!data.requestTime) throw new Error('Missing requestTime')
    if (!data.responseTime) throw new Error('Missing responseTime')
    if (!data.estimatedLatencyMs) throw new Error('Missing estimatedLatencyMs')
  })

  // Test 3: GET /api/time/validate (public)
  await test('GET /api/time/validate validates current time', async () => {
    const now = new Date().toISOString()
    const res = await fetch(`${BASE_URL}/api/time/validate?clientTimestamp=${now}`)
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`)
    const data = (await res.json()) as any
    if (data.isValid !== true) throw new Error('Expected valid=true for current time')
  })

  // Test 4: GET /api/time/validate rejects old time
  await test('GET /api/time/validate rejects old time', async () => {
    const old = new Date('2026-01-01T00:00:00Z').toISOString()
    const res = await fetch(`${BASE_URL}/api/time/validate?clientTimestamp=${old}`)
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`)
    const data = (await res.json()) as any
    if (data.isValid !== false) throw new Error('Expected valid=false for old time')
  })

  // Test 5: POST /api/attendance/checkin without X-Client-Timestamp (should allow)
  await test('POST /api/attendance/checkin allows valid time', async () => {
    const now = new Date().toISOString()
    const res = await fetch(`${BASE_URL}/api/attendance/checkin`, {
      method: 'POST',
      headers: {
        'X-Client-Timestamp': now,
        'Authorization': `Bearer ${TEST_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ locationId: 'loc-123' })
    })
    // Should get 200 or 401 (auth error), not 409
    if (res.status === 409) throw new Error('Should not block valid time')
  })

  // Test 6: POST /api/attendance/checkin with excessive drift (should block)
  await test('POST /api/attendance/checkin blocks excessive drift', async () => {
    const old = new Date('2026-01-01T00:00:00Z').toISOString()
    const res = await fetch(`${BASE_URL}/api/attendance/checkin`, {
      method: 'POST',
      headers: {
        'X-Client-Timestamp': old,
        'Authorization': `Bearer ${TEST_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ locationId: 'loc-123' })
    })
    // Should get 409 Conflict
    if (res.status !== 409) throw new Error(`Expected 409, got ${res.status}`)
    const data = (await res.json()) as any
    if (data.error !== 'CLOCK_DRIFT_VIOLATION') throw new Error('Wrong error type')
  })

  console.log('\n=== TESTS COMPLETE ===\n')
}

// Run tests if server is available
runTests().catch((error) => {
  console.error('Tests failed:', error)
  process.exit(1)
})
