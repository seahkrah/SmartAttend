#!/usr/bin/env node
/**
 * Migration filenames: NNN[a-z]_snake_case.sql, every prefix used once, no
 * superseded *_OLD.sql files. A repeated prefix let the rest of the filename
 * decide the order the schema was built in (see migrationLedger.ts).
 */
import fs from 'node:fs'
import path from 'node:path'

const dir = path.resolve(import.meta.dirname, '..', '..', 'apps', 'backend', 'src', 'db', 'migrations')
const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql'))
const problems = []
const byPrefix = new Map()

for (const f of files) {
  if (f.endsWith('_OLD.sql')) {
    problems.push(`${f}: superseded migration; delete it`)
    continue
  }
  const m = /^(\d{3}[a-z]?)_[a-z0-9_]+\.sql$/.exec(f)
  if (!m) {
    problems.push(`${f}: name must match NNN[a-z]_snake_case.sql`)
    continue
  }
  byPrefix.set(m[1], [...(byPrefix.get(m[1]) || []), f])
}
for (const [prefix, names] of byPrefix) {
  if (names.length > 1) problems.push(`prefix ${prefix} used by ${names.join(', ')}`)
}

if (problems.length) {
  console.error('migration-lint:')
  for (const p of problems) console.error(`  ${p}`)
  process.exit(1)
}
console.log(`migration-lint: ok (${files.length} migrations)`)
