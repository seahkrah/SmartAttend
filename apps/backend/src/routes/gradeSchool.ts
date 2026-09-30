import { Router, Response } from 'express'
import { query, getConnection } from '../db/connection.js'
import { authenticateToken } from '../auth/middleware.js'
import {
  resolveTenantContext,
  requireTenant,
  requirePlatform,
  requireRoles,
  type ResolvedTenantContext,
  type TenantRequest,
} from '../auth/tenantContextMiddleware.js'
import { requireSchoolFeature } from '../services/schoolTypes.js'
import { logAudit } from '../services/domainAuditService.js'
import { getClientIp } from '../utils/getClientIp.js'

/**
 * A grade school's classes and subjects.
 *
 * A grade (from migration 067) is divided into classes for each academic
 * year: Grade 4A and Grade 4B, each with a class teacher. A student sits in
 * one class a year. Subjects are what the school teaches and which grades
 * take them.
 *
 * Only a grade school has these (requireSchoolFeature('classes')). Reads are
 * open to administrators and teachers, because a teacher needs the class
 * lists; writes are the administrator's.
 */

const router = Router()

router.use(
  authenticateToken, resolveTenantContext, requireTenant, requirePlatform('school'),
  requireRoles('admin', 'faculty'), requireSchoolFeature('classes'),
)

type Ctx = ResolvedTenantContext & { tenantId: string }
const ctxOf = (req: TenantRequest) => req.ctx as Ctx
const admin = requireRoles('admin')
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function fail(res: Response, label: string, e: unknown) {
  const err = e as { code?: string; constraint?: string }
  if (err.code === '23505') {
    return res.status(409).json({ error: 'That name or code is already in use at your school' })
  }
  if (err.code === '23503') {
    return res.status(409).json({ error: 'This is still in use and cannot be removed' })
  }
  if (err.code === '23514') {
    return res.status(400).json({ error: 'A value is outside what is allowed', constraint: err.constraint })
  }
  console.error(`[GRADE_SCHOOL] ${label}:`, e)
  return res.status(500).json({ error: `Failed to ${label}` })
}

const notFound = (res: Response, what: string) => res.status(404).json({ error: `${what} not found` })

/** A row by id in the caller's school; null for another school's, so the two look the same. */
async function owned(table: string, ctx: Ctx, id: unknown): Promise<any | null> {
  if (!/^[a-z_]+$/.test(table)) throw new Error('unsafe table')
  if (typeof id !== 'string' || !UUID.test(id)) return null
  const r = await query(`SELECT * FROM ${table} WHERE id = $1 AND tenant_id = $2`, [id, ctx.tenantId])
  return r.rows[0] ?? null
}

function audit(req: TenantRequest, actionType: string, resourceType: string, resourceId: string,
               beforeState?: unknown, afterState?: unknown) {
  const ctx = ctxOf(req)
  logAudit({
    actorId: ctx.userId, actorRole: ctx.roleName, actionType, actionScope: 'TENANT',
    resourceType, resourceId, tenantId: ctx.tenantId, beforeState, afterState,
    ipAddress: getClientIp(req),
  } as any).catch((e) => console.error('[GRADE_SCHOOL] audit failed:', e))
}

/** The year asked for, or the school's current one. Null if neither exists. */
async function yearOf(ctx: Ctx, asked: unknown): Promise<any | null> {
  if (asked) return owned('academic_years', ctx, asked)
  const r = await query(
    `SELECT * FROM academic_years WHERE tenant_id = $1 AND is_current LIMIT 1`, [ctx.tenantId])
  return r.rows[0] ?? null
}

function capacityOf(v: unknown): number | null | 'bad' {
  if (v === undefined || v === null || v === '') return null
  const n = Number(v)
  return Number.isInteger(n) && n > 0 ? n : 'bad'
}

// ===========================================================================
// Teachers, for choosing a class teacher
// ===========================================================================

router.get('/teachers', async (req: TenantRequest, res: Response) => {
  try {
    const r = await query(
      `SELECT f.id, f.employee_id, f.first_name, f.last_name, f.title
         FROM faculty f
        WHERE f.tenant_id = $1
        ORDER BY f.last_name, f.first_name`,
      [ctxOf(req).tenantId])
    return res.json({ teachers: r.rows })
  } catch (e) {
    return fail(res, 'load teachers', e)
  }
})

// ===========================================================================
// Classes
// ===========================================================================

const CLASS_COLUMNS = `
  c.id, c.name, c.capacity, c.academic_year_id, c.grade_level_id, c.class_teacher_id,
  g.code AS grade_code, g.name AS grade_name, g.stage, g.sort_order,
  g.name || c.name AS display_name,
  NULLIF(TRIM(COALESCE(f.title || ' ', '') || COALESCE(f.first_name, '') || ' ' || COALESCE(f.last_name, '')), '')
    AS class_teacher_name,
  (SELECT COUNT(*)::int FROM class_placements p WHERE p.class_id = c.id) AS student_count`

const CLASS_FROM = `
  FROM school_classes c
  JOIN grade_levels g ON g.id = c.grade_level_id
  LEFT JOIN faculty f ON f.id = c.class_teacher_id`

/**
 * A school year's classes, grade by grade. ?yearId= defaults to the current
 * year; ?mine=1 keeps only the classes the caller is class teacher of.
 */
router.get('/classes', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const year = await yearOf(ctx, req.query.yearId)
    if (!year) {
      return req.query.yearId
        ? notFound(res, 'Academic year')
        : res.json({ year: null, classes: [] })
    }
    const mine = req.query.mine === '1'
    const r = await query(
      `SELECT ${CLASS_COLUMNS} ${CLASS_FROM}
        WHERE c.tenant_id = $1 AND c.academic_year_id = $2
          AND ($3::uuid IS NULL OR f.user_id = $3::uuid)
        ORDER BY g.sort_order, LOWER(c.name)`,
      [ctx.tenantId, year.id, mine ? ctx.userId : null])
    return res.json({ year, classes: r.rows })
  } catch (e) {
    return fail(res, 'load classes', e)
  }
})

router.post('/classes', admin, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const b = req.body ?? {}
    const name = typeof b.name === 'string' ? b.name.trim() : ''
    if (!name) return res.status(400).json({ error: 'A class needs a name, such as A or Blue' })
    const capacity = capacityOf(b.capacity)
    if (capacity === 'bad') return res.status(400).json({ error: 'Capacity must be a whole number above zero' })

    const year = await owned('academic_years', ctx, b.academicYearId)
    if (!year) return notFound(res, 'Academic year')
    const grade = await owned('grade_levels', ctx, b.gradeLevelId)
    if (!grade) return notFound(res, 'Grade')
    if (b.classTeacherId && !(await owned('faculty', ctx, b.classTeacherId))) return notFound(res, 'Teacher')

    const r = await query(
      `INSERT INTO school_classes (tenant_id, academic_year_id, grade_level_id, name, class_teacher_id, capacity)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [ctx.tenantId, year.id, grade.id, name, b.classTeacherId || null, capacity])
    const created = await query(`SELECT ${CLASS_COLUMNS} ${CLASS_FROM} WHERE c.id = $1`, [r.rows[0].id])
    audit(req, 'CLASS_CREATED', 'school_class', r.rows[0].id, undefined, created.rows[0])
    return res.status(201).json({ class: created.rows[0] })
  } catch (e) {
    return fail(res, 'create the class', e)
  }
})

router.patch('/classes/:id', admin, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const before = await owned('school_classes', ctx, req.params.id)
    if (!before) return notFound(res, 'Class')
    const b = req.body ?? {}

    const name = b.name === undefined ? before.name : String(b.name).trim()
    if (!name) return res.status(400).json({ error: 'A class needs a name' })
    const capacity = b.capacity === undefined ? before.capacity : capacityOf(b.capacity)
    if (capacity === 'bad') return res.status(400).json({ error: 'Capacity must be a whole number above zero' })
    let teacher = before.class_teacher_id
    if (b.classTeacherId !== undefined) {
      teacher = b.classTeacherId || null
      if (teacher && !(await owned('faculty', ctx, teacher))) return notFound(res, 'Teacher')
    }
    if (capacity !== null) {
      const n = await query(`SELECT COUNT(*)::int AS n FROM class_placements WHERE class_id = $1`, [before.id])
      if (n.rows[0].n > capacity) {
        return res.status(409).json({ error: `The class already has ${n.rows[0].n} students, more than ${capacity}` })
      }
    }

    await query(
      `UPDATE school_classes SET name = $3, class_teacher_id = $4, capacity = $5, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND tenant_id = $2`,
      [before.id, ctx.tenantId, name, teacher, capacity])
    const after = await query(`SELECT ${CLASS_COLUMNS} ${CLASS_FROM} WHERE c.id = $1`, [before.id])
    audit(req, 'CLASS_UPDATED', 'school_class', before.id, before, after.rows[0])
    return res.json({ class: after.rows[0] })
  } catch (e) {
    return fail(res, 'update the class', e)
  }
})

router.delete('/classes/:id', admin, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const before = await owned('school_classes', ctx, req.params.id)
    if (!before) return notFound(res, 'Class')
    const n = await query(`SELECT COUNT(*)::int AS n FROM class_placements WHERE class_id = $1`, [before.id])
    if (n.rows[0].n > 0) {
      return res.status(409).json({ error: `Move its ${n.rows[0].n} student(s) to another class first` })
    }
    await query(`DELETE FROM school_classes WHERE id = $1 AND tenant_id = $2`, [before.id, ctx.tenantId])
    audit(req, 'CLASS_DELETED', 'school_class', before.id, before)
    return res.json({ deleted: true })
  } catch (e) {
    return fail(res, 'remove the class', e)
  }
})

// ---------------------------------------------------------------------------
// Who is in a class
// ---------------------------------------------------------------------------

router.get('/classes/:id/students', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const cls = await owned('school_classes', ctx, req.params.id)
    if (!cls) return notFound(res, 'Class')
    const r = await query(
      `SELECT s.id, s.student_id, s.first_name, s.middle_name, s.last_name, s.gender, s.status, p.placed_at
         FROM class_placements p
         JOIN students s ON s.id = p.student_id
        WHERE p.class_id = $1 AND p.tenant_id = $2
        ORDER BY s.last_name, s.first_name`,
      [cls.id, ctx.tenantId])
    return res.json({ students: r.rows })
  } catch (e) {
    return fail(res, 'load the class list', e)
  }
})

/**
 * Put students in a class. A student already in another class that year is
 * moved, not given a second class: the placement row is changed.
 */
router.post('/classes/:id/students', admin, async (req: TenantRequest, res: Response) => {
  const client = await getConnection()
  try {
    const ctx = ctxOf(req)
    const cls = await owned('school_classes', ctx, req.params.id)
    if (!cls) return notFound(res, 'Class')
    const ids: unknown[] = Array.isArray(req.body?.studentIds) ? req.body.studentIds : []
    if (ids.length === 0 || ids.some((i) => typeof i !== 'string' || !UUID.test(i))) {
      return res.status(400).json({ error: 'studentIds must be a list of students' })
    }
    const unique = [...new Set(ids as string[])]
    const found = await query(
      `SELECT id FROM students WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [ctx.tenantId, unique])
    if (found.rowCount !== unique.length) return notFound(res, 'Student')

    await client.query('BEGIN')
    await client.query(`SELECT id FROM school_classes WHERE id = $1 FOR UPDATE`, [cls.id])
    if (cls.capacity) {
      // Everyone already here, plus everyone arriving (new, or from another class).
      const arriving = await client.query(
        `SELECT COUNT(*)::int AS n FROM unnest($2::uuid[]) AS s(id)
          WHERE NOT EXISTS (SELECT 1 FROM class_placements p WHERE p.class_id = $1 AND p.student_id = s.id)`,
        [cls.id, unique])
      const present = await client.query(`SELECT COUNT(*)::int AS n FROM class_placements WHERE class_id = $1`, [cls.id])
      if (present.rows[0].n + arriving.rows[0].n > cls.capacity) {
        await client.query('ROLLBACK')
        return res.status(409).json({
          error: `The class holds ${cls.capacity}; it has ${present.rows[0].n} and ${arriving.rows[0].n} would join`,
        })
      }
    }
    const moved = await client.query(
      `INSERT INTO class_placements (tenant_id, student_id, class_id, academic_year_id, placed_by)
       SELECT $1, s.id, $2, $3, $4 FROM unnest($5::uuid[]) AS s(id)
       ON CONFLICT (student_id, academic_year_id)
         DO UPDATE SET class_id = EXCLUDED.class_id, placed_at = CURRENT_TIMESTAMP, placed_by = EXCLUDED.placed_by
       RETURNING student_id`,
      [ctx.tenantId, cls.id, cls.academic_year_id, ctx.userId, unique])
    await client.query('COMMIT')
    audit(req, 'CLASS_STUDENTS_PLACED', 'school_class', cls.id, undefined, { studentIds: unique })
    return res.json({ placed: moved.rowCount })
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined)
    return fail(res, 'place the students', e)
  } finally {
    client.release()
  }
})

router.delete('/classes/:id/students/:studentId', admin, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const cls = await owned('school_classes', ctx, req.params.id)
    if (!cls) return notFound(res, 'Class')
    if (!UUID.test(req.params.studentId)) return notFound(res, 'Student')
    const r = await query(
      `DELETE FROM class_placements WHERE class_id = $1 AND student_id = $2 AND tenant_id = $3`,
      [cls.id, req.params.studentId, ctx.tenantId])
    if (r.rowCount === 0) return notFound(res, 'Student in this class')
    audit(req, 'CLASS_STUDENT_REMOVED', 'school_class', cls.id, { studentId: req.params.studentId })
    return res.json({ removed: true })
  } catch (e) {
    return fail(res, 'remove the student from the class', e)
  }
})

/** Students not in any class for a year (default: the current one). For pickers. */
router.get('/unplaced-students', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const year = await yearOf(ctx, req.query.yearId)
    if (!year) return res.json({ students: [] })
    const r = await query(
      `SELECT s.id, s.student_id, s.first_name, s.middle_name, s.last_name
         FROM students s
        WHERE s.tenant_id = $1 AND COALESCE(s.status, '') <> 'withdrawn'
          AND NOT EXISTS (SELECT 1 FROM class_placements p
                           WHERE p.student_id = s.id AND p.academic_year_id = $2)
        ORDER BY s.last_name, s.first_name
        LIMIT 500`,
      [ctx.tenantId, year.id])
    return res.json({ students: r.rows })
  } catch (e) {
    return fail(res, 'load unplaced students', e)
  }
})

// ===========================================================================
// Subjects
// ===========================================================================

router.get('/subjects', async (req: TenantRequest, res: Response) => {
  try {
    const r = await query(
      `SELECT sub.id, sub.code, sub.name, sub.is_active,
              COALESCE(ARRAY_AGG(gs.grade_level_id ORDER BY g.sort_order)
                       FILTER (WHERE gs.grade_level_id IS NOT NULL), '{}') AS grade_level_ids
         FROM subjects sub
         LEFT JOIN grade_subjects gs ON gs.subject_id = sub.id
         LEFT JOIN grade_levels g ON g.id = gs.grade_level_id
        WHERE sub.tenant_id = $1
        GROUP BY sub.id
        ORDER BY sub.name`,
      [ctxOf(req).tenantId])
    return res.json({ subjects: r.rows })
  } catch (e) {
    return fail(res, 'load subjects', e)
  }
})

router.post('/subjects', admin, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const code = String(req.body?.code ?? '').trim().toUpperCase()
    const name = String(req.body?.name ?? '').trim()
    if (!code || !name) return res.status(400).json({ error: 'A subject needs a code and a name' })
    const r = await query(
      `INSERT INTO subjects (tenant_id, code, name) VALUES ($1, $2, $3) RETURNING *`,
      [ctx.tenantId, code.slice(0, 20), name.slice(0, 100)])
    audit(req, 'SUBJECT_CREATED', 'subject', r.rows[0].id, undefined, r.rows[0])
    return res.status(201).json({ subject: { ...r.rows[0], grade_level_ids: [] } })
  } catch (e) {
    return fail(res, 'create the subject', e)
  }
})

router.patch('/subjects/:id', admin, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const before = await owned('subjects', ctx, req.params.id)
    if (!before) return notFound(res, 'Subject')
    const b = req.body ?? {}
    const code = b.code === undefined ? before.code : String(b.code).trim().toUpperCase().slice(0, 20)
    const name = b.name === undefined ? before.name : String(b.name).trim().slice(0, 100)
    if (!code || !name) return res.status(400).json({ error: 'A subject needs a code and a name' })
    const active = b.isActive === undefined ? before.is_active : Boolean(b.isActive)
    const r = await query(
      `UPDATE subjects SET code = $3, name = $4, is_active = $5, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      [before.id, ctx.tenantId, code, name, active])
    audit(req, 'SUBJECT_UPDATED', 'subject', before.id, before, r.rows[0])
    return res.json({ subject: r.rows[0] })
  } catch (e) {
    return fail(res, 'update the subject', e)
  }
})

router.delete('/subjects/:id', admin, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const before = await owned('subjects', ctx, req.params.id)
    if (!before) return notFound(res, 'Subject')
    const used = await query(`SELECT COUNT(*)::int AS n FROM grade_subjects WHERE subject_id = $1`, [before.id])
    if (used.rows[0].n > 0) {
      return res.status(409).json({ error: `Taken by ${used.rows[0].n} grade(s); remove it from them first, or mark it inactive` })
    }
    await query(`DELETE FROM subjects WHERE id = $1 AND tenant_id = $2`, [before.id, ctx.tenantId])
    audit(req, 'SUBJECT_DELETED', 'subject', before.id, before)
    return res.json({ deleted: true })
  } catch (e) {
    return fail(res, 'remove the subject', e)
  }
})

/** Set which grades take a subject: the list given replaces the one there. */
router.put('/subjects/:id/grades', admin, async (req: TenantRequest, res: Response) => {
  const client = await getConnection()
  try {
    const ctx = ctxOf(req)
    const subject = await owned('subjects', ctx, req.params.id)
    if (!subject) return notFound(res, 'Subject')
    const ids: unknown[] = Array.isArray(req.body?.gradeLevelIds) ? req.body.gradeLevelIds : []
    if (ids.some((i) => typeof i !== 'string' || !UUID.test(i))) {
      return res.status(400).json({ error: 'gradeLevelIds must be a list of grades' })
    }
    const unique = [...new Set(ids as string[])]
    const found = await query(
      `SELECT id FROM grade_levels WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [ctx.tenantId, unique])
    if (found.rowCount !== unique.length) return notFound(res, 'Grade')

    await client.query('BEGIN')
    const before = await client.query(`SELECT grade_level_id FROM grade_subjects WHERE subject_id = $1`, [subject.id])
    await client.query(
      `DELETE FROM grade_subjects WHERE subject_id = $1 AND NOT (grade_level_id = ANY($2::uuid[]))`,
      [subject.id, unique])
    await client.query(
      `INSERT INTO grade_subjects (tenant_id, grade_level_id, subject_id)
       SELECT $1, g, $2 FROM unnest($3::uuid[]) AS g
       ON CONFLICT (grade_level_id, subject_id) DO NOTHING`,
      [ctx.tenantId, subject.id, unique])
    await client.query('COMMIT')
    audit(req, 'SUBJECT_GRADES_SET', 'subject', subject.id,
      { gradeLevelIds: before.rows.map((r: any) => r.grade_level_id) }, { gradeLevelIds: unique })
    return res.json({ gradeLevelIds: unique })
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined)
    return fail(res, 'set the grades that take this subject', e)
  } finally {
    client.release()
  }
})

export default router
