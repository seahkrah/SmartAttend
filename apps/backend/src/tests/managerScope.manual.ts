/**
 * Managers act for the people who report to them, and nobody else
 * (finding #41, src/auth/reportingLines.ts).
 *
 * Corporate tenant A, from the seed: employees 1 and 2 report to Manager A,
 * employee 3 to Manager A2. HR and the managers report to nobody.
 *
 *   - Reporting lines: HR sets and clears them; a manager cannot; nobody is
 *     their own manager; a loop is refused; another tenant's employee is not
 *     found; each change is audited.
 *   - Leave: a manager lists, sees on the calendar, reads balances for and
 *     decides only their team's requests; not their own, not another
 *     manager's team's. An indirect report is in the team. HR decides
 *     anyone's but their own. Two decisions at once: one wins, the balance
 *     moves once. Overlapping and duplicate submissions are refused.
 *     Decisions and cancellations are in the audit log.
 *   - Held check-ins and alerts: a manager sees and decides their team's.
 *   - Rosters and timesheets: a manager rosters, lists, publishes, cancels
 *     and builds timesheets for their team only.
 *   - HR's views (members, analytics, campaigns, department exports) are not
 *     a manager's; Today shows their team.
 *
 * Needs a running API (API_BASE) and the e2e fixtures (corp.json). Suite
 * "managerScope" in scripts/run-all-e2e.sh. Puts back what it changes.
 */
import fs from 'fs'
import path from 'path'
import pg from 'pg'
import { reissue } from './freshTokens.js'

const API = (process.env.API_BASE ?? 'http://127.0.0.1:5000').replace(/\/$/, '')
const dir = process.env.E2E_FIXTURE_DIR ?? path.join(process.cwd(), '.e2e-fixtures')
const corp = JSON.parse(fs.readFileSync(path.join(dir, 'corp.json'), 'utf8'))
const RUN = Date.now().toString(36).slice(-6)
const YEAR = 2031

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

let db: pg.Client
const owner = (sql: string, params: unknown[] = []) => db.query(sql, params)

async function call(method: string, url: string, token: string, body?: unknown) {
  const res = await fetch(API + url, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  })
  return { status: res.status, json: await res.json().catch(() => null) }
}

async function main() {
  db = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await db.connect()
  const A = corp.A
  const T = A.tenantId as string
  const hr = reissue(A.token)
  const dirTok = reissue(A.dirToken)
  const mgr = reissue(A.managerToken)
  const mgr2 = reissue(A.manager2Token)
  const emp1 = reissue(A.empToken)
  const [e1, e2, e3] = A.employees as string[]
  const m1 = A.managerEmpId as string
  const m2 = A.manager2EmpId as string
  const settingsBefore = (await owner(
    `SELECT setting_key, setting_value FROM tenant_settings WHERE tenant_id = $1
      AND setting_key IN ('attendance.manual_approval_threshold', 'biometrics.enabled')`, [T])).rows
  const linesBefore = (await owner(`SELECT id, manager_id FROM employees WHERE tenant_id = $1`, [T])).rows
  let typeId: string | null = null

  try {
    console.log('-- reporting lines --')
    let r = await call('PUT', `/api/hr/employees/${e2}/manager`, mgr, { managerId: m1 })
    check('a manager cannot set reporting lines', r.status === 403, `(${r.status})`)
    r = await call('PUT', `/api/hr/employees/${e1}/manager`, hr, { managerId: e1 })
    check('nobody is their own manager', r.status === 400, `(${r.status})`)
    r = await call('PUT', `/api/hr/employees/${m1}/manager`, hr, { managerId: e1 })
    check('a line that would loop (the manager under their own report) is refused', r.status === 409, `(${r.status} ${r.json?.error})`)
    r = await call('PUT', `/api/hr/employees/${e1}/manager`, hr, { managerId: corp.B.employees[0] })
    check("another tenant's employee is no manager here", r.status === 404, `(${r.status})`)
    r = await call('PUT', `/api/hr/employees/${corp.B.employees[0]}/manager`, hr, { managerId: m1 })
    check("nor is another tenant's employee anyone's report here", r.status === 404, `(${r.status})`)
    r = await call('PUT', `/api/hr/employees/${m2}/manager`, dirTok, { managerId: m1 })
    check('the HR director puts Manager A2 under Manager A', r.status === 200 && r.json?.managerId === m1, `(${r.status} ${JSON.stringify(r.json)})`)
    const lineAudit = (await owner(
      `SELECT before_state, after_state FROM audit_logs WHERE tenant_id = $1 AND action_type = 'REPORTING_LINE_CHANGED' AND resource_id = $2
        ORDER BY created_at DESC LIMIT 1`, [T, m2])).rows[0]
    check('and that is in the audit log, before and after', lineAudit?.before_state?.managerId === null && lineAudit?.after_state?.managerId === m1,
      `(${JSON.stringify(lineAudit)})`)

    console.log('-- leave --')
    r = await call('POST', '/api/leave/types', hr, { code: `MS${RUN}`, name: `Scope leave ${RUN}`, daysPerYear: 10, allowsHalfDay: false, minNoticeDays: 0 })
    typeId = r.json?.type?.id ?? r.json?.leaveType?.id ?? r.json?.id ?? null
    check('(a leave type of 10 days a year)', r.status === 201 && !!typeId, `(${r.status} ${JSON.stringify(r.json).slice(0, 150)})`)
    const raise = (token: string, start: string, end = start) =>
      call('POST', '/api/leave/requests', token, { leaveTypeId: typeId, startDate: start, endDate: end, reason: 'scope test' })
    const hrRaise = (employeeId: string, start: string, end = start) =>
      call('POST', '/api/leave/requests', hr, { employeeId, leaveTypeId: typeId, startDate: start, endDate: end, reason: 'scope test' })
    // 2031-03-03 is a Monday.
    const q1 = (await raise(emp1, `${YEAR}-03-03`)).json?.request?.id
    const q3 = (await hrRaise(e3, `${YEAR}-03-04`)).json?.request?.id
    const qm = (await raise(mgr, `${YEAR}-03-05`)).json?.request?.id
    check('(requests for employee 1, employee 3 and Manager A)', !!q1 && !!q3 && !!qm, `(${q1} ${q3} ${qm})`)

    r = await raise(emp1, `${YEAR}-03-03`)
    check('the same days again are refused', r.status === 409, `(${r.status} ${r.json?.error})`)
    r = await raise(emp1, `${YEAR}-03-02`, `${YEAR}-03-04`)
    check('days overlapping a pending request are refused', r.status === 409, `(${r.status} ${r.json?.error})`)

    // Manager A2 now reports to Manager A, so employee 3 is in A's team, indirectly.
    r = await call('GET', '/api/leave/requests?scope=all', mgr)
    let ids = (r.json?.requests ?? []).map((x: any) => x.id)
    check("a manager's list holds their team, the indirect report included", ids.includes(q1) && ids.includes(q3) && !ids.includes(qm),
      `(${r.status} ${ids.length})`)
    await call('PUT', `/api/hr/employees/${m2}/manager`, hr, { managerId: null })
    r = await call('GET', '/api/leave/requests?scope=all', mgr)
    ids = (r.json?.requests ?? []).map((x: any) => x.id)
    check('with that line cleared, employee 3 is not in it', ids.includes(q1) && !ids.includes(q3), `(${ids.length})`)
    r = await call('GET', '/api/leave/requests?scope=all', mgr2)
    ids = (r.json?.requests ?? []).map((x: any) => x.id)
    check("Manager A2 sees employee 3's, not employee 1's", ids.includes(q3) && !ids.includes(q1), `(${ids.length})`)
    r = await call('GET', '/api/leave/requests?scope=all', hr)
    ids = (r.json?.requests ?? []).map((x: any) => x.id)
    check('HR sees all three', [q1, q3, qm].every((x) => ids.includes(x)), `(${ids.length})`)

    r = await call('GET', `/api/leave/calendar?from=${YEAR}-03-01&to=${YEAR}-03-31`, mgr)
    const cal = (r.json?.days ?? []).map((d: any) => d.employee_id)
    check("a manager's calendar: their team and themselves, not employee 3", cal.includes(e1) && cal.includes(m1) && !cal.includes(e3),
      `(${r.status} ${[...new Set(cal)].length})`)
    r = await call('GET', `/api/leave/balances?employeeId=${e3}`, mgr)
    check("a manager cannot read the balance of someone outside their team", r.status === 404, `(${r.status})`)
    r = await call('GET', `/api/leave/balances?employeeId=${e1}`, mgr)
    check('but can for their report', r.status === 200, `(${r.status})`)

    r = await call('POST', `/api/leave/requests/${q3}/decision`, mgr, { decision: 'approved' })
    check("a manager cannot decide another manager's report's leave", r.status === 404, `(${r.status})`)
    r = await call('POST', `/api/leave/requests/${qm}/decision`, mgr, { decision: 'approved' })
    check('nor their own', r.status === 403, `(${r.status} ${r.json?.error})`)
    r = await call('POST', `/api/leave/requests/${qm}/decision`, mgr2, { decision: 'approved' })
    check('nor may a peer manager decide it', r.status === 404, `(${r.status})`)
    r = await call('POST', `/api/leave/requests/${q3}/decision`, mgr2, { decision: 'rejected', note: 'Busy week' })
    check("Manager A2 decides their own report's", r.status === 200 && r.json?.request?.status === 'rejected', `(${r.status})`)
    r = await call('POST', `/api/leave/requests/${qm}/decision`, hr, { decision: 'approved' })
    check("HR decides the manager's", r.status === 200, `(${r.status})`)
    const decAudit = (await owner(
      `SELECT action_type, actor_role, action_scope, after_state FROM audit_logs WHERE tenant_id = $1 AND resource_type = 'leave_request'
        AND resource_id = ANY($2) ORDER BY created_at`, [T, [q3, qm]])).rows
    check('each decision is in the audit log, with who decided', decAudit.length === 2
      && decAudit.some((a: any) => a.action_type === 'LEAVE_REJECTED' && a.after_state?.note === 'Busy week')
      && decAudit.some((a: any) => a.action_type === 'LEAVE_APPROVED'), `(${JSON.stringify(decAudit)})`)

    // Two decisions at once on one request: one wins, the balance moves once.
    const before = (await owner(`SELECT pending_days, taken_days FROM leave_balances WHERE tenant_id = $1 AND employee_id = $2 AND leave_type_id = $3 AND year = $4`,
      [T, e1, typeId, YEAR])).rows[0]
    const [a, b] = await Promise.all([
      call('POST', `/api/leave/requests/${q1}/decision`, mgr, { decision: 'approved' }),
      call('POST', `/api/leave/requests/${q1}/decision`, hr, { decision: 'approved' }),
    ])
    const codes = [a.status, b.status].sort()
    check('two decisions at once: one is made, the other refused', JSON.stringify(codes) === '[200,409]', `(${codes})`)
    const after = (await owner(`SELECT pending_days, taken_days FROM leave_balances WHERE tenant_id = $1 AND employee_id = $2 AND leave_type_id = $3 AND year = $4`,
      [T, e1, typeId, YEAR])).rows[0]
    check('and the balance moved once: one day from pending to taken',
      Number(after?.pending_days) === Number(before?.pending_days) - 1 && Number(after?.taken_days) === Number(before?.taken_days) + 1,
      `(${JSON.stringify(before)} -> ${JSON.stringify(after)})`)
    const once = (await owner(`SELECT count(*)::int AS n FROM audit_logs WHERE tenant_id = $1 AND resource_id = $2 AND action_type = 'LEAVE_APPROVED'`,
      [T, q1])).rows[0].n
    check('and one approval is audited, not two', once === 1, `(${once})`)
    r = await call('POST', `/api/leave/requests/${q1}/cancel`, emp1)
    const cancelAudit = (await owner(`SELECT before_state, after_state FROM audit_logs WHERE tenant_id = $1 AND resource_id = $2 AND action_type = 'LEAVE_CANCELLED'`,
      [T, q1])).rows[0]
    check('a cancellation is audited too', r.status === 200 && cancelAudit?.before_state?.status === 'approved', `(${r.status} ${JSON.stringify(cancelAudit)})`)
    r = await call('POST', `/api/leave/requests/${q3}/cancel`, mgr2)
    check("a manager cannot cancel their report's leave (HR or the employee does)", r.status === 403, `(${r.status})`)

    console.log('-- held check-ins and alerts --')
    await owner(`DELETE FROM tenant_settings WHERE tenant_id = $1 AND setting_key IN ('attendance.manual_approval_threshold', 'biometrics.enabled')`, [T])
    await owner(`INSERT INTO tenant_settings (tenant_id, setting_key, setting_value) VALUES ($1, 'attendance.manual_approval_threshold', '0'), ($1, 'biometrics.enabled', 'true')`, [T])
    await call('POST', '/api/workforce/my/check-out', emp1)
    r = await call('POST', '/api/workforce/my/check-in', emp1, { checkInType: 'office', reasonCode: 'camera_failure' })
    const held1 = r.json?.checkIn?.eventId ?? (await owner(
      `SELECT id FROM attendance_events WHERE tenant_id = $1 AND employee_id = $2 AND kind = 'check_in' ORDER BY server_time DESC LIMIT 1`, [T, e1])).rows[0]?.id
    check('(employee 1 checks in by hand, held for a manager)', r.status === 201 && r.json?.checkIn?.approval === 'pending', `(${r.status} ${JSON.stringify(r.json?.checkIn)})`)
    // Employee 3 has no token in the seed: their held check-in is a fixture row, as the core would write it.
    await owner(`UPDATE corporate_checkins SET check_out_time = LOCALTIMESTAMP WHERE tenant_id = $1 AND employee_id = $2 AND check_out_time IS NULL`, [T, e3])
    const ci3 = (await owner(
      `INSERT INTO corporate_checkins (tenant_id, employee_id, check_in_type, check_in_time, face_verified, checkin_state, state_reason)
       VALUES ($1, $2, 'office', LOCALTIMESTAMP, false, 'FLAGGED', 'Manual check-in awaiting a manager') RETURNING id`, [T, e3])).rows[0].id
    const held3 = (await owner(
      `INSERT INTO attendance_events (tenant_id, platform, kind, employee_id, checkin_id, method, reason_code, actor_user_id, approval_state)
       VALUES ($1, 'corporate', 'check_in', $2, $3, 'manual', 'camera_failure', (SELECT user_id FROM employees WHERE id = $2), 'pending')
       RETURNING id`, [T, e3, ci3])).rows[0].id
    r = await call('GET', '/api/attendance-review/approvals', mgr)
    const ev = (r.json?.approvals ?? []).map((x: any) => x.event_id)
    check("a manager's approvals: their report's held check-in, not employee 3's", ev.includes(held1) && !ev.includes(held3),
      `(${r.status} ${ev.length})`)
    r = await call('POST', `/api/attendance-review/approvals/${held3}`, mgr, { decision: 'approved' })
    check("and they cannot decide employee 3's", r.status === 404, `(${r.status})`)
    r = await call('POST', `/api/attendance-review/approvals/${held3}`, mgr2, { decision: 'approved' })
    check("Manager A2 can", r.status === 200, `(${r.status} ${r.json?.error})`)
    r = await call('POST', `/api/attendance-review/approvals/${held1}`, mgr, { decision: 'approved' })
    check('Manager A decides their own report\'s', r.status === 200, `(${r.status} ${r.json?.error})`)
    const ciAudit = (await owner(`SELECT count(*)::int AS n FROM audit_logs WHERE tenant_id = $1 AND action_type = 'CHECKIN_APPROVED'
      AND after_state->>'eventId' = ANY($2)`, [T, [held1, held3]])).rows[0].n
    check('both decisions are audited', ciAudit === 2, `(${ciAudit})`)
    r = await call('GET', '/api/attendance-review/approvals', hr)
    check('HR sees the queue for everyone', r.status === 200, `(${r.status})`)

    const al = async (kind: string, employeeId: string | null, device: string | null) => (await owner(
      `INSERT INTO attendance_alerts (tenant_id, kind, employee_id, device_id, alert_day, detail) VALUES ($1, $2, $3, $4, DATE '${YEAR}-01-01', '{}') RETURNING id`,
      [T, kind, employeeId, device])).rows[0].id
    const a1 = await al('impossible_travel', e1, null)
    const a3 = await al('impossible_travel', e3, null)
    const aDev = await al('device_manual_burst', null, `dev-${RUN}`)
    r = await call('GET', '/api/attendance-review/alerts', mgr)
    const seen = (r.json?.alerts ?? []).map((x: any) => x.id)
    check("a manager's alerts: their report's, not employee 3's, not a device's", seen.includes(a1) && !seen.includes(a3) && !seen.includes(aDev),
      `(${r.status} ${seen.length})`)
    r = await call('POST', `/api/attendance-review/alerts/${a3}/acknowledge`, mgr)
    check("they cannot acknowledge employee 3's", r.status === 404, `(${r.status})`)
    r = await call('POST', `/api/attendance-review/alerts/${a1}/acknowledge`, mgr)
    check("they can their report's", r.status === 200, `(${r.status})`)
    r = await call('GET', '/api/attendance-review/alerts', hr)
    const hrSeen = (r.json?.alerts ?? []).map((x: any) => x.id)
    check('HR sees employee 3\'s and the device\'s', hrSeen.includes(a3) && hrSeen.includes(aDev), `(${hrSeen.length})`)
    r = await call('GET', '/api/attendance-review/manual', mgr)
    check("a manager's manual-entry view has only their team", r.status === 200
      && (r.json?.people ?? []).every((p: any) => [e1, e2].includes(p.person_id)), `(${JSON.stringify(r.json?.people?.map((p: any) => p.person_id))})`)
    await owner(`DELETE FROM attendance_alerts WHERE id = ANY($1)`, [[a1, a3, aDev]])

    console.log('-- rosters and timesheets --')
    const shift = (token: string, employeeId: string, day: string) => call('POST', '/api/workforce/roster', token,
      { employeeId, workDate: day, startTime: '09:00', endTime: '17:00', breakMinutes: 60 })
    // A shift needs a contract covering the day: employee 2 has the seed's; employee 3 gets one for the year.
    await owner(
      `INSERT INTO employment_contracts (tenant_id, employee_id, reference, contract_type, job_title, department_id,
                                         start_date, end_date, weekly_hours, working_days, status, signed_at)
       VALUES ($1, $2, $3, 'permanent', 'Scope test', (SELECT department_id FROM employees WHERE id = $2),
               DATE '${YEAR}-01-01', DATE '${YEAR}-12-31', 40, 5, 'active', CURRENT_TIMESTAMP)`, [T, e3, `MS-${RUN}`])
    r = await shift(mgr, e2, `${YEAR}-04-07`)
    const s1 = r.json?.shift?.id
    check('a manager rosters their report', r.status === 201, `(${r.status} ${r.json?.error})`)
    r = await shift(mgr, e3, `${YEAR}-04-07`)
    check('not employee 3', r.status === 404, `(${r.status})`)
    r = await shift(mgr, A.hrEmpId, `${YEAR}-04-07`)
    check('nor HR, who reports to nobody', r.status === 404, `(${r.status})`)
    r = await shift(hr, e3, `${YEAR}-04-07`)
    const s3 = r.json?.shift?.id
    check('HR rosters employee 3', r.status === 201, `(${r.status} ${r.json?.error})`)
    r = await call('POST', '/api/workforce/roster/bulk', mgr, { employeeId: e3, from: `${YEAR}-04-08`, to: `${YEAR}-04-09`, startTime: '09:00', endTime: '17:00' })
    check('a manager cannot bulk-roster outside their team', r.status === 404, `(${r.status})`)
    r = await call('GET', `/api/workforce/roster?from=${YEAR}-04-01&to=${YEAR}-04-30`, mgr)
    const shifts = (r.json?.shifts ?? []).map((x: any) => x.id)
    check("a manager's roster: their team's shifts, not employee 3's", r.json?.scope === 'team' && shifts.includes(s1) && !shifts.includes(s3),
      `(${r.status} ${r.json?.scope})`)
    r = await call('GET', `/api/workforce/roster?from=${YEAR}-04-01&to=${YEAR}-04-30&employeeId=${e3}`, mgr)
    check('naming employee 3 finds nobody', r.status === 404, `(${r.status})`)
    r = await call('POST', '/api/workforce/roster/publish', mgr, { from: `${YEAR}-04-07`, to: `${YEAR}-04-07` })
    const states = (await owner(`SELECT id, status FROM roster_shifts WHERE id = ANY($1)`, [[s1, s3]])).rows
    const st = (id: string) => states.find((x: any) => x.id === id)?.status
    check("publishing a day publishes the manager's team's shifts, not employee 3's", r.status === 200 && st(s1) === 'published' && st(s3) === 'scheduled',
      `(${r.status} ${JSON.stringify(states)})`)
    r = await call('POST', `/api/workforce/roster/${s3}/cancel`, mgr, { reason: 'not mine' })
    check("a manager cannot cancel employee 3's shift", r.status === 404, `(${r.status})`)
    r = await call('GET', `/api/workforce/roster/coverage?from=${YEAR}-04-07&to=${YEAR}-04-07`, mgr)
    check("coverage counts the manager's team only", r.status === 200 && r.json?.days?.[0]?.people === 1, `(${JSON.stringify(r.json?.days)})`)
    r = await call('GET', `/api/workforce/timesheets/preview?employeeId=${e3}&from=${YEAR}-04-01&to=${YEAR}-04-30`, mgr)
    check("a manager cannot preview employee 3's timesheet", r.status === 404, `(${r.status})`)
    r = await call('POST', '/api/workforce/timesheets', mgr, { employeeId: e3, periodStart: `${YEAR}-04-01`, periodEnd: `${YEAR}-04-30` })
    check('nor build it', r.status === 404, `(${r.status})`)
    r = await call('POST', '/api/workforce/timesheets', hr, { employeeId: e3, periodStart: `${YEAR}-04-01`, periodEnd: `${YEAR}-04-30` })
    const ts3 = r.json?.timesheet?.id
    check('HR builds it', r.status === 201 && !!ts3, `(${r.status} ${r.json?.error})`)
    r = await call('GET', `/api/workforce/timesheets/${ts3}`, mgr)
    check('and the manager cannot open it', r.status === 404, `(${r.status})`)
    r = await call('GET', `/api/workforce/timesheets/${ts3}/rate`, mgr)
    check("nor see the pay rate on it", r.status === 404, `(${r.status})`)
    r = await call('GET', '/api/workforce/timesheets', mgr)
    check("a manager's timesheet list leaves it out", r.status === 200 && !(r.json?.timesheets ?? []).some((x: any) => x.id === ts3), `(${r.status})`)
    r = await call('POST', `/api/workforce/timesheets/${ts3}/decision`, mgr2, { decision: 'approved' })
    check('Manager A2 reaches it (a draft cannot be approved yet)', r.status !== 404, `(${r.status} ${r.json?.error})`)

    console.log('-- the employee directory --')
    r = await call('GET', '/api/corporate/employees?limit=200', mgr)
    const dir = (r.json?.data ?? []).map((x: any) => x.id)
    check("a manager's directory: their team and themselves, not employee 3, not HR (audit F8)",
      r.status === 200 && dir.includes(e1) && dir.includes(e2) && dir.includes(m1) && !dir.includes(e3) && !dir.includes(A.hrEmpId),
      `(${r.status} ${dir.length})`)
    r = await call('GET', `/api/corporate/employees/${e3}`, mgr)
    check("and employee 3's record reads as absent", r.status === 404, `(${r.status})`)
    r = await call('GET', '/api/corporate/employees?limit=200', hr)
    check('HR still sees everyone', r.status === 200 && (r.json?.data ?? []).some((x: any) => x.id === e3), `(${r.status})`)

    console.log("-- HR's views --")
    for (const p of ['/api/hr/members', '/api/hr/overview', '/api/hr/patterns', '/api/hr/compliance/summary', '/api/hr/campaigns',
      '/api/attendance/department/all', '/api/attendance/department/export?format=CSV']) {
      r = await call('GET', p, mgr)
      check(`a manager is refused ${p.split('?')[0]}`, r.status === 403, `(${r.status})`)
    }
    r = await call('POST', '/api/hr/notifications/send', mgr, { title: 'x', message: 'y' })
    check('and cannot send notifications to the organisation', r.status === 403, `(${r.status})`)
    r = await call('GET', '/api/hr/today', mgr)
    const today = (r.json?.people ?? []).map((p: any) => p.employeeId)
    check("Today: the manager's team, not employee 3, not HR", r.json?.scope === 'team' && today.includes(e1) && today.includes(e2)
      && !today.includes(e3) && !today.includes(A.hrEmpId), `(${r.status} ${r.json?.scope} ${today.length})`)
    r = await call('GET', '/api/hr/members', hr)
    check('HR still has the members view', r.status === 200, `(${r.status})`)
  } finally {
    await call('POST', '/api/workforce/my/check-out', emp1)
    await owner(`UPDATE corporate_checkins SET check_out_time = LOCALTIMESTAMP WHERE tenant_id = $1 AND employee_id = $2 AND check_out_time IS NULL`, [T, e3])
    await owner(`DELETE FROM timesheet_entries WHERE timesheet_id IN (SELECT id FROM timesheets WHERE tenant_id = $1 AND period_start >= DATE '${YEAR}-01-01')`, [T]).catch(() => undefined)
    await owner(`DELETE FROM timesheets WHERE tenant_id = $1 AND period_start >= DATE '${YEAR}-01-01'`, [T]).catch((e) => console.log('  (cleanup timesheets)', e.message))
    await owner(`DELETE FROM roster_shifts WHERE tenant_id = $1 AND work_date >= DATE '${YEAR}-01-01'`, [T])
    await owner(`DELETE FROM employment_contracts WHERE tenant_id = $1 AND reference = $2`, [T, `MS-${RUN}`])
      .catch((e) => console.log('  (contract kept:', e.message, ')'))
    if (typeId) {
      await owner(`DELETE FROM leave_request_days WHERE request_id IN (SELECT id FROM leave_requests WHERE leave_type_id = $1)`, [typeId])
      await owner(`DELETE FROM leave_requests WHERE leave_type_id = $1`, [typeId])
      await owner(`DELETE FROM leave_balances WHERE leave_type_id = $1`, [typeId])
      await owner(`DELETE FROM leave_types WHERE id = $1`, [typeId])
    }
    for (const row of linesBefore) await owner(`UPDATE employees SET manager_id = $1 WHERE id = $2`, [row.manager_id, row.id])
    await owner(`DELETE FROM tenant_settings WHERE tenant_id = $1 AND setting_key IN ('attendance.manual_approval_threshold', 'biometrics.enabled')`, [T])
    for (const s of settingsBefore) {
      await owner(`INSERT INTO tenant_settings (tenant_id, setting_key, setting_value) VALUES ($1, $2, $3)`, [T, s.setting_key, s.setting_value])
    }
    await db.end()
  }
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
