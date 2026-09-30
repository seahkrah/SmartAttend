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
      lines: 80,
      functions: 80,
      branches: 75,
      statements: 80,
    },
    setupFiles: ['./src/tests/setup.ts'],
    testTimeout: 30000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
})
