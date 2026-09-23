import { Router, Response } from 'express'
import pool, { query } from '../db/connection.js'
import { authenticateToken } from '../auth/middleware.js'
import {
  resolveTenantContext,
  requireTenant,
  requirePlatform,
  requireRoles,
  type ResolvedTenantContext,
  type TenantRequest,
} from '../auth/tenantContextMiddleware.js'
import {
  resolveScheme,
  schemeBands,
  computeCourseResults,
  computeGpa,
  GradingError,
} from '../services/gradingService.js'
import { resultsPublished } from '../notifications/events.js'

/**
 * SMS — the gradebook: assessments, marks, results and transcripts.
 *
 * Who may do what:
 *
 *   grading schemes   the registrar's policy, so admin-only
 *   assessments       the lecturer's, for courses they teach
 *   marks             the lecturer's, for their own course's students
 *   publishing        the registrar's — a published result is the school's
 *                     official position, not one lecturer's
 *   transcripts       a student's own, or staff reading any in the school
 *
 * Authority is checked twice on every course route: the course must be in the
 * caller's tenant, and the caller must teach it. Being faculty somewhere is
 * not authority over any course.
 */

const router = Router()

router.use(authenticateToken, resolveTenantContext, requireTenant, requirePlatform('school'))

type Ctx = ResolvedTenantContext & { tenantId: string }

function ctxOf(req: TenantRequest): Ctx {
  return req.ctx as Ctx
}

const registrar = requireRoles('admin')
const teaching = requireRoles('admin', 'faculty')

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function fail(res: Response, label: string, e: unknown) {
  if (e instanceof GradingError) {
    return res.status(e.status).json({ error: e.message })
  }
  const err = e as { code?: string; constraint?: string; message?: string }

  if (err.code === '23505') {
    return res.status(409).json({ error: 'That record already exists' })
  }
  if (err.code === '23P01') {
    return res.status(409).json({ error: 'Grade bands may not overlap within a scheme' })
  }
  if (err.code === '23514') {
    // The score-bound trigger raises check_violation with a usable message.
    return res.status(400).json({ error: err.message ?? 'Value out of range' })
  }
  if (err.code === '23503') {
    return res.status(409).json({ error: 'This record is still referenced elsewhere' })
  }
  console.error(`[GRADEBOOK] ${label}:`, e)
  return res.status(500).json({ error: `Failed to ${label}` })
}

function notFound(res: Response, what: string) {
  return res.status(404).json({ error: `${what} not found` })
}

async function owned(table: string, ctx: Ctx, id: string): Promise<any | null> {
  if (!/^[a-z_]+$/.test(table)) throw new Error('unsafe table')
  if (!UUID.test(id ?? '')) return null
  const r = await query(`SELECT * FROM ${table} WHERE id = $1 AND tenant_id = $2`, [id, ctx.tenantId])
  return r.rows[0] ?? null
}

/**
 * A course the caller may act on.
 *
 * Returns null for a course in another school and for one the caller does not
 * teach, so neither can be distinguished by probing. Admins may act on any
 * course within their own school.
 */
async function authorisedCourse(ctx: Ctx, courseId: string): Promise<any | null> {
  const course = await owned('courses', ctx, courseId)
  if (!course) return null
  if (ctx.roleName === 'admin' || ctx.isSuperadmin) return course

  const teaches = await query(
    `SELECT 1
       FROM class_schedules cs
       JOIN faculty f ON f.id = cs.faculty_id AND f.tenant_id = $1
      WHERE cs.course_id = $2 AND cs.tenant_id = $1 AND f.user_id = $3
      LIMIT 1`,
    [ctx.tenantId, courseId, ctx.userId]
  )
  return teaches.rows.length > 0 ? course : null
}

// ===========================================================================
// Grading schemes
// ===========================================================================

router.get('/schemes', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const schemes = await query(
      `SELECT * FROM grading_schemes WHERE tenant_id = $1 ORDER BY is_default DESC, name`,
      [ctx.tenantId]
    )
    const bands = await query(
      `SELECT * FROM grade_bands WHERE tenant_id = $1 ORDER BY scheme_id, min_score DESC`,
      [ctx.tenantId]
    )
    return res.json({
      schemes: schemes.rows.map((s: any) => ({
        ...s,
        bands: bands.rows.filter((b: any) => b.scheme_id === s.id),
      })),
    })
  } catch (e) {
    return fail(res, 'load grading schemes', e)
  }
})

router.post('/schemes', registrar, async (req: TenantRequest, res: Response) => {
  const client = await pool.connect()
  try {
    const ctx = ctxOf(req)
    const { name, description, maxGradePoint, passMark, isDefault, bands } = req.body ?? {}

    if (!name) return res.status(400).json({ error: 'name is required' })
    if (!Array.isArray(bands) || bands.length === 0) {
      return res.status(400).json({
        error: 'A grading scheme needs at least one band, or it cannot grade anything',
      })
    }

    await client.query('BEGIN')

    if (isDefault) {
      await client.query(
        `UPDATE grading_schemes SET is_default = FALSE WHERE tenant_id = $1`,
        [ctx.tenantId]
      )
    }

    const scheme = await client.query(
      `INSERT INTO grading_schemes
         (tenant_id, name, description, max_grade_point, pass_mark, is_default)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [
        ctx.tenantId, name, description || null,
        maxGradePoint !== undefined ? Number(maxGradePoint) : 4,
        passMark !== undefined ? Number(passMark) : 40,
        !!isDefault,
      ]
    )

    for (const b of bands) {
      if (!b.letter || b.minScore === undefined || b.maxScore === undefined) {
        throw new GradingError('Each band needs a letter, a minScore and a maxScore')
      }
      await client.query(
        `INSERT INTO grade_bands
           (tenant_id, scheme_id, letter, min_score, max_score, grade_point, is_pass, remark)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          ctx.tenantId, scheme.rows[0].id, b.letter,
          Number(b.minScore), Number(b.maxScore),
          b.gradePoint !== undefined ? Number(b.gradePoint) : 0,
          b.isPass !== undefined ? !!b.isPass : true,
          b.remark || null,
        ]
      )
    }

    await client.query('COMMIT')

    const saved = await query(
      `SELECT * FROM grade_bands WHERE scheme_id = $1 ORDER BY min_score DESC`,
      [scheme.rows[0].id]
    )
    return res.status(201).json({ scheme: { ...scheme.rows[0], bands: saved.rows } })
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    return fail(res, 'create grading scheme', e)
  } finally {
    client.release()
  }
})

router.delete('/schemes/:id', registrar, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const used = await query(
      `SELECT COUNT(*)::int AS n FROM course_results
        WHERE scheme_id = $1 AND tenant_id = $2`,
      [req.params.id, ctx.tenantId]
    )
    if (used.rows[0].n > 0) {
      return res.status(409).json({
        error: `${used.rows[0].n} result(s) were graded with this scheme, so it cannot be deleted`,
      })
    }
    const deleted = await query(
      `DELETE FROM grading_schemes WHERE id = $1 AND tenant_id = $2 RETURNING id`,
      [req.params.id, ctx.tenantId]
    )
    if (deleted.rows.length === 0) return notFound(res, 'Grading scheme')
    return res.json({ message: 'Grading scheme deleted' })
  } catch (e) {
    return fail(res, 'delete grading scheme', e)
  }
})

// ===========================================================================
// Assessments
// ===========================================================================

router.get('/courses/:courseId/assessments', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const course = await owned('courses', ctx, req.params.courseId)
    if (!course) return notFound(res, 'Course')

    const result = await query(
      `SELECT a.*,
              (SELECT COUNT(*)::int FROM assessment_scores s
                WHERE s.assessment_id = a.id AND s.status = 'graded') AS graded_count
         FROM assessments a
        WHERE a.course_id = $1 AND a.tenant_id = $2
        ORDER BY a.due_date NULLS LAST, a.created_at`,
      [course.id, ctx.tenantId]
    )

    const declared = result.rows.reduce((sum: number, a: any) => sum + Number(a.weight), 0)
    return res.json({
      assessments: result.rows,
      // Surfaced rather than enforced: a course mid-setup legitimately totals
      // less than 100, and refusing that would block the registrar's work.
      weightTotal: Math.round(declared * 100) / 100,
      weightComplete: Math.abs(declared - 100) < 0.01,
    })
  } catch (e) {
    return fail(res, 'load assessments', e)
  }
})

router.post('/courses/:courseId/assessments', teaching, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const course = await authorisedCourse(ctx, req.params.courseId)
    if (!course) return notFound(res, 'Course')

    const { title, kind, maxScore, weight, dueDate, semesterId } = req.body ?? {}
    if (!title || weight === undefined) {
      return res.status(400).json({ error: 'title and weight are required' })
    }

    const w = Number(weight)
    if (!Number.isFinite(w) || w <= 0 || w > 100) {
      return res.status(400).json({ error: 'weight must be between 0 and 100' })
    }

    if (semesterId && !(await owned('semesters', ctx, String(semesterId)))) {
      return notFound(res, 'Term')
    }

    // The weights of a course's assessments are a contract with its students;
    // letting them exceed 100 makes every grade meaningless.
    const current = await query(
      `SELECT COALESCE(SUM(weight), 0)::numeric AS total FROM assessments
        WHERE course_id = $1 AND tenant_id = $2`,
      [course.id, ctx.tenantId]
    )
    if (Number(current.rows[0].total) + w > 100.01) {
      return res.status(409).json({
        error: `This course's assessments already carry ${current.rows[0].total}% weight; adding ${w}% would exceed 100%`,
      })
    }

    const created = await query(
      `INSERT INTO assessments
         (tenant_id, course_id, semester_id, title, kind, max_score, weight, due_date, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        ctx.tenantId, course.id, semesterId || null, title, kind || 'assignment',
        maxScore !== undefined ? Number(maxScore) : 100, w, dueDate || null, ctx.userId,
      ]
    )
    return res.status(201).json({ assessment: created.rows[0] })
  } catch (e) {
    return fail(res, 'create assessment', e)
  }
})

router.patch('/assessments/:id', teaching, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const existing = await owned('assessments', ctx, req.params.id)
    if (!existing) return notFound(res, 'Assessment')
    if (!(await authorisedCourse(ctx, existing.course_id))) return notFound(res, 'Assessment')

    const b = req.body ?? {}
    const fields: string[] = []
    const values: any[] = []
    const set = (col: string, v: unknown) => {
      values.push(v)
      fields.push(`${col} = $${values.length}`)
    }

    if (b.weight !== undefined) {
      const w = Number(b.weight)
      const others = await query(
        `SELECT COALESCE(SUM(weight), 0)::numeric AS total FROM assessments
          WHERE course_id = $1 AND tenant_id = $2 AND id <> $3`,
        [existing.course_id, ctx.tenantId, existing.id]
      )
      if (Number(others.rows[0].total) + w > 100.01) {
        return res.status(409).json({
          error: `The other assessments carry ${others.rows[0].total}%; ${w}% would exceed 100%`,
        })
      }
      set('weight', w)
    }
    if (b.title !== undefined) set('title', b.title)
    if (b.kind !== undefined) set('kind', b.kind)
    if (b.maxScore !== undefined) set('max_score', Number(b.maxScore))
    if (b.dueDate !== undefined) set('due_date', b.dueDate || null)
    if (b.published !== undefined) set('published', !!b.published)

    if (fields.length === 0) return res.json({ assessment: existing })

    fields.push('updated_at = CURRENT_TIMESTAMP')
    values.push(existing.id, ctx.tenantId)
    const updated = await query(
      `UPDATE assessments SET ${fields.join(', ')}
        WHERE id = $${values.length - 1} AND tenant_id = $${values.length}
        RETURNING *`,
      values
    )
    return res.json({ assessment: updated.rows[0] })
  } catch (e) {
    return fail(res, 'update assessment', e)
  }
})

router.delete('/assessments/:id', teaching, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const existing = await owned('assessments', ctx, req.params.id)
    if (!existing) return notFound(res, 'Assessment')
    if (!(await authorisedCourse(ctx, existing.course_id))) return notFound(res, 'Assessment')

    const graded = await query(
      `SELECT COUNT(*)::int AS n FROM assessment_scores
        WHERE assessment_id = $1 AND tenant_id = $2 AND status = 'graded'`,
      [existing.id, ctx.tenantId]
    )
    if (graded.rows[0].n > 0 && ctx.roleName !== 'admin' && !ctx.isSuperadmin) {
      return res.status(409).json({
        error: `${graded.rows[0].n} student(s) have been marked on this assessment. A registrar must remove it.`,
      })
    }

    await query(`DELETE FROM assessments WHERE id = $1 AND tenant_id = $2`, [
      existing.id, ctx.tenantId,
    ])
    return res.json({ message: 'Assessment deleted' })
  } catch (e) {
    return fail(res, 'delete assessment', e)
  }
})

// ===========================================================================
// Marks
// ===========================================================================

router.get('/assessments/:id/scores', teaching, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const assessment = await owned('assessments', ctx, req.params.id)
    if (!assessment) return notFound(res, 'Assessment')
    if (!(await authorisedCourse(ctx, assessment.course_id))) return notFound(res, 'Assessment')

    // Everyone enrolled, whether marked yet or not, so the gap is visible.
    const result = await query(
      `SELECT s.id AS student_id, s.student_id AS student_number,
              s.first_name, s.last_name,
              sc.score, sc.status, sc.feedback, sc.graded_at
         FROM (
           SELECT DISTINCT stu.id, stu.student_id, stu.first_name, stu.last_name
             FROM student_courses en
             JOIN class_schedules cs ON cs.id = en.schedule_id
             JOIN students stu ON stu.id = en.student_id
            WHERE cs.course_id = $1 AND en.tenant_id = $2 AND en.status = 'enrolled'
         ) s
         LEFT JOIN assessment_scores sc
           ON sc.student_id = s.id AND sc.assessment_id = $3 AND sc.tenant_id = $2
        ORDER BY s.last_name, s.first_name`,
      [assessment.course_id, ctx.tenantId, assessment.id]
    )

    return res.json({ assessment, scores: result.rows })
  } catch (e) {
    return fail(res, 'load scores', e)
  }
})

router.put('/assessments/:id/scores', teaching, async (req: TenantRequest, res: Response) => {
  const client = await pool.connect()
  try {
    const ctx = ctxOf(req)
    const assessment = await owned('assessments', ctx, req.params.id)
    if (!assessment) return notFound(res, 'Assessment')
    if (!(await authorisedCourse(ctx, assessment.course_id))) return notFound(res, 'Assessment')

    const { scores } = req.body ?? {}
    if (!Array.isArray(scores) || scores.length === 0) {
      return res.status(400).json({ error: 'scores[] is required' })
    }

    // Every student id is checked against the course's enrolment, so a mark
    // cannot be recorded for someone who is not taking the course — nor for
    // another school's student.
    const enrolled = await query(
      `SELECT DISTINCT en.student_id
         FROM student_courses en
         JOIN class_schedules cs ON cs.id = en.schedule_id
        WHERE cs.course_id = $1 AND en.tenant_id = $2 AND en.status = 'enrolled'`,
      [assessment.course_id, ctx.tenantId]
    )
    const allowed = new Set(enrolled.rows.map((r: any) => r.student_id))

    const rejected = scores
      .map((s: any) => String(s.studentId))
      .filter((id: string) => !allowed.has(id))
    if (rejected.length > 0) {
      return res.status(400).json({
        error: `${rejected.length} of the students supplied are not enrolled on this course`,
      })
    }

    await client.query('BEGIN')
    let written = 0

    for (const s of scores) {
      const status = s.status ?? 'graded'
      const raw = s.score === undefined || s.score === null || s.score === '' ? null : Number(s.score)

      if (status === 'graded' && (raw === null || !Number.isFinite(raw))) {
        throw new GradingError('A graded mark needs a numeric score')
      }

      await client.query(
        `INSERT INTO assessment_scores
           (tenant_id, assessment_id, student_id, score, status, feedback, graded_by, graded_at)
         -- The status is bound twice on purpose: once as the varchar column
         -- value and once as a text comparison operand. Reusing one parameter
         -- for both left the planner unable to deduce a single type.
         VALUES ($1,$2,$3,$4,$5,$6,$7,
                 CASE WHEN $8 = 'graded' THEN CURRENT_TIMESTAMP ELSE NULL END)
         ON CONFLICT (assessment_id, student_id)
         DO UPDATE SET score = EXCLUDED.score,
                       status = EXCLUDED.status,
                       feedback = EXCLUDED.feedback,
                       graded_by = EXCLUDED.graded_by,
                       graded_at = EXCLUDED.graded_at,
                       updated_at = CURRENT_TIMESTAMP`,
        [
          ctx.tenantId, assessment.id, s.studentId, raw, status,
          s.feedback || null, ctx.userId, status,
        ]
      )
      written++
    }

    await client.query('COMMIT')
    return res.json({ message: 'Scores saved', written })
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    return fail(res, 'save scores', e)
  } finally {
    client.release()
  }
})

// ===========================================================================
// Results
// ===========================================================================

router.get('/courses/:courseId/results', teaching, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const course = await authorisedCourse(ctx, req.params.courseId)
    if (!course) return notFound(res, 'Course')

    const semesterId = req.query.semesterId ? String(req.query.semesterId) : null
    const scheme = await resolveScheme(ctx.tenantId, req.query.schemeId as string | undefined)
    const bands = await schemeBands(ctx.tenantId, scheme.id)

    const computed = await computeCourseResults(ctx.tenantId, course.id, semesterId, bands)

    const students = await query(
      `SELECT id, student_id, first_name, last_name FROM students
        WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
      [ctx.tenantId, computed.map((c) => c.studentId)]
    )
    const byId = new Map(students.rows.map((s: any) => [s.id, s]))

    const stored = await query(
      `SELECT student_id, status, published_at FROM course_results
        WHERE course_id = $1 AND tenant_id = $2
          AND ($3::uuid IS NULL OR semester_id = $3::uuid)`,
      [course.id, ctx.tenantId, semesterId]
    )
    const storedById = new Map(stored.rows.map((r: any) => [r.student_id, r]))

    return res.json({
      course: { id: course.id, code: course.code, name: course.name },
      scheme: { id: scheme.id, name: scheme.name, passMark: Number(scheme.pass_mark) },
      results: computed.map((c) => ({
        ...c,
        student: byId.get(c.studentId) ?? null,
        status: storedById.get(c.studentId)?.status ?? 'unsaved',
        publishedAt: storedById.get(c.studentId)?.published_at ?? null,
      })),
    })
  } catch (e) {
    return fail(res, 'compute results', e)
  }
})

/**
 * Publishing is the registrar's act, not the lecturer's.
 *
 * A published result is what the school stands behind, and the check below
 * refuses to publish a course whose assessment weights do not total 100 —
 * a grade computed over two thirds of a course is not a final grade.
 */
router.post('/courses/:courseId/results/publish', registrar, async (req: TenantRequest, res: Response) => {
  const client = await pool.connect()
  try {
    const ctx = ctxOf(req)
    const course = await owned('courses', ctx, req.params.courseId)
    if (!course) return notFound(res, 'Course')

    const semesterId = req.body?.semesterId ? String(req.body.semesterId) : null
    if (semesterId && !(await owned('semesters', ctx, semesterId))) return notFound(res, 'Term')

    const scheme = await resolveScheme(ctx.tenantId, req.body?.schemeId)
    const bands = await schemeBands(ctx.tenantId, scheme.id)
    const computed = await computeCourseResults(ctx.tenantId, course.id, semesterId, bands)

    const incomplete = computed.filter((c) => Math.abs(c.weightDeclared - 100) > 0.01)
    if (incomplete.length > 0 && !req.body?.force) {
      return res.status(409).json({
        error: `This course's assessments total ${computed[0]?.weightDeclared ?? 0}% rather than 100%, so these are not final grades`,
        hint: 'Add the remaining assessments, or repeat with force: true to publish anyway',
      })
    }

    const ungraded = computed.filter((c) => c.letter === null)
    if (ungraded.length > 0 && !req.body?.force) {
      return res.status(409).json({
        error: `${ungraded.length} student(s) have no mark that the grading scheme can place`,
        hint: 'Enter the missing marks, or repeat with force: true to publish the rest',
      })
    }

    await client.query('BEGIN')
    let published = 0

    for (const c of computed) {
      // A result the scheme cannot place is not published; it would be a
      // blank grade presented as an outcome.
      if (c.letter === null) continue

      await client.query(
        `INSERT INTO course_results
           (tenant_id, student_id, course_id, semester_id, scheme_id, total_score,
            letter, grade_point, credits, is_pass, status, published_at, published_by, computed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'published',CURRENT_TIMESTAMP,$11,CURRENT_TIMESTAMP)
         ON CONFLICT (student_id, course_id, COALESCE(semester_id, '00000000-0000-0000-0000-000000000000'::uuid))
         DO UPDATE SET total_score = EXCLUDED.total_score,
                       letter = EXCLUDED.letter,
                       grade_point = EXCLUDED.grade_point,
                       credits = EXCLUDED.credits,
                       is_pass = EXCLUDED.is_pass,
                       scheme_id = EXCLUDED.scheme_id,
                       status = 'published',
                       published_at = CURRENT_TIMESTAMP,
                       published_by = EXCLUDED.published_by,
                       computed_at = CURRENT_TIMESTAMP`,
        [
          ctx.tenantId, c.studentId, course.id, semesterId, scheme.id,
          c.totalScore, c.letter, c.gradePoint, course.credits ?? null, c.isPass, ctx.userId,
        ]
      )
      published++
    }

    await client.query('COMMIT')

    if (published > 0) {
      await resultsPublished({ tenantId: ctx.tenantId, userId: ctx.userId }, course.id)
    }

    return res.json({
      message: `Published ${published} result(s)`,
      published,
      skipped: computed.length - published,
    })
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    return fail(res, 'publish results', e)
  } finally {
    client.release()
  }
})

router.post('/results/:id/withhold', registrar, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const updated = await query(
      `UPDATE course_results SET status = 'withheld', published_at = NULL
        WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      [req.params.id, ctx.tenantId]
    )
    if (updated.rows.length === 0) return notFound(res, 'Result')
    return res.json({ result: updated.rows[0] })
  } catch (e) {
    return fail(res, 'withhold result', e)
  }
})

// ===========================================================================
// Transcripts
// ===========================================================================

router.get('/students/:studentId/transcript', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const student = await owned('students', ctx, req.params.studentId)
    if (!student) return notFound(res, 'Student')

    // A student reads their own transcript; staff read any in the school.
    const isSelf = student.user_id === ctx.userId
    const isStaff = ['admin', 'faculty'].includes(ctx.roleName) || ctx.isSuperadmin
    if (!isSelf && !isStaff) {
      return res.status(403).json({ error: 'Insufficient permissions' })
    }

    const academicYearId = req.query.academicYearId ? String(req.query.academicYearId) : null

    const rows = await query(
      `SELECT * FROM student_transcript
        WHERE tenant_id = $1 AND student_id = $2
          AND ($3::uuid IS NULL OR academic_year_id = $3::uuid)
        ORDER BY academic_year NULLS LAST, semester_name NULLS LAST, course_code`,
      [ctx.tenantId, student.id, academicYearId]
    )

    const overall = await computeGpa(ctx.tenantId, student.id, null)
    const forYear = academicYearId
      ? await computeGpa(ctx.tenantId, student.id, academicYearId)
      : overall

    const programme = await query(
      `SELECT p.code, p.name, p.award, p.credits_required, sp.current_study_year, sp.status
         FROM student_programmes sp
         JOIN programmes p ON p.id = sp.programme_id
        WHERE sp.student_id = $1 AND sp.tenant_id = $2 AND sp.status = 'active'
        LIMIT 1`,
      [student.id, ctx.tenantId]
    )

    return res.json({
      student: {
        id: student.id,
        studentNumber: student.student_id,
        firstName: student.first_name,
        lastName: student.last_name,
      },
      programme: programme.rows[0] ?? null,
      entries: rows.rows,
      cgpa: overall.gpa,
      gpa: forYear.gpa,
      creditsEarned: overall.creditsEarned,
      creditsAttempted: overall.creditsAttempted,
      // Says whether the figures above are credit-weighted or a plain mean,
      // so a transcript does not imply a weighting the school has not set.
      creditWeighted: !overall.unweighted,
    })
  } catch (e) {
    return fail(res, 'load transcript', e)
  }
})

export default router
