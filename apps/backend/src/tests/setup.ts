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
