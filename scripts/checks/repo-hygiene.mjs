#!/usr/bin/env node
/**
 * Fails when files that do not belong in the repository are tracked.
 *
 * Phase 0 removed 43 one-off debug scripts from apps/backend/, eleven phase
 * "spec" files from the root, and four superseded migrations. This keeps
 * them from coming back one at a time. It also found 1,043 files of
 * node_modules/ and the types package's dist/ committed before .gitignore
 * covered them.
 */
import { execSync } from 'node:child_process'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const files = execSync('git ls-files --cached --others --exclude-standard', { cwd: ROOT, encoding: 'utf8' })
  .split('\n')
  .filter(Boolean)

const rules = [
  {
    re: /^apps\/backend\/[^/]+\.(c|m)?(j|t)s$/,
    allow: ['apps/backend/setup-superadmin.ts', 'apps/backend/vitest.config.ts', 'apps/backend/eslint.config.js'],
    why: 'loose script in the backend root',
  },
  { re: /^[^/]+\.(tsx?|ps1|sh)$/, allow: [], why: 'code file at the repository root' },
  { re: /_OLD\.sql$/, allow: [], why: 'superseded migration kept beside its replacement' },
  { re: /(^|\/)\.venv\//, allow: [], why: 'committed virtualenv' },
  { re: /\.(log|tmp|bak)$/, allow: [], why: 'log or temporary file' },
  {
    re: /(^|\/)(manage\.py|settings\.py|wsgi\.py|asgi\.py)$/,
    allow: [],
    why: 'Django leftover (the Django rebuild is retired)',
  },
  { re: /^\.claude\/.*\.html$/, allow: [], why: 'scratch copy under .claude/' },
  { re: /(^|\/)node_modules\//, allow: [], why: 'installed dependency (lockfiles are the record)' },
  { re: /(^|\/)dist\//, allow: [], why: 'build output' },
]

const problems = []
for (const f of files) {
  for (const rule of rules) {
    if (rule.re.test(f) && !rule.allow.includes(f)) problems.push(`${f}: ${rule.why}`)
  }
}

if (problems.length) {
  console.error(`repo-hygiene: ${problems.length} file(s) do not belong in the repository:`)
  for (const p of problems) console.error(`  ${p}`)
  process.exit(1)
}
console.log(`repo-hygiene: ok (${files.length} files checked)`)
