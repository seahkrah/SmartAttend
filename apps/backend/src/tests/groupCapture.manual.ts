/**
 * Group capture for classes (brief 5.4; rubric gate `group-capture`).
 *
 * One photograph of the class, several faces. Each is matched against the
 * class's enrolled students. The result is a set of proposals and nothing
 * else: no attendance is recorded until the lecturer confirms each one.
 * Confirmed proposals become face marks through the attendance core; the
 * rest are discarded. Only the lecturer who took the photograph confirms,
 * once, within ten minutes. Another school sees nothing.
 *
 * Needs a running API (API_BASE), the e2e fixtures and DATABASE_URL. Suite
 * "groupCapture" in scripts/run-all-e2e.sh.
 */
import fs from 'fs'
import path from 'path'
import pg from 'pg'
import pool from '../db/connection.js'
import { freshSession } from './freshTokens.js'

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

async function submit(route: string, token: string, fields: Record<string, string>, files: string[]) {
  const f = new FormData()
  for (const [k, v] of Object.entries(fields)) f.append(k, v)
  for (const name of files) f.append('frames', new Blob([fs.readFileSync(path.join(FACES, name))], { type: 'image/jpeg' }), name)
  const res = await fetch(API + route, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: f })
  return { status: res.status, json: await res.json().catch(() => null) }
}

const POSES: Record<string, string> = { center: 'synthetic-center.jpg', left: 'synthetic-left.jpg', right: 'synthetic-right.jpg' }

async function main() {
  const [admin, fac, bFac] = await Promise.all([school.A.token, school.A.facToken, school.B.facToken].map(freshSession))
  const s0 = school.A.students[0] as string
  const day = new Date(Date.UTC(2033, 0, 1) + (Date.now() % 2000) * 86_400_000).toISOString().slice(0, 10)
  const before = (await owner(
    `SELECT setting_value FROM tenant_settings WHERE tenant_id = $1 AND setting_key = 'biometrics.enabled'`, [school.A.tenantId])).rows[0]?.setting_value
  try {
    await call('PUT', '/api/biometrics/settings', admin, { enabled: true, threshold: 0.5 })
    const st = await call('GET', `/api/biometrics/subjects/student/${s0}`, admin)
    if (!st.json?.consent) await call('POST', `/api/biometrics/subjects/student/${s0}/consent`, admin, { basis: 'Guardian signed consent form (group suite)' })
    let ch = await call('POST', '/api/biometrics/challenges', fac, { purpose: 'enroll', subjectType: 'student', subjectId: s0 })
    await sleep(1000)
    const steps: string[] = ch.json?.steps ?? []
    let r = await submit('/api/biometrics/enroll', fac,
      { challengeId: ch.json?.challengeId, frameTimes: JSON.stringify(steps.map((_, i) => i * 700)) }, steps.map((p) => POSES[p]))
    check('(one student is enrolled)', r.status === 201, `(${r.status} ${JSON.stringify(r.json).slice(0, 120)})`)

    console.log('-- who may take a class photograph --')
    r = await call('POST', '/api/biometrics/challenges', admin, { purpose: 'group', scheduleId: school.A.scheduleId })
    check('not the administrator: it is the lecturer taking the register', r.status === 403, `(${r.status})`)
    r = await call('POST', '/api/biometrics/challenges', bFac, { purpose: 'group', scheduleId: school.A.scheduleId })
    check("nor another school's lecturer", [404, 409].includes(r.status), `(${r.status})`)

    console.log('-- one photograph, two faces --')
    ch = await call('POST', '/api/biometrics/challenges', fac, { purpose: 'group', scheduleId: school.A.scheduleId })
    check('the lecturer starts a group capture: one frame', ch.status === 201 && ch.json?.steps?.length === 1, `(${ch.status} ${JSON.stringify(ch.json)})`)
    r = await submit('/api/biometrics/group', fac, { challengeId: ch.json?.challengeId, date: day }, ['two-faces.jpg'])
    const group = r.json
    check('both faces are found', r.status === 200 && group?.facesFound === 2, `(${r.status} ${JSON.stringify(group).slice(0, 200)})`)
    check('the enrolled student is proposed, the stranger is not',
      group?.proposals?.length === 1 && group.proposals[0].studentId === s0 && group.unmatched === 1, `(${JSON.stringify(group?.proposals)})`)
    check('each proposal says what was matched',
      /^face matched at distance [0-9.]+ under threshold [0-9.]+$/.test(String(group?.proposals?.[0]?.statement)))
    let marks = await owner(`SELECT * FROM school_attendance WHERE tenant_id = $1 AND student_id = $2 AND attendance_date = $3`,
      [school.A.tenantId, s0, day])
    check('nothing is recorded before the lecturer confirms', marks.rows.length === 0, `(${marks.rows.length})`)

    r = await call('POST', `/api/biometrics/group/${group?.groupId}/confirm`, bFac, { confirm: [1] })
    check("another school's lecturer cannot confirm it", r.status === 404, `(${r.status})`)
    r = await call('POST', `/api/biometrics/group/${group?.groupId}/confirm`, fac, { confirm: [7] })
    check('a proposal that is not there is refused', r.status === 400, `(${r.status})`)
    r = await call('POST', `/api/biometrics/group/${group?.groupId}/confirm`, fac, { confirm: [1] })
    check('the lecturer confirms the proposal', r.status === 200 && r.json?.recorded?.length === 1, `(${r.status} ${JSON.stringify(r.json).slice(0, 160)})`)
    marks = await owner(`SELECT * FROM school_attendance WHERE tenant_id = $1 AND student_id = $2 AND attendance_date = $3`,
      [school.A.tenantId, s0, day])
    const ev = (await owner(`SELECT * FROM attendance_events WHERE tenant_id = $1 AND attendance_id = $2 ORDER BY server_time DESC LIMIT 1`,
      [school.A.tenantId, marks.rows[0]?.id])).rows[0]
    check('and the student is marked present, by face, citing the match',
      marks.rows[0]?.status === 'present' && marks.rows[0]?.face_verified === true && ev?.method === 'face'
        && ev?.match_event_id === r.json?.recorded?.[0]?.matchId, `(${JSON.stringify(marks.rows[0] ?? {}).slice(0, 120)})`)
    r = await call('POST', `/api/biometrics/group/${group?.groupId}/confirm`, fac, { confirm: [1] })
    check('a group capture is decided once', r.status === 404, `(${r.status})`)

    ch = await call('POST', '/api/biometrics/challenges', fac, { purpose: 'group', scheduleId: school.A.scheduleId })
    r = await submit('/api/biometrics/group', fac, { challengeId: ch.json?.challengeId, date: day }, ['two-faces.jpg'])
    const second = r.json
    r = await call('POST', `/api/biometrics/group/${second?.groupId}/confirm`, fac, { confirm: [] })
    check('confirming none records nothing', r.status === 200 && r.json?.recorded?.length === 0 && r.json?.discarded === 1, `(${r.status} ${JSON.stringify(r.json)})`)

    ch = await call('POST', '/api/biometrics/challenges', fac, { purpose: 'group', scheduleId: school.A.scheduleId })
    r = await submit('/api/biometrics/group', fac, { challengeId: ch.json?.challengeId }, ['no-face.jpg'])
    check('a photograph with no face is refused', r.status === 422 && r.json?.code === 'no_face', `(${r.status} ${r.json?.code})`)
    ch = await call('POST', '/api/biometrics/challenges', fac, { purpose: 'group', scheduleId: school.A.scheduleId })
    r = await submit('/api/biometrics/group', fac, { challengeId: ch.json?.challengeId }, ['two-faces.jpg', 'two-faces.jpg'])
    check('a group capture is one photograph', r.status === 422 && r.json?.code === 'wrong_frame_count', `(${r.status} ${r.json?.code})`)
  } finally {
    if (before === undefined) await owner(`DELETE FROM tenant_settings WHERE tenant_id = $1 AND setting_key = 'biometrics.enabled'`, [school.A.tenantId])
    else await owner(`UPDATE tenant_settings SET setting_value = $2 WHERE tenant_id = $1 AND setting_key = 'biometrics.enabled'`, [school.A.tenantId, before])
  }
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
