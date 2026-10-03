/**
 * Face matching across tenants (brief 5.9; rubric gate `biometric-cross-tenant`).
 *
 * School B enrols one of its students with a real three-pose capture. Then,
 * from school A:
 *   - over HTTP, A cannot record B's consent, start B's enrolment, read B's
 *     status or events, delete B's template, or identify in B's class;
 *   - presenting the face B enrolled in A's class never names B's student;
 *   - B's sealed template copied under one of A's students (as a database
 *     owner might) does not open under A's key and context. It is left out,
 *     and A's class is still identified;
 *   - as the runtime role in A's context, B's templates, consents,
 *     challenges and events cannot be read, written or deleted.
 * The employer side: A's HR cannot read or act on B's employees.
 *
 * Needs a running API (API_BASE), the e2e seed fixtures, DATABASE_URL (the
 * owner) and APP_DATABASE_URL (the runtime role). Suite "biometricCrossTenant"
 * in scripts/run-all-e2e.sh. Leaves both schools' face matching as it found it.
 */
import fs from 'fs'
import path from 'path'
import pg from 'pg'
import pool, { query } from '../db/connection.js'
import { withTenant } from '../db/dbContext.js'
import { reissue } from './freshTokens.js'

const API = (process.env.API_BASE ?? 'http://127.0.0.1:5000').replace(/\/$/, '')
const dir = process.env.E2E_FIXTURE_DIR ?? path.join(process.cwd(), '.e2e-fixtures')
const FACES = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), 'fixtures', 'faces')
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
    /* not JSON */
  }
  return { status: res.status, json }
}

const POSES: Record<string, string> = { center: 'synthetic-center.jpg', left: 'synthetic-left.jpg', right: 'synthetic-right.jpg' }
const MIRROR: Record<string, string> = { center: 'synthetic-center-m.jpg', left: 'synthetic-left-m.jpg', right: 'synthetic-right-m.jpg' }

async function challenge(token: string, body: Record<string, unknown>) {
  const r = await call('POST', '/api/biometrics/challenges', token, body)
  return { ...r, id: r.status === 201 ? r.json?.challengeId : null, steps: r.status === 201 ? (r.json?.steps as string[]) : [] }
}

async function frames(route: string, token: string, challengeId: string, steps: string[], faces = POSES) {
  const f = new FormData()
  f.append('challengeId', challengeId)
  for (const step of steps) {
    f.append('frames', new Blob([fs.readFileSync(path.join(FACES, faces[step]))], { type: 'image/jpeg' }), faces[step])
  }
  const res = await fetch(API + route, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: f })
  return { status: res.status, json: await res.json().catch(() => null) }
}

async function main() {
  const aAdmin = reissue(school.A.token)
  const aFac = reissue(school.A.facToken)
  const bAdmin = reissue(school.B.token)
  const bFac = reissue(school.B.facToken)
  const bStudent = school.B.students[0] as string
  const aStudents = school.A.students as string[]
  const settingOf = async (tenant: string) =>
    (await owner(`SELECT setting_value FROM tenant_settings WHERE tenant_id = $1 AND setting_key = 'biometrics.enabled'`, [tenant]))
      .rows[0]?.setting_value ?? null
  const before = { A: await settingOf(school.A.tenantId), B: await settingOf(school.B.tenantId) }
  let copied: string | null = null

  try {
    console.log('-- school B enrols its own student --')
    for (const t of [aAdmin, bAdmin]) await call('PUT', '/api/biometrics/settings', t, { enabled: true, threshold: 0.5 })
    let r = await call('GET', `/api/biometrics/subjects/student/${bStudent}`, bAdmin)
    if (!r.json?.consent) {
      r = await call('POST', `/api/biometrics/subjects/student/${bStudent}/consent`, bAdmin, { basis: `Signed consent form (cross-tenant suite ${Date.now()})` })
      check('(B records consent for its student)', r.status === 201, `(${r.status})`)
    }
    let ch = await challenge(bFac, { purpose: 'enroll', subjectType: 'student', subjectId: bStudent })
    const enrolled = ch.id ? await frames('/api/biometrics/enroll', bFac, ch.id, ch.steps) : { status: ch.status, json: ch.json }
    check("(B's lecturer enrols the student)", enrolled.status === 201, `(${enrolled.status} ${JSON.stringify(enrolled.json).slice(0, 120)})`)

    console.log('-- from school A, over HTTP --')
    r = await call('POST', `/api/biometrics/subjects/student/${bStudent}/consent`, aAdmin, { basis: 'Signed consent form' })
    check("A cannot record consent for B's student", r.status === 404, `(${r.status})`)
    ch = await challenge(aFac, { purpose: 'enroll', subjectType: 'student', subjectId: bStudent })
    check("nor start enrolling B's student", [404, 409].includes(ch.status), `(${ch.status})`)
    r = await call('GET', `/api/biometrics/subjects/student/${bStudent}`, aAdmin)
    check("nor read B's student's face-matching status", r.status === 404, `(${r.status})`)
    r = await call('DELETE', `/api/biometrics/subjects/student/${bStudent}/template`, aAdmin)
    check("nor delete B's template", r.status === 404, `(${r.status})`)
    r = await call('GET', `/api/biometrics/events?subjectType=student&subjectId=${bStudent}`, aAdmin)
    check("nor see B's student in its face-matching log", r.status === 200 && (r.json?.events ?? []).length === 0,
      `(${r.status} ${(r.json?.events ?? []).length})`)
    ch = await challenge(aFac, { purpose: 'identify', scheduleId: school.B.scheduleId })
    check("nor identify in B's class", [403, 404, 409].includes(ch.status), `(${ch.status})`)

    ch = await challenge(aFac, { purpose: 'identify', scheduleId: school.A.scheduleId })
    const seen = ch.id ? await frames('/api/biometrics/identify', aFac, ch.id, ch.steps, MIRROR) : null
    const who = seen?.json?.student?.id ?? null
    check("the face B enrolled, shown in A's class, never names B's student",
      who !== bStudent && (who === null || aStudents.includes(who)), `(${seen?.status} ${who})`)

    console.log("-- B's template, copied under one of A's students --")
    const target = aStudents[1]
    const bt = (await owner(
      `SELECT * FROM face_templates WHERE tenant_id = $1 AND subject_type = 'student' AND subject_id = $2`,
      [school.B.tenantId, bStudent])).rows[0]
    if (bt) {
      const consent = (await owner(
        `INSERT INTO biometric_consents (tenant_id, subject_type, subject_id, basis, granted_by)
         VALUES ($1, 'student', $2, 'Cross-tenant suite: a copied template', $3)
         ON CONFLICT DO NOTHING RETURNING id`,
        [school.A.tenantId, target, bt.enrolled_by])).rows[0]?.id
        ?? (await owner(`SELECT id FROM biometric_consents WHERE tenant_id = $1 AND subject_type = 'student' AND subject_id = $2
                          AND withdrawn_at IS NULL ORDER BY granted_at DESC LIMIT 1`, [school.A.tenantId, target])).rows[0]?.id
      await owner(`DELETE FROM face_templates WHERE tenant_id = $1 AND subject_type = 'student' AND subject_id = $2`, [school.A.tenantId, target])
      copied = (await owner(
        `INSERT INTO face_templates (tenant_id, subject_type, subject_id, consent_id, model, ciphertext, iv, auth_tag,
                                     key_version, dek_version, frames_used, spread, enrolled_by)
         VALUES ($1, 'student', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
        [school.A.tenantId, target, consent, bt.model, bt.ciphertext, bt.iv, bt.auth_tag, bt.key_version, bt.dek_version,
         bt.frames_used, bt.spread, bt.enrolled_by])).rows[0].id
      ch = await challenge(aFac, { purpose: 'identify', scheduleId: school.A.scheduleId })
      const res = ch.id ? await frames('/api/biometrics/identify', aFac, ch.id, ch.steps, MIRROR) : null
      check("the copy does not open under A's key: B's face is not matched to A's student",
        res?.json?.student?.id !== target, `(${res?.status} ${res?.json?.student?.id})`)
      check("and A's class is still identified, not broken by it", !!res && res.status !== 500 && res.status !== 503,
        `(${res?.status} ${JSON.stringify(res?.json).slice(0, 120)})`)
    } else {
      check("(B's template exists to copy)", false)
    }

    console.log('-- as the runtime role, in A --')
    for (const t of ['face_templates', 'biometric_consents', 'biometric_challenges', 'biometric_events']) {
      const n = await withTenant({ tenantId: school.A.tenantId }, () =>
        query(`SELECT count(*)::int AS n FROM ${t} WHERE tenant_id = $1`, [school.B.tenantId]))
      check(`${t}: none of B's rows are visible`, n.rows[0].n === 0, `(${n.rows[0].n})`)
      const del = await withTenant({ tenantId: school.A.tenantId }, () =>
        query(`DELETE FROM ${t} WHERE tenant_id = $1`, [school.B.tenantId])).then((x) => x.rowCount ?? 0, (e: any) => e.code)
      check(`${t}: none of B's rows can be deleted`, del === 0 || del === '42501', `(${del})`)
    }
    const planted = await withTenant({ tenantId: school.A.tenantId }, () =>
      query(`INSERT INTO biometric_consents (tenant_id, subject_type, subject_id, basis, granted_by)
             VALUES ($1, 'student', $2, 'planted from A', $3)`, [school.B.tenantId, bStudent, bt?.enrolled_by ?? null]))
      .then(() => null, (e: any) => e.code)
    check("a consent cannot be planted in B's name", planted !== null, `(${planted ?? 'it ran'})`)

    console.log('-- employers --')
    const aHr = reissue(corp.A.token)
    const otherEmp = (corp.B.employees as string[])[0]
    r = await call('GET', `/api/biometrics/subjects/employee/${otherEmp}`, aHr)
    check("A's HR cannot read B's employee's face-matching status", r.status === 404, `(${r.status})`)
    r = await call('POST', `/api/biometrics/subjects/employee/${otherEmp}/consent`, aHr, { basis: 'Signed consent form' })
    check("nor record their consent", r.status === 404, `(${r.status})`)
    ch = await challenge(aHr, { purpose: 'enroll', subjectType: 'employee', subjectId: otherEmp })
    check('nor start enrolling them', [404, 409].includes(ch.status), `(${ch.status})`)
  } finally {
    if (copied) await owner(`DELETE FROM face_templates WHERE id = $1`, [copied]).catch(() => undefined)
    for (const [tenant, was] of [[school.A.tenantId, before.A], [school.B.tenantId, before.B]] as const) {
      if (was === null) await owner(`DELETE FROM tenant_settings WHERE tenant_id = $1 AND setting_key = 'biometrics.enabled'`, [tenant])
      else await owner(`UPDATE tenant_settings SET setting_value = $2 WHERE tenant_id = $1 AND setting_key = 'biometrics.enabled'`, [tenant, was])
    }
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
