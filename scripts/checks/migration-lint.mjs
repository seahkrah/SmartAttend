#!/usr/bin/env node
/**
 * Migration filenames.
 *
 *   NNN_snake_case.sql      every new migration; NNN used by no other file
 *   NNNx_snake_case.sql     only the legacy groups renumbered in Phase 0
 *                           (006, 007, 008, 012, 017), frozen as they are
 *
 * A repeated number let the rest of the filename decide the order the schema
 * was built in (see apps/backend/src/db/migrationLedger.ts). Keying on the
 * number, not the number-plus-letter, matters: "008_x.sql" would otherwise
 * pass and sort before 008a, which is exactly that reordering.
 */
import fs from 'node:fs'
import path from 'node:path'

const LEGACY_LETTERED = {
  '006': ['a', 'b', 'c'],
  '007': ['a', 'b', 'c'],
  '008': ['a', 'b', 'c', 'd'],
  '012': ['a', 'b'],
  '017': ['a', 'b'],
}

// Numbers never used before the Phase 0 freeze. A file there would run in
// sequence on a fresh database but last on every existing one: two schema
// histories from one set of files. New migrations take the next number.
const FROZEN_GAPS = new Set(['014', '015', '019'])

const dir = path.resolve(import.meta.dirname, '..', '..', 'apps', 'backend', 'src', 'db', 'migrations')
const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql'))
const problems = []
const byNumber = new Map()

for (const f of files) {
  if (f.endsWith('_OLD.sql')) {
    problems.push(`${f}: superseded migration; delete it`)
    continue
  }
  const m = /^(\d{3})([a-z]?)_[a-z0-9_]+\.sql$/.exec(f)
  if (!m) {
    problems.push(`${f}: name must match NNN_snake_case.sql`)
    continue
  }
  const [, number, letter] = m
  if (FROZEN_GAPS.has(number)) problems.push(`${f}: ${number} is a gap left before Phase 0; use the next free number`)
  if (letter && !LEGACY_LETTERED[number]?.includes(letter)) {
    problems.push(`${f}: letter suffixes belong only to the frozen legacy groups; use the next free number`)
  }
  byNumber.set(number, [...(byNumber.get(number) || []), { f, letter }])
}

for (const [number, entries] of byNumber) {
  const legacy = LEGACY_LETTERED[number]
  if (legacy) {
    // Compare as lists: an unlettered "008_x" contributes '' and must not
    // disappear in a join.
    const got = entries.map(e => e.letter || '(none)').sort()
    if (got.length !== legacy.length || got.some((l, i) => l !== legacy[i]))
      problems.push(
        `${number}: legacy group must be exactly ${legacy.map(l => number + l).join(', ')}; found ${entries.map(e => e.f).join(', ')}`,
      )
  } else if (entries.length > 1) {
    problems.push(`${number} used by ${entries.map(e => e.f).join(', ')}`)
  }
}

if (problems.length) {
  console.error('migration-lint:')
  for (const p of problems) console.error(`  ${p}`)
  process.exit(1)
}
console.log(`migration-lint: ok (${files.length} migrations)`)
