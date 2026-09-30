import type { Response, NextFunction } from 'express'
import type { PoolClient } from 'pg'
import { query } from '../db/connection.js'
import type { TenantRequest } from '../auth/tenantContextMiddleware.js'

/**
 * School types: what kind of school a tenant is, which stages of it the
 * school offers, and which tools follow from that.
 *
 * This is the one place the answer lives. The API enforces it, the
 * superadmin picks from it when creating a school, and the web app reads it
 * (GET /api/academics/structure) to show a school only the tools that
 * describe it: a grade school sees grades and subjects, never programmes and
 * credits.
 *
 * Migration 067 holds the type on `tenants.school_type` and the stages on
 * `tenants.school_stages`; the grades a grade school's stages generate are
 * rows in `grade_levels`.
 */

export const SCHOOL_TYPES = ['grade_school', 'vocational', 'college', 'university'] as const
export type SchoolType = (typeof SCHOOL_TYPES)[number]

/** Switches for the tools a type uses. The web app hides what is off. */
export interface SchoolFeatures {
  /** Grades generated from the stages offered (Nursery, K-1, Grade 1 ...). */
  gradeLevels: boolean
  departments: boolean
  /** Programmes of study with a curriculum and years of study. */
  programmes: boolean
  /** Credit-weighted results and a CGPA on the transcript. */
  credits: boolean
}

/** Words a type uses for the same things. */
export interface SchoolLabels {
  teachers: string
  teacher: string
  subjects: string
  programmes: string
}

export interface Grade {
  code: string
  name: string
}

export interface Stage {
  key: string
  label: string
  /** Only for a grade school: the grades this stage adds. */
  grades?: Grade[]
}

export interface SchoolTypeDef {
  key: SchoolType
  label: string
  description: string
  stages: Stage[]
  features: SchoolFeatures
  labels: SchoolLabels
}

function grades(from: number, to: number): Grade[] {
  const out: Grade[] = []
  for (let n = from; n <= to; n++) out.push({ code: `G${n}`, name: `Grade ${n}` })
  return out
}

export const SCHOOL_TYPE_CATALOGUE: Record<SchoolType, SchoolTypeDef> = {
  grade_school: {
    key: 'grade_school',
    label: 'Grade school',
    description: 'Nursery to 12th grade: grades, classes and subjects.',
    stages: [
      {
        key: 'early_childhood',
        label: 'Nursery / Kindergarten',
        grades: [
          { code: 'N', name: 'Nursery' },
          { code: 'K1', name: 'K-1' },
          { code: 'K2', name: 'K-2' },
        ],
      },
      { key: 'elementary', label: 'Elementary', grades: grades(1, 6) },
      { key: 'junior_high', label: 'Junior high', grades: grades(7, 9) },
      { key: 'senior_high', label: 'Senior high', grades: grades(10, 12) },
    ],
    features: { gradeLevels: true, departments: false, programmes: false, credits: false },
    labels: { teachers: 'Teachers', teacher: 'Teacher', subjects: 'Subjects', programmes: 'Programmes' },
  },
  vocational: {
    key: 'vocational',
    label: 'Vocational / technical',
    description: 'Trades taught in modules, at certificate or diploma level.',
    stages: [
      { key: 'certificate', label: 'Certificate' },
      { key: 'diploma', label: 'Diploma' },
    ],
    features: { gradeLevels: false, departments: true, programmes: true, credits: false },
    labels: { teachers: 'Instructors', teacher: 'Instructor', subjects: 'Modules', programmes: 'Trades' },
  },
  college: {
    key: 'college',
    label: 'College',
    description: 'Departments and programmes, from certificate to bachelor.',
    stages: [
      { key: 'certificate', label: 'Certificate' },
      { key: 'diploma', label: 'Diploma' },
      { key: 'associate', label: 'Associate degree' },
      { key: 'bachelor', label: 'Bachelor degree' },
    ],
    features: { gradeLevels: false, departments: true, programmes: true, credits: true },
    labels: { teachers: 'Lecturers', teacher: 'Lecturer', subjects: 'Courses', programmes: 'Programmes' },
  },
  university: {
    key: 'university',
    label: 'University',
    description: 'Colleges, departments and programmes, undergraduate and postgraduate.',
    stages: [
      { key: 'undergraduate', label: 'Undergraduate' },
      { key: 'masters', label: 'Masters' },
      { key: 'doctorate', label: 'Doctorate' },
    ],
    features: { gradeLevels: false, departments: true, programmes: true, credits: true },
    labels: { teachers: 'Faculty', teacher: 'Lecturer', subjects: 'Courses', programmes: 'Programmes' },
  },
}

/**
 * The type a school tenant is. A school with none recorded was created
 * before types existed, or directly in the database, and was built on the
 * university model, so it is one.
 */
export function resolveSchoolType(value: unknown): SchoolType {
  return isSchoolType(value) ? value : 'university'
}

export function isSchoolType(value: unknown): value is SchoolType {
  return typeof value === 'string' && (SCHOOL_TYPES as readonly string[]).includes(value)
}

export class SchoolStructureError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message)
  }
}

/**
 * Checks a type and its stages, and returns the stages in catalogue order
 * without duplicates. Throws a 400 SchoolStructureError when they are wrong.
 */
export function validateStructure(type: unknown, stages: unknown): { type: SchoolType; stages: string[] } {
  if (!isSchoolType(type)) {
    throw new SchoolStructureError(
      `School type must be one of: ${SCHOOL_TYPES.join(', ')}`, 400, 'INVALID_SCHOOL_TYPE')
  }
  if (!Array.isArray(stages) || stages.length === 0) {
    throw new SchoolStructureError(
      'Choose at least one level the school offers', 400, 'STAGES_REQUIRED')
  }
  const def = SCHOOL_TYPE_CATALOGUE[type]
  const known = new Set(def.stages.map((s) => s.key))
  const unknown = stages.filter((s) => typeof s !== 'string' || !known.has(s))
  if (unknown.length > 0) {
    throw new SchoolStructureError(
      `A ${def.label.toLowerCase()} does not offer: ${unknown.join(', ')}`, 400, 'INVALID_STAGE')
  }
  const chosen = new Set(stages as string[])
  return { type, stages: def.stages.filter((s) => chosen.has(s.key)).map((s) => s.key) }
}

/** The grades a grade school's stages generate, in order. */
export function gradesFor(type: SchoolType, stages: string[]): Array<Grade & { stage: string; sortOrder: number }> {
  const def = SCHOOL_TYPE_CATALOGUE[type]
  if (!def.features.gradeLevels) return []
  const chosen = new Set(stages)
  const out: Array<Grade & { stage: string; sortOrder: number }> = []
  let order = 0
  for (const stage of def.stages) {
    for (const g of stage.grades ?? []) {
      // The position is the grade's place in the whole ladder, so K-2 sorts
      // before Grade 1 whether or not the stages between are offered.
      if (chosen.has(stage.key)) out.push({ ...g, stage: stage.key, sortOrder: order })
      order++
    }
  }
  return out
}

/**
 * Sets a school tenant's type and stages, inside the caller's transaction.
 *
 * Adds the grades of new stages and removes those of dropped ones. Refuses
 * to change the type once the school has a student, and refuses to drop a
 * stage whose grades something still refers to.
 */
export async function applySchoolStructure(
  client: PoolClient,
  tenantId: string,
  type: SchoolType,
  stages: string[],
): Promise<void> {
  const current = await client.query(
    `SELECT kind, school_type FROM tenants WHERE id = $1 FOR UPDATE`, [tenantId])
  if (current.rowCount === 0) throw new SchoolStructureError('Tenant not found', 404, 'NOT_FOUND')
  if (current.rows[0].kind !== 'school') {
    throw new SchoolStructureError('Only a school has a school type', 400, 'NOT_A_SCHOOL')
  }

  // A school with no type recorded is a university (see resolveSchoolType),
  // and is locked like one: comparing against the raw NULL let a populated
  // pre-types school be turned into a grade school.
  const was = resolveSchoolType(current.rows[0].school_type)
  if (was !== type) {
    const students = await client.query(`SELECT 1 FROM students WHERE tenant_id = $1 LIMIT 1`, [tenantId])
    if ((students.rowCount ?? 0) > 0) {
      throw new SchoolStructureError(
        'The school type cannot change once the school has students: its records are shaped by it. ' +
        'Levels can still be added.',
        409, 'SCHOOL_TYPE_LOCKED')
    }
  }

  await client.query(
    `UPDATE tenants SET school_type = $2, school_stages = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
    [tenantId, type, stages])

  const wanted = gradesFor(type, stages)
  const keep = wanted.map((g) => g.code)
  try {
    await client.query(`SAVEPOINT grade_levels_prune`)
    await client.query(
      `DELETE FROM grade_levels WHERE tenant_id = $1 AND NOT (code = ANY($2::text[]))`, [tenantId, keep])
    await client.query(`RELEASE SAVEPOINT grade_levels_prune`)
  } catch (e) {
    if ((e as { code?: string }).code === '23503') {
      await client.query(`ROLLBACK TO SAVEPOINT grade_levels_prune`)
      throw new SchoolStructureError(
        'A level cannot be removed while classes or students are placed in its grades', 409, 'STAGE_IN_USE')
    }
    throw e
  }
  for (const g of wanted) {
    await client.query(
      `INSERT INTO grade_levels (tenant_id, stage, code, name, sort_order)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (tenant_id, code) DO UPDATE
         SET stage = EXCLUDED.stage, name = EXCLUDED.name, sort_order = EXCLUDED.sort_order`,
      [tenantId, g.stage, g.code, g.name, g.sortOrder])
  }
}

export interface SchoolStructure {
  type: SchoolType
  label: string
  stages: Array<{ key: string; label: string; offered: boolean }>
  features: SchoolFeatures
  labels: SchoolLabels
  gradeLevels: Array<{ id: string; stage: string; code: string; name: string }>
}

/** What a school's own people see: its type, stages, tools and grades. */
export async function getSchoolStructure(tenantId: string): Promise<SchoolStructure | null> {
  const t = await query(`SELECT kind, school_type, school_stages FROM tenants WHERE id = $1`, [tenantId])
  if (t.rowCount === 0 || t.rows[0].kind !== 'school') return null
  const type = resolveSchoolType(t.rows[0].school_type)
  const def = SCHOOL_TYPE_CATALOGUE[type]
  const offered: string[] = t.rows[0].school_stages?.length ? t.rows[0].school_stages : [def.stages[0].key]
  const levels = def.features.gradeLevels
    ? await query(
        `SELECT id, stage, code, name FROM grade_levels WHERE tenant_id = $1 ORDER BY sort_order`, [tenantId])
    : { rows: [] }
  return {
    type,
    label: def.label,
    stages: def.stages.map((s) => ({ key: s.key, label: s.label, offered: offered.includes(s.key) })),
    features: def.features,
    labels: def.labels,
    gradeLevels: levels.rows,
  }
}

/**
 * Refuses a route whose tool the school's type does not use, e.g. programmes
 * at a grade school. Superadmins pass, as they do every tenant guard.
 */
export function requireSchoolFeature(feature: keyof SchoolFeatures) {
  return async (req: TenantRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (req.ctx?.isSuperadmin || !req.ctx?.tenantId) return next()
      const t = await query(`SELECT school_type FROM tenants WHERE id = $1`, [req.ctx.tenantId])
      const def = SCHOOL_TYPE_CATALOGUE[resolveSchoolType(t.rows[0]?.school_type)]
      if (!def.features[feature]) {
        res.status(403).json({
          error: `A ${def.label.toLowerCase()} does not use this`,
          code: 'NOT_FOR_SCHOOL_TYPE',
        })
        return
      }
      next()
    } catch (e) {
      next(e)
    }
  }
}
