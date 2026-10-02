#!/usr/bin/env node
/**
 * Scorecard runner. Runs every gate in rubric.yml, scores each dimension by
 * the rules written at the top of that file, and writes
 *   docs/scorecard/<phase>-<date>.json   the full result, committed
 *   docs/scorecard/LATEST.md             a human summary
 *
 *   node scripts/scorecard/run.mjs --phase phase-0 [--only <dimension>] [--no-write] [--allow-dirty]
 *
 * Prerequisites are detected, never assumed:
 *   DATABASE_URL       a migrated database (APP_DATABASE_URL: the API's runtime role)
 *   API_BASE           a running API
 *   E2E_RESULTS        the file scripts/run-all-e2e.sh writes; counted only if
 *                      it was produced at the current commit
 *   CI_NEEDS           in GitHub Actions, toJSON(needs): the result of each job
 * A gate whose prerequisite is missing is NOT RUN and earns nothing.
 *
 * Only committed (or staged) files count: work in progress earns nothing.
 * A phase scorecard (--phase phase-*) refuses to write from a dirty tree, so
 * the commit it names is the code it measured.
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
const allowDirty = args.includes('--allow-dirty')
const today = new Date().toISOString().slice(0, 10)

const git = cmd => execSync(`git ${cmd}`, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim()
const head = git('rev-parse HEAD')
const dirty = git('status --porcelain --untracked-files=no') !== ''

if (write && !only && /^phase-/.test(phase) && dirty && !allowDirty) {
  console.error('A phase scorecard must measure a commit: commit or stash your changes first (or pass --allow-dirty).')
  process.exit(2)
}

// ── Rubric validation ──────────────────────────────────────────────────────
const rubric = YAML.parse(fs.readFileSync(path.join(import.meta.dirname, 'rubric.yml'), 'utf8'))

const GATE_KEYS = {
  common: ['id', 'kind', 'weight', 'title', 'type', 'requires'],
  files: ['paths', 'minBytes'],
  grep: ['paths', 'pattern', 'min', 'count'],
  'grep-absent': ['paths', 'pattern'],
  cmd: ['run', 'cwd', 'timeout'],
  e2e: ['suites'],
  check: ['check'],
  'ci-job': ['jobs'],
}
const REQUIRED = {
  files: ['paths'],
  grep: ['paths', 'pattern'],
  'grep-absent': ['paths', 'pattern'],
  cmd: ['run'],
  e2e: ['suites'],
  check: ['check'],
  'ci-job': ['jobs'],
}

function rubricProblems() {
  const problems = []
  const baseline = JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'baseline.json'), 'utf8')).assessed.dimensions
  for (const dim of rubric.dimensions) {
    const total = dim.gates.reduce((s, g) => s + g.weight, 0)
    const foundation = dim.gates.filter(g => g.kind === 'foundation').reduce((s, g) => s + g.weight, 0)
    const ids = dim.gates.map(g => g.id)
    if (total !== 100) problems.push(`${dim.id}: gates weigh ${total}, want 100`)
    if (foundation !== Math.round(dim.baseline * 10))
      problems.push(`${dim.id}: foundation weighs ${foundation}, want ${dim.baseline * 10}`)
    if (baseline[dim.id] !== dim.baseline)
      problems.push(`${dim.id}: baseline ${dim.baseline} differs from baseline.json (${baseline[dim.id]})`)
    if (new Set(ids).size !== ids.length) problems.push(`${dim.id}: a gate id repeats`)
    for (const g of dim.gates) {
      const allowed = new Set([...GATE_KEYS.common, ...(GATE_KEYS[g.type] || [])])
      if (!GATE_KEYS[g.type]) problems.push(`${g.id}: unknown type ${g.type}`)
      for (const k of Object.keys(g))
        if (!allowed.has(k)) problems.push(`${g.id}: unexpected key "${k}" (a comma in an unquoted value?)`)
      for (const k of REQUIRED[g.type] || []) if (g[k] === undefined) problems.push(`${g.id}: missing ${k}`)
      if (!['foundation', 'target'].includes(g.kind)) problems.push(`${g.id}: kind must be foundation or target`)
      if (typeof g.title !== 'string' || !g.title) problems.push(`${g.id}: missing title`)
      if (g.pattern !== undefined) {
        // A double-quoted YAML "\b" is a backspace, not a word boundary: a
        // pattern with a control character in it is a quoting mistake.
        // eslint-disable-next-line no-control-regex
        if (/[\u0000-\u001f]/.test(g.pattern))
          problems.push(`${g.id}: pattern contains a control character (quote it with '')`)
        try {
          new RegExp(g.pattern.replace(/^\(\?i\)/, ''))
        } catch (e) {
          problems.push(`${g.id}: pattern does not compile: ${e.message}`)
        }
      }
    }
  }
  return problems
}
{
  const problems = rubricProblems()
  if (problems.length) {
    console.error('rubric.yml is invalid:\n  ' + problems.join('\n  '))
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

/** The suites scripts/run-all-e2e.sh runs, read from the script itself. */
function runnerSuites() {
  const script = fs.readFileSync(path.join(ROOT, 'apps', 'backend', 'scripts', 'run-all-e2e.sh'), 'utf8')
  const list = name => {
    const start = script.indexOf(`\n${name}=(`)
    if (start === -1) throw new Error(`run-all-e2e.sh has no ${name}=( ... ) list`)
    const body = script.slice(start + name.length + 3, script.indexOf('\n)', start))
    return body
      .split('\n')
      .map(l => l.replace(/#.*/, '').trim())
      .filter(Boolean)
  }
  return [...list('SUITES'), ...list('TS_SUITES')]
}

/**
 * Results count only when the run says it was made at this commit, from a
 * clean tree, and covers every suite in the runner. Anything else is stale,
 * partial or hand-made, and the e2e gates are NOT RUN.
 */
function readE2E(file) {
  if (!file || !fs.existsSync(file)) return { results: null, note: 'no e2e results file' }
  const results = new Map()
  let meta = {}
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (line.startsWith('#')) {
      for (const kv of line.slice(1).trim().split(/\s+/)) {
        const [k, v] = kv.split('=')
        meta[k] = v
      }
      continue
    }
    const [suite, status] = line.split('\t')
    if (suite && status) results.set(suite.trim(), status.trim())
  }
  if (meta.commit !== head)
    return {
      results: null,
      note: `e2e results are from ${meta.commit ? meta.commit.slice(0, 7) : 'an unknown commit'}, not ${head.slice(0, 7)}`,
    }
  if (meta.dirty !== 'false') return { results: null, note: 'e2e results came from a tree with uncommitted changes' }
  const missing = runnerSuites().filter(s => !results.has(s))
  if (missing.length) return { results: null, note: `e2e run is partial (missing ${missing.join(', ')})` }
  return { results, note: `${results.size} suites at ${head.slice(0, 7)}` }
}

function readCiNeeds() {
  if (!process.env.CI_NEEDS) return null
  try {
    return JSON.parse(process.env.CI_NEEDS)
  } catch {
    return null
  }
}

const e2e = readE2E(process.env.E2E_RESULTS || path.join(ROOT, 'apps', 'backend', '.e2e-fixtures', 'results.tsv'))
const env = {
  db: await dbClient(process.env.DATABASE_URL),
  appDbUrl: process.env.APP_DATABASE_URL || process.env.DATABASE_URL,
  api: await apiUp(process.env.API_BASE),
  e2e: e2e.results,
  e2eNote: e2e.note,
  ci: readCiNeeds(),
}
env.available = { db: !!env.db, api: env.api, e2e: !!env.e2e, ci: !!env.ci }

// ── Gate evaluation ────────────────────────────────────────────────────────
let trackedFiles = null
function tracked() {
  trackedFiles ??= git('ls-files --cached').split('\n').filter(Boolean)
  return trackedFiles
}
const isTracked = p => tracked().includes(p.replace(/\\/g, '/'))

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

// A document that says it is unwritten is not the document.
// Markers only: a document may discuss placeholders (authentication.md
// describes rejecting placeholder secrets) without being one.
const PLACEHOLDER =
  /^\s*[-*]?\s*(TODO|TBD)\b|\bnot written( yet)?\b|^\s*\*\*status: (skeleton|draft|placeholder)|\[placeholder\]|lorem ipsum/im

function checkFile(p, minBytes) {
  if (!isTracked(p)) return `${p} not committed`
  const full = path.join(ROOT, p)
  const size = fs.statSync(full).size
  if (size < minBytes) return `${p} is ${size} bytes (need ${minBytes})`
  if (/\.(md|txt|ya?ml)$/i.test(p) && PLACEHOLDER.test(fs.readFileSync(full, 'utf8')))
    return `${p} is marked as a placeholder`
  return null
}

async function evaluate(gate) {
  for (const need of gate.requires || []) {
    if (!env.available[need]) return { status: 'not-run', detail: `needs ${need}` }
  }
  switch (gate.type) {
    case 'files': {
      const problems = gate.paths.map(p => checkFile(p, gate.minBytes ?? 300)).filter(Boolean)
      return problems.length ? { status: 'fail', detail: problems.join('; ') } : { status: 'pass' }
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
      if (!env.e2e) return { status: 'not-run', detail: env.e2eNote }
      const wanted = gate.suites.length === 1 && gate.suites[0] === '*' ? runnerSuites() : gate.suites
      const missing = wanted.filter(s => !env.e2e.has(s))
      const failed = wanted.filter(s => env.e2e.has(s) && env.e2e.get(s) !== 'pass')
      if (missing.length) return { status: 'fail', detail: `suite not in runner: ${missing.join(', ')}` }
      if (failed.length) return { status: 'fail', detail: `failed: ${failed.join(', ')}` }
      return { status: 'pass', detail: `${wanted.length} suite(s)` }
    }
    case 'ci-job': {
      // Configuration alone proves nothing: the job has to have run, and passed, in this workflow run.
      if (!env.ci) return { status: 'not-run', detail: 'needs a CI run (CI_NEEDS)' }
      const bad = gate.jobs.filter(j => env.ci[j]?.result !== 'success')
      return bad.length
        ? { status: 'fail', detail: bad.map(j => `${j}: ${env.ci[j]?.result ?? 'absent'}`).join(', ') }
        : { status: 'pass' }
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

// ── Attestations and the audit ─────────────────────────────────────────────
/**
 * An attestation is outside evidence, so it must be a substantial committed
 * file that the implementing agent did not add: the commit that added it may
 * not carry a Claude co-author trailer. This is a guard against an agent
 * writing its own evidence, not against a person forging one.
 */
function attestationProblem(pattern) {
  const dir = path.dirname(pattern)
  const stem = path.basename(pattern).replace(/\.\*$/, '')
  const candidates = tracked().filter(f => path.dirname(f) === dir && path.basename(f).startsWith(stem + '.'))
  if (!candidates.length) return 'missing'
  for (const f of candidates) {
    if (fs.statSync(path.join(ROOT, f)).size < 1024) continue
    const added = git(`log --diff-filter=A --format=%B -- "${f}"`)
    if (/co-authored-by:\s*claude/i.test(added)) continue
    return null
  }
  return 'present but under 1 KB, or added by the implementing agent'
}

/** The audit counts only with its written report beside it. */
function readAudit() {
  const json = path.join(OUT_DIR, `audit-${phase}.json`)
  const report = path.join(OUT_DIR, `audit-${phase}.md`)
  if (!fs.existsSync(json)) return { audit: null, note: null }
  if (!fs.existsSync(report) || fs.statSync(report).size < 1024)
    return { audit: null, note: `audit-${phase}.json ignored: no report beside it` }
  return { audit: JSON.parse(fs.readFileSync(json, 'utf8')), note: null }
}

// ── Scoring ────────────────────────────────────────────────────────────────
const round1 = n => Math.round(n * 10) / 10
const { audit, note: auditNote } = readAudit()

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
  const missingAttestations = (dim.attestations || []).filter(a => attestationProblem(rubric.attestations[a].file))
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
  commit: head.slice(0, 7),
  dirty,
  environment: env.available,
  e2e: env.e2eNote,
  composite,
  baselineComposite,
  referenceComposite: rubric.phase_reference_composite,
  audit: audit ? `audit-${phase}.json` : null,
  auditNote,
  dimensions,
}

// ── Output ─────────────────────────────────────────────────────────────────
function previousResult() {
  if (!fs.existsSync(OUT_DIR)) return null
  const files = fs
    .readdirSync(OUT_DIR)
    .filter(f => /^phase-.*-\d{4}-\d{2}-\d{2}\.json$/.test(f) && !f.startsWith(`${phase}-`))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
  const last = files.at(-1)
  return last ? JSON.parse(fs.readFileSync(path.join(OUT_DIR, last), 'utf8')) : null
}

function markdown(r, prev) {
  const fmt = n => (n === null || n === undefined ? '—' : n.toFixed(1))
  const delta = (now, before) =>
    before === undefined || before === null ? '—' : `${now - before >= 0 ? '+' : ''}${(now - before).toFixed(1)}`
  const prevDim = id => prev?.dimensions?.find(d => d.id === id)?.score
  const lines = []
  lines.push(`# Scorecard: ${r.phase} (${r.date}, ${r.commit}${r.dirty ? ', DIRTY TREE' : ''})`, '')
  lines.push('Generated by `node scripts/scorecard/run.mjs`. Do not edit by hand.', '')
  lines.push(
    `**Composite ${fmt(r.composite)}** · previous ${prev ? `${fmt(prev.composite)} (${prev.phase})` : '—'} · assessed baseline ${fmt(r.baselineComposite)} · global-class reference about ${fmt(r.referenceComposite)}`,
    '',
  )
  const envLine = Object.entries(r.environment)
    .map(([k, v]) => `${k} ${v ? 'available' : 'NOT available'}`)
    .join(', ')
  lines.push(
    `Environment: ${envLine} (e2e: ${r.e2e}). Gates needing something unavailable are NOT RUN and earn nothing.`,
    '',
  )
  if (r.auditNote) lines.push(r.auditNote, '')
  if (!r.audit) lines.push(`No independent audit for ${r.phase} yet, so no dimension can exceed 8.5.`, '')
  else
    lines.push(
      `Independent audit: [audit-${r.phase}.md](audit-${r.phase}.md). Where it scored lower, its score is used.`,
      '',
    )
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
