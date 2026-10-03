/**
 * The manual fallback on both platforms (brief 5.2; rubric gate
 * `manual-fallback-controls`).
 *
 *   - With face matching off, manual is how attendance is taken: no reason
 *     is asked, and face_not_in_use is recorded.
 *   - With it on, every manual entry needs a reason code ("other" with
 *     words). The register, check-in rows and exports say "manual" and why.
 *   - Employers: manual check-ins beyond the tenant's allowance wait for a
 *     manager. Their hours count as flagged until a decision. Nobody decides
 *     their own check-in, another tenant cannot decide them, and a rejection
 *     says why.
 *   - Abuse alerts: many people entered by hand from one device; one person
 *     "not recognised" again and again; a manual check-in outside the
 *     rostered shift.
 *   - Idempotency: a retried capture records once. Events are append-only,
 *     for the runtime role too.
 *
 * Needs a running API (API_BASE), the e2e seed fixtures, DATABASE_URL (the
 * owner) and APP_DATABASE_URL (the runtime role). Suite "manualFallback" in
 * scripts/run-all-e2e.sh. Restores the tenants' face and threshold settings.
 */
import fs from 'fs'
import path from 'path'
import pg from 'pg'
import pool, { query } from '../db/connection.js'
import { withTenant } from '../db/dbContext.js'
import { reissue } from './freshTokens.js'

const API = (process.env.API_BASE ?? 'http://127.0.0.1:5000').replace(/\/$/, '')
const dir = process.env.E2E_FIXTURE_DIR ?? path.join(process.cwd(), '.e2e-fixtures')
const school = JSON.parse(fs.readFileSync(path.join(dir, 'seed.json'), 'utf8'))
const corp = JSON.parse(fs.readFileSync(path.join(dir, 'corp.json'), 'utf8'))

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

async function call(method: string, url: string, token: string, body?: unknown) {
  const res = await fetch(API + url, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  })
  const text = await res.text()
  let json: any = null
  try {
    json = JSON.parse(text)
  } catch {
    /* CSV */
  }
  return { status: res.status, json, text }
}

const RUN = Date.now() % 100000
/** A school day this run alone uses: the register is one mark per student, class and day. */
const day = (n: number) => {
  const d = new Date(Date.UTC(2031, 0, 1) + ((RUN * 7 + n) % 3000) * 86_400_000)
  return d.toISOString().slice(0, 10)
}

async function school_() {
  console.log('-- school: the register --')
  const admin = reissue(school.A.token)
  const fac = reissue(school.A.facToken)
  const stu = reissue(school.A.studentToken)
  const [s0, s1] = school.A.students as string[]
  const mark = (date: string, extra: Record<string, unknown>, entries = [{ student_id: s0, status: 'present' }]) =>
    call('POST', '/api/faculty/attendance/mark', fac, { schedule_id: school.A.scheduleId, date, entries, ...extra })
  const eventFor = async (date: string, student: string) =>
    (await owner(
      `SELECT ev.* FROM attendance_events ev JOIN school_attendance sa ON sa.id = ev.attendance_id
        WHERE sa.tenant_id = $1 AND sa.student_id = $2 AND sa.attendance_date = $3
        ORDER BY ev.server_time DESC LIMIT 1`, [school.A.tenantId, student, date])).rows[0]

  let r = await call('PUT', '/api/biometrics/settings', admin, { enabled: false, threshold: 0.5 })
  check('(face matching off at school A)', r.status === 200, `(${r.status})`)
  r = await mark(day(1), {})
  check('with face matching off, a manual mark needs no reason', r.status === 200, `(${r.status} ${r.text.slice(0, 120)})`)
  let ev = await eventFor(day(1), s0)
  check('and is recorded as manual, face not in use', ev?.method === 'manual' && ev?.reason_code === 'face_not_in_use',
    `(${ev?.method} ${ev?.reason_code})`)

  r = await call('PUT', '/api/biometrics/settings', admin, { enabled: true, threshold: 0.5 })
  check('(face matching on at school A)', r.status === 200, `(${r.status})`)
  r = await mark(day(2), {})
  check('with it on, a manual mark without a reason is refused', r.status === 400 && r.json?.code === 'reason_required',
    `(${r.status} ${r.text.slice(0, 120)})`)
  r = await mark(day(2), { reason_code: 'the dog ate it' })
  check('an unknown reason is refused', r.status === 400 && r.json?.code === 'bad_reason', `(${r.status})`)
  r = await mark(day(2), { reason_code: 'other' })
  check('"other" without words is refused', r.status === 400 && r.json?.code === 'reason_text_required', `(${r.status})`)
  r = await mark(day(2), { reason_code: 'other', reason_text: 'Projector fell on the camera' })
  check('"other" with words is recorded', r.status === 200, `(${r.status})`)
  r = await mark(day(3), { reason_code: 'camera_failure', device_id: `tablet-${RUN}` })
  check('a manual mark with a reason is recorded', r.status === 200, `(${r.status})`)
  ev = await eventFor(day(3), s0)
  check('with its reason, device and actor', ev?.method === 'manual' && ev?.reason_code === 'camera_failure'
    && ev?.device_id === `tablet-${RUN}` && !!ev?.actor_user_id, `(${JSON.stringify(ev ?? {}).slice(0, 160)})`)

  r = await call('GET', `/api/faculty/schedules/${school.A.scheduleId}/students?date=${day(3)}`, fac)
  const row = (r.json?.students ?? []).find((x: any) => x.student_id === s0)
  check('the register says manual, and why', row?.method === 'manual' && row?.manual_reason === 'camera_failure',
    `(${r.status} ${JSON.stringify(row ?? {}).slice(0, 160)})`)
  r = await call('GET', '/api/attendance/me/export?days=3650', stu)
  check("the student's export says manual, and why", r.status === 200 && /,manual,camera_failure/.test(r.text),
    `(${r.status} ${r.text.split('\n').slice(0, 3).join(' | ').slice(0, 200)})`)

  console.log('-- school: alerts --')
  r = await call('PUT', '/api/attendance-review/settings', admin, { deviceManualAlert: 2, faceNotRecognisedAlert: 3 })
  check('(the school sets its alert thresholds)', r.status === 200, `(${r.status} ${r.text.slice(0, 100)})`)
  const device = `kiosk-${RUN}`
  r = await mark(day(4), { reason_code: 'network_outage', device_id: device },
    [{ student_id: s0, status: 'present' }, { student_id: s1, status: 'present' }])
  check('(two students entered by hand from one device)', r.status === 200, `(${r.status})`)
  for (let i = 5; i <= 7; i++) await mark(day(i), { reason_code: 'face_not_recognised' }, [{ student_id: s1, status: 'present' }])
  // All alerts, acknowledged too: one per kind, person and day, so a rerun
  // on the same seed finds the one an earlier run acknowledged.
  r = await call('GET', '/api/attendance-review/alerts?all=true', admin)
  const alerts: any[] = r.json?.alerts ?? []
  check('an alert: many people entered by hand from one device',
    alerts.some((a) => a.kind === 'device_manual_burst' && a.device_id === device), `(${r.status} ${alerts.map((a) => a.kind)})`)
  const nr = alerts.find((a) => a.kind === 'repeated_face_not_recognised' && a.student_id === s1)
  check('an alert: one student "not recognised" three times in a week', !!nr)
  r = await call('GET', '/api/attendance-review/alerts', fac)
  check('a lecturer does not see the alerts', r.status === 403, `(${r.status})`)
  if (nr && !nr.acknowledged_at) {
    r = await call('POST', `/api/attendance-review/alerts/${nr.id}/acknowledge`, admin)
    check('the administrator acknowledges one', r.status === 200, `(${r.status})`)
    r = await call('GET', '/api/attendance-review/alerts', admin)
    check('and it leaves the open list', !(r.json?.alerts ?? []).some((a: any) => a.id === nr.id))
  }
  r = await call('GET', '/api/attendance-review/manual', admin)
  const me = (r.json?.people ?? []).find((p: any) => p.person_id === s1)
  check('manual entries by person', r.status === 200 && me?.manual >= 4 && me?.not_recognised >= 3, `(${JSON.stringify(me ?? {})})`)
  check('and by device', (r.json?.devices ?? []).some((d: any) => d.device_id === device && d.people === 2))

  console.log('-- school: one capture, recorded once --')
  const key = `pe-${RUN}-retry`
  const once = () => mark(day(8), { reason_code: 'camera_failure' }, [{ student_id: s0, status: 'late', idempotency_key: key } as any])
  await once()
  await once()
  const n = (await owner(`SELECT count(*)::int AS n FROM attendance_events WHERE tenant_id = $1 AND idempotency_key = $2`,
    [school.A.tenantId, key])).rows[0].n
  check('a retried capture with the same key records once', n === 1, `(${n})`)
  const code = await withTenant({ tenantId: school.A.tenantId }, () =>
    query(`UPDATE attendance_events SET reason_code = 'other' WHERE tenant_id = $1`, [school.A.tenantId]))
    .then(() => null, (e: any) => e.code ?? 'error')
  check('the runtime role cannot rewrite an event', code === '42501', `(${code ?? 'it ran'})`)

  await call('PUT', '/api/biometrics/settings', admin, { enabled: false, threshold: 0.5 })
  await call('PUT', '/api/attendance-review/settings', admin, { deviceManualAlert: 5, faceNotRecognisedAlert: 3 })
}

async function employer() {
  console.log('-- employer: manual check-ins and their approval --')
  const admin = reissue(corp.A.adminToken)
  const emp = reissue(corp.A.empToken)
  const mgr = reissue(corp.A.managerToken)
  const hr = reissue(corp.A.token)
  const otherHr = reissue(corp.B.token)

  // Start from a clean slate: no open check-in, and no manual allowance used.
  for (const t of [emp, mgr]) await call('POST', '/api/workforce/my/check-out', t)
  let r = await call('PUT', '/api/biometrics/settings', admin, { enabled: true, threshold: 0.5 })
  check('(face matching on at employer A)', r.status === 200, `(${r.status})`)
  const before = (await owner(
    `SELECT count(*)::int AS n FROM attendance_events WHERE tenant_id = $1 AND employee_id = $2 AND kind = 'check_in'
        AND method IN ('manual', 'offline_manual') AND reason_code <> 'face_not_in_use'
        AND server_time > CURRENT_TIMESTAMP - INTERVAL '30 days'`, [corp.A.tenantId, corp.A.empId])).rows[0].n
  r = await call('PUT', '/api/attendance-review/settings', admin, { manualApprovalThreshold: before + 1 })
  check('(the employer allows one more manual check-in this month)', r.status === 200, `(${r.status})`)
  r = await call('PUT', '/api/attendance-review/settings', mgr, { manualApprovalThreshold: 50 })
  check('a manager cannot change the thresholds', r.status === 403, `(${r.status})`)

  r = await call('POST', '/api/workforce/my/check-in', emp, { checkInType: 'office' })
  check('a manual check-in without a reason is refused', r.status === 400 && r.json?.code === 'reason_required', `(${r.status})`)
  r = await call('POST', '/api/workforce/my/check-in', emp, { checkInType: 'office', reasonCode: 'camera_failure', deviceId: `phone-${RUN}` })
  check('within the allowance, it is recorded', r.status === 201 && r.json?.checkIn?.approval === 'not_needed', `(${r.status} ${r.text.slice(0, 150)})`)
  check('and marked manual, with its reason', r.json?.checkIn?.method === 'manual' && r.json?.checkIn?.manualReason === 'camera_failure')
  await call('POST', '/api/workforce/my/check-out', emp)
  r = await call('POST', '/api/workforce/my/check-in', emp, { checkInType: 'office', reasonCode: 'face_not_recognised' })
  const waiting = r.json?.checkIn
  check('beyond it, the check-in waits for a manager', r.status === 201 && waiting?.approval === 'pending'
    && waiting?.awaitingApproval === true && waiting?.state === 'FLAGGED', `(${r.status} ${JSON.stringify(waiting ?? {}).slice(0, 160)})`)
  await call('POST', '/api/workforce/my/check-out', emp)

  r = await call('GET', '/api/attendance-review/approvals', emp)
  check('an employee cannot see the approvals', r.status === 403, `(${r.status})`)
  r = await call('GET', '/api/attendance-review/approvals', mgr)
  const item = (r.json?.approvals ?? []).find((a: any) => a.checkin_id === waiting?.id)
  check('the manager sees it waiting', r.status === 200 && !!item, `(${r.status})`)
  if (item) {
    r = await call('POST', `/api/attendance-review/approvals/${item.event_id}`, otherHr, { decision: 'approved' })
    check("another employer's HR cannot decide it", r.status === 403 || r.status === 404, `(${r.status})`)
    r = await call('POST', `/api/attendance-review/approvals/${item.event_id}`, emp, { decision: 'approved' })
    check('nor can the employee', r.status === 403, `(${r.status})`)
    r = await call('POST', `/api/attendance-review/approvals/${item.event_id}`, mgr, { decision: 'approved' })
    check('the manager approves it', r.status === 200, `(${r.status} ${r.text.slice(0, 120)})`)
    const state = (await owner(`SELECT checkin_state FROM corporate_checkins WHERE id = $1`, [item.checkin_id])).rows[0]?.checkin_state
    check('and its hours now count', state === 'VERIFIED', `(${state})`)
    r = await call('POST', `/api/attendance-review/approvals/${item.event_id}`, mgr, { decision: 'rejected', note: 'changed my mind' })
    check('a decided check-in cannot be decided again', r.status === 404, `(${r.status})`)
  }

  // The manager's own manual check-in beyond the allowance: someone else decides it.
  await owner(`INSERT INTO tenant_settings (tenant_id, setting_key, setting_value) VALUES ($1, 'attendance.manual_approval_threshold', '0')
               ON CONFLICT (tenant_id, setting_key) DO UPDATE SET setting_value = '0'`, [corp.A.tenantId])
  r = await call('POST', '/api/workforce/my/check-in', mgr, { checkInType: 'office', reasonCode: 'network_outage' })
  const own = r.json?.checkIn
  check("(the manager's own manual check-in waits too)", own?.approval === 'pending', `(${r.status} ${r.text.slice(0, 120)})`)
  await call('POST', '/api/workforce/my/check-out', mgr)
  r = await call('GET', '/api/attendance-review/approvals', hr)
  const ownItem = (r.json?.approvals ?? []).find((a: any) => a.checkin_id === own?.id)
  if (ownItem) {
    r = await call('POST', `/api/attendance-review/approvals/${ownItem.event_id}`, mgr, { decision: 'approved' })
    check('the manager cannot approve their own', r.status === 403, `(${r.status})`)
    r = await call('POST', `/api/attendance-review/approvals/${ownItem.event_id}`, hr, { decision: 'rejected' })
    check('a rejection has to say why', r.status === 400, `(${r.status})`)
    r = await call('POST', `/api/attendance-review/approvals/${ownItem.event_id}`, hr, { decision: 'rejected', note: 'Was on leave that day' })
    check('HR rejects it', r.status === 200, `(${r.status})`)
    const state = (await owner(`SELECT checkin_state FROM corporate_checkins WHERE id = $1`, [ownItem.checkin_id])).rows[0]?.checkin_state
    check('and its hours do not count', state === 'REVOKED', `(${state})`)
  } else {
    check('HR sees the manager\'s check-in waiting', false)
  }

  console.log('-- employer: a manual check-in outside the shift --')
  const now = new Date()
  const far = now.getHours() < 12 ? ['20:00', '22:00'] : ['02:00', '04:00']
  const shift = (await owner(
    `INSERT INTO roster_shifts (tenant_id, employee_id, code, name, work_date, start_time, end_time)
     VALUES ($1, $2, $3, 'Away from now', CURRENT_DATE, $4::time, $5::time) RETURNING id`,
    [corp.A.tenantId, corp.A.empId, `MF-${RUN}`, far[0], far[1]])).rows[0].id
  try {
    r = await call('POST', '/api/workforce/my/check-in', emp, { checkInType: 'office', reasonCode: 'camera_failure' })
    check('(the employee checks in by hand, hours from their shift)', r.status === 201, `(${r.status} ${r.text.slice(0, 120)})`)
    await call('POST', '/api/workforce/my/check-out', emp)
    r = await call('GET', '/api/attendance-review/alerts?all=true', hr)
    check('an alert: a manual check-in outside the rostered shift',
      (r.json?.alerts ?? []).some((a: any) => a.kind === 'manual_outside_shift' && a.employee_id === corp.A.empId),
      `(${r.status} ${(r.json?.alerts ?? []).map((a: any) => a.kind)})`)
  } finally {
    await owner(`DELETE FROM roster_shifts WHERE id = $1`, [shift])
  }

  r = await call('GET', '/api/attendance/department/export', hr)
  check("the department export counts manual check-ins", r.status === 200 && r.text.split('\n')[0].includes('manual_checkins'),
    `(${r.status} ${r.text.split('\n')[0]})`)

  await call('PUT', '/api/biometrics/settings', admin, { enabled: false, threshold: 0.5 })
  await call('PUT', '/api/attendance-review/settings', admin, { manualApprovalThreshold: 3 })
}

async function main() {
  await school_()
  await employer()
}

main()
  .catch((e) => {
    fail++
    console.error(e)
  })
  .finally(async () => {
    await pool.end().catch(() => undefined)
    console.log(`\n${pass} passed, ${fail} failed`)
    process.exit(fail ? 1 : 0)
  })
