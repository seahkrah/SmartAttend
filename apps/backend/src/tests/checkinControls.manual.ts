/**
 * Where, from what and when an employee may check in (brief 5.5).
 *
 *   - Administration: modes and numbers, sites (a circle and its networks),
 *     registered devices; admin and HR director change them, HR reads them,
 *     an employee does neither.
 *   - Geofence, with the position's accuracy: no position, too imprecise,
 *     outside, inside; "enforce" refuses, "flag" holds the hours for a
 *     manager and raises an alert; what was found is kept on the event.
 *   - Network: the request's address against the sites' CIDRs; a forged
 *     X-Forwarded-For is not believed.
 *   - Device: none, unregistered, someone else's, revoked; one's own and a
 *     shared kiosk pass.
 *   - Shift window: not rostered passes; outside a rostered shift does not.
 *   - Buddy punching and impossible travel raise alerts.
 *   - Breaks: one at a time, only while checked in, closed at check-out, and
 *     taken off worked hours.
 *
 * Needs a running API (API_BASE) and the e2e fixtures (corp.json). Suite
 * "checkinControls" in scripts/run-all-e2e.sh. Leaves corporate tenant A's
 * settings as it found them and removes the sites, devices, shifts and
 * alerts it made.
 */
import fs from 'fs'
import path from 'path'
import pg from 'pg'
import { reissue } from './freshTokens.js'

const API = (process.env.API_BASE ?? 'http://127.0.0.1:5000').replace(/\/$/, '')
const dir = process.env.E2E_FIXTURE_DIR ?? path.join(process.cwd(), '.e2e-fixtures')
const corp = JSON.parse(fs.readFileSync(path.join(dir, 'corp.json'), 'utf8'))
const RUN = Date.now().toString(36)

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

async function call(method: string, url: string, token: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(API + url, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...headers },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  })
  return { status: res.status, json: await res.json().catch(() => null) }
}

// Head office in Monrovia; 0.001 degrees of latitude is about 111 m.
const HQ = { latitude: 6.3005, longitude: -10.7969 }
const at = (metresNorth: number, accuracyMetres: number | null = 15) =>
  ({ latitude: HQ.latitude + metresNorth / 111195, longitude: HQ.longitude, accuracyMetres })
const ACCRA = { latitude: 5.6037, longitude: -0.187, accuracyMetres: 15 }
const NEW_KINDS = ['buddy_punching', 'impossible_travel', 'outside_geofence', 'outside_network', 'unregistered_device', 'outside_shift_window']

async function main() {
  const A = corp.A
  const T = A.tenantId as string
  const admin = reissue(A.adminToken)
  const hr = reissue(A.token)
  const emp = reissue(A.empToken)
  const mgr = reissue(A.managerToken)
  const empId = A.empId as string
  const mgrId = A.managerEmpId as string
  const before = (await owner(
    `SELECT setting_key, setting_value FROM tenant_settings
      WHERE tenant_id = $1 AND (setting_key LIKE 'checkin.%' OR setting_key LIKE 'biometrics.%' OR setting_key = 'attendance.shift_early_minutes')`,
    [T])).rows
  const out = async (token: string, body: unknown = {}) => call('POST', '/api/workforce/my/check-out', token, body)
  const inn = (token: string, body: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
    call('POST', '/api/workforce/my/check-in', token, { checkInType: 'office', ...body }, headers)
  const controls = (body: Record<string, unknown>) => call('PUT', '/api/checkin-controls/settings', admin, body)
  const lastCheckIn = async (employeeId: string) => (await owner(
    `SELECT e.controls, e.approval_state, e.client_ip, c.checkin_state, c.state_reason
       FROM attendance_events e JOIN corporate_checkins c ON c.id = e.checkin_id
      WHERE e.tenant_id = $1 AND e.employee_id = $2 AND e.kind = 'check_in' ORDER BY e.server_time DESC LIMIT 1`,
    [T, employeeId])).rows[0]
  const alertsOf = async (kind: string, employeeId?: string) => (await owner(
    `SELECT * FROM attendance_alerts WHERE tenant_id = $1 AND kind = $2 AND ($3::uuid IS NULL OR employee_id = $3)`,
    [T, kind, employeeId ?? null])).rows

  try {
    // Face matching off for this tenant, so check-ins are plain manual ones that need no approval.
    await owner(`DELETE FROM tenant_settings WHERE tenant_id = $1 AND (setting_key LIKE 'checkin.%' OR setting_key LIKE 'biometrics.%')`, [T])
    await owner(`DELETE FROM attendance_alerts WHERE tenant_id = $1 AND kind = ANY($2)`, [T, NEW_KINDS])
    await out(emp)
    await out(mgr)

    console.log('-- administration --')
    let r = await call('GET', '/api/checkin-controls/settings', hr)
    check('HR reads the controls, all off by default', r.status === 200
      && ['geofence', 'network', 'device', 'shift_window'].every((k) => r.json?.settings?.[k] === 'off'), `(${r.status} ${JSON.stringify(r.json)})`)
    r = await call('PUT', '/api/checkin-controls/settings', hr, { geofence: 'enforce' })
    check('HR cannot change them', r.status === 403, `(${r.status})`)
    r = await call('GET', '/api/checkin-controls/settings', emp)
    check('an employee cannot read them', r.status === 403, `(${r.status})`)
    r = await controls({ geofence: 'sometimes' })
    check('a mode that is not off, flag or enforce is refused', r.status === 400, `(${r.status})`)
    r = await controls({ maxAccuracyMetres: 2 })
    check('an accuracy limit below 5 m is refused', r.status === 400, `(${r.status})`)
    r = await call('POST', '/api/checkin-controls/sites', admin, { name: `HQ ${RUN}`, latitude: 95, longitude: 0 })
    check('a site off the globe is refused', r.status === 400, `(${r.status})`)
    r = await call('POST', '/api/checkin-controls/sites', admin, { name: `HQ ${RUN}`, ...HQ, allowedCidrs: ['example.com'] })
    check('a network that is not a CIDR is refused', r.status === 400, `(${r.status} ${r.json?.error})`)
    r = await call('POST', '/api/checkin-controls/sites', admin,
      { name: `HQ ${RUN}`, ...HQ, radiusMetres: 100, allowedCidrs: ['203.0.113.0/24'] })
    const site = r.json?.site
    check('the admin adds a site: a circle and its network', r.status === 201 && site?.radiusMetres === 100
      && site?.allowedCidrs?.[0] === '203.0.113.0/24', `(${r.status} ${JSON.stringify(r.json)})`)
    r = await call('POST', '/api/checkin-controls/sites', emp, { name: 'Mine', ...HQ })
    check('an employee cannot add one', r.status === 403, `(${r.status})`)
    const audited = await owner(
      `SELECT count(*)::int AS n FROM audit_logs WHERE tenant_id = $1 AND action_type = 'CHECKIN_SITE_CREATED' AND resource_id = $2`,
      [T, site?.id])
    check('adding it is in the audit log', audited.rows[0].n === 1, `(${audited.rows[0].n})`)

    console.log('-- geofence, enforced --')
    await controls({ geofence: 'enforce', maxAccuracyMetres: 100 })
    r = await inn(emp)
    check('no position is refused', r.status === 403 && r.json?.code === 'no_location', `(${r.status} ${r.json?.code})`)
    r = await inn(emp, at(0, 500))
    check('a position too imprecise is refused, however close it claims', r.status === 403 && r.json?.code === 'location_imprecise',
      `(${r.status} ${r.json?.code})`)
    r = await inn(emp, at(2000))
    check('two kilometres away is refused', r.status === 403 && r.json?.code === 'outside_geofence', `(${r.status} ${r.json?.code})`)
    r = await inn(emp, at(130, 40))
    check('at the edge, within the phone\'s error, is let in', r.status === 201, `(${r.status} ${r.json?.code})`)
    let ev = await lastCheckIn(empId)
    const geo = (ev?.controls ?? []).find((x: any) => x.control === 'geofence')
    check('and the event keeps what was found: site, distance, accuracy', geo?.ok === true && geo?.detail?.distanceMetres === 130
      && geo?.detail?.accuracyMetres === 40 && geo?.detail?.site === `HQ ${RUN}`, `(${JSON.stringify(geo)})`)
    r = await out(emp, at(10))
    check('(checks out)', r.status === 200, `(${r.status})`)

    console.log('-- geofence, flagged --')
    await controls({ geofence: 'flag' })
    r = await inn(emp, at(2000))
    ev = await lastCheckIn(empId)
    check('outside, the check-in is recorded but held for a manager', r.status === 201 && ev?.approval_state === 'pending'
      && ev?.checkin_state === 'FLAGGED' && /outside geofence/.test(ev?.state_reason ?? ''), `(${r.status} ${JSON.stringify(ev)})`)
    check('and raises an alert', (await alertsOf('outside_geofence', empId)).length === 1)
    check('the employee is told it is held, and why', r.json?.checkIn?.awaitingApproval === true
      && /outside geofence/.test(r.json?.checkIn?.stateReason ?? ''), `(${JSON.stringify(r.json?.checkIn)})`)
    r = await call('GET', '/api/workforce/my/attendance', emp)
    check('with the geofence on, the page is asked for a position', r.json?.locationWanted === true, `(${r.json?.locationWanted})`)
    r = await call('GET', '/api/attendance-review/approvals', mgr)
    check('it is in the manager\'s approvals', r.status === 200
      && (r.json?.approvals ?? []).some((a: any) => a.employee_id === empId || a.employeeId === empId), `(${r.status})`)
    await out(emp, at(2000))
    await controls({ geofence: 'off' })
    r = await call('GET', '/api/workforce/my/attendance', emp)
    check("with it off, it is not: nobody's location is collected for nothing", r.json?.locationWanted === false,
      `(${r.json?.locationWanted})`)

    console.log('-- network --')
    await controls({ network: 'enforce' })
    r = await inn(emp, {}, { 'X-Forwarded-For': '203.0.113.5' })
    check('from outside the site\'s network, even claiming to be inside it, is refused',
      r.status === 403 && r.json?.code === 'outside_network', `(${r.status} ${r.json?.code})`)
    r = await call('PATCH', `/api/checkin-controls/sites/${site?.id}`, admin, { allowedCidrs: ['203.0.113.0/24', '127.0.0.1', '::1'] })
    check('(the admin adds this network)', r.status === 200, `(${r.status} ${r.json?.error})`)
    r = await inn(emp)
    ev = await lastCheckIn(empId)
    check('from it, the check-in is let in, with its address recorded', r.status === 201 && ev?.client_ip === '127.0.0.1',
      `(${r.status} ${r.json?.code} ${ev?.client_ip})`)
    await out(emp)
    await controls({ network: 'off' })

    console.log('-- registered devices --')
    await controls({ device: 'enforce' })
    const phone = `phone-${RUN}`
    const kiosk = `kiosk-${RUN}`
    r = await inn(emp)
    check('a device that does not identify itself is refused', r.status === 403 && r.json?.code === 'no_device_id', `(${r.status} ${r.json?.code})`)
    r = await inn(emp, {}, { 'X-Device-Id': phone })
    check('an unregistered one is refused', r.status === 403 && r.json?.code === 'unregistered_device', `(${r.status} ${r.json?.code})`)
    r = await call('POST', '/api/checkin-controls/devices', emp, { deviceId: phone, employeeId: empId })
    check('an employee cannot register their own', r.status === 403, `(${r.status})`)
    r = await call('POST', '/api/checkin-controls/devices', admin, { deviceId: phone, employeeId: empId, label: 'Work phone' })
    const phoneRow = r.json?.device
    check('the admin registers it to the employee', r.status === 201 && phoneRow?.employeeId === empId, `(${r.status} ${JSON.stringify(r.json)})`)
    r = await call('POST', '/api/checkin-controls/devices', admin, { deviceId: phone, employeeId: empId })
    check('not twice', r.status === 409, `(${r.status})`)
    r = await inn(emp, {}, { 'X-Device-Id': phone })
    check('the employee checks in on it', r.status === 201, `(${r.status} ${r.json?.code})`)
    await out(emp)
    r = await inn(mgr, {}, { 'X-Device-Id': phone })
    check('someone else cannot', r.status === 403 && r.json?.code === 'unregistered_device', `(${r.status} ${r.json?.code})`)
    r = await call('POST', '/api/checkin-controls/devices', admin, { deviceId: kiosk, label: 'Lobby kiosk' })
    check('(a shared kiosk is registered)', r.status === 201 && r.json?.device?.employeeId === null, `(${r.status})`)
    r = await inn(mgr, {}, { 'X-Device-Id': kiosk })
    check('anyone checks in at a shared kiosk', r.status === 201, `(${r.status} ${r.json?.code})`)
    await out(mgr)
    r = await call('DELETE', `/api/checkin-controls/devices/${phoneRow?.id}`, admin)
    check('(the admin revokes the phone)', r.status === 200, `(${r.status})`)
    r = await inn(emp, {}, { 'X-Device-Id': phone })
    check('a revoked device is refused', r.status === 403 && r.json?.code === 'unregistered_device', `(${r.status} ${r.json?.code})`)
    await controls({ device: 'off' })

    console.log('-- shift window --')
    await controls({ shift_window: 'enforce', shiftEarlyMinutes: 60 })
    r = await inn(emp)
    check('someone not rostered today is not outside a roster', r.status === 201, `(${r.status} ${r.json?.code})`)
    await out(emp)
    await owner(
      `INSERT INTO roster_shifts (tenant_id, employee_id, code, name, work_date, start_time, end_time)
       VALUES ($1, $2, $3, 'Ended shift', (LOCALTIMESTAMP - INTERVAL '5 hours')::date,
               (LOCALTIMESTAMP - INTERVAL '5 hours')::time, (LOCALTIMESTAMP - INTERVAL '4 hours')::time)`,
      [T, empId, `E${RUN}`.slice(0, 30)])
    r = await inn(emp)
    check('after the shift has ended, checking in is refused', r.status === 403 && r.json?.code === 'outside_shift_window',
      `(${r.status} ${r.json?.code})`)
    await owner(
      `INSERT INTO roster_shifts (tenant_id, employee_id, code, name, work_date, start_time, end_time)
       VALUES ($1, $2, $3, 'Current shift', (LOCALTIMESTAMP - INTERVAL '30 minutes')::date,
               (LOCALTIMESTAMP - INTERVAL '30 minutes')::time, (LOCALTIMESTAMP + INTERVAL '2 hours')::time)`,
      [T, empId, `C${RUN}`.slice(0, 30)])
    r = await inn(emp)
    check('during a shift, it is let in', r.status === 201, `(${r.status} ${r.json?.code})`)
    await out(emp)
    await controls({ shift_window: 'off' })

    console.log('-- buddy punching and impossible travel --')
    const shared = `shared-${RUN}`
    await inn(emp, {}, { 'X-Device-Id': shared })
    await out(emp)
    r = await inn(mgr, {}, { 'X-Device-Id': shared })
    check('(another person checks in on the same phone moments later)', r.status === 201, `(${r.status})`)
    await out(mgr)
    const buddy = await alertsOf('buddy_punching', mgrId)
    check('that is a buddy-punching alert, naming the first person', buddy.length === 1 && buddy[0].device_id === shared
      && buddy[0].detail?.otherEmployees?.includes(empId), `(${JSON.stringify(buddy)})`)
    await inn(emp, {}, { 'X-Device-Id': kiosk })
    await out(emp)
    await inn(mgr, {}, { 'X-Device-Id': kiosk })
    await out(mgr)
    check('a shared kiosk is not buddy punching', (await alertsOf('buddy_punching')).every((a: any) => a.device_id !== kiosk))
    await inn(emp, at(0))
    await out(emp, at(0))
    r = await inn(emp, ACCRA)
    check('(the same person checks in 1,200 km away a minute later)', r.status === 201, `(${r.status})`)
    const travel = await alertsOf('impossible_travel', empId)
    check('that is an impossible-travel alert', travel.length === 1 && travel[0].detail?.kmh > 300, `(${JSON.stringify(travel)})`)
    await out(emp, ACCRA)

    console.log('-- breaks --')
    r = await call('POST', '/api/workforce/my/break-start', emp)
    check('no break without checking in', r.status === 409, `(${r.status})`)
    await inn(emp)
    r = await call('POST', '/api/workforce/my/break-start', emp)
    check('a break starts', r.status === 201 && !!r.json?.break?.breakId, `(${r.status} ${JSON.stringify(r.json)})`)
    r = await call('GET', '/api/workforce/my/attendance', emp)
    check("and the employee's page says they are on it", !!r.json?.onBreakSince && !!r.json?.onTheClock, `(${r.json?.onBreakSince})`)
    r = await call('POST', '/api/workforce/my/break-start', emp)
    check('one at a time', r.status === 409, `(${r.status})`)
    r = await call('POST', '/api/workforce/my/break-end', emp)
    check('and ends', r.status === 200 && !!r.json?.break?.endedAt, `(${r.status})`)
    r = await call('POST', '/api/workforce/my/break-end', emp)
    check('not twice', r.status === 409, `(${r.status})`)
    r = await call('POST', '/api/workforce/my/break-start', emp)
    r = await out(emp)
    const checkinId = r.json?.checkIn?.id
    const kinds = (await owner(
      `SELECT kind FROM attendance_events WHERE tenant_id = $1 AND checkin_id = $2 ORDER BY server_time, created_at`, [T, checkinId])).rows
      .map((x: any) => x.kind)
    // The last break's end and the check-out share a transaction, and so a timestamp: their order is not asserted.
    check('a break open at check-out ends with it; each is an event',
      JSON.stringify(kinds.slice(0, 4)) === JSON.stringify(['check_in', 'break_start', 'break_end', 'break_start'])
      && JSON.stringify(kinds.slice(4).sort()) === JSON.stringify(['break_end', 'check_out']), `(${kinds})`)
    const week0 = Number((await call('GET', '/api/workforce/my/attendance', emp)).json?.week?.verifiedHours)
    // Four hours checked in, with breaks of an hour in all: three hours worked.
    await owner(`UPDATE corporate_checkins SET check_in_time = check_out_time - INTERVAL '4 hours' WHERE id = $1`, [checkinId])
    await owner(
      `UPDATE checkin_breaks k SET started_at = c.check_out_time - INTERVAL '3 hours',
                                   ended_at = c.check_out_time - INTERVAL '2 hours 30 minutes'
         FROM corporate_checkins c
        WHERE c.id = k.checkin_id AND k.id = (SELECT id FROM checkin_breaks WHERE checkin_id = $1 ORDER BY started_at LIMIT 1)`,
      [checkinId])
    await owner(
      `UPDATE checkin_breaks k SET started_at = c.check_out_time - INTERVAL '1 hour', ended_at = c.check_out_time - INTERVAL '30 minutes'
         FROM corporate_checkins c
        WHERE c.id = k.checkin_id AND k.id = (SELECT id FROM checkin_breaks WHERE checkin_id = $1 ORDER BY started_at DESC LIMIT 1)`,
      [checkinId])
    const mine = (await call('GET', '/api/workforce/my/attendance', emp)).json
    const week1 = Number(mine?.week?.verifiedHours)
    check('breaks come off worked hours: four hours checked in, an hour of breaks, three worked',
      Math.abs(week1 - week0 - 3) <= 0.02, `(${week0} -> ${week1})`)
    const row = (mine?.history ?? []).find((c: any) => c.id === checkinId)
    check("and the check-in's own row agrees", row?.hours === '3.00', `(${row?.hours})`)
  } finally {
    await out(emp)
    await out(mgr)
    await owner(`DELETE FROM roster_shifts WHERE tenant_id = $1 AND employee_id = $2 AND (code = $3 OR code = $4)`,
      [T, empId, `E${RUN}`.slice(0, 30), `C${RUN}`.slice(0, 30)])
    await owner(`DELETE FROM attendance_devices WHERE tenant_id = $1 AND device_id LIKE $2`, [T, `%-${RUN}`])
    await owner(`DELETE FROM checkin_sites WHERE tenant_id = $1 AND name = $2`, [T, `HQ ${RUN}`])
    await owner(`DELETE FROM attendance_alerts WHERE tenant_id = $1 AND kind = ANY($2)`, [T, NEW_KINDS])
    await owner(`DELETE FROM tenant_settings WHERE tenant_id = $1 AND (setting_key LIKE 'checkin.%' OR setting_key LIKE 'biometrics.%' OR setting_key = 'attendance.shift_early_minutes')`, [T])
    for (const row of before) {
      await owner(`INSERT INTO tenant_settings (tenant_id, setting_key, setting_value) VALUES ($1, $2, $3)`,
        [T, row.setting_key, row.setting_value])
    }
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
