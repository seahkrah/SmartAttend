/**
 * School attendance reports: the day by class, and the term by student and
 * by class (src/reports/schoolAttendance.ts).
 *
 * The suite builds its own term, classes, students, enrolments and marks in
 * school A, so the numbers are known exactly and no other suite's marks can
 * move them. The expected figures below are worked out by hand from the
 * fixture, not read back from the report:
 *
 *   Term "R" 2025-09-01 .. 2025-12-19. Class X meets Mon and Wed ("1,3"),
 *   class Y Tue ("2"), both in R; class Z Mon, in a course with no term.
 *   X: P1, P2, P3 enrolled; P4 dropped; P6 joined on 09-02.  Y: P1, P2, P4, P5.  Z: P1.
 *   (Everyone else enrolled on 2025-08-01.)
 *
 *   X Mon 09-01   P1 present (face)  P2 late  P3 absent
 *   X Wed 09-03   P1 present  P2 excused  P3 -  P6 -  P4 present (dropped, but marked)
 *   X Mon 09-08   no marks: the register was not taken
 *   Y Tue 09-02   P1 absent  P2 present  P4 present  P5 excused
 *   X Mon 2026-01-05   P1 present (outside R)
 *
 *   By student: P1 3 sessions, 2 present, 1 absent: 66.7%, below 80
 *               P2 3, 1 present, 1 late, 1 excused: 2/2 = 100%
 *               P3 2, 1 absent, 1 unmarked: 0%, below
 *               P4 2, 2 present: 100%
 *               P5 1, 1 excused: no rate, not below
 *               P6 1 (the 09-01 session was before they joined), unmarked: 0%, below
 *   By class:   X 2 sessions, 8 seats, 4 attended, 1 excused: 4/7 = 57.1%
 *               Y 1 session, 4 seats, 2 attended, 1 excused: 2/3 = 66.7%
 *
 * Needs a running API (API_BASE) and the e2e fixtures. Suite "schoolReports"
 * in scripts/run-all-e2e.sh. Removes everything it made.
 */
import fs from 'fs'
import path from 'path'
import pg from 'pg'
import { reissue } from './freshTokens.js'

const API = (process.env.API_BASE ?? 'http://127.0.0.1:5000').replace(/\/$/, '')
const dir = process.env.E2E_FIXTURE_DIR ?? path.join(process.cwd(), '.e2e-fixtures')
const school = JSON.parse(fs.readFileSync(path.join(dir, 'seed.json'), 'utf8'))
const corp = JSON.parse(fs.readFileSync(path.join(dir, 'corp.json'), 'utf8'))
const RUN = Date.now().toString(36).slice(-6)
const BASE = '/api/auth/admin/school/reports/attendance'

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
async function owner(sql: string, params: unknown[] = []) {
  return db.query(sql, params)
}

async function call(url: string, token: string | null) {
  const res = await fetch(API + url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
  const text = await res.text()
  let json: any = null
  try {
    json = JSON.parse(text)
  } catch {
    /* CSV */
  }
  return { status: res.status, json, text, type: res.headers.get('content-type') ?? '', disposition: res.headers.get('content-disposition') ?? '' }
}

async function main() {
  db = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await db.connect()
  const A = school.A
  const T = A.tenantId as string
  const admin = reissue(A.token)
  const adminB = reissue(school.B.token)
  const fac = reissue(A.facToken)
  const stu = reissue(A.studentToken)
  const corpAdmin = reissue(corp.A.adminToken)
  const made: { term?: string; room?: string; matches: string[]; courses: string[]; schedules: string[]; students: string[]; users: string[] } =
    { matches: [], courses: [], schedules: [], students: [], users: [] }
  const atRiskBefore = (await owner(
    `SELECT setting_value FROM tenant_settings WHERE tenant_id = $1 AND setting_key = 'attendance.at_risk_percent'`, [T])).rows[0]

  try {
    // -- fixture ----------------------------------------------------------
    const ref = (await owner(
      `SELECT s.platform_id, s.department_id FROM students s WHERE s.id = $1`, [A.students[0]])).rows[0]
    made.term = (await owner(
      `INSERT INTO semesters (department_id, name, start_date, end_date, is_active, tenant_id)
       VALUES ($1, $2, '2025-09-01', '2025-12-19', false, $3) RETURNING id`, [A.deptId, `Report term ${RUN}`, T])).rows[0].id
    const course = async (code: string, term: string | null) => {
      const id = (await owner(
        `INSERT INTO courses (department_id, semester_id, code, name, tenant_id) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [A.deptId, term, `${code}-${RUN}`, `Report course ${code}`, T])).rows[0].id
      made.courses.push(id)
      return id
    }
    made.room = (await owner(
      `INSERT INTO rooms (building, room_number, capacity, tenant_id) VALUES ('Reports', $1, 30, $2) RETURNING id`,
      [`RPT-${RUN}`, T])).rows[0].id
    const schedule = async (courseId: string, days: string, start: string) => {
      const id = (await owner(
        `INSERT INTO class_schedules (course_id, room_id, faculty_id, day_of_week, days_of_week, start_time, end_time, tenant_id)
         VALUES ($1, $2, $3, $4, $5, $6, ($6::time + INTERVAL '1 hour'), $7) RETURNING id`,
        [courseId, made.room, A.facultyId, Number(days[0]), days, start, T])).rows[0].id
      made.schedules.push(id)
      return id
    }
    const X = await schedule(await course('X', made.term!), '1,3', '08:00')
    const Y = await schedule(await course('Y', made.term!), '2', '09:00')
    const Z = await schedule(await course('Z', null), '1', '10:00')
    const names = ['Ada', 'Ben', '=HYPERLINK("http://x.test","click")', 'Dee, Jr', 'Eve', 'Fay']
    const P: string[] = []
    for (let i = 0; i < names.length; i++) {
      // An account that cannot sign in: the report needs a student, not a login.
      const user = (await owner(
        `INSERT INTO users (platform_id, email, full_name, role_id, password_hash, is_active)
         VALUES ($1, $2, $3, (SELECT id FROM roles WHERE platform_id = $1 AND name = 'student'), '!', false) RETURNING id`,
        [ref.platform_id, `rpt-${RUN}-${i + 1}@e2e.test`, `Report ${i + 1}`])).rows[0].id
      made.users.push(user)
      const id = (await owner(
        `INSERT INTO students (user_id, student_id, first_name, last_name, email, college, status, enrollment_year, platform_id, department_id, tenant_id)
         VALUES ($1, $2, $3, $4, $5, 'Computing', 'active', 2025, $6, $7, $8) RETURNING id`,
        [user, `RPT-${RUN}-${i + 1}`, names[i], `R${i + 1}`, `rpt-${RUN}-${i + 1}@e2e.test`, ref.platform_id, ref.department_id, T])).rows[0].id
      P.push(id)
      made.students.push(id)
    }
    const enrol = (s: string, sid: string, status = 'enrolled', on = '2025-08-01') => owner(
      `INSERT INTO student_courses (schedule_id, student_id, status, enrolled_at, tenant_id) VALUES ($1, $2, $3, $4, $5)`,
      [s, sid, status, on, T])
    await enrol(X, P[0]); await enrol(X, P[1]); await enrol(X, P[2]); await enrol(X, P[3], 'dropped')
    await enrol(Y, P[0]); await enrol(Y, P[1]); await enrol(Y, P[3]); await enrol(Y, P[4])
    await enrol(Z, P[0])
    await enrol(X, P[5], 'enrolled', '2025-09-02')
    const facUser = (await owner(`SELECT user_id FROM faculty WHERE id = $1`, [A.facultyId])).rows[0].user_id
    const mark = async (s: string, sid: string, date: string, status: string, face = false) => {
      // A face mark cites the match the server made (chk_school_attendance_face_cited): a fixture match event.
      const match = face ? (await owner(
        `INSERT INTO biometric_events (tenant_id, actor_user_id, action, outcome, subject_type, subject_id)
         VALUES ($1, $2, 'identified', 'success', 'student', $3) RETURNING id`, [T, facUser, sid])).rows[0].id : null
      // biometric_events is append-only, so these stay; the marks citing them are removed.
      if (match) made.matches.push(match)
      await owner(
        `INSERT INTO school_attendance (schedule_id, student_id, marked_by_id, attendance_date, status, face_verified, face_match_event_id,
                                        verification_method, marked_at, tenant_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP, $9)`,
        [s, sid, A.facultyId, date, status, face, match, face ? 'FACE_MATCH' : 'MANUAL', T])
    }
    await mark(X, P[0], '2025-09-01', 'present', true); await mark(X, P[1], '2025-09-01', 'late'); await mark(X, P[2], '2025-09-01', 'absent')
    await mark(X, P[0], '2025-09-03', 'present'); await mark(X, P[1], '2025-09-03', 'excused'); await mark(X, P[3], '2025-09-03', 'present')
    await mark(Y, P[0], '2025-09-02', 'absent'); await mark(Y, P[1], '2025-09-02', 'present'); await mark(Y, P[3], '2025-09-02', 'present')
    await mark(Y, P[4], '2025-09-02', 'excused')
    await mark(X, P[0], '2026-01-05', 'present')

    // -- the day by class --------------------------------------------------
    console.log('-- the day by class --')
    let r = await call(`${BASE}/daily?date=2025-09-01`, admin)
    const cls = (id: string) => (r.json?.classes ?? []).find((c: any) => c.scheduleId === id)
    let x = cls(X)
    check('a Monday lists the class that meets Mondays and Wednesdays ("1,3")', r.status === 200 && !!x && x.meetsToday === true,
      `(${r.status} ${JSON.stringify(x)})`)
    check('with its register: 3 enrolled (the dropped student is not), 1 present, 1 late, 1 absent, none unmarked',
      x?.enrolled === 3 && x?.present === 1 && x?.late === 1 && x?.absent === 1 && x?.excused === 0 && x?.unmarked === 0
      && x?.registerTaken === true, `(${JSON.stringify(x)})`)
    check('and how each was taken: 1 by face, 2 by hand', x?.byFace === 1 && x?.byHand === 2, `(${x?.byFace} ${x?.byHand})`)
    const z = cls(Z)
    check('a class with no term meets on its weekday; its register not taken shows as such',
      z?.meetsToday === true && z?.registerTaken === false && z?.enrolled === 1 && z?.unmarked === 1, `(${JSON.stringify(z)})`)
    check('a class that meets on Tuesdays is not listed on a Monday', !cls(Y))
    check('the seeded class, whose term has not begun, is not listed', !cls(A.scheduleId))
    const t = r.json?.totals
    const sums = ['enrolled', 'present', 'late', 'absent', 'excused', 'unmarked', 'byFace', 'byHand']
      .every((k) => t?.[k] === r.json.classes.reduce((a: number, c: any) => a + c[k], 0))
    check('the totals are the sums of the classes shown', sums && t?.classes === r.json.classes.length
      && t?.registersNotTaken === r.json.classes.filter((c: any) => c.meetsToday && !c.registerTaken).length, `(${JSON.stringify(t)})`)

    r = await call(`${BASE}/daily?date=2025-09-02`, admin)
    const y = cls(Y)
    check('on the Tuesday: 4 enrolled, 2 present, 1 absent, 1 excused', y?.enrolled === 4 && y?.present === 2 && y?.absent === 1
      && y?.excused === 1 && y?.unmarked === 0, `(${JSON.stringify(y)})`)
    r = await call(`${BASE}/daily?date=2025-09-03`, admin)
    x = cls(X)
    check("on the Wednesday: 4 enrolled that day (P6 has joined), 2 unmarked, though a dropped student's mark is there (audit P3)",
      x?.enrolled === 4 && x?.unmarked === 2 && x?.present === 2 && x?.excused === 1, `(${JSON.stringify(x)})`)
    r = await call(`${BASE}/daily?date=2025-09-08`, admin)
    x = cls(X)
    check('a Monday with no marks: the class met and its register was not taken', x?.meetsToday === true && x?.registerTaken === false
      && x?.unmarked === 4 && r.json?.totals?.registersNotTaken >= 1, `(${JSON.stringify(x)})`)
    r = await call(`${BASE}/daily?date=2026-01-05`, admin)
    x = cls(X)
    check('after the term, the class does not meet, but a mark made then is still shown', x?.meetsToday === false && x?.present === 1,
      `(${JSON.stringify(x)})`)
    r = await call(`${BASE}/daily?date=2025-02-30`, admin)
    check('an impossible date is refused', r.status === 400, `(${r.status})`)
    r = await call(`${BASE}/daily?date=yesterday`, admin)
    check('a date that is not YYYY-MM-DD is refused', r.status === 400, `(${r.status})`)

    // -- the term ----------------------------------------------------------
    console.log('-- the term --')
    await owner(`DELETE FROM tenant_settings WHERE tenant_id = $1 AND setting_key = 'attendance.at_risk_percent'`, [T])
    r = await call(`${BASE}/term/${made.term}`, admin)
    const st = (i: number) => (r.json?.students ?? []).find((s: any) => s.studentId === P[i])
    check('the term report answers, with the default line of 80%', r.status === 200 && r.json?.atRiskPercent === 80,
      `(${r.status} ${r.json?.error ?? r.json?.atRiskPercent})`)
    check('P1: 3 sessions, 2 present, 1 absent: 66.7%, below',
      st(0)?.sessions === 3 && st(0)?.present === 2 && st(0)?.absent === 1 && st(0)?.ratePercent === 66.7 && st(0)?.below === true,
      `(${JSON.stringify(st(0))})`)
    check('P2: late counts as attended; excused leaves the denominator: 100%',
      st(1)?.sessions === 3 && st(1)?.late === 1 && st(1)?.excused === 1 && st(1)?.ratePercent === 100 && st(1)?.below === false,
      `(${JSON.stringify(st(1))})`)
    check('P3: a session with no mark is unmarked and not attended: 0%, below',
      st(2)?.sessions === 2 && st(2)?.absent === 1 && st(2)?.unmarked === 1 && st(2)?.ratePercent === 0 && st(2)?.below === true,
      `(${JSON.stringify(st(2))})`)
    check('P4: a dropped student\'s mark still counts; the sessions before it do not',
      st(3)?.sessions === 2 && st(3)?.present === 2 && st(3)?.ratePercent === 100, `(${JSON.stringify(st(3))})`)
    check('P5: only excused, so no rate and not below', st(4)?.sessions === 1 && st(4)?.ratePercent === null && st(4)?.below === false,
      `(${JSON.stringify(st(4))})`)
    check('the mark after the term is not in it', st(0)?.present === 2)
    check('P6, who joined after the first session: only the session since counts (audit P3)',
      st(5)?.sessions === 1 && st(5)?.unmarked === 1 && st(5)?.ratePercent === 0 && st(5)?.below === true,
      `(${JSON.stringify(st(5))})`)
    check('the term has exactly these six students', r.json?.students?.length === 6 && r.json?.totals?.students === 6
      && r.json?.totals?.below === 3, `(${r.json?.students?.length} ${JSON.stringify(r.json?.totals)})`)
    const c = (id: string) => (r.json?.classes ?? []).find((k: any) => k.scheduleId === id)
    check('class X: 2 sessions (the untaken register is not one), 5 students, 57.1%',
      c(X)?.sessions === 2 && c(X)?.students === 5 && c(X)?.ratePercent === 57.1, `(${JSON.stringify(c(X))})`)
    check('class Y: 1 session, 4 students, 66.7%', c(Y)?.sessions === 1 && c(Y)?.students === 4 && c(Y)?.ratePercent === 66.7,
      `(${JSON.stringify(c(Y))})`)
    check('a class outside the term is not in it', !c(Z) && r.json?.totals?.sessions === 3, `(${JSON.stringify(r.json?.totals)})`)

    r = await call(`${BASE}/term/${made.term}?below=60`, admin)
    check('a lower line asked for: P1 at 66.7% is no longer below', r.json?.atRiskPercent === 60
      && r.json?.students?.find((s: any) => s.studentId === P[0])?.below === false)
    await owner(`INSERT INTO tenant_settings (tenant_id, setting_key, setting_value) VALUES ($1, 'attendance.at_risk_percent', '70')`, [T])
    r = await call(`${BASE}/term/${made.term}`, admin)
    check('the school\'s own line is used when set', r.json?.atRiskPercent === 70, `(${r.json?.atRiskPercent})`)
    await owner(`UPDATE tenant_settings SET setting_value = 'lots' WHERE tenant_id = $1 AND setting_key = 'attendance.at_risk_percent'`, [T])
    r = await call(`${BASE}/term/${made.term}`, admin)
    check('an unusable setting falls back to 80', r.json?.atRiskPercent === 80, `(${r.json?.atRiskPercent})`)
    r = await call(`${BASE}/term/${made.term}?below=150`, admin)
    check('a line above 100% is refused', r.status === 400, `(${r.status})`)
    r = await call(`${BASE}/term/not-a-term`, admin)
    check('a term id that is not one is 404', r.status === 404, `(${r.status})`)

    // -- CSV ---------------------------------------------------------------
    console.log('-- CSV --')
    r = await call(`${BASE}/term/${made.term}?format=csv`, admin)
    const lines = r.text.split('\r\n')
    check('the term report downloads as CSV', r.status === 200 && r.type.startsWith('text/csv')
      && /attachment; filename="term-attendance.csv"/.test(r.disposition)
      && lines[0] === 'student_number,name,sessions,present,late,absent,excused,unmarked,rate_percent,below', `(${r.status} ${lines[0]})`)
    const evil = lines.find((l) => l.startsWith(`RPT-${RUN}-3,`)) ?? ''
    check('a name a spreadsheet would run as a formula is written as text', evil.startsWith(`RPT-${RUN}-3,"'=HYPERLINK(""http://x.test"",""click"") R3"`),
      `(${evil})`)
    const comma = lines.find((l) => l.startsWith(`RPT-${RUN}-4,`)) ?? ''
    check('a name with a comma is quoted', comma.startsWith(`RPT-${RUN}-4,"Dee, Jr R4",2,`), `(${comma})`)
    check('as many rows as students, and nothing else', lines.filter((l) => l).length === 7, `(${lines.length})`)
    r = await call(`${BASE}/daily?date=2025-09-01&format=csv`, admin)
    check('the day downloads as CSV, named for the date', r.status === 200 && /attendance-2025-09-01\.csv/.test(r.disposition)
      && r.text.includes(`X-${RUN},Report course X,`), `(${r.status} ${r.disposition})`)

    // -- who may see them --------------------------------------------------
    console.log('-- who may see them --')
    r = await call(`${BASE}/term/${made.term}`, adminB)
    check('another school\'s administrator gets 404 for this term', r.status === 404, `(${r.status})`)
    r = await call(`${BASE}/daily?date=2025-09-01`, adminB)
    check('and none of this school\'s classes in their day', r.status === 200
      && !(r.json?.classes ?? []).some((k: any) => [X, Y, Z].includes(k.scheduleId)), `(${r.status})`)
    for (const [who, token] of [['a lecturer', fac], ['a student', stu], ['an employer\'s administrator', corpAdmin]] as const) {
      r = await call(`${BASE}/term/${made.term}`, token)
      const d = await call(`${BASE}/daily?date=2025-09-01`, token)
      check(`${who} cannot see either report`, r.status === 403 && d.status === 403, `(${r.status} ${d.status})`)
    }
    r = await call(`${BASE}/daily?date=2025-09-01`, null)
    check('nobody signed in cannot either', r.status === 401, `(${r.status})`)
  } finally {
    await owner(`DELETE FROM school_attendance WHERE tenant_id = $1 AND schedule_id = ANY($2)`, [T, made.schedules])
    await owner(`DELETE FROM attendance_events WHERE tenant_id = $1 AND schedule_id = ANY($2)`, [T, made.schedules]).catch(() => undefined)
    await owner(`DELETE FROM student_courses WHERE tenant_id = $1 AND schedule_id = ANY($2)`, [T, made.schedules])
    await owner(`DELETE FROM class_schedules WHERE tenant_id = $1 AND id = ANY($2)`, [T, made.schedules])
    await owner(`DELETE FROM courses WHERE tenant_id = $1 AND id = ANY($2)`, [T, made.courses])
    await owner(`DELETE FROM students WHERE tenant_id = $1 AND id = ANY($2)`, [T, made.students])
    if (made.term) await owner(`DELETE FROM semesters WHERE id = $1`, [made.term])
    if (made.room) await owner(`DELETE FROM rooms WHERE id = $1`, [made.room])
    await owner(`DELETE FROM users WHERE id = ANY($1)`, [made.users])
    await owner(`DELETE FROM tenant_settings WHERE tenant_id = $1 AND setting_key = 'attendance.at_risk_percent'`, [T])
    if (atRiskBefore) {
      await owner(`INSERT INTO tenant_settings (tenant_id, setting_key, setting_value) VALUES ($1, 'attendance.at_risk_percent', $2)`,
        [T, atRiskBefore.setting_value])
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
