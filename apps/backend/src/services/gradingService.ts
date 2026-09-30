import { query } from '../db/connection.js'

/**
 * SMS — turning marks into results.
 *
 * The arithmetic of a course result lives here rather than in a handler
 * because three callers need it and they must agree: a lecturer computing a
 * provisional grade, a registrar publishing a cohort, and the transcript.
 *
 * Two rules shape everything below.
 *
 * Weights are a contract. A course's assessments carry weights that are meant
 * to total 100; a total of 60 means two thirds of the assessment has not
 * happened yet. Scaling the marks to the weight actually recorded would make
 * a mid-term grade look like a final one, so the shortfall is reported and
 * the caller decides.
 *
 * An absence is a zero; a pending mark is not. A student who missed an exam
 * scored nothing on it, and their grade should say so. A mark that has not
 * been entered yet is missing data, and averaging over it silently invents a
 * grade. The two are kept apart.
 */

export interface GradeBand {
  letter: string
  min_score: number
  max_score: number
  grade_point: number
  is_pass: boolean
}

export interface ComputedResult {
  studentId: string
  /** Weighted percentage over the assessments that carry a mark. */
  totalScore: number
  /** How much of the course's weight has actually been graded. */
  weightGraded: number
  /** The course's total declared weight, which should be 100. */
  weightDeclared: number
  /** Assessments with no mark recorded for this student. */
  pending: number
  letter: string | null
  gradePoint: number | null
  isPass: boolean | null
}

export class GradingError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
    this.name = 'GradingError'
  }
}

/**
 * The grading scheme a course is marked against: the one named on the course's
 * result rows, else the school's default.
 */
export async function resolveScheme(tenantId: string, schemeId?: string | null) {
  if (schemeId) {
    const r = await query(
      `SELECT * FROM grading_schemes WHERE id = $1 AND tenant_id = $2`,
      [schemeId, tenantId]
    )
    if (r.rows.length === 0) throw new GradingError('Grading scheme not found', 404)
    return r.rows[0]
  }

  const d = await query(
    `SELECT * FROM grading_schemes WHERE tenant_id = $1 AND is_default LIMIT 1`,
    [tenantId]
  )
  if (d.rows.length === 0) {
    throw new GradingError(
      'This school has no default grading scheme. Create one before publishing results.',
      409
    )
  }
  return d.rows[0]
}

export async function schemeBands(tenantId: string, schemeId: string): Promise<GradeBand[]> {
  const r = await query(
    `SELECT letter, min_score, max_score, grade_point, is_pass
       FROM grade_bands
      WHERE scheme_id = $1 AND tenant_id = $2
      ORDER BY min_score DESC`,
    [schemeId, tenantId]
  )
  return r.rows.map((b: any) => ({
    letter: b.letter,
    min_score: Number(b.min_score),
    max_score: Number(b.max_score),
    grade_point: Number(b.grade_point),
    is_pass: b.is_pass,
  }))
}

/** The band a percentage falls in, or null when the scheme does not cover it. */
export function bandFor(bands: GradeBand[], score: number): GradeBand | null {
  return bands.find((b) => score >= b.min_score && score <= b.max_score) ?? null
}

/**
 * Computes every enrolled student's result for a course.
 *
 * Scoped by tenant throughout: the course, its assessments, the enrolment and
 * the marks are all read within the caller's school.
 */
export async function computeCourseResults(
  tenantId: string,
  courseId: string,
  semesterId: string | null,
  bands: GradeBand[]
): Promise<ComputedResult[]> {
  const assessments = await query(
    `SELECT id, max_score, weight FROM assessments
      WHERE course_id = $1 AND tenant_id = $2
        AND ($3::uuid IS NULL OR semester_id = $3::uuid OR semester_id IS NULL)`,
    [courseId, tenantId, semesterId]
  )

  if (assessments.rows.length === 0) {
    throw new GradingError('This course has no assessments to compute a result from', 409)
  }

  const weightDeclared = assessments.rows.reduce(
    (sum: number, a: any) => sum + Number(a.weight),
    0
  )

  // Everyone enrolled on the course, through its schedules.
  const enrolled = await query(
    `SELECT DISTINCT sc.student_id
       FROM student_courses sc
       JOIN class_schedules cs ON cs.id = sc.schedule_id
      WHERE cs.course_id = $1 AND sc.tenant_id = $2 AND sc.status = 'enrolled'`,
    [courseId, tenantId]
  )

  const scores = await query(
    `SELECT s.assessment_id, s.student_id, s.score, s.status, a.max_score, a.weight
       FROM assessment_scores s
       JOIN assessments a ON a.id = s.assessment_id
      WHERE a.course_id = $1 AND s.tenant_id = $2
        AND ($3::uuid IS NULL OR a.semester_id = $3::uuid OR a.semester_id IS NULL)`,
    [courseId, tenantId, semesterId]
  )

  const byStudent = new Map<string, any[]>()
  for (const row of scores.rows) {
    const list = byStudent.get(row.student_id) ?? []
    list.push(row)
    byStudent.set(row.student_id, list)
  }

  const results: ComputedResult[] = []

  for (const { student_id } of enrolled.rows) {
    const marks = byStudent.get(student_id) ?? []

    let weighted = 0
    let weightGraded = 0

    for (const m of marks) {
      // 'pending' and 'submitted' mean no mark yet; they are not zeros.
      if (m.status === 'pending' || m.status === 'submitted') continue
      // 'excused' removes the assessment from this student's denominator.
      if (m.status === 'excused') continue

      const max = Number(m.max_score)
      const weight = Number(m.weight)
      // An absence is a zero, not missing data.
      const raw = m.status === 'absent' ? 0 : Number(m.score ?? 0)

      weighted += max > 0 ? (raw / max) * weight : 0
      weightGraded += weight
    }

    const pending = assessments.rows.length - marks.filter(
      (m: any) => m.status !== 'pending' && m.status !== 'submitted'
    ).length

    // The percentage is over what has been graded, so a mid-term result reads
    // as a real percentage rather than a fraction of an unfinished course.
    const totalScore = weightGraded > 0 ? (weighted / weightGraded) * 100 : 0
    const rounded = Math.round(totalScore * 100) / 100
    const band = weightGraded > 0 ? bandFor(bands, rounded) : null

    results.push({
      studentId: student_id,
      totalScore: rounded,
      weightGraded: Math.round(weightGraded * 100) / 100,
      weightDeclared: Math.round(weightDeclared * 100) / 100,
      pending,
      letter: band?.letter ?? null,
      gradePoint: band?.grade_point ?? null,
      isPass: band ? band.is_pass : null,
    })
  }

  return results
}

/**
 * Grade point average over published results, weighted by credits.
 *
 * Only published results count: a provisional mark is not yet the school's
 * position, and a withheld one is deliberately not.
 */
export async function computeGpa(
  tenantId: string,
  studentId: string,
  academicYearId?: string | null
): Promise<{
  gpa: number | null
  creditsEarned: number
  creditsAttempted: number
  /** True when no result carried credits, so the mean is unweighted. */
  unweighted: boolean
}> {
  const r = await query(
    `SELECT t.grade_point, t.credits, t.is_pass
       FROM student_transcript t
      WHERE t.tenant_id = $1 AND t.student_id = $2
        AND ($3::uuid IS NULL OR t.academic_year_id = $3::uuid)`,
    [tenantId, studentId, academicYearId ?? null]
  )

  let points = 0
  let creditsAttempted = 0
  let creditsEarned = 0

  for (const row of r.rows) {
    const credits = Number(row.credits ?? 0)
    if (credits <= 0) continue
    creditsAttempted += credits
    if (row.grade_point !== null) points += Number(row.grade_point) * credits
    if (row.is_pass) creditsEarned += credits
  }

  if (creditsAttempted > 0) {
    return {
      gpa: Math.round((points / creditsAttempted) * 100) / 100,
      creditsEarned,
      creditsAttempted,
      unweighted: false,
    }
  }

  // A school that has not assigned credit values still needs a GPA, and
  // weighting by a credit of zero would report null for every student. The
  // mean over the graded results is the honest answer, flagged so the caller
  // can say which it is rather than presenting it as credit-weighted.
  const graded = r.rows.filter((row: any) => row.grade_point !== null)
  if (graded.length === 0) {
    return { gpa: null, creditsEarned: 0, creditsAttempted: 0, unweighted: true }
  }

  const mean =
    graded.reduce((sum: number, row: any) => sum + Number(row.grade_point), 0) / graded.length

  return {
    gpa: Math.round(mean * 100) / 100,
    creditsEarned: graded.filter((row: any) => row.is_pass).length,
    creditsAttempted: graded.length,
    unweighted: true,
  }
}
