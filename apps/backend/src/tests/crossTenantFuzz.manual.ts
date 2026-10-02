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

const callers = [
  // `control` is a route the caller must be able to read for its own tenant:
  // without it, an expired token would make every refusal below meaningless.
  { name: 'school A admin', token: school.A.token as string, control: `/api/school/students/${school.A.students[0]}` },
  {
    name: 'corporate A admin',
    token: corp.A.adminToken as string,
    control: `/api/corporate/employees/${corp.A.employees[0]}`,
  },
]
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

/** One id of B's from every tenant table with a uuid `id` column, and B's row count per table. */
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
  return { ids, counts }
}

async function main() {
  const routes: RouteEntry[] = (await inventory()).filter((r) => r.params.length > 0)
  const { ids, counts: before } = await victimRows()
  const names = (await owner<{ name: string }>(`SELECT name FROM tenants WHERE id = ANY($1::uuid[])`, [victims])).map((r) => r.name)
  const candidates = [...victims.map((id) => ({ table: 'tenants', id })), ...ids]
  const allIds = new Set(candidates.map((c) => c.id))

  console.log(`  ${routes.length} routes with parameters, ${candidates.length} of tenant B's ids, ${callers.length} callers`)

  type Job = { route: RouteEntry; caller: (typeof callers)[number]; id: string; table: string }
  const jobs: Job[] = []
  for (const route of routes) for (const caller of callers) for (const c of candidates) jobs.push({ route, caller, ...c })

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

  async function call(route: RouteEntry, token: string, id: string) {
    let url = route.path
    for (const p of route.params) url = url.replace(`:${p}`, id)
    try {
      const res = await fetch(API + url, {
        method: route.method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: ['POST', 'PUT', 'PATCH'].includes(route.method) ? '{}' : undefined,
        signal: AbortSignal.timeout(30_000),
      })
      return { status: res.status, body: await res.text() }
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
  const baseline = (route: RouteEntry, caller: (typeof callers)[number]) => {
    const key = `${caller.name} ${route.method} ${route.path}`
    if (!baselines.has(key)) {
      baselines.set(
        key,
        call(route, caller.token, NOWHERE).then((r) => ({ status: r.status, body: mask(r.body, NOWHERE) })),
      )
    }
    return baselines.get(key)!
  }

  async function run(job: Job) {
    const { status, body } = await call(job.route, job.caller.token, job.id)
    statuses[String(status).slice(0, 1) + 'xx'] = (statuses[String(status).slice(0, 1) + 'xx'] ?? 0) + 1
    const what = `${job.route.method} ${job.route.path} as ${job.caller.name} with B's ${job.table} id`
    const leaked = [...allIds].filter((id) => id !== job.id && body.includes(id))
    const leakedName = names.find((n) => n && body.includes(n))
    if (status === 0) failures.push(`${what}: no response (${body.slice(0, 80)})`)
    else if (status === 401) failures.push(`${what}: 401, the caller was not authenticated, so the answer proves nothing`)
    else if (status === 429) failures.push(`${what}: 429, rate limited; raise RATE_LIMIT_API_PER_MINUTE for this run`)
    else if (status >= 500) failures.push(`${what}: ${status}`)
    else if (leaked.length || leakedName) failures.push(`${what}: ${status} carries B's data (${leaked[0] ?? leakedName})`)
    else {
      const base = await baseline(job.route, job.caller)
      if (base.status !== status) {
        failures.push(`${what}: ${status}, where an id that exists nowhere gets ${base.status} (an existence oracle)`)
      } else if (status < 300 && base.body !== mask(body, job.id)) {
        failures.push(`${what}: ${status} answers differently from an id that exists nowhere`)
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
