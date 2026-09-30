#!/usr/bin/env node
/**
 * A load baseline for the busiest screens' API calls.
 *
 *   node scripts/load-test.mjs [--requests 200] [--concurrency 20]
 *
 * Signs in as the seeded test accounts (Passw0rd!x), then fires each call
 * `requests` times with `concurrency` in flight and reports p50 / p95 / max
 * latency and errors. Point API_BASE elsewhere to test another deployment.
 *
 * Run it against an API started with RATE_LIMIT_API_PER_MINUTE raised; the
 * default per-address limit exists to stop exactly this kind of traffic.
 */
const API = (process.env.API_BASE ?? 'http://127.0.0.1:5000') + '/api'
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? Number(process.argv[i + 1]) : fallback
}
const REQUESTS = arg('requests', 200)
const CONCURRENCY = arg('concurrency', 20)
const PASSWORD = process.env.LOAD_PASSWORD ?? 'Passw0rd!x'

async function login(email, platform) {
  const r = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD, platform }),
  })
  const j = await r.json()
  if (!j.accessToken) throw new Error(`login ${email}: ${r.status} ${JSON.stringify(j)}`)
  return j.accessToken
}

async function measure(label, path, token) {
  const times = []
  let errors = 0, lastError = ''
  let next = 0
  const worker = async () => {
    while (next < REQUESTS) {
      next++
      const t = performance.now()
      try {
        const r = await fetch(API + path, { headers: { Authorization: `Bearer ${token}` } })
        await r.arrayBuffer()
        if (!r.ok) { errors++; lastError = String(r.status) }
      } catch (e) { errors++; lastError = e.message }
      times.push(performance.now() - t)
    }
  }
  const started = performance.now()
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  const wall = (performance.now() - started) / 1000
  times.sort((a, b) => a - b)
  const pct = (p) => times[Math.min(times.length - 1, Math.floor(times.length * p))]
  return { label, path, p50: pct(0.5), p95: pct(0.95), max: times[times.length - 1], rps: REQUESTS / wall, errors, lastError }
}

const PLAN = [
  ['school', 'admin.a@e2e.test', [
    ['School dashboard', '/auth/admin/school/stats'],
    ['Students page (50)', '/auth/admin/school/students?page=1&pageSize=50'],
    ['Student picker', '/auth/admin/school/students?fields=summary'],
    ['Attendance overview', '/auth/admin/school/attendance/overview'],
    ['Attendance report', '/auth/admin/school/reports/attendance'],
    ['Enrolments', '/auth/admin/school/enrollments'],
    ['Guardians', '/guardians'],
    ['Fees overview', '/fees/overview'],
  ]],
  ['school', 'fac.a@e2e.test', [
    ['Lecturer dashboard', '/faculty/dashboard'],
    ['Lecturer students', '/faculty/students'],
    ['Lecturer reports', '/faculty/reports'],
  ]],
  ['school', 'stu1.a@e2e.test', [
    ['Student dashboard', '/student/dashboard'],
    ['Student attendance', '/student/attendance'],
    ['Transcript', '/gradebook/my/transcript'],
  ]],
  ['corporate', 'hr.a@c2e.test', [
    ['HR today', '/hr/today'],
    ['HR overview', '/hr/overview'],
    ['Leave requests', '/leave/requests'],
    ['Payroll runs', '/payroll/runs'],
  ]],
]

const rows = []
for (const [platform, email, calls] of PLAN) {
  const token = await login(email, platform)
  for (const [label, path] of calls) rows.push(await measure(label, path, token))
}
const f = (n) => n.toFixed(0).padStart(6)
console.log(`${REQUESTS} requests per call, ${CONCURRENCY} concurrent\n`)
console.log('call'.padEnd(22), '   p50', '   p95', '   max', '  req/s', ' errors')
for (const r of rows) {
  console.log(r.label.padEnd(22), f(r.p50), f(r.p95), f(r.max), f(r.rps), String(r.errors).padStart(6), r.errors ? `(${r.lastError})` : '')
}
