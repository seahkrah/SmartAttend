import { Router, Response } from 'express'
import crypto from 'crypto'
import { query } from '../db/connection.js'
import pool from '../db/connection.js'
import { authenticateToken } from '../auth/middleware.js'
import {
  resolveTenantContext,
  requireTenant,
  requirePlatform,
  requireRoles,
  type TenantRequest,
} from '../auth/tenantContextMiddleware.js'
import { TenantScopeError } from '../db/tenantScoped.js'
import { assertUsableMatch, BiometricError } from '../biometrics/service.js'
import { absencesSubmitted } from '../notifications/events.js'

/**
 * SMS — the faculty attendance workflow.
 *
 * Taking a register is a lifecycle, not a single write: draft while marks are
 * being made, submitted when the lecturer is done, locked when it becomes the
 * record of what happened. After locking, marks change only through the
 * correction trail, never by editing in place — that is what makes the record
 * defensible.
 *
 * Authority is checked twice on every route: the course must belong to the
 * caller's tenant, and the caller must be assigned to teach it. Being faculty
 * somewhere is not authority over any course.
 */

const router = Router()

router.use(
  authenticateToken,
  resolveTenantContext,
  requireTenant,
  requirePlatform('school'),
  requireRoles('faculty', 'admin')
)

function fail(res: Response, e: unknown) {
  if (e instanceof TenantScopeError) {
    return res.status(e.status).json({ error: 'Request refused', message: e.message })
  }
  console.error('[FACULTY]', e)
  return res.status(500).json({ error: 'Internal error' })
}

const VALID_STATUS = ['present', 'absent', 'late', 'excused'] as const
type MarkStatus = (typeof VALID_STATUS)[number]

function parseDate(v: unknown): string | null {
  const s = String(v ?? '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) return null
  return s
}

/**
 * Resolves a course the caller is entitled to act on.
 *
 * Returns null for a course in another tenant and for one the caller does not
 * teach, so neither case can be distinguished from the other by probing.
 * Admins are entitled to any course within their own tenant.
 */
async function authorisedCourse(ctx: any, courseId: string) {
  const r = await query(
    `SELECT c.*,
            (SELECT COUNT(*)::int FROM faculty_courses fc
               JOIN faculty f ON f.id = fc.faculty_id AND f.tenant_id = $1
              WHERE fc.course_id = c.id AND fc.tenant_id = $1 AND f.user_id = $3) AS teaches
       FROM courses c
      WHERE c.id = $2 AND c.tenant_id = $1`,
    [ctx.tenantId, courseId, ctx.userId]
  )
  if (r.rows.length === 0) return null
  const course = r.rows[0]
  if (ctx.roleName !== 'admin' && !ctx.isSuperadmin && course.teaches === 0) return null
  return course
}

/**
 * The caller's own faculty record in this tenant.
 *
 * school_attendance.marked_by_id references faculty(id), not users(id):
 * a mark is attributed to a person who teaches, not to any account. An admin
 * without a faculty record therefore cannot mark attendance, which is the
 * correct answer rather than a misattribution to someone else.
 */
async function callerFacultyId(ctx: any): Promise<string | null> {
  const r = await query(
    `SELECT id FROM faculty WHERE tenant_id = $1 AND user_id = $2 LIMIT 1`,
    [ctx.tenantId, ctx.userId]
  )
  return r.rows[0]?.id ?? null
}

/** The register for a course on a date, created lazily as a draft. */
async function getOrCreateSubmission(ctx: any, courseId: string, date: string) {
  const existing = await query(
    `SELECT * FROM attendance_submissions
      WHERE tenant_id = $1 AND course_id = $2 AND attendance_date = $3`,
    [ctx.tenantId, courseId, date]
  )
  if (existing.rows.length > 0) return existing.rows[0]

  const created = await query(
    `INSERT INTO attendance_submissions (tenant_id, course_id, attendance_date, status)
     VALUES ($1,$2,$3,'DRAFT')
     ON CONFLICT (tenant_id, course_id, attendance_date) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
     RETURNING *`,
    [ctx.tenantId, courseId, date]
  )
  return created.rows[0]
}

/** Schedules for a course, used to find the register's attendance rows. */
async function scheduleIdsFor(ctx: any, courseId: string): Promise<string[]> {
  const r = await query(
    `SELECT id FROM class_schedules WHERE tenant_id = $1 AND course_id = $2`,
    [ctx.tenantId, courseId]
  )
  return r.rows.map((x: any) => x.id)
}

// ---------------------------------------------------------------------------
// GET /api/faculty/attendance/draft
// ---------------------------------------------------------------------------
router.get('/attendance/draft', async (req: TenantRequest, res: Response) => {
  const ctx = req.ctx!
  const courseId = String(req.query.course_id ?? '')
  const date = parseDate(req.query.date)
  if (!courseId) return res.status(400).json({ error: 'Validation failed', message: 'course_id is required' })
  if (!date) return res.status(400).json({ error: 'Validation failed', message: 'date must be YYYY-MM-DD' })

  try {
    const course = await authorisedCourse(ctx, courseId)
    if (!course) {
      return res.status(404).json({ error: 'Not found', message: 'No such course you are assigned to in this tenant' })
    }

    const submission = await getOrCreateSubmission(ctx, courseId, date)
    const schedules = await scheduleIdsFor(ctx, courseId)

    // The roster and its marks are both bounded by tenant_id, so a schedule
    // shared by id across tenants could not pull in foreign students.
    const roster = await query(
      `SELECT DISTINCT s.id AS student_id, s.student_id AS enrollment_id,
              s.first_name, s.last_name, s.email,
              sa.status, sa.face_verified, sa.remarks, sa.marked_at
         FROM student_courses sc
         JOIN students s ON s.id = sc.student_id AND s.tenant_id = $1
         LEFT JOIN school_attendance sa
           ON sa.student_id = s.id AND sa.tenant_id = $1
          AND sa.attendance_date = $3
          AND sa.schedule_id = ANY($2::uuid[])
        WHERE sc.tenant_id = $1 AND sc.schedule_id = ANY($2::uuid[]) AND sc.is_active
        ORDER BY s.last_name, s.first_name`,
      [ctx.tenantId, schedules, date]
    )

    res.json({
      course_id: course.id,
      course_code: course.code,
      course_name: course.name,
      date,
      status: submission.status,
      submitted_at: submission.submitted_at,
      locked_at: submission.locked_at,
      editable: submission.status !== 'LOCKED',
      marks: roster.rows.map((x: any) => ({
        student_id: x.student_id,
        enrollment_id: x.enrollment_id,
        name: `${x.first_name} ${x.last_name}`,
        email: x.email,
        status: x.status ?? null,
        face_verified: x.face_verified ?? false,
        remarks: x.remarks ?? null,
        marked_at: x.marked_at ?? null,
      })),
      marked_count: roster.rows.filter((x: any) => x.status).length,
      roster_count: roster.rows.length,
    })
  } catch (e) {
    fail(res, e)
  }
})

// ---------------------------------------------------------------------------
// POST /api/faculty/attendance/submit
// ---------------------------------------------------------------------------
router.post('/attendance/submit', async (req: TenantRequest, res: Response) => {
  const ctx = req.ctx!
  const courseId = String(req.body?.course_id ?? '')
  const date = parseDate(req.body?.date)
  if (!courseId) return res.status(400).json({ error: 'Validation failed', message: 'course_id is required' })
  if (!date) return res.status(400).json({ error: 'Validation failed', message: 'date must be YYYY-MM-DD' })

  try {
    const course = await authorisedCourse(ctx, courseId)
    if (!course) {
      return res.status(404).json({ error: 'Not found', message: 'No such course you are assigned to in this tenant' })
    }
    const submission = await getOrCreateSubmission(ctx, courseId, date)
    if (submission.status === 'LOCKED') {
      return res.status(409).json({ error: 'Conflict', message: 'This register is locked' })
    }

    const schedules = await scheduleIdsFor(ctx, courseId)
    const counted = await query(
      `SELECT COUNT(*)::int AS n FROM school_attendance
        WHERE tenant_id = $1 AND attendance_date = $3 AND schedule_id = ANY($2::uuid[])`,
      [ctx.tenantId, schedules, date]
    )

    const updated = await query(
      `UPDATE attendance_submissions
          SET status = 'SUBMITTED', submitted_by_user_id = $1, submitted_at = CURRENT_TIMESTAMP,
              marks_count = $2
        WHERE tenant_id = $3 AND course_id = $4 AND attendance_date = $5
        RETURNING status, marks_count`,
      [ctx.userId, counted.rows[0].n, ctx.tenantId, courseId, date]
    )

    // The register is the lecturer's confirmed account of the session now,
    // so this is when guardians hear about absences. Best effort: a message
    // that cannot be queued is logged, and never undoes the submission.
    await absencesSubmitted({ tenantId: ctx.tenantId!, userId: ctx.userId }, courseId, date)

    res.json({ success: true, status: updated.rows[0].status, marks_count: updated.rows[0].marks_count })
  } catch (e) {
    fail(res, e)
  }
})

// ---------------------------------------------------------------------------
// POST /api/faculty/attendance/lock
// ---------------------------------------------------------------------------
router.post('/attendance/lock', async (req: TenantRequest, res: Response) => {
  const ctx = req.ctx!
  const courseId = String(req.body?.course_id ?? '')
  const date = parseDate(req.body?.date)
  if (!courseId) return res.status(400).json({ error: 'Validation failed', message: 'course_id is required' })
  if (!date) return res.status(400).json({ error: 'Validation failed', message: 'date must be YYYY-MM-DD' })

  try {
    const course = await authorisedCourse(ctx, courseId)
    if (!course) {
      return res.status(404).json({ error: 'Not found', message: 'No such course you are assigned to in this tenant' })
    }
    const submission = await getOrCreateSubmission(ctx, courseId, date)
    if (submission.status === 'LOCKED') {
      return res.status(409).json({ error: 'Conflict', message: 'This register is already locked' })
    }
    // Locking an unsubmitted register would skip the step where the lecturer
    // confirms the marks are complete.
    if (submission.status !== 'SUBMITTED') {
      return res.status(409).json({ error: 'Conflict', message: 'Submit the register before locking it' })
    }

    const updated = await query(
      `UPDATE attendance_submissions
          SET status = 'LOCKED', locked_by_user_id = $1, locked_at = CURRENT_TIMESTAMP
        WHERE tenant_id = $2 AND course_id = $3 AND attendance_date = $4
        RETURNING status`,
      [ctx.userId, ctx.tenantId, courseId, date]
    )
    res.json({ success: true, status: updated.rows[0].status })
  } catch (e) {
    fail(res, e)
  }
})

// ---------------------------------------------------------------------------
// POST /api/faculty/attendance/bulk-edit
// ---------------------------------------------------------------------------
router.post('/attendance/bulk-edit', async (req: TenantRequest, res: Response) => {
  const ctx = req.ctx!
  const courseId = String(req.body?.course_id ?? '')
  const date = parseDate(req.body?.date)
  const action = String(req.body?.action ?? '')
  const ACTIONS: Record<string, MarkStatus | null> = {
    MARK_ALL_PRESENT: 'present',
    MARK_ALL_ABSENT: 'absent',
    CLEAR: null,
  }

  if (!courseId) return res.status(400).json({ error: 'Validation failed', message: 'course_id is required' })
  if (!date) return res.status(400).json({ error: 'Validation failed', message: 'date must be YYYY-MM-DD' })
  if (!(action in ACTIONS)) {
    return res.status(400).json({ error: 'Validation failed', message: `action must be one of ${Object.keys(ACTIONS).join(', ')}` })
  }

  const client = await pool.connect()
  try {
    const course = await authorisedCourse(ctx, courseId)
    if (!course) {
      client.release()
      return res.status(404).json({ error: 'Not found', message: 'No such course you are assigned to in this tenant' })
    }
    const submission = await getOrCreateSubmission(ctx, courseId, date)
    if (submission.status === 'LOCKED') {
      client.release()
      return res.status(409).json({ error: 'Conflict', message: 'This register is locked and cannot be edited' })
    }

    const schedules = await scheduleIdsFor(ctx, courseId)
    if (schedules.length === 0) {
      client.release()
      return res.status(409).json({ error: 'Conflict', message: 'This course has no schedule to mark against' })
    }

    const markerId = await callerFacultyId(ctx)
    if (markerId === null && action !== 'CLEAR') {
      client.release()
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Marking attendance requires a faculty record in this tenant',
      })
    }

    await client.query('BEGIN')
    const target = ACTIONS[action]
    let affected = 0

    if (target === null) {
      const r = await client.query(
        `DELETE FROM school_attendance
          WHERE tenant_id = $1 AND attendance_date = $2 AND schedule_id = ANY($3::uuid[])`,
        [ctx.tenantId, date, schedules]
      )
      affected = r.rowCount ?? 0
    } else {
      // Every student written here comes from the tenant-scoped roster, so a
      // bulk action cannot reach a student outside the tenant.
      const roster = await client.query(
        `SELECT DISTINCT sc.student_id, sc.schedule_id
           FROM student_courses sc
           JOIN students s ON s.id = sc.student_id AND s.tenant_id = $1
          WHERE sc.tenant_id = $1 AND sc.schedule_id = ANY($2::uuid[]) AND sc.is_active`,
        [ctx.tenantId, schedules]
      )
      for (const row of roster.rows) {
        const existing = await client.query(
          `SELECT id FROM school_attendance
            WHERE tenant_id = $1 AND student_id = $2 AND schedule_id = $3 AND attendance_date = $4`,
          [ctx.tenantId, row.student_id, row.schedule_id, date]
        )
        if (existing.rows.length > 0) {
          await client.query(
            `UPDATE school_attendance SET status = $1, marked_by_id = $2, marked_at = CURRENT_TIMESTAMP
              WHERE id = $3 AND tenant_id = $4`,
            [target, markerId, existing.rows[0].id, ctx.tenantId]
          )
        } else {
          await client.query(
            `INSERT INTO school_attendance
               (schedule_id, student_id, marked_by_id, attendance_date, status, face_verified, tenant_id)
             VALUES ($1,$2,$3,$4,$5,false,$6)`,
            [row.schedule_id, row.student_id, markerId, date, target, ctx.tenantId]
          )
        }
        affected++
      }
    }

    await client.query(
      `UPDATE attendance_submissions SET marks_count = $1
        WHERE tenant_id = $2 AND course_id = $3 AND attendance_date = $4`,
      [target === null ? 0 : affected, ctx.tenantId, courseId, date]
    )
    await client.query('COMMIT')
    res.json({ success: true, affected_count: affected })
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    fail(res, e)
  } finally {
    client.release()
  }
})

// ---------------------------------------------------------------------------
// POST /api/faculty/attendance/facial-match
// ---------------------------------------------------------------------------
// Records a student present on the strength of a face match.
//
// This took a "confidence" number from the request and, above 0.85, wrote the
// student present and face-verified. The number was whatever the client sent.
// It now takes face_match_id: a match /api/biometrics/identify made for this
// student, in one of this course's classes, by this lecturer, moments ago.
// The match is spent here and cannot back another record.
router.post('/attendance/facial-match', async (req: TenantRequest, res: Response) => {
  const ctx = req.ctx!
  const courseId = String(req.body?.course_id ?? '')
  const date = parseDate(req.body?.date)
  const studentId = String(req.body?.student_id ?? '')
  const matchId = req.body?.face_match_id

  if (!courseId) return res.status(400).json({ error: 'Validation failed', message: 'course_id is required' })
  if (!date) return res.status(400).json({ error: 'Validation failed', message: 'date must be YYYY-MM-DD' })
  if (!studentId) return res.status(400).json({ error: 'Validation failed', message: 'student_id is required' })
  if (!matchId) {
    return res.status(400).json({
      error: 'Validation failed',
      message: 'face_match_id is required: identify the student with /api/biometrics/identify first',
    })
  }

  const client = await pool.connect()
  try {
    const course = await authorisedCourse(ctx, courseId)
    if (!course) {
      return res.status(404).json({ error: 'Not found', message: 'No such course you are assigned to in this tenant' })
    }
    const submission = await getOrCreateSubmission(ctx, courseId, date)
    if (submission.status === 'LOCKED') {
      return res.status(409).json({ error: 'Conflict', message: 'This register is locked' })
    }

    const schedules = await scheduleIdsFor(ctx, courseId)
    const enrolled = await query(
      `SELECT sc.schedule_id
         FROM student_courses sc
         JOIN students s ON s.id = sc.student_id AND s.tenant_id = $1
        WHERE sc.tenant_id = $1 AND sc.student_id = $2
          AND sc.schedule_id = ANY($3::uuid[]) AND sc.is_active
        LIMIT 1`,
      [ctx.tenantId, studentId, schedules]
    )
    if (enrolled.rows.length === 0) {
      return res.status(404).json({ error: 'Not found', message: 'That student is not enrolled on this course in this tenant' })
    }

    const markerId = await callerFacultyId(ctx)
    if (markerId === null) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Marking attendance requires a faculty record in this tenant',
      })
    }

    const scheduleId = enrolled.rows[0].schedule_id
    await client.query('BEGIN')
    const cited = await assertUsableMatch(client, ctx as any, matchId, {
      action: 'identified',
      subject: { type: 'student', id: studentId },
      scheduleId: schedules,
    })
    await client.query(
      `INSERT INTO school_attendance
         (schedule_id, student_id, marked_by_id, attendance_date, status,
          face_verified, face_match_event_id, verification_method, attendance_state, tenant_id)
       VALUES ($1,$2,$3,$4,'present',TRUE,$5,'FACE_MATCH','VERIFIED',$6)
       ON CONFLICT (schedule_id, student_id, attendance_date)
       DO UPDATE SET status = 'present', face_verified = TRUE, face_match_event_id = EXCLUDED.face_match_event_id,
                     marked_by_id = EXCLUDED.marked_by_id, marked_at = CURRENT_TIMESTAMP,
                     verification_method = 'FACE_MATCH', attendance_state = 'VERIFIED'`,
      [scheduleId, studentId, markerId, date, cited, ctx.tenantId]
    )
    await client.query('COMMIT')
    res.json({ success: true, status: 'present', face_verified: true, face_match_id: cited })
  } catch (e: any) {
    await client.query('ROLLBACK').catch(() => {})
    if (e instanceof BiometricError) return res.status(e.status).json({ error: e.message, code: e.code })
    if (e?.code === '23505') {
      return res.status(409).json({ error: 'A face match can back only one attendance record', code: 'match_used' })
    }
    fail(res, e)
  } finally {
    client.release()
  }
})

// ---------------------------------------------------------------------------
// GET /api/faculty/attendance/export
// ---------------------------------------------------------------------------
router.get('/attendance/export', async (req: TenantRequest, res: Response) => {
  const ctx = req.ctx!
  const courseId = String(req.query.course_id ?? '')
  const format = String(req.query.format ?? 'CSV').toUpperCase()
  if (!courseId) return res.status(400).json({ error: 'Validation failed', message: 'course_id is required' })
  if (format !== 'CSV') {
    return res.status(415).json({ error: 'Unsupported format', message: `${format} export is not implemented; request format=CSV` })
  }

  try {
    const course = await authorisedCourse(ctx, courseId)
    if (!course) {
      return res.status(404).json({ error: 'Not found', message: 'No such course you are assigned to in this tenant' })
    }
    const schedules = await scheduleIdsFor(ctx, courseId)

    const rows = await query(
      `SELECT sa.attendance_date, s.student_id AS enrollment_id,
              s.first_name || ' ' || s.last_name AS name, s.email,
              sa.status, sa.face_verified, sa.marked_at
         FROM school_attendance sa
         JOIN students s ON s.id = sa.student_id AND s.tenant_id = $1
        WHERE sa.tenant_id = $1 AND sa.schedule_id = ANY($2::uuid[])
        ORDER BY sa.attendance_date DESC, s.last_name`,
      [ctx.tenantId, schedules]
    )

    const escape = (v: unknown) => {
      const s = v === null || v === undefined ? '' : String(v)
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const csv = [
      ['date', 'enrollment_id', 'name', 'email', 'status', 'face_verified', 'marked_at'].join(','),
      ...rows.rows.map((x: any) =>
        [x.attendance_date, x.enrollment_id, x.name, x.email, x.status, x.face_verified, x.marked_at].map(escape).join(',')
      ),
    ].join('\n')

    const safe = String(course.code).replace(/[^a-z0-9]+/gi, '-').toLowerCase()
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${safe}-attendance.csv"`)
    res.send(csv)
  } catch (e) {
    fail(res, e)
  }
})

// ---------------------------------------------------------------------------
// GET /api/faculty/courses/:courseId/qr-code
// ---------------------------------------------------------------------------
router.get('/courses/:courseId/qr-code', async (req: TenantRequest, res: Response) => {
  const ctx = req.ctx!
  try {
    const course = await authorisedCourse(ctx, req.params.courseId)
    if (!course) {
      return res.status(404).json({ error: 'Not found', message: 'No such course you are assigned to in this tenant' })
    }

    const date = parseDate(req.query.date) ?? new Date().toISOString().slice(0, 10)
    const submission = await getOrCreateSubmission(ctx, course.id, date)
    if (submission.status === 'LOCKED') {
      return res.status(409).json({ error: 'Conflict', message: 'This register is locked' })
    }

    // The payload is signed and carries the tenant, so a code scanned against
    // another tenant's session cannot be replayed into this one. It also
    // expires, so a photographed code does not grant indefinite check-in.
    const expiresAt = Date.now() + 15 * 60 * 1000
    const payload = {
      v: 1,
      tenant_id: ctx.tenantId,
      course_id: course.id,
      session_id: submission.id,
      date,
      exp: expiresAt,
    }
    const secret = process.env.JWT_SECRET ?? ''
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
    const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url')

    res.json({
      qr_code_data: `jjelotech://attend?d=${body}&s=${sig}`,
      session_id: submission.id,
      course_code: course.code,
      date,
      expires_at: new Date(expiresAt).toISOString(),
    })
  } catch (e) {
    fail(res, e)
  }
})

export default router
