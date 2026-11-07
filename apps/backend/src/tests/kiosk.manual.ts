/**
 * Attendance kiosks (src/routes/kiosk.ts, src/kiosk/auth.ts).
 *
 *   - Registration: the admin creates a kiosk at one of the tenant's sites,
 *     with a PIN; HR reads but cannot create; a site of another tenant, or a
 *     retired one, is refused; the device is registered as a shared kiosk.
 *   - Pairing: a code once, within 15 minutes; a used, wrong or expired code
 *     pairs nothing; a new code unpairs the old device.
 *   - Restricted access: the kiosk token reaches the kiosk routes and
 *     nothing else; a user's token does not reach them; another tenant's
 *     employees cannot be found from it; a challenge from another kiosk
 *     cannot be answered at this one.
 *   - Punching: by face (consent, enrolment, a match cited once) or by the
 *     attendant's PIN with a reason; five wrong PINs lock it; a retried punch
 *     answers with the first result.
 *   - Controls: the kiosk is placed at its site; a retired site fails it; the
 *     network control applies to the kiosk's address; a revoked kiosk's
 *     device fails the device control; the shift window applies.
 *   - Revocation ends the token at once. Every administrative change is audited.
 *
 * Needs a running API and face worker (API_BASE) and the e2e fixtures.
 * Suite "kiosk" in scripts/run-all-e2e.sh. Puts back what it changes.
 */
import fs from 'fs'
import path from 'path'
import pg from 'pg'
import { reissue } from './freshTokens.js'

const API = (process.env.API_BASE ?? 'http://127.0.0.1:5000').replace(/\/$/, '')
const dir = process.env.E2E_FIXTURE_DIR ?? path.join(process.cwd(), '.e2e-fixtures')
const FACES = path.join(process.cwd(), 'src', 'tests', 'fixtures', 'faces')
const corp = JSON.parse(fs.readFileSync(path.join(dir, 'corp.json'), 'utf8'))
const RUN = Date.now().toString(36).slice(-6)

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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function call(method: string, url: string, auth: string | null, body?: unknown, headers: Record<string, string> = {}) {
  const h: Record<string, string> = { 'Content-Type': 'application/json', ...headers }
  if (auth) h.Authorization = auth
  const res = await fetch(API + url, { method, headers: h, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) })
  return { status: res.status, json: await res.json().catch(() => null) }
}
const bearer = (t: string) => `Bearer ${t}`
const kioskAuth = (t: string) => `Kiosk ${t}`

const POSES: Record<string, string> = { center: 'synthetic-center.jpg', left: 'synthetic-left.jpg', right: 'synthetic-right.jpg' }
const MIRROR: Record<string, string> = { center: 'synthetic-center-m.jpg', left: 'synthetic-left-m.jpg', right: 'synthetic-right-m.jpg' }

async function frames(url: string, auth: string, fields: Record<string, string>, files: string[]) {
  const f = new FormData()
  for (const [k, v] of Object.entries(fields)) f.append(k, v)
  f.append('frameTimes', JSON.stringify(files.map((_, i) => i * 700)))
  for (const name of files) f.append('frames', new Blob([fs.readFileSync(path.join(FACES, name))], { type: 'image/jpeg' }), name)
  const res = await fetch(API + url, { method: 'POST', headers: { Authorization: auth }, body: f })
  return { status: res.status, json: await res.json().catch(() => null) }
}

async function main() {
  db = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await db.connect()
  const A = corp.A
  const T = A.tenantId as string
  const admin = reissue(A.adminToken)
  const hr = reissue(A.token)
  const dirTok = reissue(A.dirToken)
  const adminB = reissue(corp.B.adminToken)
  const emp1 = reissue(A.empToken)
  const e1 = A.employees[0] as string
  const code1 = (await owner(`SELECT employee_id FROM employees WHERE id = $1`, [e1])).rows[0].employee_id as string
  const codeB = (await owner(`SELECT employee_id FROM employees WHERE id = $1`, [corp.B.employees[0]])).rows[0].employee_id as string
  const before = (await owner(
    `SELECT setting_key, setting_value FROM tenant_settings WHERE tenant_id = $1 AND (setting_key LIKE 'checkin.%' OR setting_key LIKE 'biometrics.%')`,
    [T])).rows
  const made: { sites: string[]; kiosks: string[] } = { sites: [], kiosks: [] }

  try {
    await owner(`DELETE FROM tenant_settings WHERE tenant_id = $1 AND (setting_key LIKE 'checkin.%' OR setting_key LIKE 'biometrics.%')`, [T])
    await owner(`UPDATE corporate_checkins SET check_out_time = LOCALTIMESTAMP WHERE tenant_id = $1 AND employee_id = $2 AND check_out_time IS NULL`, [T, e1])
    const site = (await call('POST', '/api/checkin-controls/sites', bearer(admin),
      { name: `Kiosk site ${RUN}`, latitude: 6.3, longitude: -10.8, allowedCidrs: ['203.0.113.0/24'] })).json?.site
    made.sites.push(site.id)
    const siteB = (await call('POST', '/api/checkin-controls/sites', bearer(adminB), { name: `B site ${RUN}`, latitude: 6.3, longitude: -10.8 })).json?.site
    if (siteB?.id) made.sites.push(siteB.id)

    console.log('-- registration --')
    let r = await call('POST', '/api/kiosk/admin/devices', bearer(hr), { siteId: site.id, label: 'Lobby', pin: '2468' })
    check('HR cannot create a kiosk', r.status === 403, `(${r.status})`)
    r = await call('GET', '/api/kiosk/admin/devices', bearer(hr))
    check('but can see them', r.status === 200, `(${r.status})`)
    r = await call('POST', '/api/kiosk/admin/devices', bearer(emp1), { siteId: site.id, label: 'Lobby', pin: '2468' })
    check('nor can an employee', r.status === 403, `(${r.status})`)
    r = await call('POST', '/api/kiosk/admin/devices', bearer(admin), { siteId: siteB?.id, label: 'Lobby', pin: '2468' })
    check("another tenant's site is not found", r.status === 404, `(${r.status})`)
    r = await call('POST', '/api/kiosk/admin/devices', bearer(admin), { siteId: site.id, label: 'Lobby', pin: '12' })
    check('a PIN of fewer than 4 digits is refused', r.status === 400, `(${r.status})`)
    r = await call('POST', '/api/kiosk/admin/devices', bearer(admin), { siteId: site.id, label: `Lobby ${RUN}`, pin: '2468' })
    const kiosk = r.json?.kiosk
    let code = r.json?.pairingCode as string
    check('the admin creates a kiosk at the site, and sees its pairing code once', r.status === 201 && !!kiosk?.id
      && /^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code) && kiosk?.paired === false && kiosk?.awaitingPairing === true, `(${r.status} ${JSON.stringify(r.json)})`)
    made.kiosks.push(kiosk.id)
    const stored = (await owner(`SELECT pairing_hash, pin_hash, device_id FROM kiosks WHERE id = $1`, [kiosk.id])).rows[0]
    check('only hashes of the code and PIN are kept', stored.pairing_hash.length === 64 && !stored.pairing_hash.includes(code.replace('-', ''))
      && stored.pin_hash.startsWith('$2') && !stored.pin_hash.includes('2468'))
    const dev = (await owner(`SELECT employee_id FROM attendance_devices WHERE tenant_id = $1 AND device_id = $2 AND revoked_at IS NULL`,
      [T, stored.device_id])).rows
    check('its device is registered as a shared kiosk', dev.length === 1 && dev[0].employee_id === null)
    check('creating it is audited', (await owner(`SELECT count(*)::int AS n FROM audit_logs WHERE tenant_id = $1 AND action_type = 'KIOSK_CREATED' AND resource_id = $2`,
      [T, kiosk.id])).rows[0].n === 1)

    console.log('-- pairing --')
    r = await call('POST', '/api/kiosk/pair', null, { code: 'AAAA-AAAA' })
    check('a wrong code pairs nothing', r.status === 401, `(${r.status})`)
    r = await call('POST', '/api/kiosk/pair', null, { code: code.toLowerCase().replace('-', ' ') })
    let token = r.json?.token as string
    check('the code, however typed, pairs the device once', r.status === 201 && typeof token === 'string' && token.length >= 40, `(${r.status})`)
    r = await call('POST', '/api/kiosk/pair', null, { code })
    check('and not twice', r.status === 401, `(${r.status})`)
    r = await call('GET', '/api/kiosk/session', kioskAuth(token))
    check('the kiosk knows its site and organisation', r.status === 200 && r.json?.kiosk?.site === `Kiosk site ${RUN}` && !!r.json?.organisation,
      `(${r.status} ${JSON.stringify(r.json)})`)
    r = await call('POST', `/api/kiosk/admin/devices/${kiosk.id}/pairing-code`, bearer(admin))
    const code2 = r.json?.pairingCode
    check('a new code is issued', r.status === 200 && !!code2, `(${r.status})`)
    r = await call('GET', '/api/kiosk/session', kioskAuth(token))
    check('and the old pairing stops working', r.status === 401 && r.json?.code === 'kiosk_revoked', `(${r.status})`)
    await owner(`UPDATE kiosks SET pairing_expires_at = CURRENT_TIMESTAMP - INTERVAL '1 minute' WHERE id = $1`, [kiosk.id])
    r = await call('POST', '/api/kiosk/pair', null, { code: code2 })
    check('an expired code pairs nothing', r.status === 401, `(${r.status})`)
    code = (await call('POST', `/api/kiosk/admin/devices/${kiosk.id}/pairing-code`, bearer(admin))).json?.pairingCode
    token = (await call('POST', '/api/kiosk/pair', null, { code })).json?.token
    const K = kioskAuth(token)
    check('(paired again)', !!token)

    console.log('-- restricted access --')
    for (const p of ['/api/workforce/my/attendance', '/api/leave/requests', '/api/checkin-controls/settings', '/api/kiosk/admin/devices']) {
      r = await call('GET', p, K)
      check(`the kiosk token does not reach ${p}`, r.status === 401, `(${r.status})`)
    }
    r = await call('GET', '/api/kiosk/session', bearer(admin))
    check("a user's token does not reach the kiosk routes", r.status === 401, `(${r.status})`)
    r = await call('GET', '/api/kiosk/session', 'Kiosk not-a-real-token-but-long-enough-to-look-like-one-1234')
    check('a made-up token does not either', r.status === 401, `(${r.status})`)
    r = await call('POST', '/api/kiosk/lookup', K, { employeeCode: code1 })
    check('the kiosk finds an employee by number, with their first name and initial only', r.status === 200
      && /^Emp1 A\.$/.test(r.json?.employee?.displayName) && Object.keys(r.json?.employee ?? {}).length === 1, `(${r.status} ${JSON.stringify(r.json)})`)
    r = await call('POST', '/api/kiosk/lookup', K, { employeeCode: codeB })
    check("another tenant's employee number finds nobody", r.status === 404, `(${r.status})`)
    r = await call('POST', '/api/kiosk/punch', K, { employeeCode: codeB, action: 'in', pin: '2468', reasonCode: 'camera_failure' })
    check("and cannot be checked in from here", r.status === 404, `(${r.status})`)

    console.log('-- punching by PIN --')
    r = await call('POST', '/api/kiosk/punch', K, { employeeCode: code1, action: 'in' })
    check('without a face, the attendant PIN is required', r.status === 403 && r.json?.code === 'wrong_pin', `(${r.status} ${r.json?.code})`)
    r = await call('POST', '/api/kiosk/punch', K, { employeeCode: code1, action: 'in', pin: '2468', reasonCode: 'camera_failure', idempotencyKey: `k1-${RUN}` })
    const first = r.json
    check('with the PIN, the employee is checked in', r.status === 201 && first?.action === 'in' && first?.checkIn?.id, `(${r.status} ${JSON.stringify(r.json)})`)
    r = await call('POST', '/api/kiosk/punch', K, { employeeCode: code1, action: 'in', pin: '2468', reasonCode: 'camera_failure', idempotencyKey: `k1-${RUN}` })
    check('the same punch retried answers with the first, and records nothing more', r.status === 200 && r.json?.replayed === true
      && r.json?.checkinId === first?.checkIn?.id, `(${r.status} ${JSON.stringify(r.json)})`)
    const ev = (await owner(`SELECT device_id, client_ip, controls, method, reason_code FROM attendance_events WHERE tenant_id = $1
      AND checkin_id = $2 AND kind = 'check_in'`, [T, first?.checkIn?.id])).rows
    check('one event, with the kiosk\'s device and address, by hand with its reason', ev.length === 1 && ev[0].device_id === stored.device_id
      && ev[0].client_ip === '127.0.0.1' && ev[0].method === 'manual' && ev[0].reason_code === 'camera_failure', `(${JSON.stringify(ev)})`)
    r = await call('POST', '/api/kiosk/punch', K, { employeeCode: code1, action: 'out', pin: '2468', idempotencyKey: `k2-${RUN}` })
    check('and out', r.status === 200 && r.json?.action === 'out' && !!r.json?.checkIn?.checkOutTime, `(${r.status} ${JSON.stringify(r.json)})`)
    r = await call('POST', '/api/kiosk/punch', K, { employeeCode: code1, action: 'out', pin: '2468', idempotencyKey: `k2-${RUN}` })
    check('a retried check-out answers with the first instead of "not checked in"', r.status === 200 && r.json?.replayed === true && r.json?.action === 'out',
      `(${r.status} ${JSON.stringify(r.json)})`)
    r = await call('POST', '/api/kiosk/punch', K, { employeeCode: code1, action: 'out', pin: '2468' })
    check('a fresh check-out when not checked in is refused', r.status === 409, `(${r.status})`)
    for (let i = 0; i < 5; i++) await call('POST', '/api/kiosk/punch', K, { employeeCode: code1, action: 'in', pin: '0000', reasonCode: 'other', reasonText: 'x' })
    r = await call('POST', '/api/kiosk/punch', K, { employeeCode: code1, action: 'in', pin: '2468', reasonCode: 'camera_failure' })
    check('five wrong PINs lock it, even for the right one', r.status === 429 && r.json?.code === 'pin_locked', `(${r.status} ${r.json?.code})`)
    r = await call('POST', `/api/kiosk/admin/devices/${kiosk.id}/pin`, bearer(admin), { pin: '1357' })
    check('the admin sets a new PIN, which unlocks it', r.status === 200, `(${r.status})`)

    console.log('-- check-in controls at the kiosk --')
    await call('PUT', '/api/checkin-controls/settings', bearer(admin), { geofence: 'enforce', network: 'enforce', device: 'enforce' })
    r = await call('POST', '/api/kiosk/punch', K, { employeeCode: code1, action: 'in', pin: '1357', reasonCode: 'camera_failure' })
    check("the kiosk's address is checked against its site's networks", r.status === 403 && r.json?.code === 'outside_network', `(${r.status} ${r.json?.code})`)
    await call('PATCH', `/api/checkin-controls/sites/${site.id}`, bearer(admin), { allowedCidrs: ['203.0.113.0/24', '127.0.0.1', '::1'] })
    r = await call('POST', '/api/kiosk/punch', K, { employeeCode: code1, action: 'in', pin: '1357', reasonCode: 'camera_failure' })
    const inId = r.json?.checkIn?.id
    const ctl = (await owner(`SELECT controls FROM attendance_events WHERE checkin_id = $1 AND kind = 'check_in'`, [inId])).rows[0]?.controls ?? []
    const c = (n: string) => ctl.find((x: any) => x.control === n)
    check('from its network: placed at its site, on its network, a registered kiosk', r.status === 201 && c('geofence')?.code === 'kiosk_site'
      && c('network')?.ok === true && c('device')?.code === 'shared_kiosk', `(${r.status} ${JSON.stringify(ctl)})`)
    await call('POST', '/api/kiosk/punch', K, { employeeCode: code1, action: 'out', pin: '1357' })
    await call('DELETE', `/api/checkin-controls/sites/${site.id}`, bearer(admin))
    r = await call('POST', '/api/kiosk/punch', K, { employeeCode: code1, action: 'in', pin: '1357', reasonCode: 'camera_failure' })
    check("with its site retired, the kiosk's check-ins fail the geofence", r.status === 403 && r.json?.code === 'kiosk_site_retired', `(${r.status} ${r.json?.code})`)
    await call('PATCH', `/api/checkin-controls/sites/${site.id}`, bearer(admin), { isActive: true })
    await call('PUT', '/api/checkin-controls/settings', bearer(admin), { geofence: 'off', network: 'off', shift_window: 'enforce' })
    await owner(`INSERT INTO roster_shifts (tenant_id, employee_id, code, name, work_date, start_time, end_time)
       VALUES ($1, $2, $3, 'Ended', (LOCALTIMESTAMP - INTERVAL '5 hours')::date, (LOCALTIMESTAMP - INTERVAL '5 hours')::time,
               (LOCALTIMESTAMP - INTERVAL '4 hours')::time)`, [T, e1, `K${RUN}`])
      .catch((e) => console.log('  (shift not made:', e.message, ')'))
    r = await call('POST', '/api/kiosk/punch', K, { employeeCode: code1, action: 'in', pin: '1357', reasonCode: 'camera_failure' })
    check('the shift window applies to the employee at the kiosk', r.status === 403 && r.json?.code === 'outside_shift_window', `(${r.status} ${r.json?.code})`)
    await owner(`DELETE FROM roster_shifts WHERE tenant_id = $1 AND code = $2`, [T, `K${RUN}`])
    await call('PUT', '/api/checkin-controls/settings', bearer(admin), { shift_window: 'off', device: 'off' })

    console.log('-- punching by face --')
    await call('PUT', '/api/biometrics/settings', bearer(dirTok), { enabled: true, threshold: 0.5 })
    r = await call('POST', '/api/kiosk/lookup', K, { employeeCode: code1 })
    check('before consent and enrolment, face is not offered', r.json?.faceAvailable === false, `(${JSON.stringify(r.json)})`)
    await call('POST', `/api/biometrics/subjects/employee/${e1}/consent`, bearer(hr), { basis: `Signed consent form (kiosk suite ${RUN})` })
    const en = await call('POST', '/api/biometrics/challenges', bearer(hr), { purpose: 'enroll', subjectType: 'employee', subjectId: e1 })
    await sleep(800)
    r = await frames('/api/biometrics/enroll', bearer(hr), { challengeId: en.json?.challengeId }, (en.json?.steps ?? []).map((p: string) => POSES[p]))
    check('(HR enrols employee 1)', r.status === 201, `(${r.status} ${JSON.stringify(r.json).slice(0, 120)})`)
    r = await call('POST', '/api/kiosk/lookup', K, { employeeCode: code1 })
    check('now the kiosk offers face', r.json?.faceAvailable === true, `(${JSON.stringify(r.json)})`)
    let ch = await call('POST', '/api/kiosk/face/challenge', K, { employeeCode: code1 })
    check('a face challenge is issued to the kiosk for that employee', ch.status === 201 && (ch.json?.steps ?? []).length >= 2, `(${ch.status} ${JSON.stringify(ch.json)})`)
    const bound = (await owner(`SELECT device_id FROM biometric_challenges WHERE id = $1`, [ch.json?.challengeId])).rows[0]
    check('bound to the kiosk\'s device', bound?.device_id === stored.device_id)
    // Another kiosk cannot answer this one's challenge.
    const other = (await call('POST', '/api/kiosk/admin/devices', bearer(admin), { siteId: site.id, label: `Other ${RUN}`, pin: '1111' })).json
    made.kiosks.push(other.kiosk.id)
    const otherTok = (await call('POST', '/api/kiosk/pair', null, { code: other.pairingCode })).json?.token
    await sleep(800)
    r = await frames('/api/kiosk/face/verify', kioskAuth(otherTok), { challengeId: ch.json?.challengeId, employeeCode: code1 },
      (ch.json?.steps ?? []).map((p: string) => MIRROR[p]))
    check("another kiosk cannot answer this kiosk's challenge", r.status === 404, `(${r.status})`)
    r = await frames('/api/kiosk/face/verify', K, { challengeId: ch.json?.challengeId, employeeCode: code1 }, (ch.json?.steps ?? []).map((p: string) => MIRROR[p]))
    const matchId = r.json?.matchId
    check('the employee is matched at the kiosk', r.status === 200 && !!matchId, `(${r.status} ${JSON.stringify(r.json).slice(0, 160)})`)
    r = await call('POST', '/api/kiosk/punch', K, { employeeCode: code1, action: 'in', faceMatchId: matchId })
    check('and checked in by face, with no PIN', r.status === 201 && r.json?.checkIn?.faceVerified === true, `(${r.status} ${JSON.stringify(r.json)})`)
    await call('POST', '/api/kiosk/punch', K, { employeeCode: code1, action: 'out', pin: '1357' })
    r = await call('POST', '/api/kiosk/punch', K, { employeeCode: code1, action: 'in', faceMatchId: matchId })
    check('a match is spent once', r.status === 409 && r.json?.code === 'match_used', `(${r.status} ${r.json?.code})`)
    ch = await call('POST', '/api/kiosk/face/challenge', K, { employeeCode: code1 })
    await sleep(800)
    r = await frames('/api/kiosk/face/verify', K, { challengeId: ch.json?.challengeId, employeeCode: code1 }, ['other-a.jpg', 'other-a-m.jpg', 'other-b.jpg'].slice(0, (ch.json?.steps ?? []).length))
    check('someone else\'s face is not matched', r.status === 422, `(${r.status} ${r.json?.code})`)
    const fe = (await owner(`SELECT count(*)::int AS n FROM biometric_events WHERE tenant_id = $1 AND subject_id = $2 AND action = 'verified'
      AND challenge_id IN (SELECT id FROM biometric_challenges WHERE device_id = $3)`, [T, e1, stored.device_id])).rows[0].n
    check('the kiosk\'s face checks are in the biometric log', fe >= 2, `(${fe})`)

    console.log('-- revocation --')
    r = await call('DELETE', `/api/kiosk/admin/devices/${kiosk.id}`, bearer(hr))
    check('HR cannot revoke a kiosk', r.status === 403, `(${r.status})`)
    r = await call('DELETE', `/api/kiosk/admin/devices/${kiosk.id}`, bearer(admin))
    check('the admin revokes it', r.status === 200, `(${r.status})`)
    r = await call('GET', '/api/kiosk/session', K)
    check('its token stops working at once', r.status === 401 && r.json?.code === 'kiosk_revoked', `(${r.status})`)
    const devAfter = (await owner(`SELECT revoked_at FROM attendance_devices WHERE tenant_id = $1 AND device_id = $2`, [T, stored.device_id])).rows[0]
    check('and its device registration is revoked with it', !!devAfter?.revoked_at)
    r = await call('POST', `/api/kiosk/admin/devices/${kiosk.id}/pairing-code`, bearer(admin))
    check('a revoked kiosk cannot be paired again', r.status === 404, `(${r.status})`)
    r = await call('DELETE', `/api/kiosk/admin/devices/${kiosk.id}`, bearer(adminB))
    check("another tenant's admin cannot touch it", r.status === 404, `(${r.status})`)
    const audits = (await owner(`SELECT array_agg(DISTINCT action_type) AS a FROM audit_logs WHERE tenant_id = $1 AND resource_id = $2`, [T, kiosk.id])).rows[0].a
    check('pairing codes, the PIN change and the revocation are audited', ['KIOSK_PAIRING_CODE_ISSUED', 'KIOSK_PIN_CHANGED', 'KIOSK_REVOKED'].every((x) => audits?.includes(x)),
      `(${audits})`)
  } finally {
    await owner(`UPDATE corporate_checkins SET check_out_time = LOCALTIMESTAMP WHERE tenant_id = $1 AND employee_id = $2 AND check_out_time IS NULL`, [T, e1])
    await owner(`DELETE FROM face_templates WHERE tenant_id = $1 AND subject_type = 'employee' AND subject_id = $2`, [T, e1]).catch(() => undefined)
    await owner(`UPDATE biometric_consents SET withdrawn_at = CURRENT_TIMESTAMP WHERE tenant_id = $1 AND subject_id = $2 AND withdrawn_at IS NULL`, [T, e1])
      .catch(() => undefined)
    await owner(`UPDATE kiosks SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP), token_hash = NULL, pairing_hash = NULL, pairing_expires_at = NULL
      WHERE id = ANY($1)`, [made.kiosks])
    await owner(`UPDATE attendance_devices SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP) WHERE device_id LIKE 'kiosk-%'
      AND device_id IN (SELECT device_id FROM kiosks WHERE id = ANY($1))`, [made.kiosks])
    await owner(`UPDATE checkin_sites SET is_active = false WHERE id = ANY($1)`, [made.sites])
    await owner(`DELETE FROM tenant_settings WHERE tenant_id = $1 AND (setting_key LIKE 'checkin.%' OR setting_key LIKE 'biometrics.%')`, [T])
    for (const s of before) await owner(`INSERT INTO tenant_settings (tenant_id, setting_key, setting_value) VALUES ($1, $2, $3)`, [T, s.setting_key, s.setting_value])
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
