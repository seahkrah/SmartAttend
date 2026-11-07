/**
 * The check-in burst test (docs/operations/capacity.md; rubric gate
 * `checkin-burst-load`).
 *
 *   npx tsx src/scripts/loadCheckinBurst.ts [--n 120] [--write]
 *
 * Makes N throwaway employees in the e2e corporate tenant A, each with their
 * own session. Two bursts follow, each of N check-ins spread evenly over one
 * minute:
 *   - manual: each employee checks in by hand with a reason;
 *   - face: each verifies their face (challenge, three frames, 1:1 match) and
 *     checks in citing the match. Each is enrolled first, by HR, with the
 *     synthetic test face.
 * Reports, per path: the most requests in flight at once, throughput, error
 * rate, p50, p95, p99 and max, and the database during the burst (connections
 * active and waiting on locks, sampled every 250 ms; commits, rollbacks and
 * deadlocks from pg_stat_database). A duplicate phase then sends each manual
 * check-in twice at once, with one idempotency key and without one, and
 * counts what was stored. Whether the capacity targets were met is computed
 * from the bursts.
 * With --write, saves the result to
 * docs/scorecard/evidence/load-checkin-burst.json.
 * The throwaway employees are removed afterwards.
 *
 * Needs the e2e stack (API_BASE, DATABASE_URL, the fixtures), face matching
 * configured, and RATE_LIMIT_API_PER_MINUTE raised. Run it against a
 * throwaway database only: it writes check-ins.
 */
import { execSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import pg from 'pg'
import { issueTokens } from '../auth/authService.js'
import { runAsSystem } from '../db/dbContext.js'
import pool from '../db/connection.js'
import { openStoredTemplate, sealTemplateForStorage, templateContext } from '../biometrics/templateCrypto.js'

const API = (process.env.API_BASE ?? 'http://127.0.0.1:5000').replace(/\/$/, '')
const arg = (name: string, fallback: number) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? Number(process.argv[i + 1]) : fallback
}
const N = arg('n', 120)
const FACE_N = arg('face-n', N)
/** Also run a face burst at this rate, to record what this machine sustains. */
const SUSTAIN = arg('sustain', 0)
const TARGET = { manualP95Ms: 500, faceP95Ms: 4000 }
const ROOT = path.resolve(process.cwd(), '..', '..')
const dir = process.env.E2E_FIXTURE_DIR ?? path.join(process.cwd(), '.e2e-fixtures')
const corp = JSON.parse(fs.readFileSync(path.join(dir, 'corp.json'), 'utf8'))
const FACES = path.join(process.cwd(), 'src', 'tests', 'fixtures', 'faces')
const POSES: Record<string, string> = { center: 'synthetic-center.jpg', left: 'synthetic-left.jpg', right: 'synthetic-right.jpg' }
const MIRROR: Record<string, string> = { center: 'synthetic-center-m.jpg', left: 'synthetic-left-m.jpg', right: 'synthetic-right-m.jpg' }
const image = (name: string) => new Blob([fs.readFileSync(path.join(FACES, name))], { type: 'image/jpeg' })

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
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  })
  return { status: res.status, json: (await res.json().catch(() => null)) as any }
}

async function frames(route: string, token: string, challengeId: string, steps: string[], faces: Record<string, string>) {
  const f = new FormData()
  f.append('challengeId', challengeId)
  f.append('frameTimes', JSON.stringify(steps.map((_, i) => i * 700)))
  for (const s of steps) f.append('frames', image(faces[s]), faces[s])
  const res = await fetch(API + route, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: f })
  return { status: res.status, json: (await res.json().catch(() => null)) as any }
}

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? Math.round(s[Math.min(s.length - 1, Math.floor(s.length * p))]) : null
}

/**
 * The database while a burst runs: this database's connections that are
 * active and that wait on a lock, sampled every 250 ms (the most of each),
 * and pg_stat_database's commits, rollbacks and deadlocks over the burst.
 */
async function dbWatch() {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await c.connect()
  const stats = async () => (await c.query(
    `SELECT xact_commit::bigint AS commits, xact_rollback::bigint AS rollbacks, deadlocks::bigint AS deadlocks
       FROM pg_stat_database WHERE datname = current_database()`)).rows[0]
  const before = await stats()
  let maxActive = 0
  let maxWaitingOnLocks = 0
  let maxConnections = 0
  let samples = 0
  const timer = setInterval(async () => {
    try {
      const r = (await c.query(
        `SELECT count(*)::int AS connections,
                count(*) FILTER (WHERE state = 'active')::int AS active,
                count(*) FILTER (WHERE wait_event_type = 'Lock')::int AS waiting
           FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()`)).rows[0]
      samples++
      maxConnections = Math.max(maxConnections, r.connections)
      maxActive = Math.max(maxActive, r.active)
      maxWaitingOnLocks = Math.max(maxWaitingOnLocks, r.waiting)
    } catch { /* a sample missed is a sample missed */ }
  }, 250)
  return async () => {
    clearInterval(timer)
    const after = await stats()
    await c.end()
    return {
      samples, maxConnections, maxActive, maxWaitingOnLocks,
      commits: Number(after.commits) - Number(before.commits),
      rollbacks: Number(after.rollbacks) - Number(before.rollbacks),
      deadlocks: Number(after.deadlocks) - Number(before.deadlocks),
    }
  }
}

/** Runs `jobs` spread evenly over one minute; returns each one's latency and outcome. */
async function burst(jobs: Array<() => Promise<boolean>>) {
  const why: string[] = []
  const gap = 60_000 / jobs.length
  const t0 = Date.now()
  let inFlight = 0
  let maxInFlight = 0
  const stopWatch = await dbWatch()
  const results = await Promise.all(jobs.map((job, i) => new Promise<{ ms: number; ok: boolean }>((resolve) => {
    setTimeout(async () => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      const t = performance.now()
      let ok = false
      try {
        ok = await job()
      } catch (e) {
        ok = false
        if (why.length < 5) why.push(String((e as Error)?.message ?? e).slice(0, 160))
      }
      inFlight--
      resolve({ ms: performance.now() - t, ok })
    }, i * gap)
  })))
  const database = await stopWatch()
  const wall = (Date.now() - t0) / 1000
  const ok = results.filter((r) => r.ok).map((r) => r.ms)
  const errors = results.filter((r) => !r.ok).length
  return {
    n: jobs.length, offeredPerMinute: jobs.length, wallSeconds: Math.round(wall * 10) / 10,
    maxInFlight, throughputPerSecond: Math.round((ok.length / wall) * 100) / 100,
    errors, errorRatePercent: Math.round((errors / jobs.length) * 1000) / 10,
    p50Ms: pct(ok, 0.5), p95Ms: pct(ok, 0.95), p99Ms: pct(ok, 0.99), maxMs: ok.length ? Math.round(Math.max(...ok)) : null,
    database,
    firstFailures: why,
  }
}

async function main() {
  const tenant = corp.A.tenantId as string
  const platform = (await owner(`SELECT id FROM platforms WHERE name = 'corporate'`)).rows[0].id
  const role = (await owner(`SELECT id FROM roles WHERE platform_id = $1 AND name = 'employee'`, [platform])).rows[0].id
  const hr = (await runAsSystem('load test: HR session', async () => {
    const t = JSON.parse(Buffer.from(String(corp.A.token).split('.')[1], 'base64url').toString())
    return issueTokens({ id: t.userId, platform_id: t.platformId, role_id: t.roleId }, { userAgent: 'load test' })
  })).accessToken
  const run = Date.now()
  const made: Array<{ userId: string; employeeId: string; token: string }> = []
  console.log(`making ${N} employees in corporate tenant A`)
  for (let i = 0; i < N; i++) {
    const email = `load${i}.${run}@c2e.test`
    const u = (await owner(`INSERT INTO users (platform_id, email, full_name, role_id, password_hash, is_active)
                            VALUES ($1, $2, $3, $4, 'x', TRUE) RETURNING id`, [platform, email, `Load ${i}`, role])).rows[0].id
    await owner(`INSERT INTO corporate_user_associations (user_id, corporate_entity_id, status) VALUES ($1, $2, 'active')`, [u, tenant])
    const e = (await owner(`INSERT INTO employees (user_id, employee_id, first_name, last_name, email, phone, department_id,
                                                   date_of_joining, is_currently_employed, tenant_id)
                            VALUES ($1, $2, 'Load', $3, $4, '000', $5, '2024-01-01', TRUE, $6) RETURNING id`,
      [u, `L-${run}-${i}`, String(i), email, corp.A.deptId, tenant])).rows[0].id
    const t = await runAsSystem('load test: employee session', () =>
      issueTokens({ id: u, platform_id: platform, role_id: role }, { userAgent: 'load test' }))
    made.push({ userId: u, employeeId: e, token: t.accessToken })
  }
  const settingsBefore = (await owner(
    `SELECT setting_key, setting_value FROM tenant_settings WHERE tenant_id = $1 AND setting_key IN
       ('biometrics.enabled', 'attendance.manual_approval_threshold')`, [tenant])).rows
  try {
    await owner(`INSERT INTO tenant_settings (tenant_id, setting_key, setting_value) VALUES ($1, 'biometrics.enabled', 'true')
                 ON CONFLICT (tenant_id, setting_key) DO UPDATE SET setting_value = 'true'`, [tenant])
    // Manual check-ins beyond the allowance wait for a manager; for a load test they should not.
    await owner(`INSERT INTO tenant_settings (tenant_id, setting_key, setting_value) VALUES ($1, 'attendance.manual_approval_threshold', '1000')
                 ON CONFLICT (tenant_id, setting_key) DO UPDATE SET setting_value = '1000'`, [tenant])

    console.log(`manual: ${N} check-ins over one minute`)
    const manual = await burst(made.map((m) => async () =>
      (await call('POST', '/api/workforce/my/check-in', m.token, { checkInType: 'office', reasonCode: 'camera_failure' })).status === 201))
    for (const m of made) await call('POST', '/api/workforce/my/check-out', m.token)

    // Duplicates: each employee's check-in sent twice at once, with one
    // idempotency key, then twice at once without one. Exactly one check-in
    // each must be stored either way.
    console.log(`duplicates: ${N} check-ins sent twice at once, with and without a key`)
    const emps = made.map((m) => m.employeeId)
    const counted = async () => (await owner(
      `SELECT (SELECT count(*)::int FROM corporate_checkins WHERE tenant_id = $1 AND employee_id = ANY($2::uuid[])) AS checkins,
              (SELECT count(*)::int FROM attendance_events WHERE tenant_id = $1 AND employee_id = ANY($2::uuid[]) AND kind = 'check_in') AS events`,
      [tenant, emps])).rows[0]
    const beforeDup = await counted()
    const withKey = await Promise.all(made.map(async (m, i) => {
      const body = { checkInType: 'office', reasonCode: 'camera_failure', idempotencyKey: `dup-${run}-${i}` }
      const [a, b] = await Promise.all([call('POST', '/api/workforce/my/check-in', m.token, body),
        call('POST', '/api/workforce/my/check-in', m.token, body)])
      return { codes: [a.status, b.status].sort().join('+'), same: !!a.json?.checkIn?.id && a.json?.checkIn?.id === b.json?.checkIn?.id }
    }))
    for (const m of made) await call('POST', '/api/workforce/my/check-out', m.token)
    const noKey = await Promise.all(made.map(async (m) => {
      const body = { checkInType: 'office', reasonCode: 'camera_failure' }
      const [a, b] = await Promise.all([call('POST', '/api/workforce/my/check-in', m.token, body),
        call('POST', '/api/workforce/my/check-in', m.token, body)])
      return [a.status, b.status].sort().join('+')
    }))
    for (const m of made) await call('POST', '/api/workforce/my/check-out', m.token)
    const afterDup = await counted()
    // What the two rounds stored: one check-in, and one event, per employee per round.
    const stored = { checkins: afterDup.checkins - beforeDup.checkins, events: afterDup.events - beforeDup.events }
    const tally = (xs: string[]) => xs.reduce<Record<string, number>>((a, x) => ({ ...a, [x]: (a[x] ?? 0) + 1 }), {})
    const duplicates = {
      sentTwiceAtOnce: N * 2,
      withKey: { responses: tally(withKey.map((x) => x.codes)), bothAnsweredWithTheSameCheckIn: withKey.filter((x) => x.same).length },
      withoutKey: { responses: tally(noKey) },
      stored: { checkIns: stored.checkins, events: stored.events, expected: N * 2 },
      ok: stored.checkins === N * 2 && stored.events === N * 2 && withKey.every((x) => x.same),
    }

    // Enrolment is set-up, not what is measured. One employee is enrolled
    // through the API; the same face is then sealed for each of the others
    // under their own context, as an enrolment would (a user may start only
    // 30 face captures in ten minutes, so HR cannot enrol 120 at once).
    console.log(`enrolling ${N} faces (not timed)`)
    for (const m of made) {
      await call('POST', `/api/biometrics/subjects/employee/${m.employeeId}/consent`, hr, { basis: 'Load test: synthetic face' })
    }
    const ch = await call('POST', '/api/biometrics/challenges', hr, { purpose: 'enroll', subjectType: 'employee', subjectId: made[0].employeeId })
    await new Promise((r) => setTimeout(r, 900))
    const first = await frames('/api/biometrics/enroll', hr, ch.json.challengeId, ch.json.steps, POSES)
    if (first.status !== 201) throw new Error(`enrolment failed: ${first.status} ${JSON.stringify(first.json)}`)
    const row = (await owner(`SELECT * FROM face_templates WHERE tenant_id = $1 AND subject_type = 'employee' AND subject_id = $2`,
      [tenant, made[0].employeeId])).rows[0]
    const descriptor = await runAsSystem('load test: open the enrolled template', () => openStoredTemplate(tenant,
      { ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag, keyVersion: row.key_version, dekVersion: row.dek_version },
      templateContext(tenant, 'employee', made[0].employeeId, row.model)))
    for (const m of made.slice(1)) {
      const sealed = await runAsSystem('load test: seal it for another employee', () =>
        sealTemplateForStorage(tenant, descriptor, templateContext(tenant, 'employee', m.employeeId, row.model)))
      const consent = (await owner(`SELECT id FROM biometric_consents WHERE tenant_id = $1 AND subject_type = 'employee'
                                      AND subject_id = $2 AND withdrawn_at IS NULL`, [tenant, m.employeeId])).rows[0].id
      await owner(`INSERT INTO face_templates (tenant_id, subject_type, subject_id, consent_id, model, ciphertext, iv, auth_tag,
                                               key_version, dek_version, frames_used, spread, enrolled_by)
                   VALUES ($1, 'employee', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [tenant, m.employeeId, consent, row.model, sealed.ciphertext, sealed.iv, sealed.authTag, sealed.keyVersion,
         sealed.dekVersion, row.frames_used, row.spread, row.enrolled_by])
    }

    console.log(`face: ${FACE_N} check-ins over one minute`)
    const face = await burst(made.slice(0, FACE_N).map((m) => async () => {
      const ch = await call('POST', '/api/biometrics/challenges', m.token, { purpose: 'verify' })
      if (ch.status !== 201) throw new Error(`challenge ${ch.status} ${ch.json?.code ?? ''}`)
      const v = await frames('/api/biometrics/verify', m.token, ch.json.challengeId, ch.json.steps, MIRROR)
      if (v.status !== 200) throw new Error(`verify ${v.status} ${v.json?.code ?? ''}`)
      return (await call('POST', '/api/workforce/my/check-in', m.token, { checkInType: 'office', faceMatchId: v.json.matchId })).status === 201
    }))
    for (const m of made) await call('POST', '/api/workforce/my/check-out', m.token)

    let sustained = null
    let recoverySeconds: number | null = null
    if (SUSTAIN > 0) {
      // How long the workers take to answer again after the burst, then the
      // sustained rate on recovered workers.
      const started = Date.now()
      const urls = (process.env.FACE_WORKER_URL ?? '').split(',').filter(Boolean)
      const up = async () => (await Promise.all(urls.map((u) => fetch(`${u}/health`, {
        headers: { 'X-Worker-Token': process.env.FACE_WORKER_TOKEN ?? '' }, signal: AbortSignal.timeout(2000),
      }).then((r) => r.ok, () => false)))).every(Boolean)
      while (!(await up()) && Date.now() - started < 300_000) await new Promise((r) => setTimeout(r, 2000))
      recoverySeconds = Math.round((Date.now() - started) / 1000)
      console.log(`face, sustained: ${SUSTAIN} check-ins over one minute (workers answered again after ${recoverySeconds} s)`)
      sustained = await burst(made.slice(0, SUSTAIN).map((m) => async () => {
        const ch = await call('POST', '/api/biometrics/challenges', m.token, { purpose: 'verify' })
        if (ch.status !== 201) throw new Error(`challenge ${ch.status} ${ch.json?.code ?? ''}`)
        const v = await frames('/api/biometrics/verify', m.token, ch.json.challengeId, ch.json.steps, MIRROR)
        if (v.status !== 200) throw new Error(`verify ${v.status} ${v.json?.code ?? ''}`)
        return (await call('POST', '/api/workforce/my/check-in', m.token, { checkInType: 'office', faceMatchId: v.json.matchId })).status === 201
      }))
      for (const m of made) await call('POST', '/api/workforce/my/check-out', m.token)
    }

    const workers = (process.env.FACE_WORKER_URL ?? '').split(',').filter(Boolean).length
    let commit = 'unknown'
    let dirty: boolean | null = null
    try {
      commit = execSync('git rev-parse HEAD', { cwd: ROOT, encoding: 'utf8' }).trim()
      dirty = execSync('git status --porcelain --untracked-files=no', { cwd: ROOT, encoding: 'utf8' }).trim() !== ''
    } catch { /* not a checkout */ }
    const postgres = (await owner(`SELECT current_setting('server_version') AS v`)).rows[0].v
    const result = {
      measuredAt: new Date().toISOString(),
      commit,
      dirtyTree: dirty,
      command: `npx tsx src/scripts/loadCheckinBurst.ts ${process.argv.slice(2).join(' ')}`.trim(),
      assumption: 'docs/operations/capacity.md: N check-ins per minute for one tenant',
      n: N,
      environment: {
        kind: 'development machine, not production hardware',
        os: `${os.type()} ${os.release()}`, cpus: os.cpus().length, cpuModel: os.cpus()[0]?.model ?? null,
        memoryGb: Math.round(os.totalmem() / 1e9), node: process.version,
        faceWorkers: workers || 'in-process engine', engineProcessesPerWorker: Number(process.env.FACE_ENGINE_PROCESSES ?? 2),
        apiReplicas: 1, database: `PostgreSQL ${postgres} in Docker, same machine`,
      },
      targets: TARGET,
      manual,
      duplicates,
      face,
      faceSustained: sustained,
      workersRecoveredAfterSeconds: recoverySeconds,
      met: manual.errors === 0 && face.errors === 0 && (manual.p95Ms ?? Infinity) < TARGET.manualP95Ms
        && (face.p95Ms ?? Infinity) < TARGET.faceP95Ms && duplicates.ok,
    }
    console.log(JSON.stringify(result, null, 2))
    if (process.argv.includes('--write')) {
      const out = path.join(ROOT, 'docs', 'scorecard', 'evidence', 'load-checkin-burst.json')
      fs.mkdirSync(path.dirname(out), { recursive: true })
      fs.writeFileSync(out, JSON.stringify(result, null, 2) + '\n')
      console.log(`written to ${path.relative(ROOT, out)}`)
    }
  } finally {
    await owner(`DELETE FROM tenant_settings WHERE tenant_id = $1 AND setting_key IN ('biometrics.enabled', 'attendance.manual_approval_threshold')`, [tenant])
    for (const r of settingsBefore) {
      await owner(`INSERT INTO tenant_settings (tenant_id, setting_key, setting_value) VALUES ($1, $2, $3)`, [tenant, r.setting_key, r.setting_value])
    }
    const ids = made.map((m) => m.userId)
    const emps = made.map((m) => m.employeeId)
    await owner(`DELETE FROM attendance_alerts WHERE tenant_id = $1 AND employee_id = ANY($2::uuid[])`, [tenant, emps]).catch(() => undefined)
    await owner(`DELETE FROM attendance_events WHERE tenant_id = $1 AND employee_id = ANY($2::uuid[])`, [tenant, emps]).catch(() => undefined)
    await owner(`DELETE FROM corporate_checkins WHERE tenant_id = $1 AND employee_id = ANY($2::uuid[])`, [tenant, emps]).catch(() => undefined)
    await owner(`DELETE FROM face_templates WHERE tenant_id = $1 AND subject_id = ANY($2::uuid[])`, [tenant, emps]).catch(() => undefined)
    await owner(`DELETE FROM biometric_consents WHERE tenant_id = $1 AND subject_id = ANY($2::uuid[])`, [tenant, emps]).catch(() => undefined)
    await owner(`DELETE FROM employees WHERE id = ANY($1::uuid[])`, [emps]).catch(() => undefined)
    await owner(`DELETE FROM corporate_user_associations WHERE user_id = ANY($1::uuid[])`, [ids]).catch(() => undefined)
    await owner(`DELETE FROM auth_sessions WHERE user_id = ANY($1::uuid[])`, [ids]).catch(() => undefined)
    await owner(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [ids]).catch(() => undefined)
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(async () => {
    await pool.end().catch(() => undefined)
  })
