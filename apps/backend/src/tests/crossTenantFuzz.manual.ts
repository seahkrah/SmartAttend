/**
 * Cross-tenant fuzzer over every route the API serves.
 *
 * The route list is generated from the Express routers (routeInventory.ts),
 * so a route added anywhere is fuzzed without anyone listing it. For every
 * route with a path parameter, and for each of tenant B's real row ids (one
 * from every tenant table that has rows for B, plus B's tenant ids), it calls
 * the route as tenant A's administrator, on both platforms, with B's id in
 * every parameter. It passes only if:
 *
 *   - no response carries B's data: B's tenant ids, any of B's row ids other
 *     than the one in the URL, or B's tenant names;
 *   - B's id is indistinguishable from an id that exists nowhere: the same
 *     status, and for a success the same body once the id and timestamps
 *     are masked (no data, and no existence oracle such as 403 against 404);
 *   - nothing answers 5xx (an error is not proof of refusal) or 429 (a rate
 *     limit would hide the answer: raise RATE_LIMIT_API_PER_MINUTE);
 *   - and, checked as the owner afterwards, B's row counts are unchanged
 *     in every tenant table, so no write aimed at B landed.
 *
 * Needs a running API (API_BASE), the e2e seed fixtures and DATABASE_URL.
 * Run by scripts/run-all-e2e.sh as suite "crossTenantFuzz".
 */
import fs from 'fs'
import path from 'path'
import pg from 'pg'
import { inventory, type RouteEntry } from '../scripts/routeInventory.js'

const API = (process.env.API_BASE ?? 'http://127.0.0.1:5000').replace(/\/$/, '')
const dir = process.env.E2E_FIXTURE_DIR ?? path.join(process.cwd(), '.e2e-fixtures')
const school = JSON.parse(fs.readFileSync(path.join(dir, 'seed.json'), 'utf8'))
const corp = JSON.parse(fs.readFileSync(path.join(dir, 'corp.json'), 'utf8'))

// `control` is a route the caller must be able to read for its own tenant:
// without it, an expired token would make every refusal below meaningless.
// Low-privilege callers are fuzzed too: an administrator-only fuzz cannot
// tell "refused because it is B's" from "refused because I may not".
const callers = [
  { name: 'school A admin', token: school.A.token as string, control: `/api/school/students/${school.A.students[0]}`, full: true },
  { name: 'corporate A admin', token: corp.A.adminToken as string, control: `/api/corporate/employees/${corp.A.employees[0]}`, full: true },
  { name: 'school A lecturer', token: school.A.facToken as string, control: '/api/faculty/courses', full: false },
  { name: 'corporate A HR', token: corp.A.token as string, control: '/api/hr/overview', full: false },
  { name: 'corporate A employee', token: corp.A.empToken as string, control: '/api/workforce/my/timesheets', full: false },
]

// Identity flows (sign-out, session revocation, two-factor, password) would
// end the callers' own sessions, and the public enquiry form is limited per
// address; they are covered by their own suites. Path-parameter fuzzing
// still reaches every route.
const NO_INJECTION = /^\/api\/(auth|access-requests)(\/|$)/

// Answers that change on their own between any two calls, so "same as for an
// id that exists nowhere" cannot be decided by comparing them. Each was
// checked by reading the handler: none reads an injected id. They still get
// every other check (B's data in the answer, 5xx, 401, 429).
const VOLATILE: Array<[RegExp, string]> = [
  [/^GET \/api\/time\/sync(\/precise)?$/, 'the server clock; takes no input'],
  [/^POST \/api\/workforce\/my\/check-(in|out)$/, "the caller's own attendance; reads faceMatchId, checkInType, siteLocation only"],
  [
    /^GET \/api\/metrics\/(summary|dashboard|api-latency|api-latency-by-endpoint|failure-rates|health-status)$/,
    "aggregates of the caller tenant's own live traffic, which the fuzz moves; reads hours and endpoint only",
  ],
  [/^GET \/api\/notifications\/(overview|messages)$/, "live counts of the tenant's own outbox; ids filter via relatedId, which is injected"],
  [/^(GET|POST) \/api\/notifications\/inbox(\/read-all)?$/, "the caller's own inbox, which the fuzz's own writes keep filling; reads unread and limit only"],
]
const isVolatile = (r: RouteEntry) => VOLATILE.some(([re]) => re.test(`${r.method} ${r.path}`))
const victims = [school.B.tenantId as string, corp.B.tenantId as string]
const CONCURRENCY = Number(process.env.FUZZ_CONCURRENCY ?? 12)

async function owner<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await c.connect()
  try {
    return (await c.query(sql, params)).rows as T[]
  } finally {
    await c.end()
  }
}

/**
 * One id of B's from every tenant table with a uuid `id` column, B's users
 * (identity rows have no tenant_id, so they are reached through B's
 * memberships), and B's row count per table.
 */
async function victimRows() {
  const tables = await owner<{ table: string }>(`
    SELECT c.relname AS table FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r'
       AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped)
     ORDER BY 1`)
  const ids: Array<{ table: string; id: string }> = []
  const counts: Record<string, number> = {}
  for (const { table } of tables) {
    counts[table] = Number((await owner(`SELECT count(*) AS n FROM ${table} WHERE tenant_id = ANY($1::uuid[])`, [victims]))[0].n)
    const hasUuidId = await owner(
      `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'id' AND data_type = 'uuid'`,
      [table],
    )
    if (!hasUuidId.length) continue
    for (const r of await owner(`SELECT id FROM ${table} WHERE tenant_id = ANY($1::uuid[]) ORDER BY id LIMIT 1`, [victims])) {
      ids.push({ table, id: r.id })
    }
  }
  for (const r of await owner(
    `SELECT DISTINCT user_id AS id FROM user_tenant_memberships WHERE tenant_id = ANY($1::uuid[]) ORDER BY 1 LIMIT 3`,
    [victims],
  )) {
    ids.push({ table: 'users', id: r.id })
  }
  return { ids, counts }
}

async function main() {
  const everyRoute: RouteEntry[] = await inventory()
  const routes = everyRoute.filter((r) => r.params.length > 0)
  const { ids, counts: before } = await victimRows()
  const names = (await owner<{ name: string }>(`SELECT name FROM tenants WHERE id = ANY($1::uuid[])`, [victims])).map((r) => r.name)
  const candidates = [...victims.map((id) => ({ table: 'tenants', id })), ...ids]
  const allIds = new Set(candidates.map((c) => c.id))

  // Every name a route uses for an id, plus the common ones: B's id goes into
  // each of them in the query string (GET, DELETE) or the JSON body.
  const idKeys = [
    ...new Set([
      ...everyRoute.flatMap((r) => r.params).filter((p) => /(^id$|Id$)/.test(p)),
      'id', 'tenantId', 'userId', 'studentId', 'employeeId', 'courseId', 'scheduleId', 'facultyId',
      'guardianId', 'invoiceId', 'departmentId', 'fileId', 'sessionId', 'ownerId', 'relatedId', 'faceMatchId',
    ]),
  ]
  // A spread of B's ids for the wider sweeps: one per kind, at most twelve.
  const sample = candidates.filter((c, i, all) => all.findIndex((x) => x.table === c.table) === i).slice(0, 12)

  type Variant = 'path' | 'query' | 'body'
  type Job = { route: RouteEntry; caller: (typeof callers)[number]; id: string; table: string; variant: Variant }
  const jobs: Job[] = []
  for (const caller of callers) {
    for (const route of routes) for (const c of caller.full ? candidates : sample) jobs.push({ route, caller, ...c, variant: 'path' })
    for (const route of everyRoute) {
      if (NO_INJECTION.test(route.path)) continue
      const variant: Variant = ['POST', 'PUT', 'PATCH'].includes(route.method) ? 'body' : 'query'
      for (const c of sample) jobs.push({ route, caller, ...c, variant })
    }
  }
  console.log(
    `  ${everyRoute.length} routes (${routes.length} with path parameters), ${candidates.length} of tenant B's ids, ` +
      `${callers.length} callers, ${idKeys.length} id names in queries and bodies: ${jobs.length} requests`,
  )

  const failures: string[] = []
  const statuses: Record<string, number> = {}

  // Positive controls, before and after: each caller reads its own tenant.
  const controls = async (when: string) => {
    for (const c of callers) {
      const res = await fetch(API + c.control, { headers: { Authorization: `Bearer ${c.token}` } })
      if (res.status !== 200) failures.push(`control ${when}: ${c.name} cannot read its own ${c.control} (${res.status})`)
    }
  }
  await controls('before')
  if (failures.length) {
    for (const f of failures) console.log(`  FAIL  ${f}`)
    console.log(`
0 passed, ${failures.length} failed`)
    process.exit(1)
  }
  let done = 0

  async function call(route: RouteEntry, token: string, id: string, variant: Variant) {
    let url = route.path
    for (const p of route.params) url = url.replace(`:${p}`, id)
    const ids = Object.fromEntries(idKeys.map((k) => [k, id]))
    if (variant === 'query') url += '?' + new URLSearchParams(ids).toString()
    const hasBody = ['POST', 'PUT', 'PATCH'].includes(route.method)
    try {
      const res = await fetch(API + url, {
        method: route.method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: hasBody ? JSON.stringify(variant === 'body' ? ids : {}) : undefined,
        signal: AbortSignal.timeout(30_000),
        // The API's own answer is what is judged. A redirect (single sign-on
        // sends the browser to a provider or back to the app) is compared by
        // where it points, which goes into the body compared below.
        redirect: 'manual',
      })
      const location = res.headers.get('location')
      return { status: res.status, body: (location ? `Location: ${location}
` : '') + (await res.text()) }
    } catch (e: any) {
      return { status: 0, body: String(e.message) }
    }
  }

  // The same request with an id that exists nowhere. B's row must be
  // indistinguishable from it: same status, same body once the id itself and
  // timestamps are masked. That rules out data and an existence oracle (a
  // 403 for B's row where a missing row gets 404) in one comparison.
  const NOWHERE = '00000000-0000-4000-8000-00000000f022'
  const mask = (body: string, id: string) =>
    body.split(id).join('<ID>').replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z?/g, '<TIME>')
  const baselines = new Map<string, Promise<{ status: number; body: string }>>()
  const baseline = (route: RouteEntry, caller: (typeof callers)[number], variant: Variant) => {
    const key = `${caller.name} ${variant} ${route.method} ${route.path}`
    if (!baselines.has(key)) {
      baselines.set(
        key,
        call(route, caller.token, NOWHERE, variant).then((r) => ({ status: r.status, body: mask(r.body, NOWHERE) })),
      )
    }
    return baselines.get(key)!
  }

  async function run(job: Job) {
    const { status, body } = await call(job.route, job.caller.token, job.id, job.variant)
    statuses[String(status).slice(0, 1) + 'xx'] = (statuses[String(status).slice(0, 1) + 'xx'] ?? 0) + 1
    const where = job.variant === 'path' ? '' : ` in the ${job.variant}`
    const what = `${job.route.method} ${job.route.path} as ${job.caller.name} with B's ${job.table} id${where}`
    const leaked = [...allIds].filter((id) => id !== job.id && body.includes(id))
    const leakedName = names.find((n) => n && body.includes(n))
    if (status === 0) failures.push(`${what}: no response (${body.slice(0, 80)})`)
    else if (status === 401) failures.push(`${what}: 401, the caller was not authenticated, so the answer proves nothing`)
    else if (status === 429) failures.push(`${what}: 429, rate limited; raise RATE_LIMIT_API_PER_MINUTE for this run`)
    else if (status >= 500) failures.push(`${what}: ${status}`)
    else if (leaked.length || leakedName) failures.push(`${what}: ${status} carries B's data (${leaked[0] ?? leakedName})`)
    else {
      const base = await baseline(job.route, job.caller, job.variant)
      const differs = (a: { status: number; body: string }, b: { status: number; body: string }) =>
        a.status !== b.status || (a.status < 300 && a.body !== b.body)
      const mine = { status, body: mask(body, job.id) }
      if (differs(mine, base) && !isVolatile(job.route)) {
        // Some answers change on their own (a clock, a counter the fuzz
        // itself moves) or with state (a check-in succeeds once, then
        // conflicts). Ask both again, B's id then the id that exists nowhere,
        // and call it an oracle only if they still differ.
        const again = await call(job.route, job.caller.token, job.id, job.variant)
        const fresh = await call(job.route, job.caller.token, NOWHERE, job.variant)
        const a = { status: again.status, body: mask(again.body, job.id) }
        const b = { status: fresh.status, body: mask(fresh.body, NOWHERE) }
        if (differs(a, b)) {
          failures.push(
            a.status !== b.status
              ? `${what}: ${a.status}, where an id that exists nowhere gets ${b.status} (an existence oracle)`
              : `${what}: ${a.status} answers differently from an id that exists nowhere`,
          )
        }
      }
    }
    done++
    if (done % 2000 === 0) console.log(`  … ${done}/${jobs.length}`)
  }

  let next = 0
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < jobs.length) await run(jobs[next++])
    }),
  )

  await controls('after')
  const after = (await victimRows()).counts
  const changed = Object.keys(before).filter((t) => before[t] !== after[t])

  // One line per distinct (route, outcome): the same defect across many ids is one finding.
  const distinct = [...new Set(failures.map((f) => f.replace(/ with B's \w+ id/, '')))]
  for (const f of distinct.slice(0, 80)) console.log(`  FAIL  ${f}`)
  if (distinct.length > 80) console.log(`  … and ${distinct.length - 80} more`)
  for (const t of changed) console.log(`  FAIL  B's rows in ${t} changed: ${before[t]} -> ${after[t]}`)

  const pass = jobs.length - failures.length
  console.log(`  responses: ${JSON.stringify(statuses)}`)
  for (const f of failures.filter((f) => f.startsWith('control'))) console.log(`  FAIL  ${f}`)
  console.log(`\n${pass} passed, ${failures.length + changed.length} failed`)
  process.exit(failures.length + changed.length === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
