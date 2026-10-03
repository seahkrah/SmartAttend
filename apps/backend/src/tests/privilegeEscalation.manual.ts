/**
 * Privilege escalation and IDOR inside a tenant.
 *
 * The cross-tenant fuzz proves tenant A cannot reach tenant B. This proves
 * that, inside one tenant, a person cannot do what their role does not
 * allow, and cannot reach another person's records:
 *
 *   1. The role matrix, generated from docs/api/permission-map.json: every
 *      route the map says is reserved to some roles (or to superadmins) is
 *      called as every seeded caller the map leaves out, on both platforms.
 *      Each must be refused. A route with a path parameter may answer 404
 *      instead, when the parameter is loaded before the role guard runs; the
 *      suite says how many did.
 *   2. Same-tenant IDOR cases: a student, lecturer or employee asking for
 *      another person's transcript, attendance, invoice, pay, timesheet,
 *      leave balance or face-matching record, or attaching a file to them.
 *   3. Vertical escalation: a caller raising their own role, or an
 *      administrator creating a superadmin.
 *
 * Needs a running API (API_BASE), the e2e seed fixtures and DATABASE_URL (the
 * owner, to create an invoice and read back what changed). Suite
 * "privilegeEscalation" in scripts/run-all-e2e.sh.
 */
import fs from 'fs'
import path from 'path'
import pg from 'pg'
import type { GuardTag } from '../auth/guards.js'

const API = (process.env.API_BASE ?? 'http://127.0.0.1:5000').replace(/\/$/, '')
const dir = process.env.E2E_FIXTURE_DIR ?? path.join(process.cwd(), '.e2e-fixtures')
const school = JSON.parse(fs.readFileSync(path.join(dir, 'seed.json'), 'utf8'))
const corp = JSON.parse(fs.readFileSync(path.join(dir, 'corp.json'), 'utf8'))
const map: Array<{ method: string; path: string; guards: GuardTag[] }> = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), '..', '..', 'docs', 'api', 'permission-map.json'), 'utf8'),
)

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    pass++
    console.log(`  ok    ${name}`)
  } else {
    fail++
    console.log(`  FAIL  ${name} ${detail}`)
  }
}

async function owner(sql: string, params: unknown[] = []) {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await c.connect()
  try {
    return await c.query(sql, params)
  } finally {
    await c.end()
  }
}

type Caller = { name: string; token: string; platform: 'school' | 'corporate'; role: string }
const callers: Caller[] = [
  { name: 'school admin', token: school.A.token, platform: 'school', role: 'admin' },
  { name: 'lecturer', token: school.A.facToken, platform: 'school', role: 'faculty' },
  { name: 'student', token: school.A.studentToken, platform: 'school', role: 'student' },
  { name: 'corporate admin', token: corp.A.adminToken, platform: 'corporate', role: 'admin' },
  { name: 'HR', token: corp.A.token, platform: 'corporate', role: 'hr' },
  { name: 'HR director', token: corp.A.dirToken, platform: 'corporate', role: 'hr_director' },
  { name: 'manager', token: corp.A.managerToken, platform: 'corporate', role: 'manager' },
  { name: 'employee', token: corp.A.empToken, platform: 'corporate', role: 'employee' },
]

async function call(method: string, url: string, token: string, body?: unknown) {
  const res = await fetch(API + url, {
    method,
    redirect: 'manual',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: method === 'GET' || method === 'HEAD' ? undefined : JSON.stringify(body ?? {}),
  })
  const text = await res.text()
  let json: any = null
  try {
    json = JSON.parse(text)
  } catch {
    /* not JSON */
  }
  return { status: res.status, json, text }
}

const NOWHERE = '00000000-0000-4000-8000-000000000000'
const fill = (p: string) => p.replace(/:(\w+)/g, (_m, name: string) => (name === 'type' ? 'student' : NOWHERE))

/** Who the map lets through: every roles guard on the chain, and every platform guard. */
function admits(guards: GuardTag[], c: Caller): boolean {
  if (guards.some((g) => g.kind === 'superadmin')) return false
  for (const g of guards) {
    if (g.kind === 'roles' && !g.values.includes(c.role)) return false
    if (g.kind === 'platform' && !g.values.includes(c.platform)) return false
  }
  return true
}

async function roleMatrix() {
  console.log('-- role matrix (from the permission map) --')
  for (const c of callers) {
    const me = await call('GET', '/api/auth/me', c.token)
    check(`${c.name}'s token is live`, me.status === 200, `(${me.status})`)
  }
  const reserved = map.filter((r) => r.guards.some((g) => g.kind === 'roles' || g.kind === 'superadmin'))
  let calls = 0
  let notFound = 0
  const leaks: string[] = []
  const queue: Array<() => Promise<void>> = []
  for (const r of reserved) {
    for (const c of callers) {
      if (admits(r.guards, c)) continue
      queue.push(async () => {
        const res = await call(r.method, fill(r.path), c.token)
        calls++
        const hasParam = r.path.includes(':')
        if (res.status === 403) return
        if (res.status === 404 && hasParam) {
          notFound++
          return
        }
        leaks.push(`${r.method} ${r.path} as ${c.name}: ${res.status} ${res.text.slice(0, 120)}`)
      })
    }
  }
  // A few at a time: enough to be quick, few enough not to trip a rate limit.
  for (let i = 0; i < queue.length; i += 8) await Promise.all(queue.slice(i, i + 8).map((f) => f()))
  check(`${reserved.length} reserved routes, ${calls} calls by callers the map leaves out: all refused`,
    leaks.length === 0, `\n    ${leaks.slice(0, 25).join('\n    ')}${leaks.length > 25 ? `\n    ... ${leaks.length - 25} more` : ''}`)
  console.log(`        (${calls - notFound} answered 403; ${notFound} answered 404, their parameter loaded before the guard)`)
}

async function idor() {
  console.log('-- one person, another person\'s records (same tenant) --')
  const [me, other] = school.A.students as string[]
  const course = school.A.courseId as string
  const stu = school.A.studentToken as string
  const fac = school.A.facToken as string
  const emp = corp.A.empToken as string
  const myEmp = corp.A.empId as string
  const otherEmp = (corp.A.employees as string[]).find((e) => e !== myEmp)!

  let r = await call('GET', `/api/gradebook/students/${me}/transcript`, stu)
  check('a student reads their own transcript', r.status === 200, `(${r.status})`)
  r = await call('GET', `/api/gradebook/students/${other}/transcript`, stu)
  check("but not a classmate's", r.status === 403 || r.status === 404, `(${r.status})`)

  r = await call('GET', `/api/attendance/students/${other}/courses/${course}/attendance`, stu)
  check("a student cannot read a classmate's attendance (findings #32)", r.status === 403, `(${r.status})`)
  r = await call('GET', `/api/attendance/courses/${course}/sessions`, stu)
  check("nor list a class's sessions", r.status === 403, `(${r.status})`)
  r = await call('GET', `/api/attendance/students/${other}/courses/${course}/attendance`, fac)
  check('a lecturer can', r.status === 200, `(${r.status})`)

  r = await call('GET', `/api/academics/students/${other}/programme`, stu)
  check("a student cannot read a classmate's programme", [403, 404].includes(r.status), `(${r.status})`)

  // An invoice for the other student, made as the owner.
  const inv = (await owner(
    `INSERT INTO invoices (tenant_id, student_id, number, status) VALUES ($1, $2, $3, 'draft') RETURNING id`,
    [school.A.tenantId, other, `PE-${Date.now()}`],
  )).rows[0].id
  try {
    r = await call('GET', `/api/fees/invoices/${inv}`, stu)
    check("a student cannot read a classmate's invoice", r.status === 404, `(${r.status})`)
    r = await call('GET', `/api/fees/invoices/${inv}`, fac)
    check('nor can a lecturer, who has no invoice of their own (findings #33)', r.status === 404, `(${r.status})`)
    r = await call('GET', `/api/fees/invoices/${inv}`, school.A.token)
    check('the school admin can', r.status === 200, `(${r.status})`)
    r = await call('GET', `/api/fees/statement?studentId=${other}`, stu)
    check("a student asking for a classmate's statement gets their own",
      !JSON.stringify(r.json ?? '').includes(other), `(${r.status})`)
  } finally {
    await owner(`DELETE FROM invoices WHERE id = $1`, [inv])
  }

  r = await call('GET', `/api/payroll/employees/${myEmp}/compensation`, emp)
  check('an employee reads their own pay', r.status === 200, `(${r.status})`)
  r = await call('GET', `/api/payroll/employees/${otherEmp}/compensation`, emp)
  check("but not a colleague's", r.status === 404, `(${r.status})`)

  r = await call('GET', `/api/leave/balances?employeeId=${otherEmp}`, emp)
  check("an employee asking for a colleague's leave balance gets their own",
    r.status === 200 && r.json?.employee?.id === myEmp, `(${r.status} ${r.json?.employee?.id})`)
  r = await call('GET', '/api/leave/requests?scope=all', emp)
  const otherRows = (r.json?.requests ?? []).filter((x: any) => x.employee_id && x.employee_id !== myEmp)
  check("and scope=all shows an employee only their own requests", r.status === 200 && otherRows.length === 0,
    `(${r.status}, ${otherRows.length} of others)`)

  // A colleague's timesheet, built by HR for a week no other suite uses.
  const otherSheetEmp = corp.A.timesheetEmpId !== myEmp ? corp.A.timesheetEmpId : otherEmp
  const built = await call('POST', '/api/workforce/timesheets', corp.A.token,
    { employeeId: otherSheetEmp, periodStart: '2031-01-06', periodEnd: '2031-01-12' })
  const sheet = built.json?.timesheet?.id ?? built.json?.id
  check("HR builds a colleague's timesheet to test with", !!sheet, `(${built.status} ${built.text.slice(0, 120)})`)
  if (sheet) {
    try {
      r = await call('GET', `/api/workforce/timesheets/${sheet}`, emp)
      check("an employee cannot read a colleague's timesheet", r.status === 404, `(${r.status})`)
      r = await call('POST', `/api/workforce/timesheets/${sheet}/submit`, emp)
      check('nor submit it', r.status === 404, `(${r.status})`)
    } finally {
      await owner(`DELETE FROM timesheet_days WHERE timesheet_id = $1`, [sheet]).catch(() => undefined)
      await owner(`DELETE FROM timesheets WHERE id = $1`, [sheet]).catch(() => undefined)
    }
  }

  r = await call('GET', `/api/biometrics/subjects/student/${other}`, stu)
  check("a student cannot read a classmate's face-matching record", [403, 404].includes(r.status), `(${r.status})`)
  r = await call('POST', `/api/biometrics/subjects/student/${other}/consent`, stu, { basis: 'consent' })
  check('nor give consent for them', [403, 404].includes(r.status), `(${r.status})`)
  r = await call('GET', `/api/biometrics/subjects/employee/${otherEmp}`, emp)
  check("an employee cannot read a colleague's", [403, 404].includes(r.status), `(${r.status})`)

  // Attaching a file to someone else's record (findings #34).
  const form = (ownerType: string, ownerId: string) => {
    const f = new FormData()
    f.append('category', 'other')
    f.append('ownerType', ownerType)
    f.append('ownerId', ownerId)
    f.append('file', new Blob([Buffer.from('plain text, nothing more\n')], { type: 'text/plain' }), 'note.txt')
    return f
  }
  const upload = async (token: string, ownerType: string, ownerId: string) => {
    const res = await fetch(`${API}/api/files`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form(ownerType, ownerId) })
    return { status: res.status, json: await res.json().catch(() => null) }
  }
  let u = await upload(stu, 'student', other)
  check("a student cannot attach a file to a classmate's record", u.status === 403, `(${u.status})`)
  u = await upload(stu, 'student', me)
  check('but can to their own', u.status === 201, `(${u.status})`)
  if (u.json?.file?.id) await owner(`DELETE FROM stored_files WHERE id = $1`, [u.json.file.id]).catch(() => undefined)
  u = await upload(emp, 'employee', otherEmp)
  check("an employee cannot attach a file to a colleague's record", u.status === 403, `(${u.status})`)
}

async function vertical() {
  console.log('-- raising one\'s own role --')
  const roleOf = async (token: string) => (await call('GET', '/api/auth/me', token)).json
  const before = await roleOf(school.A.studentToken)
  const superRole = (await owner(`SELECT id FROM roles WHERE name = 'superadmin' LIMIT 1`)).rows[0]?.id
  await call('PUT', '/api/auth/me', school.A.studentToken, { roleId: superRole, role: 'admin', role_id: superRole, isSuperadmin: true })
  const after = await roleOf(school.A.studentToken)
  check('a student cannot change their own role through their profile',
    JSON.stringify(before?.role ?? before?.user?.role) === JSON.stringify(after?.role ?? after?.user?.role) &&
      after?.isSuperadmin !== true && after?.user?.isSuperadmin !== true)

  for (const [who, token] of [['the school admin', school.A.token], ['the corporate admin', corp.A.adminToken]] as const) {
    const email = `pe-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@e2e.test`
    const res = await call('POST', '/api/admin/users', token, { email, name: 'Escalation probe', role: 'superadmin' })
    const made = (await owner(
      `SELECT r.name FROM users u JOIN roles r ON r.id = u.role_id WHERE lower(u.email) = $1`, [email],
    )).rows[0]?.name
    check(`${who} cannot create a superadmin`, made !== 'superadmin' && res.status !== 201, `(${res.status}, made ${made ?? 'nothing'})`)
    await owner(`DELETE FROM users WHERE lower(email) = $1`, [email]).catch(() => undefined)
  }

  const r = await call('POST', '/api/superadmin/tenants', corp.A.adminToken, { name: 'Escalation probe' })
  check('a tenant administrator cannot use the control plane', r.status === 403, `(${r.status})`)
}

async function main() {
  await roleMatrix()
  await idor()
  await vertical()
}

main()
  .catch((e) => {
    fail++
    console.error(e)
  })
  .finally(() => {
    console.log(`\n${pass} passed, ${fail} failed`)
    process.exit(fail ? 1 : 0)
  })
