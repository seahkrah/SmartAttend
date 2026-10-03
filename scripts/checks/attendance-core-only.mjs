#!/usr/bin/env node
/**
 * One attendance core for both platforms (brief 5.1, rubric gate
 * `unified-core`): only apps/backend/src/attendance/ writes attendance.
 *
 * Fails if any other application file INSERTs into, UPDATEs or DELETEs from
 * school_attendance, corporate_checkins or attendance_events. Migrations,
 * seeds, tests and scripts are excluded: they shape or fill the schema, they
 * do not record attendance.
 */
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const TABLES = ['school_attendance', 'corporate_checkins', 'attendance_events']
const WRITE = new RegExp(String.raw`\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(${TABLES.join('|')})\b`, 'gi')

const files = execSync('git ls-files --cached --others --exclude-standard apps/backend/src', {
  cwd: ROOT,
  encoding: 'utf8',
})
  .split('\n')
  .filter(f => /\.(ts|mjs|js)$/.test(f))
  .filter(f => !f.startsWith('apps/backend/src/attendance/'))
  .filter(f => !/\/(tests|scripts|db\/migrations)\//.test(f) && !/\.test\.ts$/.test(f))

const problems = []
for (const f of files) {
  const text = fs.readFileSync(path.join(ROOT, f), 'utf8')
  for (const m of text.matchAll(WRITE)) {
    const line = text.slice(0, m.index).split('\n').length
    problems.push(`${f}:${line}: ${m[1].toUpperCase().replace(/\s+/g, ' ')} ${m[2]}`)
  }
}
if (problems.length) {
  console.error(`attendance-core-only: ${problems.length} write(s) outside src/attendance/`)
  for (const p of problems) console.error(`  ${p}`)
  process.exit(1)
}
console.log(`attendance-core-only: ok (${files.length} files; ${TABLES.join(', ')} written only in src/attendance/)`)
