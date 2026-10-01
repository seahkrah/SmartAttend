#!/usr/bin/env node
/**
 * Scorecard runner. Runs every gate in rubric.yml, scores each dimension by
 * the rules written at the top of that file, and writes
 *   docs/scorecard/<phase>-<date>.json   the full result, committed
 *   docs/scorecard/LATEST.md             a human summary
 *
 *   node scripts/scorecard/run.mjs --phase phase-0 [--only tenant-isolation] [--no-write]
 *
 * Prerequisites are detected, never assumed: DATABASE_URL (and optionally
 * APP_DATABASE_URL, the API's runtime role), API_BASE, and E2E_RESULTS (the
 * file scripts/run-all-e2e.sh writes). A gate whose prerequisite is missing
 * is reported NOT RUN and earns nothing.
 */
import fs from 'node:fs'
import path from 'node:path'
import { execSync, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import YAML from 'yaml'
import { customChecks } from './checks.mjs'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const OUT_DIR = path.join(ROOT, 'docs', 'scorecard')

const args = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? fallback : args[i + 1]
}
const phase = arg('phase', 'adhoc')
const only = arg('only', null)
const write = !args.includes('--no-write')
const today = new Date().toISOString().slice(0, 10)

const rubric = YAML.parse(fs.readFileSync(path.join(import.meta.dirname, 'rubric.yml'), 'utf8'))

// The calibration rule in rubric.yml, enforced: gate weights add up to 100,
// and foundation weights to the assessed baseline. Editing a weight without
// keeping both true is an error, not a quiet change of score.
for (const dim of rubric.dimensions) {
  const total = dim.gates.reduce((s, g) => s + g.weight, 0)
  const foundation = dim.gates.filter(g => g.kind === 'foundation').reduce((s, g) => s + g.weight, 0)
  const ids = dim.gates.map(g => g.id)
  if (total !== 100 || foundation !== dim.baseline * 10 || new Set(ids).size !== ids.length) {
    console.error(`rubric.yml: ${dim.id} gates weigh ${total} (want 100), foundation ${foundation} (want ${dim.baseline * 10}), or a gate id repeats`)
    process.exit(2)
  }
}

// ── Environment ────────────────────────────────────────────────────────────
const requireFromBackend = createRequire(path.join(ROOT, 'apps', 'backend', 'package.json'))

async function dbClient(url) {
  if (!url) return null
  try {
    const pg = requireFromBackend('pg')
    const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000 })
    await client.connect()
    await client.query('SELECT 1')
    return client
  } catch {
    return null
  }
}

async function apiUp(base) {
  if (!base) return false
  try {
    const res = await fetch(`${base.replace(/\/$/, '')}/api/health`, { signal: AbortSignal.timeout(5000) })
    return res.ok
  } catch {
    return false
  }
}

function readE2E(file) {
  if (!file || !fs.existsSync(file)) return null
  const results = new Map()
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const [suite, status] = line.split('\t')
    if (suite && status) results.set(suite.trim(), status.trim())
  }
  return results.size ? results : null
}

const env = {
  db: await dbClient(process.env.DATABASE_URL),
  appDbUrl: process.env.APP_DATABASE_URL || process.env.DATABASE_URL,
  api: await apiUp(process.env.API_BASE),
  e2e: readE2E(process.env.E2E_RESULTS || path.join(ROOT, 'apps', 'backend', '.e2e-fixtures', 'results.tsv')),
}
env.available = { db: !!env.db, api: env.api, e2e: !!env.e2e }

// ── Gate evaluation ────────────────────────────────────────────────────────
let trackedFiles = null
function tracked() {
  // Tracked and untracked-but-not-ignored: a gate should see work in progress.
  trackedFiles ??= execSync('git ls-files --cached --others --exclude-standard', {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\n')
    .filter(Boolean)
  return trackedFiles
}

function filesUnder(paths) {
  const prefixes = paths.map(p => p.replace(/\\/g, '/').replace(/\/$/, ''))
  return tracked().filter(
    f => prefixes.some(p => f === p || f.startsWith(p + '/')) && fs.existsSync(path.join(ROOT, f)),
  )
}

function toRegex(pattern) {
  let flags = 'm'
  let source = pattern
  if (source.startsWith('(?i)')) {
    flags += 'i'
    source = source.slice(4)
  }
  return new RegExp(source, flags + 'g')
}

function grepCount(gate) {
  const re = toRegex(gate.pattern)
  let files = 0
  let occurrences = 0
  for (const f of filesUnder(gate.paths)) {
    const text = fs.readFileSync(path.join(ROOT, f), 'utf8')
    const n = (text.match(re) || []).length
    if (n) {
      files++
      occurrences += n
    }
  }
  return gate.count === 'occurrences' ? occurrences : files
}

function globExists(pattern) {
  // Supports a trailing ".*" (any extension) only; that is all the rubric uses.
  const dir = path.join(ROOT, path.dirname(pattern))
  const base = path.basename(pattern)
  if (!fs.existsSync(dir)) return false
  if (base.endsWith('.*')) {
    const stem = base.slice(0, -2)
    return fs.readdirSync(dir).some(f => f.startsWith(stem + '.'))
  }
  return fs.existsSync(path.join(dir, base))
}

async function evaluate(gate) {
  for (const need of gate.requires || []) {
    if (!env.available[need]) return { status: 'not-run', detail: `needs ${need}` }
  }
  switch (gate.type) {
    case 'files': {
      const missing = gate.paths.filter(p => !fs.existsSync(path.join(ROOT, p)))
      return missing.length ? { status: 'fail', detail: `missing: ${missing.join(', ')}` } : { status: 'pass' }
    }
    case 'grep': {
      const n = grepCount(gate)
      const min = gate.min ?? 1
      return n >= min ? { status: 'pass', detail: `${n} found` } : { status: 'fail', detail: `${n} found, need ${min}` }
    }
    case 'grep-absent': {
      const n = grepCount({ ...gate, count: 'occurrences' })
      return n === 0 ? { status: 'pass' } : { status: 'fail', detail: `${n} occurrences` }
    }
    case 'cmd': {
      const cwd = path.join(ROOT, gate.cwd || '.')
      const res = spawnSync(gate.run, {
        cwd,
        shell: true,
        encoding: 'utf8',
        timeout: (gate.timeout ?? 900) * 1000,
        maxBuffer: 64 * 1024 * 1024,
      })
      if (res.status === 0) return { status: 'pass' }
      const tail = `${res.stdout || ''}${res.stderr || ''}`.trim().split('\n').slice(-3).join(' | ').slice(0, 300)
      return { status: 'fail', detail: res.error ? String(res.error.message) : `exit ${res.status}: ${tail}` }
    }
    case 'e2e': {
      if (!env.e2e) return { status: 'not-run', detail: 'no e2e results file' }
      if (gate.suites.length === 1 && gate.suites[0] === '*') {
        const failed = [...env.e2e].filter(([, s]) => s !== 'pass').map(([n]) => n)
        return failed.length
          ? { status: 'fail', detail: `failed: ${failed.join(', ')}` }
          : { status: 'pass', detail: `${env.e2e.size} suites` }
      }
      const missing = gate.suites.filter(s => !env.e2e.has(s))
      const failed = gate.suites.filter(s => env.e2e.has(s) && env.e2e.get(s) !== 'pass')
      if (missing.length) return { status: 'fail', detail: `suite not in runner: ${missing.join(', ')}` }
      if (failed.length) return { status: 'fail', detail: `failed: ${failed.join(', ')}` }
      return { status: 'pass' }
    }
    case 'check': {
      const fn = customChecks[gate.check]
      if (!fn) return { status: 'fail', detail: `unknown check ${gate.check}` }
      try {
        return await fn({ env, root: ROOT, requireFromBackend })
      } catch (e) {
        return { status: 'fail', detail: String(e.message || e) }
      }
    }
    default:
      return { status: 'fail', detail: `unknown gate type ${gate.type}` }
  }
}

// ── Scoring ────────────────────────────────────────────────────────────────
const round1 = n => Math.round(n * 10) / 10

function readAudit() {
  const file = path.join(OUT_DIR, `audit-${phase}.json`)
  if (!fs.existsSync(file)) return null
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}
const audit = readAudit()

const dimensions = []
for (const dim of rubric.dimensions) {
  if (only && dim.id !== only) continue
  const gates = []
  for (const gate of dim.gates) {
    process.stderr.write(`  [${dim.n}] ${gate.id} ... `)
    const result = await evaluate(gate)
    process.stderr.write(`${result.status}\n`)
    gates.push({ id: gate.id, kind: gate.kind, weight: gate.weight, title: gate.title, ...result })
  }
  const total = gates.reduce((s, g) => s + g.weight, 0)
  const passed = gates.filter(g => g.status === 'pass').reduce((s, g) => s + g.weight, 0)
  const raw = (10 * passed) / total
  const caps = []
  let score = raw
  if (gates.some(g => g.status !== 'pass') && score > 8.9) {
    score = 8.9
    caps.push('not every gate passes (max 8.9)')
  }
  const missingAttestations = (dim.attestations || []).filter(a => !globExists(rubric.attestations[a].file))
  if (missingAttestations.length && score > 8.5) {
    score = 8.5
    caps.push(`attestation missing: ${missingAttestations.join(', ')} (max 8.5)`)
  }
  const auditScore = audit?.dimensions?.[dim.id]
  if (score > 8.5 && auditScore === undefined) {
    score = 8.5
    caps.push(`no independent audit for ${phase} (max 8.5)`)
  }
  if (auditScore !== undefined && auditScore < score) {
    caps.push(`independent audit scored ${auditScore}`)
    score = auditScore
  }
  dimensions.push({
    id: dim.id,
    n: dim.n,
    title: dim.title,
    weight: dim.weight,
    baseline: dim.baseline,
    reference: dim.reference,
    raw: round1(raw),
    score: round1(score),
    caps,
    missingAttestations,
    gates,
  })
}

const composite = only
  ? null
  : round1(dimensions.reduce((s, d) => s + d.weight * d.score, 0) / dimensions.reduce((s, d) => s + d.weight, 0))
const baselineComposite = round1(
  rubric.dimensions.reduce((s, d) => s + d.weight * d.baseline, 0) /
    rubric.dimensions.reduce((s, d) => s + d.weight, 0),
)

const result = {
  phase,
  date: today,
  commit: execSync('git rev-parse --short HEAD', { cwd: ROOT, encoding: 'utf8' }).trim(),
  environment: env.available,
  composite,
  baselineComposite,
  referenceComposite: rubric.phase_reference_composite,
  audit: audit ? `audit-${phase}.json` : null,
  dimensions,
}

// ── Output ─────────────────────────────────────────────────────────────────
function previousResult() {
  if (!fs.existsSync(OUT_DIR)) return null
  const files = fs
    .readdirSync(OUT_DIR)
    .filter(f => /^phase-.*-\d{4}-\d{2}-\d{2}\.json$/.test(f) && f !== `${phase}-${today}.json`)
    .sort((a, b) => fs.statSync(path.join(OUT_DIR, a)).mtimeMs - fs.statSync(path.join(OUT_DIR, b)).mtimeMs)
  const last = files.at(-1)
  return last ? JSON.parse(fs.readFileSync(path.join(OUT_DIR, last), 'utf8')) : null
}

function markdown(r, prev) {
  const fmt = n => (n === null || n === undefined ? '—' : n.toFixed(1))
  const delta = (now, before) =>
    before === undefined || before === null ? '—' : `${now - before >= 0 ? '+' : ''}${(now - before).toFixed(1)}`
  const prevDim = id => prev?.dimensions?.find(d => d.id === id)?.score
  const lines = []
  lines.push(`# Scorecard: ${r.phase} (${r.date}, ${r.commit})`, '')
  lines.push('Generated by `node scripts/scorecard/run.mjs`. Do not edit by hand.', '')
  lines.push(
    `**Composite ${fmt(r.composite)}** · previous ${prev ? `${fmt(prev.composite)} (${prev.phase})` : '—'} · assessed baseline ${fmt(r.baselineComposite)} · global-class reference about ${fmt(r.referenceComposite)}`,
    '',
  )
  const envLine = Object.entries(r.environment)
    .map(([k, v]) => `${k} ${v ? 'available' : 'NOT available'}`)
    .join(', ')
  lines.push(`Environment: ${envLine}. Gates needing something unavailable are NOT RUN and earn nothing.`, '')
  if (!r.audit) lines.push(`No independent audit file for ${r.phase} yet, so no dimension can exceed 8.5.`, '')
  lines.push(
    '| # | Dimension | Weight | Score | Δ prev | Baseline | Reference | Caps |',
    '|---|---|---|---|---|---|---|---|',
  )
  for (const d of r.dimensions) {
    lines.push(
      `| ${d.n} | ${d.title} | ${d.weight} | **${fmt(d.score)}** | ${delta(d.score, prevDim(d.id))} | ${fmt(d.baseline)} | ${fmt(d.reference)} | ${d.caps.join('; ') || ''} |`,
    )
  }
  lines.push('', '## Gates that do not pass', '')
  for (const d of r.dimensions) {
    const open = d.gates.filter(g => g.status !== 'pass')
    if (!open.length) continue
    lines.push(`### ${d.n}. ${d.title}`, '')
    for (const g of open)
      lines.push(
        `- **${g.status.toUpperCase()}** \`${g.id}\` (${g.kind}, w${g.weight}): ${g.title}${g.detail ? ` — ${g.detail}` : ''}`,
      )
    lines.push('')
  }
  return lines.join('\n')
}

const prev = previousResult()
console.log(markdown(result, prev))
if (write && !only) {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(path.join(OUT_DIR, `${phase}-${today}.json`), JSON.stringify(result, null, 2) + '\n')
  fs.writeFileSync(path.join(OUT_DIR, 'LATEST.md'), markdown(result, prev) + '\n')
}
await env.db?.end()
