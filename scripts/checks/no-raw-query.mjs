#!/usr/bin/env node
/**
 * The tenant-bound pool in apps/backend/src/db/connection.ts is the only way
 * application code reaches the database. Every connection it hands out
 * carries the caller's tenant for row-level security
 * (docs/decisions/2026-10-02-adopt-rls.md). This check keeps it the only way:
 *
 *   1. No `pg` Pool or Client is constructed outside src/db/ (type-only
 *      imports of pg are fine). Maintenance scripts and tests that need
 *      their own connection are allow-listed.
 *   2. No SQL sets or resets app.tenant_id / app.user_id outside the pool.
 *   3. runAsSystem (the RLS-exempt system pool) is called only from the
 *      files below, each with a reason string at the call.
 */
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const files = execSync('git ls-files --cached --others --exclude-standard apps/backend', {
  cwd: ROOT,
  encoding: 'utf8',
})
  .split('\n')
  .filter(f => /\.(ts|mjs|js|cjs)$/.test(f) && !f.includes('node_modules/') && !f.includes('/dist/'))

const under = (f, ...prefixes) => prefixes.some(p => f.startsWith(p))

// Own connections: the database layer itself, maintenance scripts, and tests
// that must compare what the owner sees with what the runtime role sees.
const OWN_CONNECTION_ALLOWED = f =>
  under(
    f,
    'apps/backend/src/db/',
    'apps/backend/src/scripts/',
    'apps/backend/src/tests/',
    'apps/backend/test/',
    'apps/backend/scripts/',
  )

// Cross-tenant work. Adding a file here is a security decision: say why in
// the commit, and give every call a reason.
const SYSTEM_ALLOWED = new Set([
  'apps/backend/src/db/migrate.ts', // schema migrations run as the owner
  'apps/backend/src/auth/tenantContextMiddleware.ts', // memberships decide the tenant
  'apps/backend/src/routes/auth.ts', // password reset happens before sign-in
  'apps/backend/src/routes/superadmin.ts', // the control plane administers tenants
  'apps/backend/src/notifications/service.ts', // the dispatcher sweeps every outbox
  'apps/backend/src/services/metricsService.ts', // retention prunes every tenant
  'apps/backend/setup-superadmin.ts', // bootstrap, before any tenant exists
])
const SYSTEM_ALLOWED_PREFIX = f =>
  under(f, 'apps/backend/src/scripts/', 'apps/backend/src/tests/', 'apps/backend/test/')

const problems = []
for (const f of files) {
  const text = fs.readFileSync(path.join(ROOT, f), 'utf8')
  const lines = text.split('\n')
  lines.forEach((line, i) => {
    const at = `${f}:${i + 1}`
    if (/^\s*(\/\/|\*)/.test(line)) return // comments
    if (!OWN_CONNECTION_ALLOWED(f)) {
      if (/\bnew\s+(pg\.)?(Pool|Client)\s*\(/.test(line))
        problems.push(`${at}: constructs its own pg connection; use query()/getConnection() from db/connection`)
      if (/^\s*import\s+(?!type\b)[^;]*\bfrom\s+['"]pg['"]/.test(line) || /require\(['"]pg['"]\)/.test(line))
        problems.push(`${at}: imports pg for values; only \`import type\` is allowed outside src/db`)
    }
    if (f !== 'apps/backend/src/db/connection.ts' && !under(f, 'apps/backend/src/tests/')) {
      if (/set_config\(\s*'app\.|\b(SET|RESET)\s+(LOCAL\s+)?app\./i.test(line))
        problems.push(`${at}: sets app.* itself; the pool owns the tenant context`)
    }
    if (/\brunAsSystem\s*\(/.test(line) && !/^\s*export function runAsSystem/.test(line)) {
      if (f !== 'apps/backend/src/db/dbContext.ts' && !SYSTEM_ALLOWED.has(f) && !SYSTEM_ALLOWED_PREFIX(f))
        problems.push(`${at}: runAsSystem outside the allow-list in scripts/checks/no-raw-query.mjs`)
    }
  })
}

if (problems.length) {
  console.error(`no-raw-query: ${problems.length} problem(s):`)
  for (const p of problems) console.error(`  ${p}`)
  process.exit(1)
}
console.log(`no-raw-query: ok (${files.length} files; ${SYSTEM_ALLOWED.size} files may use the system pool)`)
