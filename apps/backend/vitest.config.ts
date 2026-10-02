import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    root: process.cwd(),
    // `include`, not Jest's `testMatch`, which Vitest ignores: with it, the
    // default pattern also picked up stale compiled tests in dist/ and
    // reported dozens of failures in code that no longer exists.
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    exclude: ['dist/**', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/tests/**', 'dist/**'],
      // A floor, raised as tests are added; never lowered. It was "80" before,
      // at a level of the config Vitest ignores and with no coverage provider
      // installed, so nothing was ever enforced. Measured 2026-10-01: lines
      // 4.11%. 2026-10-02, with the tenancy, storage and KMS tests: lines
      // 5.52%, statements 5.55%, functions 8.43%, branches 5.06%. That is
      // unit tests only: the e2e suites exercise the API from outside the
      // process and are not counted here.
      thresholds: {
        lines: 5.5,
        statements: 5.5,
        functions: 8,
        branches: 5,
      },
    },
    setupFiles: ['./src/tests/setup.ts'],
    // Unit tests run as DATABASE_URL's role (the owner). Several read tenant
    // tables with no tenant in context on purpose; as the runtime role, row-
    // level security would show them nothing. RLS itself is tested as the
    // runtime role by the rlsNoContext and blindWrite suites.
    env: { APP_DATABASE_URL: '' },
    testTimeout: 30000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
})
