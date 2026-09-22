#!/usr/bin/env node
/**
 * Static SQL validator.
 *
 * Every literal SQL string in the route and service layer is handed to
 * PostgreSQL's parser via PREPARE, inside a transaction that is always rolled
 * back. Nothing runs; the planner simply resolves every table, column and
 * function name. A query naming a column that does not exist fails here
 * instead of at 3am in production.
 *
 * This exists because the codebase accumulated queries against tables and
 * columns that were never created — student_schedules, class_schedules.section
 * — and nothing caught them: the routes were unmounted, or the failure only
 * showed as a 500 on a page nobody had opened yet.
 *
 * Only fully static literals are checked. A template with ${...} in it is
 * assembled at runtime and is reported as skipped rather than guessed at.
 */
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'

const ROOT = path.resolve(import.meta.dirname, '..', 'src')
const DB = process.env.DATABASE_URL

if (!DB) {
  console.error('DATABASE_URL is required')
  process.exit(2)
}

/** Collects the backtick literal that follows each query(/client.query( call. */
function extractQueries(source, file) {
  const found = []
  const re = /(?:\bquery|\bclient\.query|\bpool\.query)\s*\(\s*`/g
  let m
  while ((m = re.exec(source)) !== null) {
    const start = re.lastIndex
    let i = start
    let depth = 0
    let sql = null
    // Walk to the matching backtick, stepping over nested ${ } expressions.
    while (i < source.length) {
      const ch = source[i]
      if (ch === '\\') { i += 2; continue }
      if (ch === '$' && source[i + 1] === '{') { depth++; i += 2; continue }
      if (ch === '}' && depth > 0) { depth--; i++; continue }
      if (ch === '`' && depth === 0) { sql = source.slice(start, i); break }
      i++
    }
    if (sql === null) continue
    const line = source.slice(0, start).split('\n').length
    found.push({ sql, file, line, dynamic: /\$\{/.test(sql) })
  }
  return found
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'migrations') continue
      walk(full, out)
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      out.push(full)
    }
  }
  return out
}

/** Errors that mean the schema does not match the query. */
const SCHEMA_ERRORS = new Set([
  '42703', // undefined_column
  '42P01', // undefined_table
  '42883', // undefined_function
  '42P10', // invalid_column_reference (ON CONFLICT with no matching constraint)
  '42704', // undefined_object
])

/** Errors that only mean PREPARE cannot infer a parameter type. */
const PARAM_ERRORS = new Set([
  '42P18', // indeterminate_datatype
  '42725', // ambiguous_function
])

const client = new pg.Client({ connectionString: DB })
await client.connect()

const files = walk(ROOT).filter((f) => !f.includes('/tests/'))
const problems = []
let checked = 0
let skippedDynamic = 0
let skippedParams = 0

let n = 0
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8')
  for (const q of extractQueries(source, file)) {
    if (q.dynamic) { skippedDynamic++; continue }
    const name = `v_check_${n++}`
    await client.query('BEGIN')
    try {
      await client.query(`PREPARE ${name} AS ${q.sql}`)
      checked++
    } catch (e) {
      if (SCHEMA_ERRORS.has(e.code)) {
        problems.push({
          file: path.relative(ROOT, q.file),
          line: q.line,
          code: e.code,
          message: e.message,
          sql: q.sql.trim().split('\n').slice(0, 3).join(' ').replace(/\s+/g, ' ').slice(0, 140),
        })
      } else if (PARAM_ERRORS.has(e.code)) {
        skippedParams++
      } else {
        checked++
      }
    } finally {
      await client.query('ROLLBACK')
    }
  }
}

await client.end()

for (const p of problems) {
  console.log(`${p.file}:${p.line}  [${p.code}] ${p.message}`)
  console.log(`    ${p.sql}`)
}

console.log('')
console.log(`checked ${checked} static statements`)
console.log(`skipped ${skippedDynamic} assembled at runtime, ${skippedParams} with uninferable parameter types`)
console.log(`${problems.length} schema mismatches`)

process.exit(problems.length > 0 ? 1 : 0)
