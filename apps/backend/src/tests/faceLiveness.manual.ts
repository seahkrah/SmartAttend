/**
 * Layered presentation-attack signals (brief 5.4; rubric gate `layered-pad`).
 *
 *   - The challenge is the nonce: server-issued, expiring within minutes,
 *     single-use.
 *   - Hard signals: the same image sent for more than one step; frame times
 *     no person turning their head could produce; a malformed frameTimes.
 *   - Soft signals lower a score: no frame times, an answer sooner than a
 *     person could give it, soft, flat or glaring frames. The tenant's
 *     threshold is clamped to [0.5, 0.9], and a rejection is logged with
 *     its score and signals.
 *   - A match says "face matched at distance X under threshold Y".
 *
 * Needs a running API (API_BASE) and the e2e fixtures. Suite "faceLiveness" in
 * scripts/run-all-e2e.sh. Leaves school A's face settings as it found them.
 */
import fs from 'fs'
import path from 'path'
import pg from 'pg'
import { reissue } from './freshTokens.js'

const API = (process.env.API_BASE ?? 'http://127.0.0.1:5000').replace(/\/$/, '')
const dir = process.env.E2E_FIXTURE_DIR ?? path.join(process.cwd(), '.e2e-fixtures')
const FACES = path.join(process.cwd(), 'src', 'tests', 'fixtures', 'faces')
const school = JSON.parse(fs.readFileSync(path.join(dir, 'seed.json'), 'utf8'))

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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

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
  return { status: res.status, json: await res.json().catch(() => null) }
}

const POSES: Record<string, string> = { center: 'synthetic-center.jpg', left: 'synthetic-left.jpg', right: 'synthetic-right.jpg' }
const MIRROR: Record<string, string> = { center: 'synthetic-center-m.jpg', left: 'synthetic-left-m.jpg', right: 'synthetic-right-m.jpg' }

async function challenge(token: string, body: Record<string, unknown>) {
  const r = await call('POST', '/api/biometrics/challenges', token, body)
  return { status: r.status, json: r.json, id: r.json?.challengeId as string, steps: (r.json?.steps ?? []) as string[] }
}

async function submit(route: string, token: string, id: string, files: string[], frameTimes?: unknown) {
  const f = new FormData()
  f.append('challengeId', id)
  if (frameTimes !== undefined) f.append('frameTimes', typeof frameTimes === 'string' ? frameTimes : JSON.stringify(frameTimes))
  for (const name of files) f.append('frames', new Blob([fs.readFileSync(path.join(FACES, name))], { type: 'image/jpeg' }), name)
  const res = await fetch(API + route, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: f })
  return { status: res.status, json: await res.json().catch(() => null) }
}

const human = (n: number) => Array.from({ length: n }, (_, i) => i * 700)

async function main() {
  const admin = reissue(school.A.token)
  const fac = reissue(school.A.facToken)
  const s0 = school.A.students[0] as string
  const before = (await owner(
    `SELECT setting_key, setting_value FROM tenant_settings WHERE tenant_id = $1 AND setting_key LIKE 'biometrics.%'`,
    [school.A.tenantId])).rows
  try {
    await call('PUT', '/api/biometrics/settings', admin, { enabled: true, threshold: 0.5, padThreshold: 0.7 })
    const st = await call('GET', `/api/biometrics/subjects/student/${s0}`, admin)
    if (!st.json?.consent) await call('POST', `/api/biometrics/subjects/student/${s0}/consent`, admin, { basis: 'Guardian signed consent form (liveness suite)' })

    console.log('-- the challenge is the nonce --')
    let ch = await challenge(fac, { purpose: 'enroll', subjectType: 'student', subjectId: s0 })
    const ttl = (new Date(ch.json?.expiresAt).getTime() - Date.now()) / 1000
    check('a challenge is issued by the server and expires within minutes', ch.status === 201 && !!ch.id && ttl > 0 && ttl <= 600,
      `(${ch.status} ${Math.round(ttl)} s)`)
    await sleep(1000)
    let r = await submit('/api/biometrics/enroll', fac, ch.id, ch.steps.map((p) => POSES[p]), human(ch.steps.length))
    check('(a plausible enrolment is accepted)', r.status === 201, `(${r.status} ${JSON.stringify(r.json).slice(0, 160)})`)
    r = await submit('/api/biometrics/enroll', fac, ch.id, ch.steps.map((p) => POSES[p]), human(ch.steps.length))
    check('and cannot be answered twice', r.status === 410, `(${r.status})`)

    console.log('-- hard signals --')
    ch = await challenge(fac, { purpose: 'identify', scheduleId: school.A.scheduleId })
    r = await submit('/api/biometrics/identify', fac, ch.id, ch.steps.map(() => MIRROR.center), human(ch.steps.length))
    check('the same image sent for every step is refused as such', r.status === 422 && r.json?.code === 'duplicate_frames',
      `(${r.status} ${r.json?.code})`)
    ch = await challenge(fac, { purpose: 'identify', scheduleId: school.A.scheduleId })
    r = await submit('/api/biometrics/identify', fac, ch.id, ch.steps.map((p) => MIRROR[p]), [0, 10, 20])
    check('frame times no person could produce are refused', r.status === 422 && r.json?.code === 'implausible_timing',
      `(${r.status} ${r.json?.code})`)
    ch = await challenge(fac, { purpose: 'identify', scheduleId: school.A.scheduleId })
    r = await submit('/api/biometrics/identify', fac, ch.id, ch.steps.map((p) => MIRROR[p]), 'soon')
    check('a malformed frameTimes is refused', r.status === 400 && r.json?.code === 'bad_frame_times', `(${r.status} ${r.json?.code})`)

    console.log('-- the score, and the tenant\'s threshold --')
    ch = await challenge(fac, { purpose: 'identify', scheduleId: school.A.scheduleId })
    await sleep(1000)
    r = await submit('/api/biometrics/identify', fac, ch.id, ch.steps.map((p) => MIRROR[p]), human(ch.steps.length))
    check('a plausible capture is identified, with its score', r.status === 200 && r.json?.student?.id === s0 && r.json?.padScore >= 0.8,
      `(${r.status} ${JSON.stringify(r.json).slice(0, 160)})`)
    check('and says what was matched, not that identity was verified',
      /^face matched at distance [0-9.]+ under threshold [0-9.]+$/.test(String(r.json?.statement)), `(${r.json?.statement})`)

    ch = await challenge(fac, { purpose: 'identify', scheduleId: school.A.scheduleId })
    r = await submit('/api/biometrics/identify', fac, ch.id, ch.steps.map((p) => MIRROR[p]))
    check('without frame times, answered at once, it scores lower but passes the default 0.7',
      r.status === 200 && r.json?.padScore === 0.7, `(${r.status} ${r.json?.padScore})`)

    let s = await call('PUT', '/api/biometrics/settings', admin, { enabled: true, threshold: 0.5, padThreshold: 0.99 })
    check('a threshold above 0.9 is clamped to 0.9', s.json?.settings?.padThreshold === 0.9, `(${JSON.stringify(s.json?.settings)})`)
    ch = await challenge(fac, { purpose: 'identify', scheduleId: school.A.scheduleId })
    r = await submit('/api/biometrics/identify', fac, ch.id, ch.steps.map((p) => MIRROR[p]))
    check('at 0.9 the same capture is refused as a suspected presentation attack',
      r.status === 422 && r.json?.code === 'presentation_attack_suspected', `(${r.status} ${r.json?.code})`)
    const ev = await call('GET', '/api/biometrics/events?limit=5', admin)
    const rejected = (ev.json?.events ?? []).find((e: any) => e.reason === 'presentation_attack_suspected')
    check('the rejection is logged with its score and signals', !!rejected && rejected.pad_score === 0.7
      && rejected.pad_signals?.reasons?.includes('no_frame_times') && rejected.pad_signals?.quality,
      `(${JSON.stringify(rejected ?? {}).slice(0, 200)})`)
    ch = await challenge(fac, { purpose: 'identify', scheduleId: school.A.scheduleId })
    await sleep(1000)
    r = await submit('/api/biometrics/identify', fac, ch.id, ch.steps.map((p) => MIRROR[p]), human(ch.steps.length))
    check('at 0.9 a plausible capture still passes', r.status === 200 && r.json?.student?.id === s0, `(${r.status} ${r.json?.code})`)
    s = await call('PUT', '/api/biometrics/settings', admin, { enabled: true, threshold: 0.5, padThreshold: 0.1 })
    check('a threshold below 0.5 is clamped to 0.5: the check cannot be turned off', s.json?.settings?.padThreshold === 0.5,
      `(${JSON.stringify(s.json?.settings)})`)
    s = await call('PUT', '/api/biometrics/settings', fac, { enabled: true, threshold: 0.5, padThreshold: 0.5 })
    check('a lecturer cannot change the threshold', s.status === 403, `(${s.status})`)
  } finally {
    await owner(`DELETE FROM tenant_settings WHERE tenant_id = $1 AND setting_key LIKE 'biometrics.%'`, [school.A.tenantId])
    for (const row of before) {
      await owner(`INSERT INTO tenant_settings (tenant_id, setting_key, setting_value) VALUES ($1, $2, $3)`,
        [school.A.tenantId, row.setting_key, row.setting_value])
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
