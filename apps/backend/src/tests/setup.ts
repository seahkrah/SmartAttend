/**
 * Test Setup File
 * Runs before all tests
 */

import { config } from 'dotenv'
import path from 'path'

// Load environment variables
config({ path: path.resolve(__dirname, '../../.env') })

// Verify database connection is available
if (!process.env.DATABASE_URL) {
  console.warn('⚠️  DATABASE_URL not set - database tests will fail')
}

// Several unit tests write fixtures, briefly disable audit triggers and
// delete what they wrote. Run against a developer's own database (which is
// what .env names) they leave rows behind there. So they refuse any database
// whose name does not say it is for tests: jjelotech_ci, jjelotech_score,
// anything ending _test. UNIT_TEST_DATABASE_OK=1 overrides, deliberately.
{
  let name = ''
  try {
    name = new URL(process.env.DATABASE_URL ?? '').pathname.replace(/^\//, '')
  } catch {
    // Not a URL: nothing to connect to, and the tests that need it will say so.
  }
  if (name && !/(^|_)(ci|score|test)$/.test(name) && process.env.UNIT_TEST_DATABASE_OK !== '1') {
    throw new Error(
      `Unit tests refuse the database "${name}": they write and delete fixtures. ` +
      'Point DATABASE_URL at a test database (name ending _ci, _score or _test), or set UNIT_TEST_DATABASE_OK=1.'
    )
  }
}

// Setup test database connection pool
beforeAll(async () => {
  console.log('🧪 Test environment initialized')
})

// Cleanup after all tests
afterAll(async () => {
  console.log('✅ Tests completed')
})

// Global test helpers
global.testRetry = 3
