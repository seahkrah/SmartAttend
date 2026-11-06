/**
 * Enrolment and consent safeguards (brief 5.3).
 *
 *   - A minor's face-matching consent names one of the student's own
 *     guardians. A minor is younger than the tenant's biometrics.minor_age
 *     (default 18), or, with no date of birth recorded, a student of a K-12
 *     school.
 *   - Enrolment frames must show a face at least 80 px wide, sharp and evenly
 *     lit, measured on the face itself.
 *   - A face already enrolled for someone else in the tenant is refused.
 *   - Templates from another model, or older than the tenant's re-enrolment
 *     interval, are listed as stale.
 *
 * Needs a running API (API_BASE), the e2e fixtures and DATABASE_URL. Suite
 * "enrolmentSafeguards" in scripts/run-all-e2e.sh. Puts back what it changes.
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
  return { status: res.status, json: (await res.json().catch(() => null)) as any }
}

const POSES: Record<string, string> = { center: 'synthetic-center.jpg', left: 'synthetic-left.jpg', right: 'synthetic-right.jpg' }
const read = (name: string) => fs.readFileSync(path.join(FACES, name))

/**
 * A degraded copy of a fixture, for the quality checks: the face shrunk onto
 * a grey canvas (too small), or shrunk and scaled back up (blurred).
 */
async function degraded(name: string, how: 'small' | 'blurred'): Promise<Buffer> {
  const tf = (await import('@tensorflow/tfjs-node')) as any
  const img = tf.node.decodeImage(read(name), 3)
  const [h, w] = img.shape
  let out
  if (how === 'small') {
    const small = tf.image.resizeBilinear(img, [Math.round(h * 0.4), Math.round(w * 0.4)])
    const padH = Math.round(h * 0.3)
    const padW = Math.round(w * 0.3)
    out = tf.pad(small, [[padH, padH], [padW, padW], [0, 0]], 128)
  } else {
    out = tf.image.resizeBilinear(tf.image.resizeBilinear(img, [Math.round(h / 3), Math.round(w / 3)]), [h, w])
  }
  const jpeg = await tf.node.encodeJpeg(tf.clipByValue(out, 0, 255).toInt(), 'rgb', 92)
  return Buffer.from(jpeg)
}

async function enrol(token: string, studentId: string, swap: Partial<Record<string, Buffer>> = {}) {
  const ch = await call('POST', '/api/biometrics/challenges', token, { purpose: 'enroll', subjectType: 'student', subjectId: studentId })
  if (ch.status !== 201) return ch
  await sleep(900)
  const f = new FormData()
  f.append('challengeId', ch.json.challengeId)
  f.append('frameTimes', JSON.stringify(ch.json.steps.map((_: string, i: number) => i * 700)))
  for (const step of ch.json.steps as string[]) {
    f.append('frames', new Blob([swap[step] ?? read(POSES[step])], { type: 'image/jpeg' }), `${step}.jpg`)
  }
  const res = await fetch(`${API}/api/biometrics/enroll`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: f })
  return { status: res.status, json: (await res.json().catch(() => null)) as any }
}

async function main() {
  const [admin] = await Promise.all([school.A.token].map(freshSession))
  // The administrator enrols here. Captures are limited per person (30 in ten
  // minutes) and earlier suites use the lecturer's: start this one's count afresh.
  const adminId = JSON.parse(Buffer.from(admin.split('.')[1], 'base64url').toString()).userId
  await owner(`DELETE FROM biometric_challenges WHERE issued_to = $1 AND created_at > CURRENT_TIMESTAMP - INTERVAL '10 minutes'`, [adminId])
  const tenant = school.A.tenantId as string
  const [s0, s1] = school.A.students as string[]
  const saved = {
    settings: (await owner(`SELECT setting_key, setting_value FROM tenant_settings WHERE tenant_id = $1 AND setting_key LIKE 'biometrics.%'`, [tenant])).rows,
    type: (await owner(`SELECT school_type FROM tenants WHERE id = $1`, [tenant])).rows[0].school_type,
  }
  let guardian: string | null = null
  try {
    await call('PUT', '/api/biometrics/settings', admin, { enabled: true, threshold: 0.5 })
    // Start clean: no consent or template for either student.
    for (const s of [s0, s1]) {
      await owner(`DELETE FROM face_templates WHERE tenant_id = $1 AND subject_type = 'student' AND subject_id = $2`, [tenant, s])
      await owner(`DELETE FROM biometric_consents WHERE tenant_id = $1 AND subject_type = 'student' AND subject_id = $2`, [tenant, s])
    }

    console.log('-- consent for a minor --')
    await owner(`UPDATE students SET date_of_birth = CURRENT_DATE - INTERVAL '10 years' WHERE id = $1`, [s1])
    let r = await call('POST', `/api/biometrics/subjects/student/${s1}/consent`, admin, { basis: 'Signed consent form' })
    check("a ten-year-old's consent without a guardian is refused", r.status === 400 && r.json?.code === 'guardian_consent_required',
      `(${r.status} ${r.json?.code})`)
    guardian = (await owner(`INSERT INTO guardians (tenant_id, first_name, last_name, phone) VALUES ($1, 'Consent', 'Guardian', '0770000001') RETURNING id`,
      [tenant])).rows[0].id
    r = await call('POST', `/api/biometrics/subjects/student/${s1}/consent`, admin, { basis: 'Signed consent form', guardianId: guardian })
    check("as is one naming a guardian who is not the student's", r.status === 400 && r.json?.code === 'guardian_consent_required',
      `(${r.status} ${r.json?.code})`)
    await owner(`INSERT INTO guardian_students (tenant_id, guardian_id, student_id, relationship) VALUES ($1, $2, $3, 'mother')`,
      [tenant, guardian, s1])
    r = await call('POST', `/api/biometrics/subjects/student/${s1}/consent`, admin, { basis: "Mother's signed consent form", guardianId: guardian })
    const recorded = (await owner(`SELECT guardian_id FROM biometric_consents WHERE tenant_id = $1 AND subject_id = $2 AND withdrawn_at IS NULL`,
      [tenant, s1])).rows[0]?.guardian_id
    check("the student's own guardian gives it, and is recorded", r.status === 201 && recorded === guardian, `(${r.status} ${recorded})`)
    await owner(`DELETE FROM biometric_consents WHERE tenant_id = $1 AND subject_type = 'student' AND subject_id = $2`, [tenant, s1])

    await owner(`INSERT INTO tenant_settings (tenant_id, setting_key, setting_value) VALUES ($1, 'biometrics.minor_age', '8')
                 ON CONFLICT (tenant_id, setting_key) DO UPDATE SET setting_value = '8'`, [tenant])
    r = await call('POST', `/api/biometrics/subjects/student/${s1}/consent`, admin, { basis: 'Signed consent form' })
    check("where the tenant's age of majority is 8, a ten-year-old consents for themselves", r.status === 201, `(${r.status} ${r.json?.code})`)
    await owner(`DELETE FROM biometric_consents WHERE tenant_id = $1 AND subject_type = 'student' AND subject_id = $2`, [tenant, s1])
    await owner(`DELETE FROM tenant_settings WHERE tenant_id = $1 AND setting_key = 'biometrics.minor_age'`, [tenant])

    await owner(`UPDATE students SET date_of_birth = NULL WHERE id = $1`, [s1])
    await owner(`UPDATE tenants SET school_type = 'grade_school' WHERE id = $1`, [tenant])
    r = await call('POST', `/api/biometrics/subjects/student/${s1}/consent`, admin, { basis: 'Signed consent form' })
    check('at a K-12 school, a student with no date of birth is treated as a minor', r.status === 400 && r.json?.code === 'guardian_consent_required',
      `(${r.status} ${r.json?.code})`)
    await owner(`UPDATE tenants SET school_type = $2 WHERE id = $1`, [tenant, saved.type])
    r = await call('POST', `/api/biometrics/subjects/student/${s1}/consent`, admin, { basis: 'Signed consent form' })
    check('at a college or university, as an adult', r.status === 201, `(${r.status} ${r.json?.code})`)

    console.log('-- enrolment quality --')
    r = await call('POST', `/api/biometrics/subjects/student/${s0}/consent`, admin, { basis: 'Signed consent form' })
    r = await enrol(admin, s0, { center: await degraded('synthetic-center.jpg', 'small') })
    check('a face under 80 px is refused for enrolment', r.status === 422 && r.json?.code === 'enrolment_face_too_small',
      `(${r.status} ${r.json?.code})`)
    r = await enrol(admin, s0, { center: await degraded('synthetic-center.jpg', 'blurred') })
    // Blur shows as low sharpness or as a less confident detection: either is the gate.
    check('a blurred face is refused for enrolment', r.status === 422 && ['enrolment_blurred', 'enrolment_face_unclear'].includes(r.json?.code),
      `(${r.status} ${r.json?.code})`)
    r = await enrol(admin, s0)
    check('a clear capture enrols', r.status === 201, `(${r.status} ${JSON.stringify(r.json).slice(0, 120)})`)

    console.log('-- one face, one person --')
    r = await enrol(admin, s1)
    check("the same face cannot be enrolled for a second student", r.status === 409 && r.json?.code === 'duplicate_identity',
      `(${r.status} ${r.json?.code})`)
    check('and nothing was enrolled for them',
      (await owner(`SELECT 1 FROM face_templates WHERE tenant_id = $1 AND subject_id = $2`, [tenant, s1])).rows.length === 0)

    console.log('-- stale templates --')
    let list = await call('GET', '/api/biometrics/subjects?type=student', admin)
    let row = (list.json?.people ?? []).find((p: any) => p.id === s0)
    check('a fresh template is not stale', row && row.stale === false, `(${JSON.stringify(row ?? {}).slice(0, 120)})`)
    await owner(`UPDATE face_templates SET enrolled_at = CURRENT_TIMESTAMP - INTERVAL '30 months' WHERE tenant_id = $1 AND subject_id = $2`, [tenant, s0])
    list = await call('GET', '/api/biometrics/subjects?type=student', admin)
    row = (list.json?.people ?? []).find((p: any) => p.id === s0)
    check('one older than the re-enrolment interval (24 months) is', row?.stale === true, `(${JSON.stringify(row ?? {}).slice(0, 120)})`)
    await owner(`UPDATE face_templates SET enrolled_at = CURRENT_TIMESTAMP, model = 'an-older-model' WHERE tenant_id = $1 AND subject_id = $2`, [tenant, s0])
    list = await call('GET', '/api/biometrics/subjects?type=student', admin)
    row = (list.json?.people ?? []).find((p: any) => p.id === s0)
    check('as is one made by another model version', row?.stale === true, `(${JSON.stringify(row ?? {}).slice(0, 120)})`)
  } finally {
    await owner(`UPDATE tenants SET school_type = $2 WHERE id = $1`, [tenant, saved.type])
    await owner(`UPDATE students SET date_of_birth = NULL WHERE id = ANY($1::uuid[])`, [[s0, s1]])
    for (const s of [s0, s1]) {
      await owner(`DELETE FROM face_templates WHERE tenant_id = $1 AND subject_type = 'student' AND subject_id = $2`, [tenant, s])
      await owner(`DELETE FROM biometric_consents WHERE tenant_id = $1 AND subject_type = 'student' AND subject_id = $2`, [tenant, s])
    }
    if (guardian) {
      await owner(`DELETE FROM guardian_students WHERE guardian_id = $1`, [guardian])
      await owner(`DELETE FROM guardians WHERE id = $1`, [guardian])
    }
    await owner(`DELETE FROM tenant_settings WHERE tenant_id = $1 AND setting_key LIKE 'biometrics.%'`, [tenant])
    for (const s of saved.settings) {
      await owner(`INSERT INTO tenant_settings (tenant_id, setting_key, setting_value) VALUES ($1, $2, $3)`, [tenant, s.setting_key, s.setting_value])
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
