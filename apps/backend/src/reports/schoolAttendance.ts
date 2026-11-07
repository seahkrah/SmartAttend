/**
 * School attendance reports (brief 5.x, SMS): the day by class, and the term
 * by student and by class.
 *
 * What the numbers mean, since a rate is only as honest as its denominator:
 *
 *   - A class "meets" on a date when its days_of_week includes that weekday
 *     (or, for a class from before days_of_week, its day_of_week), and the
 *     date is inside its course's term when the course has one.
 *   - A "session" is a class on a date whose register was taken: at least one
 *     mark exists. A day the class did not run (a holiday, an absent
 *     teacher) has no marks and is not counted against anyone. Sessions that
 *     should have been taken and were not are reported separately, as
 *     registers not taken, so they are not hidden either.
 *   - Present and late count as attended. Excused is neither attended nor
 *     missed: it leaves the denominator. A student enrolled in a session but
 *     with no mark is "unmarked", shown, and counted as not attended, since
 *     nobody recorded them there.
 *   - The attendance rate is attended / (sessions - excused).
 *
 * A student is "below" when their rate is under the school's
 * attendance.at_risk_percent (a school setting, default 80), the line the
 * school chose for following up, not a statutory one.
 */
import { query } from '../db/connection.js'

export const DEFAULT_AT_RISK_PERCENT = 80

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export class ReportInputError extends Error {
  readonly status: number
  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}

export function isoDate(v: unknown, name: string): string {
  const s = String(v ?? '')
  // The round trip refuses 2025-02-30, which Date quietly turns into 2 March.
  const d = new Date(`${s}T00:00:00Z`)
  if (!ISO_DATE.test(s) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
    throw new ReportInputError(`${name} must be a date as YYYY-MM-DD`)
  }
  return s
}

/** A class meets on date $2 (SQL fragment over class_schedules cs, courses c, semesters t). */
const MEETS = `(
  (cs.days_of_week IS NOT NULL AND (',' || replace(cs.days_of_week, ' ', '') || ',') LIKE '%,' || EXTRACT(DOW FROM $2::date)::int || ',%')
  OR (cs.days_of_week IS NULL AND cs.day_of_week = EXTRACT(DOW FROM $2::date)::int)
) AND (t.id IS NULL OR $2::date BETWEEN t.start_date AND t.end_date)`

export interface DailyClassRow {
  scheduleId: string
  courseCode: string
  courseName: string
  section: number | null
  startTime: string | null
  faculty: string | null
  meetsToday: boolean
  enrolled: number
  present: number
  late: number
  absent: number
  excused: number
  unmarked: number
  byFace: number
  byHand: number
  registerTaken: boolean
}

/** Every class that met on a date, or was marked on it, with its register's numbers. */
export async function dailyByClass(tenantId: string, date: string) {
  const r = await query(
    `WITH classes AS (
       SELECT cs.id, (${MEETS}) AS meets
         FROM class_schedules cs
         JOIN courses c ON c.id = cs.course_id AND c.tenant_id = cs.tenant_id
         LEFT JOIN semesters t ON t.id = c.semester_id AND t.tenant_id = c.tenant_id
        WHERE cs.tenant_id = $1
     ),
     wanted AS (
       SELECT id, meets FROM classes WHERE meets
       UNION
       SELECT sa.schedule_id, COALESCE((SELECT meets FROM classes k WHERE k.id = sa.schedule_id), false)
         FROM school_attendance sa WHERE sa.tenant_id = $1 AND sa.attendance_date = $2::date
     )
     SELECT cs.id AS "scheduleId", c.code AS "courseCode", c.name AS "courseName", cs.section,
            to_char(cs.start_time, 'HH24:MI') AS "startTime",
            NULLIF(trim(CONCAT(f.first_name, ' ', f.last_name)), '') AS faculty,
            bool_or(w.meets) AS "meetsToday",
            (SELECT count(*)::int FROM student_courses sc
              WHERE sc.schedule_id = cs.id AND sc.tenant_id = cs.tenant_id AND sc.status = 'enrolled') AS enrolled,
            count(sa.id) FILTER (WHERE sa.status = 'present')::int AS present,
            count(sa.id) FILTER (WHERE sa.status = 'late')::int AS late,
            count(sa.id) FILTER (WHERE sa.status = 'absent')::int AS absent,
            count(sa.id) FILTER (WHERE sa.status = 'excused')::int AS excused,
            count(sa.id) FILTER (WHERE sa.face_verified)::int AS "byFace",
            count(sa.id) FILTER (WHERE sa.id IS NOT NULL AND NOT COALESCE(sa.face_verified, false))::int AS "byHand",
            count(sa.id)::int AS marked
       FROM wanted w
       JOIN class_schedules cs ON cs.id = w.id AND cs.tenant_id = $1
       JOIN courses c ON c.id = cs.course_id AND c.tenant_id = cs.tenant_id
       LEFT JOIN faculty f ON f.id = cs.faculty_id AND f.tenant_id = cs.tenant_id
       LEFT JOIN school_attendance sa ON sa.schedule_id = cs.id AND sa.tenant_id = cs.tenant_id AND sa.attendance_date = $2::date
      GROUP BY cs.id, c.code, c.name, cs.section, cs.start_time, f.first_name, f.last_name
      ORDER BY cs.start_time NULLS LAST, c.code, cs.section`,
    [tenantId, date])
  const classes: DailyClassRow[] = r.rows.map((x: any) => ({
    scheduleId: x.scheduleId, courseCode: x.courseCode, courseName: x.courseName, section: x.section,
    startTime: x.startTime, faculty: x.faculty, meetsToday: x.meetsToday,
    enrolled: x.enrolled, present: x.present, late: x.late, absent: x.absent, excused: x.excused,
    // A mark for someone no longer enrolled is still a mark; unmarked never goes below zero.
    unmarked: Math.max(0, x.enrolled - x.marked), byFace: x.byFace, byHand: x.byHand, registerTaken: x.marked > 0,
  }))
  const sum = (k: keyof DailyClassRow) => classes.reduce((a, c) => a + (c[k] as number), 0)
  return {
    date,
    totals: {
      classes: classes.length,
      registersTaken: classes.filter((c) => c.registerTaken).length,
      registersNotTaken: classes.filter((c) => c.meetsToday && !c.registerTaken).length,
      enrolled: sum('enrolled'), present: sum('present'), late: sum('late'), absent: sum('absent'),
      excused: sum('excused'), unmarked: sum('unmarked'), byFace: sum('byFace'), byHand: sum('byHand'),
    },
    classes,
  }
}

export interface TermStudentRow {
  studentId: string
  studentNumber: string
  name: string
  sessions: number
  present: number
  late: number
  absent: number
  excused: number
  unmarked: number
  /** attended / (sessions - excused), as a percentage to one decimal; null with nothing to divide by. */
  ratePercent: number | null
  below: boolean
}

function rate(attended: number, sessions: number, excused: number): number | null {
  const d = sessions - excused
  return d > 0 ? Math.round((attended / d) * 1000) / 10 : null
}

/** A term's attendance, by student and by class. */
export async function termReport(tenantId: string, termId: string, atRiskPercent: number) {
  if (!UUID.test(termId)) throw new ReportInputError('No such term', 404)
  const term = await query(
    `SELECT id, name, to_char(start_date, 'YYYY-MM-DD') AS "startDate", to_char(end_date, 'YYYY-MM-DD') AS "endDate"
       FROM semesters WHERE id = $1 AND tenant_id = $2`, [termId, tenantId])
  if (!term.rows.length) throw new ReportInputError('No such term', 404)
  const t = term.rows[0]

  // Sessions: each class of the term, on each date in the term its register was taken.
  // Each enrolled student's row in each session: their mark, or none.
  const base = `
    WITH sessions AS (
      SELECT DISTINCT sa.schedule_id, sa.attendance_date
        FROM school_attendance sa
        JOIN class_schedules cs ON cs.id = sa.schedule_id AND cs.tenant_id = sa.tenant_id
        JOIN courses c ON c.id = cs.course_id AND c.tenant_id = cs.tenant_id
       WHERE sa.tenant_id = $1 AND c.semester_id = $2 AND sa.attendance_date BETWEEN $3::date AND $4::date
    ),
    seats AS (
      SELECT s.schedule_id, s.attendance_date, sc.student_id, sa.status
        FROM sessions s
        JOIN student_courses sc ON sc.schedule_id = s.schedule_id AND sc.tenant_id = $1 AND sc.status = 'enrolled'
        LEFT JOIN school_attendance sa ON sa.tenant_id = $1 AND sa.schedule_id = s.schedule_id
              AND sa.attendance_date = s.attendance_date AND sa.student_id = sc.student_id
      UNION ALL
      -- Marked, but no longer enrolled: the mark still happened.
      SELECT sa.schedule_id, sa.attendance_date, sa.student_id, sa.status
        FROM sessions s
        JOIN school_attendance sa ON sa.tenant_id = $1 AND sa.schedule_id = s.schedule_id AND sa.attendance_date = s.attendance_date
       WHERE NOT EXISTS (SELECT 1 FROM student_courses sc WHERE sc.schedule_id = sa.schedule_id AND sc.tenant_id = $1
                           AND sc.student_id = sa.student_id AND sc.status = 'enrolled')
    )`
  const params = [tenantId, termId, t.startDate, t.endDate]
  const byStudent = await query(
    `${base}
     SELECT st.id AS "studentId", st.student_id AS "studentNumber",
            trim(CONCAT(st.first_name, ' ', st.last_name)) AS name,
            count(*)::int AS sessions,
            count(*) FILTER (WHERE x.status = 'present')::int AS present,
            count(*) FILTER (WHERE x.status = 'late')::int AS late,
            count(*) FILTER (WHERE x.status = 'absent')::int AS absent,
            count(*) FILTER (WHERE x.status = 'excused')::int AS excused,
            count(*) FILTER (WHERE x.status IS NULL)::int AS unmarked
       FROM seats x JOIN students st ON st.id = x.student_id AND st.tenant_id = $1
      GROUP BY st.id, st.student_id, st.first_name, st.last_name
      ORDER BY st.last_name, st.first_name`, params)
  const byClass = await query(
    `${base}
     SELECT cs.id AS "scheduleId", c.code AS "courseCode", c.name AS "courseName", cs.section,
            NULLIF(trim(CONCAT(f.first_name, ' ', f.last_name)), '') AS faculty,
            count(DISTINCT x.attendance_date)::int AS sessions,
            count(DISTINCT x.student_id)::int AS students,
            count(*) FILTER (WHERE x.status IN ('present', 'late'))::int AS attended,
            count(*) FILTER (WHERE x.status = 'excused')::int AS excused,
            count(*)::int AS seats
       FROM seats x
       JOIN class_schedules cs ON cs.id = x.schedule_id AND cs.tenant_id = $1
       JOIN courses c ON c.id = cs.course_id AND c.tenant_id = cs.tenant_id
       LEFT JOIN faculty f ON f.id = cs.faculty_id AND f.tenant_id = cs.tenant_id
      GROUP BY cs.id, c.code, c.name, cs.section, f.first_name, f.last_name
      ORDER BY c.code, cs.section`, params)

  const students: TermStudentRow[] = byStudent.rows.map((x: any) => {
    const r = rate(x.present + x.late, x.sessions, x.excused)
    return { ...x, ratePercent: r, below: r !== null && r < atRiskPercent }
  })
  const classes = byClass.rows.map((x: any) => ({
    scheduleId: x.scheduleId, courseCode: x.courseCode, courseName: x.courseName, section: x.section, faculty: x.faculty,
    sessions: x.sessions, students: x.students, ratePercent: rate(x.attended, x.seats, x.excused),
  }))
  return {
    term: t,
    atRiskPercent,
    totals: {
      students: students.length,
      below: students.filter((s) => s.below).length,
      sessions: classes.reduce((a: number, c: any) => a + c.sessions, 0),
    },
    students,
    classes,
  }
}

/** The school's follow-up line, from its settings; the default where unset or unusable. */
export async function atRiskPercentFor(tenantId: string, override?: unknown): Promise<number> {
  if (override !== undefined && override !== '') {
    const v = Number(override)
    if (!Number.isFinite(v) || v < 0 || v > 100) throw new ReportInputError('below must be a percentage from 0 to 100')
    return v
  }
  const r = await query(
    `SELECT setting_value FROM tenant_settings WHERE tenant_id = $1 AND setting_key = 'attendance.at_risk_percent'`, [tenantId])
  const v = Number(r.rows[0]?.setting_value)
  return r.rows.length && Number.isFinite(v) && v >= 0 && v <= 100 ? v : DEFAULT_AT_RISK_PERCENT
}

/**
 * One CSV cell. Quoted when it must be, and a value a spreadsheet would run
 * as a formula (a name beginning with =, +, - or @) is prefixed with an
 * apostrophe so it is shown, not evaluated.
 */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v)
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'
}
