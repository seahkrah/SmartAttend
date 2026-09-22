import { Router, Response } from 'express'
import { query } from '../db/connection.js'
import { authenticateToken } from '../auth/middleware.js'
import {
  resolveTenantContext,
  requireTenant,
  requirePlatform,
  requireRoles,
  type ResolvedTenantContext,
  type TenantRequest,
} from '../auth/tenantContextMiddleware.js'

/**
 * SMS — the academic structure a school is built on.
 *
 * Academic years, terms, programmes, the curriculum that says which courses a
 * programme requires, and which programme a student is reading. None of this
 * existed: the system could take a register but could not say what a student
 * was studying, what it added up to, or which year they were in.
 *
 * Reads are open to any member of the school, because a lecturer needs the
 * curriculum and a student needs their own programme. Writes are the
 * registrar's, so they are admin-only.
 */

const router = Router()

router.use(authenticateToken, resolveTenantContext, requireTenant, requirePlatform('school'))

type Ctx = ResolvedTenantContext & { tenantId: string }

function ctxOf(req: TenantRequest): Ctx {
  return req.ctx as Ctx
}

const writers = requireRoles('admin')

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function fail(res: Response, label: string, e: unknown) {
  const err = e as { code?: string; constraint?: string; message?: string }

  if (err.code === '23505') {
    return res.status(409).json({ error: 'That value is already in use at your school' })
  }
  if (err.code === '23503') {
    return res.status(409).json({
      error: 'This record is still referenced by other records and cannot be removed',
    })
  }
  if (err.code === '23514') {
    return res.status(400).json({
      error: 'The values supplied are outside what this record allows',
      constraint: err.constraint,
    })
  }
  console.error(`[ACADEMICS] ${label}:`, e)
  return res.status(500).json({ error: `Failed to ${label}` })
}

function notFound(res: Response, what: string) {
  return res.status(404).json({ error: `${what} not found` })
}

/**
 * A row by id within the caller's tenant.
 *
 * Returns null both for an id that does not exist and for one belonging to
 * another school, so the two cannot be told apart from outside.
 */
async function owned(table: string, ctx: Ctx, id: string): Promise<any | null> {
  if (!/^[a-z_]+$/.test(table)) throw new Error('unsafe table')
  if (!UUID.test(id ?? '')) return null
  const r = await query(`SELECT * FROM ${table} WHERE id = $1 AND tenant_id = $2`, [id, ctx.tenantId])
  return r.rows[0] ?? null
}

function toInt(v: unknown, fallback: number | null = null): number | null {
  if (v === undefined || v === null || v === '') return fallback
  const n = parseInt(String(v), 10)
  return Number.isInteger(n) ? n : fallback
}

// ===========================================================================
// Academic years
// ===========================================================================

router.get('/years', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const result = await query(
      `SELECT y.*,
              (SELECT COUNT(*)::int FROM semesters s WHERE s.academic_year_id = y.id) AS term_count
         FROM academic_years y
        WHERE y.tenant_id = $1
        ORDER BY y.start_date DESC`,
      [ctx.tenantId]
    )
    return res.json({ years: result.rows })
  } catch (e) {
    return fail(res, 'load academic years', e)
  }
})

router.post('/years', writers, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const { name, startDate, endDate, isCurrent } = req.body ?? {}

    if (!name || !startDate || !endDate) {
      return res.status(400).json({ error: 'name, startDate and endDate are required' })
    }
    if (String(endDate) <= String(startDate)) {
      return res.status(400).json({ error: 'The year must end after it starts' })
    }

    // Only one year is current, so promoting one stands the others down in
    // the same transaction rather than leaving two.
    if (isCurrent) {
      await query(`UPDATE academic_years SET is_current = FALSE WHERE tenant_id = $1`, [ctx.tenantId])
    }

    const created = await query(
      `INSERT INTO academic_years (tenant_id, name, start_date, end_date, is_current, status)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [ctx.tenantId, name, startDate, endDate, !!isCurrent, isCurrent ? 'active' : 'planned']
    )
    return res.status(201).json({ year: created.rows[0] })
  } catch (e) {
    return fail(res, 'create academic year', e)
  }
})

router.patch('/years/:id', writers, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const existing = await owned('academic_years', ctx, req.params.id)
    if (!existing) return notFound(res, 'Academic year')

    const { name, startDate, endDate, isCurrent, status } = req.body ?? {}
    const fields: string[] = []
    const values: any[] = []
    const set = (col: string, v: unknown) => {
      values.push(v)
      fields.push(`${col} = $${values.length}`)
    }

    if (name !== undefined) set('name', name)
    if (startDate !== undefined) set('start_date', startDate)
    if (endDate !== undefined) set('end_date', endDate)
    if (status !== undefined) set('status', status)
    if (isCurrent !== undefined) {
      if (isCurrent) {
        await query(
          `UPDATE academic_years SET is_current = FALSE WHERE tenant_id = $1 AND id <> $2`,
          [ctx.tenantId, existing.id]
        )
      }
      set('is_current', !!isCurrent)
    }

    if (fields.length === 0) return res.json({ year: existing })

    fields.push('updated_at = CURRENT_TIMESTAMP')
    values.push(existing.id, ctx.tenantId)
    const updated = await query(
      `UPDATE academic_years SET ${fields.join(', ')}
        WHERE id = $${values.length - 1} AND tenant_id = $${values.length}
        RETURNING *`,
      values
    )
    return res.json({ year: updated.rows[0] })
  } catch (e) {
    return fail(res, 'update academic year', e)
  }
})

router.delete('/years/:id', writers, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const deleted = await query(
      `DELETE FROM academic_years WHERE id = $1 AND tenant_id = $2 RETURNING id`,
      [req.params.id, ctx.tenantId]
    )
    if (deleted.rows.length === 0) return notFound(res, 'Academic year')
    return res.json({ message: 'Academic year deleted' })
  } catch (e) {
    return fail(res, 'delete academic year', e)
  }
})

// ===========================================================================
// Terms (semesters, grouped under a year)
// ===========================================================================

router.get('/terms', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const yearId = req.query.yearId ? String(req.query.yearId) : null

    const params: any[] = [ctx.tenantId]
    let where = 's.tenant_id = $1'
    if (yearId) {
      if (!UUID.test(yearId)) return res.json({ terms: [] })
      params.push(yearId)
      where += ` AND s.academic_year_id = $${params.length}`
    }

    const result = await query(
      `SELECT s.*, y.name AS academic_year, d.name AS department_name,
              (SELECT COUNT(*)::int FROM courses c WHERE c.semester_id = s.id) AS course_count
         FROM semesters s
         LEFT JOIN academic_years y ON y.id = s.academic_year_id
         LEFT JOIN school_departments d ON d.id = s.department_id
        WHERE ${where}
        ORDER BY s.start_date DESC, s.sequence NULLS LAST`,
      params
    )
    return res.json({ terms: result.rows })
  } catch (e) {
    return fail(res, 'load terms', e)
  }
})

router.post('/terms', writers, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const { name, departmentId, academicYearId, startDate, endDate, sequence, isActive } =
      req.body ?? {}

    if (!name || !departmentId || !startDate || !endDate) {
      return res
        .status(400)
        .json({ error: 'name, departmentId, startDate and endDate are required' })
    }

    // Each referenced id is its own chance to cross a tenant boundary.
    if (!(await owned('school_departments', ctx, String(departmentId)))) {
      return notFound(res, 'Department')
    }
    if (academicYearId && !(await owned('academic_years', ctx, String(academicYearId)))) {
      return notFound(res, 'Academic year')
    }

    const created = await query(
      `INSERT INTO semesters
         (tenant_id, department_id, academic_year_id, name, start_date, end_date, sequence, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        ctx.tenantId, departmentId, academicYearId || null, name,
        startDate, endDate, toInt(sequence), !!isActive,
      ]
    )
    return res.status(201).json({ term: created.rows[0] })
  } catch (e) {
    return fail(res, 'create term', e)
  }
})

router.patch('/terms/:id', writers, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const existing = await owned('semesters', ctx, req.params.id)
    if (!existing) return notFound(res, 'Term')

    const { name, academicYearId, startDate, endDate, sequence, isActive } = req.body ?? {}
    const fields: string[] = []
    const values: any[] = []
    const set = (col: string, v: unknown) => {
      values.push(v)
      fields.push(`${col} = $${values.length}`)
    }

    if (academicYearId !== undefined) {
      if (academicYearId && !(await owned('academic_years', ctx, String(academicYearId)))) {
        return notFound(res, 'Academic year')
      }
      set('academic_year_id', academicYearId || null)
    }
    if (name !== undefined) set('name', name)
    if (startDate !== undefined) set('start_date', startDate)
    if (endDate !== undefined) set('end_date', endDate)
    if (sequence !== undefined) set('sequence', toInt(sequence))
    if (isActive !== undefined) set('is_active', !!isActive)

    if (fields.length === 0) return res.json({ term: existing })

    values.push(existing.id, ctx.tenantId)
    const updated = await query(
      `UPDATE semesters SET ${fields.join(', ')}
        WHERE id = $${values.length - 1} AND tenant_id = $${values.length}
        RETURNING *`,
      values
    )
    return res.json({ term: updated.rows[0] })
  } catch (e) {
    return fail(res, 'update term', e)
  }
})

// ===========================================================================
// Programmes
// ===========================================================================

router.get('/programmes', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const result = await query(
      `SELECT p.*, d.name AS department_name,
              (SELECT COUNT(*)::int FROM programme_courses pc WHERE pc.programme_id = p.id) AS course_count,
              (SELECT COUNT(*)::int FROM student_programmes sp
                WHERE sp.programme_id = p.id AND sp.status = 'active') AS student_count
         FROM programmes p
         LEFT JOIN school_departments d ON d.id = p.department_id
        WHERE p.tenant_id = $1
        ORDER BY p.name`,
      [ctx.tenantId]
    )
    return res.json({ programmes: result.rows })
  } catch (e) {
    return fail(res, 'load programmes', e)
  }
})

router.get('/programmes/:id', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const programme = await owned('programmes', ctx, req.params.id)
    if (!programme) return notFound(res, 'Programme')

    const curriculum = await query(
      `SELECT pc.*, c.code AS course_code, c.name AS course_name, c.credits AS course_credits
         FROM programme_courses pc
         JOIN courses c ON c.id = pc.course_id
        WHERE pc.programme_id = $1 AND pc.tenant_id = $2
        ORDER BY pc.study_year, pc.term_sequence NULLS LAST, c.code`,
      [programme.id, ctx.tenantId]
    )

    return res.json({ programme, curriculum: curriculum.rows })
  } catch (e) {
    return fail(res, 'load programme', e)
  }
})

router.post('/programmes', writers, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const { code, name, departmentId, description, award, level, durationYears, creditsRequired } =
      req.body ?? {}

    if (!code || !name) return res.status(400).json({ error: 'code and name are required' })
    if (departmentId && !(await owned('school_departments', ctx, String(departmentId)))) {
      return notFound(res, 'Department')
    }

    const created = await query(
      `INSERT INTO programmes
         (tenant_id, department_id, code, name, description, award, level, duration_years, credits_required)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        ctx.tenantId, departmentId || null, code, name, description || null,
        award || null, level || null,
        durationYears !== undefined ? Number(durationYears) : 4,
        toInt(creditsRequired),
      ]
    )
    return res.status(201).json({ programme: created.rows[0] })
  } catch (e) {
    return fail(res, 'create programme', e)
  }
})

router.patch('/programmes/:id', writers, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const existing = await owned('programmes', ctx, req.params.id)
    if (!existing) return notFound(res, 'Programme')

    const b = req.body ?? {}
    const fields: string[] = []
    const values: any[] = []
    const set = (col: string, v: unknown) => {
      values.push(v)
      fields.push(`${col} = $${values.length}`)
    }

    if (b.departmentId !== undefined) {
      if (b.departmentId && !(await owned('school_departments', ctx, String(b.departmentId)))) {
        return notFound(res, 'Department')
      }
      set('department_id', b.departmentId || null)
    }
    if (b.code !== undefined) set('code', b.code)
    if (b.name !== undefined) set('name', b.name)
    if (b.description !== undefined) set('description', b.description || null)
    if (b.award !== undefined) set('award', b.award || null)
    if (b.level !== undefined) set('level', b.level || null)
    if (b.durationYears !== undefined) set('duration_years', Number(b.durationYears))
    if (b.creditsRequired !== undefined) set('credits_required', toInt(b.creditsRequired))
    if (b.isActive !== undefined) set('is_active', !!b.isActive)

    if (fields.length === 0) return res.json({ programme: existing })

    fields.push('updated_at = CURRENT_TIMESTAMP')
    values.push(existing.id, ctx.tenantId)
    const updated = await query(
      `UPDATE programmes SET ${fields.join(', ')}
        WHERE id = $${values.length - 1} AND tenant_id = $${values.length}
        RETURNING *`,
      values
    )
    return res.json({ programme: updated.rows[0] })
  } catch (e) {
    return fail(res, 'update programme', e)
  }
})

router.delete('/programmes/:id', writers, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const enrolled = await query(
      `SELECT COUNT(*)::int AS n FROM student_programmes
        WHERE programme_id = $1 AND tenant_id = $2 AND status = 'active'`,
      [req.params.id, ctx.tenantId]
    )
    if (enrolled.rows[0].n > 0) {
      return res.status(409).json({
        error: `${enrolled.rows[0].n} student(s) are reading this programme. Move them before deleting it.`,
      })
    }

    const deleted = await query(
      `DELETE FROM programmes WHERE id = $1 AND tenant_id = $2 RETURNING id`,
      [req.params.id, ctx.tenantId]
    )
    if (deleted.rows.length === 0) return notFound(res, 'Programme')
    return res.json({ message: 'Programme deleted' })
  } catch (e) {
    return fail(res, 'delete programme', e)
  }
})

// ===========================================================================
// Curriculum
// ===========================================================================

router.post('/programmes/:id/courses', writers, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const programme = await owned('programmes', ctx, req.params.id)
    if (!programme) return notFound(res, 'Programme')

    const { courseId, studyYear, termSequence, requirement, credits } = req.body ?? {}
    if (!courseId || studyYear === undefined) {
      return res.status(400).json({ error: 'courseId and studyYear are required' })
    }
    if (!(await owned('courses', ctx, String(courseId)))) return notFound(res, 'Course')

    const year = toInt(studyYear)
    if (year === null || year < 1) {
      return res.status(400).json({ error: 'studyYear must be a positive whole number' })
    }
    // A course cannot sit in a year the programme does not run to.
    if (year > Math.ceil(Number(programme.duration_years))) {
      return res.status(400).json({
        error: `This programme runs for ${programme.duration_years} year(s), so study year ${year} is out of range`,
      })
    }

    const created = await query(
      `INSERT INTO programme_courses
         (tenant_id, programme_id, course_id, study_year, term_sequence, requirement, credits)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        ctx.tenantId, programme.id, courseId, year, toInt(termSequence),
        requirement || 'core', toInt(credits),
      ]
    )
    return res.status(201).json({ entry: created.rows[0] })
  } catch (e) {
    return fail(res, 'add course to programme', e)
  }
})

router.delete('/programmes/:id/courses/:entryId', writers, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const deleted = await query(
      `DELETE FROM programme_courses
        WHERE id = $1 AND programme_id = $2 AND tenant_id = $3 RETURNING id`,
      [req.params.entryId, req.params.id, ctx.tenantId]
    )
    if (deleted.rows.length === 0) return notFound(res, 'Curriculum entry')
    return res.json({ message: 'Course removed from programme' })
  } catch (e) {
    return fail(res, 'remove course from programme', e)
  }
})

// ===========================================================================
// Student programme enrolment
// ===========================================================================

router.get('/students/:studentId/programme', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const student = await owned('students', ctx, req.params.studentId)
    if (!student) return notFound(res, 'Student')

    // A student may read their own record; staff may read any in the school.
    const isSelf = student.user_id === ctx.userId
    const isStaff = ['admin', 'faculty'].includes(ctx.roleName) || ctx.isSuperadmin
    if (!isSelf && !isStaff) {
      return res.status(403).json({ error: 'Insufficient permissions' })
    }

    const result = await query(
      `SELECT sp.*, p.code AS programme_code, p.name AS programme_name,
              p.award, p.credits_required, y.name AS academic_year
         FROM student_programmes sp
         JOIN programmes p ON p.id = sp.programme_id
         LEFT JOIN academic_years y ON y.id = sp.academic_year_id
        WHERE sp.student_id = $1 AND sp.tenant_id = $2
        ORDER BY sp.started_at DESC`,
      [student.id, ctx.tenantId]
    )
    return res.json({ enrolments: result.rows })
  } catch (e) {
    return fail(res, 'load student programme', e)
  }
})

router.post('/students/:studentId/programme', writers, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const student = await owned('students', ctx, req.params.studentId)
    if (!student) return notFound(res, 'Student')

    const { programmeId, academicYearId, entryYear, currentStudyYear } = req.body ?? {}
    if (!programmeId) return res.status(400).json({ error: 'programmeId is required' })
    if (!(await owned('programmes', ctx, String(programmeId)))) return notFound(res, 'Programme')
    if (academicYearId && !(await owned('academic_years', ctx, String(academicYearId)))) {
      return notFound(res, 'Academic year')
    }

    const active = await query(
      `SELECT id FROM student_programmes
        WHERE student_id = $1 AND tenant_id = $2 AND status = 'active'`,
      [student.id, ctx.tenantId]
    )
    if (active.rows.length > 0) {
      return res.status(409).json({
        error: 'This student is already reading a programme. Withdraw or complete it first.',
      })
    }

    const created = await query(
      `INSERT INTO student_programmes
         (tenant_id, student_id, programme_id, academic_year_id, entry_year, current_study_year)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [
        ctx.tenantId, student.id, programmeId, academicYearId || null,
        toInt(entryYear, new Date().getFullYear()),
        toInt(currentStudyYear, 1),
      ]
    )
    return res.status(201).json({ enrolment: created.rows[0] })
  } catch (e) {
    return fail(res, 'enrol student on programme', e)
  }
})

router.patch('/student-programmes/:id', writers, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const existing = await owned('student_programmes', ctx, req.params.id)
    if (!existing) return notFound(res, 'Enrolment')

    const { status, currentStudyYear, completedAt } = req.body ?? {}
    const fields: string[] = []
    const values: any[] = []
    const set = (col: string, v: unknown) => {
      values.push(v)
      fields.push(`${col} = $${values.length}`)
    }

    if (status !== undefined) {
      set('status', status)
      // Graduating or withdrawing closes the record, so it carries a date.
      if (['graduated', 'withdrawn', 'dismissed'].includes(String(status)) && !completedAt) {
        set('completed_at', new Date().toISOString().slice(0, 10))
      }
    }
    if (currentStudyYear !== undefined) set('current_study_year', toInt(currentStudyYear, 1))
    if (completedAt !== undefined) set('completed_at', completedAt || null)

    if (fields.length === 0) return res.json({ enrolment: existing })

    fields.push('updated_at = CURRENT_TIMESTAMP')
    values.push(existing.id, ctx.tenantId)
    const updated = await query(
      `UPDATE student_programmes SET ${fields.join(', ')}
        WHERE id = $${values.length - 1} AND tenant_id = $${values.length}
        RETURNING *`,
      values
    )
    return res.json({ enrolment: updated.rows[0] })
  } catch (e) {
    return fail(res, 'update enrolment', e)
  }
})

export default router
