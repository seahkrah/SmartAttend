/**
 * The face worker is isolated, and the API carries on without it
 * (brief 5.4 and 5.9; rubric gate `worker-isolation`).
 *
 *   - The worker answers only with its token, and holds no database
 *     credentials: it refuses to start with any in its environment.
 *   - With the worker running, a face check reaches it.
 *   - With the worker killed, the API stays healthy and ready. A face check
 *     answers 503 engine_unavailable at once, saying to take attendance by
 *     hand. A manual mark and a manual check-in still work.
 *   - Started again, the worker serves face checks again.
 *
 * Needs a running API using the worker (FACE_WORKER_URL, FACE_WORKER_TOKEN),
 * the worker's process id in FACE_WORKER_PID_FILE, and the e2e fixtures.
 * Suite "faceWorkerDown" in scripts/run-all-e2e.sh. It leaves the worker
 * running.
 */
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { reissue } from './freshTokens.js'

const API = (process.env.API_BASE ?? 'http://127.0.0.1:5000').replace(/\/$/, '')
const WORKER = (process.env.FACE_WORKER_URL ?? '').replace(/\/$/, '')
const TOKEN = process.env.FACE_WORKER_TOKEN ?? ''
const PID_FILE = process.env.FACE_WORKER_PID_FILE ?? ''
const dir = process.env.E2E_FIXTURE_DIR ?? path.join(process.cwd(), '.e2e-fixtures')
const FACES = path.join(process.cwd(), 'src', 'tests', 'fixtures', 'faces')
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function call(method: string, url: string, token?: string, body?: unknown) {
  const res = await fetch(API + url, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  })
  return { status: res.status, json: await res.json().catch(() => null) }
}

async function workerHealth(token = TOKEN): Promise<number> {
  try {
    const r = await fetch(`${WORKER}/health`, { headers: { 'X-Worker-Token': token }, signal: AbortSignal.timeout(2000) })
    return r.status
  } catch {
    return 0
  }
}

/** A face identification in A's class with strangers' faces: reaching the engine answers 422 not_matched. */
async function faceCheck(fac: string) {
  const ch = await call('POST', '/api/biometrics/challenges', fac, { purpose: 'identify', scheduleId: school.A.scheduleId })
  if (ch.status !== 201) return { status: ch.status, json: ch.json, ms: 0 }
  const f = new FormData()
  f.append('challengeId', ch.json.challengeId)
  for (const name of ['other-a.jpg', 'other-b.jpg', 'other-a-m.jpg'].slice(0, ch.json.steps.length)) {
    f.append('frames', new Blob([fs.readFileSync(path.join(FACES, name))], { type: 'image/jpeg' }), name)
  }
  const t = Date.now()
  const res = await fetch(`${API}/api/biometrics/identify`, { method: 'POST', headers: { Authorization: `Bearer ${fac}` }, body: f })
  return { status: res.status, json: await res.json().catch(() => null), ms: Date.now() - t }
}

/** The worker's environment: this one, without credentials. */
function workerEnv(extra: Record<string, string> = {}) {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue
    if (['DATABASE_URL', 'APP_DATABASE_URL', 'SYSTEM_DATABASE_URL', 'PGPASSWORD', 'BIOMETRIC_TEMPLATE_KEY', 'KMS_LOCAL_KEK', 'JWT_SECRET'].includes(k)) continue
    env[k] = v
  }
  return { ...env, ...extra }
}

function startWorker(extra: Record<string, string> = {}, log?: string) {
  const out = log ? fs.openSync(log, 'a') : 'ignore'
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/faceWorker/server.ts'], {
    cwd: process.cwd(), env: workerEnv(extra), detached: true, stdio: ['ignore', out, out],
  })
  return child
}

async function main() {
  if (!WORKER || !TOKEN || !PID_FILE) {
    check('the API uses the face worker (FACE_WORKER_URL, FACE_WORKER_TOKEN, FACE_WORKER_PID_FILE)', false)
    return
  }
  const admin = reissue(school.A.token)
  const fac = reissue(school.A.facToken)
  const emp = reissue(corp.A.empToken)
  await call('PUT', '/api/biometrics/settings', admin, { enabled: true, threshold: 0.5 })

  console.log('-- the worker --')
  check('the worker refuses a caller without its token', (await workerHealth('wrong')) === 401)
  const health = await fetch(`${WORKER}/health`, { headers: { 'X-Worker-Token': TOKEN } }).then((r) => r.json()).catch(() => null)
  check('and says it holds no database connection', health?.database === false, `(${JSON.stringify(health)})`)
  const refused = startWorker({ DATABASE_URL: 'postgresql://nobody@127.0.0.1:1/none', FACE_WORKER_PORT: '5199' })
  const code = await new Promise<number | null>((resolve) => {
    const t = setTimeout(() => resolve(null), 30_000)
    refused.on('exit', (c) => {
      clearTimeout(t)
      resolve(c)
    })
  })
  check('it refuses to start with database credentials in its environment', code === 2, `(exit ${code})`)

  let r = await faceCheck(fac)
  check('with the worker up, a face check reaches it', r.status === 422 && r.json?.code === 'not_matched',
    `(${r.status} ${JSON.stringify(r.json).slice(0, 120)})`)

  console.log('-- the worker is killed --')
  const pid = Number(fs.readFileSync(PID_FILE, 'utf8'))
  try {
    process.kill(pid)
  } catch {
    /* already gone */
  }
  for (let i = 0; i < 30 && (await workerHealth()) !== 0; i++) await sleep(500)
  check('(the worker is down)', (await workerHealth()) === 0)

  r = await faceCheck(fac)
  check('a face check answers 503 engine_unavailable', r.status === 503 && r.json?.code === 'engine_unavailable',
    `(${r.status} ${JSON.stringify(r.json).slice(0, 120)})`)
  check('at once, not after a long wait', r.ms < 5000, `(${r.ms} ms)`)
  check('and says to take attendance by hand', /by hand/i.test(String(r.json?.error ?? '')), `(${r.json?.error})`)
  const live = await call('GET', '/api/health')
  check('the API stays healthy', live.status === 200, `(${live.status})`)
  const ready = await call('GET', '/api/health/ready')
  check('and ready, reporting the worker unreachable', ready.status === 200
    && ready.json?.components?.faceEngine?.worker?.reachable === false, `(${ready.status} ${JSON.stringify(ready.json)})`)
  r = await call('GET', '/api/auth/me', fac)
  check('other routes answer as usual', r.status === 200, `(${r.status})`)
  const day = new Date(Date.UTC(2032, 0, 1) + (Date.now() % 1000) * 86_400_000).toISOString().slice(0, 10)
  r = await call('POST', '/api/faculty/attendance/mark', fac, {
    schedule_id: school.A.scheduleId, date: day, reason_code: 'network_outage',
    entries: [{ student_id: school.A.students[0], status: 'present' }],
  })
  check('the lecturer marks the class by hand', r.status === 200, `(${r.status} ${JSON.stringify(r.json).slice(0, 120)})`)
  await call('POST', '/api/workforce/my/check-out', emp)
  r = await call('POST', '/api/workforce/my/check-in', emp, { checkInType: 'office', reasonCode: 'network_outage' })
  check('an employee checks in by hand', r.status === 201, `(${r.status} ${JSON.stringify(r.json).slice(0, 120)})`)
  await call('POST', '/api/workforce/my/check-out', emp)

  console.log('-- the worker comes back --')
  startWorker({}, path.join(dir, 'face-worker.log')).unref()
  for (let i = 0; i < 120 && (await workerHealth()) !== 200; i++) await sleep(500)
  check('(the worker is up again)', (await workerHealth()) === 200)
  for (let i = 0; i < 60; i++) {
    r = await faceCheck(fac)
    if (r.status !== 503) break
    await sleep(1000)
  }
  check('face checks work again', r.status === 422 && r.json?.code === 'not_matched', `(${r.status} ${JSON.stringify(r.json).slice(0, 120)})`)

  await call('PUT', '/api/biometrics/settings', admin, { enabled: false, threshold: 0.5 })
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
