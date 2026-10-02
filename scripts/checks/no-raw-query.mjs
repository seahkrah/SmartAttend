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
 *   2. No SQL calls set_config(...), or SET/RESET [SESSION|LOCAL] app.*,
 *      outside the pool: the tenant setting belongs to the pool alone.
 *   3. runAsSystem (the RLS-exempt system pool) is called only from the
 *      files below, each with a reason string at the call.
 *   4. withTenant (binding to any tenant id it is given) is called only
 *      where the id was resolved from identity: the tenant middleware.
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
  // Identity (migration 074): accounts span tenants and are read before any
  // tenant is known; the runtime role cannot read password hashes.
  'apps/backend/src/auth/authService.ts', // sign-in, registration, password checks
  'apps/backend/src/auth/sessions.ts', // sessions are checked before the tenant is resolved
  'apps/backend/src/auth/mfaService.ts', // two-factor state, read during sign-in
  'apps/backend/src/auth/accountTokens.ts', // reset and activation links before sign-in
  'apps/backend/src/auth/stepUp.ts', // when the session last proved who it is
  'apps/backend/src/auth/passkeys.ts', // passkey challenges and sign-in before anyone is known
  'apps/backend/src/security/rateLimitStore.ts', // rate-limit counters shared across replicas, not tenant data
  'apps/backend/src/routes/mfa.ts', // the code step of sign-in and the caller's own settings
  // Platform-level records (migration 075).
  'apps/backend/src/services/incidentService.ts', // errors become platform incidents, whatever the tenant
  'apps/backend/src/routes/accessRequests.ts', // enquiries before any tenant exists; superadmin reads
  'apps/backend/src/routes/incidents.ts', // a superadmin with no tenant reviews platform-wide
  'apps/backend/src/routes/incidentAdminRoutes.ts', // superadmin-only incident administration
  'apps/backend/src/routes/validation.ts', // superadmin incident export and replay
  'apps/backend/src/routes/time.ts', // superadmin clock-drift review across tenants
  'apps/backend/src/routes/superadmin.ts', // the control plane administers tenants
  'apps/backend/src/notifications/service.ts', // the dispatcher sweeps every outbox
  'apps/backend/src/services/metricsService.ts', // retention prunes every tenant
  'apps/backend/setup-superadmin.ts', // bootstrap, before any tenant exists
])
// Tests anywhere: setting up and comparing across tenants is their job.
const SYSTEM_ALLOWED_PREFIX = f =>
  under(f, 'apps/backend/src/scripts/', 'apps/backend/src/tests/', 'apps/backend/test/') || f.endsWith('.test.ts')

const WITH_TENANT_ALLOWED = new Set([
  'apps/backend/src/auth/tenantContextMiddleware.ts', // the tenant comes from membership or break-glass
  'apps/backend/src/db/dbContext.ts',
])

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
      // Any set_config, whatever the name argument: `set_config($1, …)` with a
      // name from elsewhere is the same hole as a literal 'app.tenant_id'.
      if (/\bset_config\s*\(|\b(SET|RESET)\s+(SESSION\s+|LOCAL\s+)?app\./i.test(line))
        problems.push(`${at}: sets a session setting itself; the pool owns the tenant context`)
    }
    if (/\bwithTenant\s*\(/.test(line) && !/^\s*export function withTenant/.test(line)) {
      if (!WITH_TENANT_ALLOWED.has(f) && !SYSTEM_ALLOWED_PREFIX(f))
        problems.push(`${at}: withTenant binds to any tenant id; only the tenant middleware resolves one from identity`)
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
