/**
 * Biometric safety around the matcher (brief 5.8).
 *
 *   - Every biometric event is also written to the hash-chained audit log,
 *     in the same transaction, so a deleted or altered face event shows as a
 *     break in the chain.
 *   - Captures are limited per person (30 per 10 minutes), per device
 *     (X-Device-Id; biometrics.device_challenges_per_10min) and per tenant
 *     (biometrics.tenant_challenges_per_minute), each refused with 429.
 *   - One device failing to identify anyone, again and again, raises a
 *     device_face_failures alert, once a day.
 *   - The school admin sees 30 days of outcomes, failure reasons, PAD scores
 *     and open alerts; a lecturer does not.
 *
 * The lockout alert after repeated failed verifications is asserted in
 * faceMatchingApi.e2e.py, where the pause is driven.
 *
 * Needs a running API (API_BASE) and the e2e fixtures. Suite "biometricLimits"
 * in scripts/run-all-e2e.sh. Leaves school A's face settings, and the
 * challenges and alerts it made, as it found them.
 */
import fs from 'fs'
import path from 'path'
import pg from 'pg'
import { reissue } from './freshTokens.js'

const API = (process.env.API_BASE ?? 'http://127.0.0.1:5000').replace(/\/$/, '')
const dir = process.env.E2E_FIXTURE_DIR ?? path.join(process.cwd(), '.e2e-fixtures')
const FACES = path.join(process.cwd(), 'src', 'tests', 'fixtures', 'faces')
const school = JSON.parse(fs.readFileSync(path.join(dir, 'seed.json'), 'utf8'))
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

async function call(method: string, url: string, token: string, body?: unknown, device?: string) {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  if (device) headers['X-Device-Id'] = device
  const res = await fetch(API + url, { method, headers, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) })
  return { status: res.status, json: await res.json().catch(() => null) }
}

async function submit(route: string, token: string, id: string, files: string[]) {
  const f = new FormData()
  f.append('challengeId', id)
  f.append('frameTimes', JSON.stringify(files.map((_, i) => i * 700)))
  for (const name of files) f.append('frames', new Blob([fs.readFileSync(path.join(FACES, name))], { type: 'image/jpeg' }), name)
  const res = await fetch(API + route, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: f })
  return { status: res.status, json: await res.json().catch(() => null) }
}

async function main() {
  const T = school.A.tenantId as string
  const admin = reissue(school.A.token)
  const fac = reissue(school.A.facToken)
  const before = (await owner(
    `SELECT setting_key, setting_value FROM tenant_settings WHERE tenant_id = $1 AND setting_key LIKE 'biometrics.%'`, [T])).rows
  const devFail = `limits-fail-${RUN}`
  const devBusy = `limits-busy-${RUN}`
  const setting = (k: string, v: string) => owner(
    `INSERT INTO tenant_settings (tenant_id, setting_key, setting_value) VALUES ($1, $2, $3)
     ON CONFLICT (tenant_id, setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value`, [T, k, v])
  const clearMine = () => owner(
    `DELETE FROM biometric_challenges WHERE tenant_id = $1 AND created_at > CURRENT_TIMESTAMP - INTERVAL '10 minutes'`, [T])
  try {
    await call('PUT', '/api/biometrics/settings', admin, { enabled: true, threshold: 0.5 })
    await clearMine()

    console.log('-- every biometric event is in the audit chain --')
    let ch = await call('POST', '/api/biometrics/challenges', fac, { purpose: 'identify', scheduleId: school.A.scheduleId }, devFail)
    check('(a challenge is issued with a device id)', ch.status === 201, `(${ch.status} ${JSON.stringify(ch.json)})`)
    const stored = await owner(`SELECT device_id FROM biometric_challenges WHERE id = $1`, [ch.json?.challengeId])
    check('the challenge records the device that asked', stored.rows[0]?.device_id === devFail, `(${stored.rows[0]?.device_id})`)
    let r = await submit('/api/biometrics/identify', fac, ch.json.challengeId, ch.json.steps.map(() => 'other-a.jpg'))
    check('(a stranger, the same frame for every step, is refused)', r.status === 422, `(${r.status} ${r.json?.code})`)
    const ev = await owner(
      `SELECT id, reason FROM biometric_events WHERE tenant_id = $1 AND challenge_id = $2`, [T, ch.json.challengeId])
    const audit = await owner(
      `SELECT action, resource_type, after_state, row_hash IS NOT NULL AS chained FROM audit_logs
        WHERE tenant_id = $1 AND resource_type = 'biometric_event' AND resource_id = $2`, [T, ev.rows[0]?.id])
    check('the failure is in the audit log, chained, with its reason', audit.rows.length === 1
      && audit.rows[0].action === 'BIOMETRIC_IDENTIFIED_FAILURE' && audit.rows[0].chained
      && !!ev.rows[0]?.reason && audit.rows[0].after_state?.reason === ev.rows[0].reason, `(${JSON.stringify(audit.rows)})`)

    console.log('-- one device failing again and again is an alert --')
    await owner(`DELETE FROM attendance_alerts WHERE tenant_id = $1 AND device_id = $2`, [T, devFail])
    // Challenges are kept: the count follows each failure to its challenge's device.
    for (let i = 0; i < 9; i++) {
      ch = await call('POST', '/api/biometrics/challenges', fac, { purpose: 'identify', scheduleId: school.A.scheduleId }, devFail)
      await submit('/api/biometrics/identify', fac, ch.json?.challengeId, (ch.json?.steps ?? []).map(() => 'other-a.jpg'))
    }
    const alerts = await call('GET', '/api/attendance-review/alerts', admin)
    const mine = (alerts.json?.alerts ?? []).filter((a: any) => a.kind === 'device_face_failures' && a.device_id === devFail)
    check('ten failed identifications from one device raise one alert', mine.length === 1 && mine[0].detail?.failures >= 10,
      `(${alerts.status} ${JSON.stringify(mine)})`)

    console.log('-- per-device and per-tenant limits --')
    await clearMine()
    await setting('biometrics.device_challenges_per_10min', '3')
    for (let i = 0; i < 3; i++) await call('POST', '/api/biometrics/challenges', fac, { purpose: 'identify', scheduleId: school.A.scheduleId }, devBusy)
    r = await call('POST', '/api/biometrics/challenges', fac, { purpose: 'identify', scheduleId: school.A.scheduleId }, devBusy)
    check('a device past its limit is refused', r.status === 429 && r.json?.code === 'device_rate_limited', `(${r.status} ${r.json?.code})`)
    r = await call('POST', '/api/biometrics/challenges', fac, { purpose: 'identify', scheduleId: school.A.scheduleId }, `other-${RUN}`)
    check('another device is not', r.status === 201, `(${r.status} ${r.json?.code})`)
    await setting('biometrics.tenant_challenges_per_minute', '4')
    r = await call('POST', '/api/biometrics/challenges', fac, { purpose: 'identify', scheduleId: school.A.scheduleId })
    check('the tenant past its limit is refused, device or not', r.status === 429 && r.json?.code === 'tenant_rate_limited',
      `(${r.status} ${r.json?.code})`)
    await setting('biometrics.tenant_challenges_per_minute', 'none')
    r = await call('POST', '/api/biometrics/challenges', fac, { purpose: 'identify', scheduleId: school.A.scheduleId })
    check('a nonsense limit falls back to the default', r.status === 201, `(${r.status} ${r.json?.code})`)

    console.log('-- the administrator\'s overview --')
    r = await call('GET', '/api/biometrics/overview', admin)
    check('the school admin sees 30 days of outcomes, reasons and alerts', r.status === 200 && r.json?.windowDays === 30
      && r.json.daily.some((d: any) => d.action === 'identified' && d.outcome === 'failure')
      && r.json.failureReasons.some((x: any) => x.reason === ev.rows[0]?.reason)
      && r.json.openAlerts.some((a: any) => a.kind === 'device_face_failures'), `(${r.status} ${JSON.stringify(r.json).slice(0, 200)})`)
    r = await call('GET', '/api/biometrics/overview', fac)
    check('a lecturer does not', r.status === 403, `(${r.status})`)
  } finally {
    await clearMine()
    await owner(`DELETE FROM attendance_alerts WHERE tenant_id = $1 AND device_id = $2`, [T, devFail])
    await owner(`DELETE FROM tenant_settings WHERE tenant_id = $1 AND setting_key LIKE 'biometrics.%'`, [T])
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
