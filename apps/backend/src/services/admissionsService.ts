import type { PoolClient } from 'pg'
import { query } from '../db/connection.js'
import { sendInvitation, unusablePasswordHash, type InvitationResult } from '../auth/accountTokens.js'

/**
 * SMS — admissions.
 *
 * An application is a small state machine, and the value of writing it down
 * once is that no route can invent a transition. Admissions decisions get
 * challenged: a rejected applicant asks why, an offer holder asks when it
 * expires, an auditor asks who moved an application from waitlisted to offer
 * three days after the decision deadline. Every answer has to come from the
 * record rather than from someone's recollection, so every transition writes
 * an application_events row inside the same transaction that made it.
 *
 * The one transition that does more than change a column is enrolment, which
 * has to bring a student into existence: a users row so they can log in, a
 * students row so the rest of SMS can see them, the school association that
 * places them in this school, and the programme enrolment that says what they
 * are reading. It either all happens or none of it does.
 */

export class AdmissionsError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.name = 'AdmissionsError'
    this.status = status
  }
}

export interface AdmissionsContext {
  tenantId: string
  platformId: string
  userId: string
}

/** A runner that is either the pool or a transaction client. */
type Runner = { query: (text: string, params?: any[]) => Promise<any> }

export type ApplicationStatus =
  | 'draft'
  | 'submitted'
  | 'under_review'
  | 'offer'
  | 'accepted'
  | 'declined'
  | 'rejected'
  | 'waitlisted'
  | 'withdrawn'
  | 'enrolled'

/**
 * What may follow what.
 *
 * Read down the left column for the current status. An application that is
 * already enrolled, declined or rejected is finished — the empty arrays are
 * deliberate, not unfinished work. Withdrawal is the applicant's own exit and
 * is available from anywhere that is still live.
 */
const TRANSITIONS: Record<ApplicationStatus, ApplicationStatus[]> = {
  draft: ['submitted', 'withdrawn'],
  submitted: ['under_review', 'offer', 'rejected', 'waitlisted', 'withdrawn'],
  under_review: ['offer', 'rejected', 'waitlisted', 'withdrawn'],
  // A waitlisted applicant is still in the running: a place freeing up moves
  // them to offer, and the close of the cycle moves them to rejected.
  waitlisted: ['offer', 'rejected', 'withdrawn'],
  offer: ['accepted', 'declined', 'withdrawn'],
  accepted: ['enrolled', 'withdrawn'],
  declined: [],
  rejected: [],
  withdrawn: [],
  enrolled: [],
}

/** Transitions the applicant themselves drives, as opposed to the registrar. */
const APPLICANT_TRANSITIONS = new Set<ApplicationStatus>([
  'submitted',
  'accepted',
  'declined',
  'withdrawn',
])

export function canTransition(from: ApplicationStatus, to: ApplicationStatus): boolean {
  return (TRANSITIONS[from] ?? []).includes(to)
}

export function nextStatuses(from: ApplicationStatus): ApplicationStatus[] {
  return [...(TRANSITIONS[from] ?? [])]
}

export function isApplicantDriven(to: ApplicationStatus): boolean {
  return APPLICANT_TRANSITIONS.has(to)
}

/** True once the application can no longer move. */
export function isTerminal(status: ApplicationStatus): boolean {
  return (TRANSITIONS[status] ?? []).length === 0
}

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------

/**
 * Human-facing reference codes.
 *
 * Applicants quote these on the phone, so they are short, unambiguous and
 * scoped per tenant. The unique index is the real guard; the retry here just
 * keeps a collision from reaching the caller as a 409 on something they did
 * not choose.
 */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function randomSuffix(length: number): string {
  let out = ''
  for (let i = 0; i < length; i += 1) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
  }
  return out
}

export async function allocateReference(
  runner: Runner,
  table: 'applicants' | 'applications',
  tenantId: string,
  prefix: string
): Promise<string> {
  const column = table === 'applicants' ? 'applicants' : 'applications'
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const candidate = `${prefix}-${randomSuffix(8)}`
    const clash = await runner.query(
      `SELECT 1 FROM ${column} WHERE tenant_id = $1 AND UPPER(reference) = UPPER($2) LIMIT 1`,
      [tenantId, candidate]
    )
    if (clash.rowCount === 0) return candidate
  }
  throw new AdmissionsError('Could not allocate a reference; please retry', 503)
}

// ---------------------------------------------------------------------------
// The trail
// ---------------------------------------------------------------------------

export async function recordEvent(
  runner: Runner,
  ctx: AdmissionsContext,
  applicationId: string,
  fromStatus: ApplicationStatus | null,
  toStatus: ApplicationStatus,
  note?: string | null
): Promise<void> {
  await runner.query(
    `INSERT INTO application_events
       (tenant_id, application_id, from_status, to_status, actor_id, note)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [ctx.tenantId, applicationId, fromStatus, toStatus, ctx.userId, note ?? null]
  )
}

// ---------------------------------------------------------------------------
// Intake gating
// ---------------------------------------------------------------------------

export interface IntakeRow {
  id: string
  tenant_id: string
  status: string
  opens_at: string | Date
  closes_at: string | Date
  capacity: number | null
}

/**
 * Whether an intake is accepting submissions right now.
 *
 * A closed window is not a validation nicety: an application that arrives
 * after the deadline and is quietly accepted is the kind of thing that ends
 * in a complaint the registrar cannot answer.
 */
export function intakeAcceptsSubmissions(intake: IntakeRow, on = new Date()): { ok: boolean; reason?: string } {
  if (intake.status !== 'open') {
    return { ok: false, reason: `This intake is ${intake.status}, so it is not accepting applications` }
  }
  const day = isoDay(on)
  const opens = isoDay(intake.opens_at)
  const closes = isoDay(intake.closes_at)
  if (opens && day < opens) return { ok: false, reason: `This intake opens on ${opens}` }
  if (closes && day > closes) return { ok: false, reason: `This intake closed on ${closes}` }
  return { ok: true }
}

/**
 * A DATE column as YYYY-MM-DD, whatever the driver handed back.
 *
 * node-postgres turns a DATE into a JS Date at local midnight, whose default
 * string form is 'Fri Aug 14 2026 ...'. Slicing that gives 'Fri Aug 14' and
 * every window comparison silently becomes a string comparison against a
 * weekday name. Comparing admission deadlines has to be done on the calendar
 * date the column actually holds.
 */
function isoDay(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null
    // Local parts, not toISOString: the driver put the calendar date at local
    // midnight, and converting to UTC can move it back a day.
    const y = value.getFullYear()
    const m = String(value.getMonth() + 1).padStart(2, '0')
    const d = String(value.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  const text = String(value)
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : null
}

/**
 * How many places an intake has left.
 *
 * Counted against enrolled and accepted applications — an accepted offer is a
 * place committed even though the student record does not exist yet. Returns
 * null where the intake declares no capacity, which means uncapped rather
 * than full.
 */
export async function remainingCapacity(
  runner: Runner,
  tenantId: string,
  intakeId: string
): Promise<{ capacity: number | null; taken: number; remaining: number | null }> {
  const r = await runner.query(
    `SELECT i.capacity,
            COUNT(a.id) FILTER (WHERE a.status IN ('accepted', 'enrolled')) AS taken
       FROM admission_intakes i
       LEFT JOIN applications a
              ON a.intake_id = i.id AND a.tenant_id = i.tenant_id
      WHERE i.id = $1 AND i.tenant_id = $2
      GROUP BY i.capacity`,
    [intakeId, tenantId]
  )
  if (r.rowCount === 0) throw new AdmissionsError('Intake not found', 404)
  const capacity = r.rows[0].capacity === null ? null : Number(r.rows[0].capacity)
  const taken = Number(r.rows[0].taken ?? 0)
  return { capacity, taken, remaining: capacity === null ? null : capacity - taken }
}

// ---------------------------------------------------------------------------
// Transition
// ---------------------------------------------------------------------------

export interface TransitionInput {
  to: ApplicationStatus
  note?: string | null
  /** Required when moving to 'offer'; must be a programme in this tenant. */
  offeredProgrammeId?: string | null
  /** Optional deadline the offer lapses on. */
  offerExpiresAt?: string | null
}

export interface ApplicationRow {
  id: string
  tenant_id: string
  applicant_id: string
  intake_id: string
  reference: string
  status: ApplicationStatus
  submitted_at: string | null
  offered_programme_id: string | null
  offer_expires_at: string | null
  student_id: string | null
  enrolled_at: string | null
}

/**
 * Moves an application, writing the trail.
 *
 * The caller has already established that the application belongs to the
 * tenant; this re-scopes anyway on the UPDATE, because a predicate that is
 * only enforced one layer up is a predicate that goes missing the next time
 * someone adds a caller.
 */
export async function transition(
  client: PoolClient,
  ctx: AdmissionsContext,
  application: ApplicationRow,
  input: TransitionInput
): Promise<ApplicationRow> {
  const from = application.status
  const to = input.to

  if (!TRANSITIONS[to]) throw new AdmissionsError(`Unknown status '${to}'`)
  if (from === to) throw new AdmissionsError(`This application is already ${to}`, 409)
  if (!canTransition(from, to)) {
    const allowed = nextStatuses(from)
    throw new AdmissionsError(
      allowed.length === 0
        ? `This application is ${from} and can no longer be changed`
        : `An application that is ${from} can only move to ${allowed.join(', ')}`,
      409
    )
  }

  // Enrolment is not a status change; it creates a student. The caller uses
  // enrolApplicant for that, which calls back here once the student exists.
  if (to === 'enrolled' && !application.student_id) {
    throw new AdmissionsError('Use the enrolment endpoint to enrol an accepted applicant', 400)
  }

  let programmeId = application.offered_programme_id
  if (to === 'offer') {
    const supplied = input.offeredProgrammeId ?? null
    if (!supplied) throw new AdmissionsError('An offer must name the programme being offered')
    const owned = await client.query(
      `SELECT id FROM programmes WHERE id = $1 AND tenant_id = $2 AND is_active = TRUE`,
      [supplied, ctx.tenantId]
    )
    if (owned.rowCount === 0) throw new AdmissionsError('Programme not found', 404)
    programmeId = supplied
  }

  // Submission stamps the time the school received it, which is what a
  // deadline is measured against.
  const submittedAt = to === 'submitted' ? 'CURRENT_TIMESTAMP' : 'submitted_at'

  // A decision records who made it. Rescinding into a live state clears the
  // previous reviewer rather than leaving a stale name attached.
  const decisive = ['under_review', 'offer', 'rejected', 'waitlisted'].includes(to)

  const updated = await client.query(
    `UPDATE applications
        SET status = $3,
            submitted_at = ${submittedAt},
            offered_programme_id = $4,
            offer_expires_at = $5,
            decision_note = COALESCE($6, decision_note),
            reviewed_by = ${decisive ? '$7' : 'reviewed_by'},
            reviewed_at = ${decisive ? 'CURRENT_TIMESTAMP' : 'reviewed_at'},
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND tenant_id = $2
      RETURNING *`,
    decisive
      ? [
          application.id, ctx.tenantId, to, programmeId,
          input.offerExpiresAt ?? application.offer_expires_at ?? null,
          input.note ?? null, ctx.userId,
        ]
      : [
          application.id, ctx.tenantId, to, programmeId,
          input.offerExpiresAt ?? application.offer_expires_at ?? null,
          input.note ?? null,
        ]
  )
  if (updated.rowCount === 0) throw new AdmissionsError('Application not found', 404)

  await recordEvent(client, ctx, application.id, from, to, input.note ?? null)
  return updated.rows[0] as ApplicationRow
}

// ---------------------------------------------------------------------------
// Enrolment
// ---------------------------------------------------------------------------

export interface EnrolInput {
  /** The school's own student number. Generated if not supplied. */
  studentId?: string
  /** Falls back to the offered programme. */
  programmeId?: string
  academicYearId?: string | null
  departmentId?: string | null
  college?: string
  entryYear?: number
  note?: string | null
}

export interface EnrolResult {
  application: ApplicationRow
  studentId: string
  userId: string
  studentNumber: string
  invitation: InvitationResult
}

/**
 * Turns an accepted applicant into a student.
 *
 * Everything here runs on one client inside one transaction, because a
 * half-made student — a login with no student record, or a student with no
 * programme — is worse than a failed enrolment. The caller owns BEGIN and
 * COMMIT so that this can be composed with whatever else a route needs.
 */
export async function enrolApplicant(
  client: PoolClient,
  ctx: AdmissionsContext,
  application: ApplicationRow,
  input: EnrolInput = {}
): Promise<EnrolResult> {
  if (application.status !== 'accepted') {
    throw new AdmissionsError(
      `Only an accepted applicant can be enrolled; this application is ${application.status}`,
      409
    )
  }
  if (application.student_id) {
    throw new AdmissionsError('This application has already produced a student', 409)
  }

  const applicantRow = await client.query(
    `SELECT * FROM applicants WHERE id = $1 AND tenant_id = $2`,
    [application.applicant_id, ctx.tenantId]
  )
  if (applicantRow.rowCount === 0) throw new AdmissionsError('Applicant not found', 404)
  const applicant = applicantRow.rows[0]

  const programmeId = input.programmeId ?? application.offered_programme_id
  if (!programmeId) {
    throw new AdmissionsError('No programme to enrol onto; make an offer first')
  }
  const programme = await client.query(
    `SELECT p.id, p.name, d.name AS department_name, p.department_id
       FROM programmes p
       LEFT JOIN school_departments d ON d.id = p.department_id AND d.tenant_id = p.tenant_id
      WHERE p.id = $1 AND p.tenant_id = $2`,
    [programmeId, ctx.tenantId]
  )
  if (programme.rowCount === 0) throw new AdmissionsError('Programme not found', 404)

  if (input.academicYearId) {
    const year = await client.query(
      `SELECT id FROM academic_years WHERE id = $1 AND tenant_id = $2`,
      [input.academicYearId, ctx.tenantId]
    )
    if (year.rowCount === 0) throw new AdmissionsError('Academic year not found', 404)
  }
  if (input.departmentId) {
    const dept = await client.query(
      `SELECT id FROM school_departments WHERE id = $1 AND tenant_id = $2`,
      [input.departmentId, ctx.tenantId]
    )
    if (dept.rowCount === 0) throw new AdmissionsError('Department not found', 404)
  }

  // The applicant's email becomes the login. If the school already has a user
  // on that address the enrolment stops here rather than quietly attaching
  // the new student to somebody else's account.
  const existing = await client.query(
    `SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND platform_id = $2`,
    [applicant.email, ctx.platformId]
  )
  if (existing.rowCount > 0) {
    throw new AdmissionsError(
      'An account already exists on this email address; resolve the duplicate before enrolling',
      409
    )
  }

  const role = await client.query(
    `SELECT id FROM roles WHERE name = 'student' AND platform_id = $1`,
    [ctx.platformId]
  )
  if (role.rowCount === 0) {
    throw new AdmissionsError('The student role is not configured for this platform', 500)
  }

  const studentNumber = input.studentId
    ? String(input.studentId)
    : await allocateStudentNumber(client, ctx.tenantId)

  const clash = await client.query(
    `SELECT id FROM students WHERE UPPER(student_id) = UPPER($1) AND tenant_id = $2`,
    [studentNumber, ctx.tenantId]
  )
  if (clash.rowCount > 0) {
    throw new AdmissionsError(`Student number ${studentNumber} is already in use`, 409)
  }

  // The student chooses their own password from the invitation sent below.
  const hashed = await unusablePasswordHash()
  const fullName = applicant.middle_name
    ? `${applicant.first_name} ${applicant.middle_name} ${applicant.last_name}`
    : `${applicant.first_name} ${applicant.last_name}`

  const user = await client.query(
    `INSERT INTO users (email, full_name, phone, platform_id, role_id, is_active,
                        password_hash, must_reset_password)
     VALUES ($1, $2, $3, $4, $5, TRUE, $6, FALSE) RETURNING id`,
    [applicant.email, fullName, applicant.phone ?? null, ctx.platformId, role.rows[0].id, hashed]
  )
  const userId = user.rows[0].id as string

  const entryYear = Number.isInteger(input.entryYear)
    ? Number(input.entryYear)
    : new Date().getFullYear()

  // tenant_id and platform_id come from the resolved context. Nothing the
  // applicant or the form supplied can place this student in another school.
  const student = await client.query(
    `INSERT INTO students (user_id, student_id, first_name, middle_name, last_name, email,
                           phone, address, college, department_id, status, gender,
                           enrollment_year, platform_id, tenant_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'freshman',$11,$12,$13,$14) RETURNING id`,
    [
      userId, studentNumber, applicant.first_name, applicant.middle_name ?? null,
      applicant.last_name, applicant.email, applicant.phone ?? null, applicant.address ?? null,
      input.college ?? programme.rows[0].department_name ?? '',
      input.departmentId ?? programme.rows[0].department_id ?? null,
      applicant.gender ?? null, entryYear, ctx.platformId, ctx.tenantId,
    ]
  )
  const newStudentId = student.rows[0].id as string

  await client.query(
    `INSERT INTO school_user_associations (user_id, school_entity_id, status)
     VALUES ($1, $2, 'active')`,
    [userId, ctx.tenantId]
  )

  await client.query(
    `INSERT INTO student_programmes
       (tenant_id, student_id, programme_id, academic_year_id, entry_year, status)
     VALUES ($1, $2, $3, $4, $5, 'active')`,
    [ctx.tenantId, newStudentId, programmeId, input.academicYearId ?? null, entryYear]
  )

  const updated = await client.query(
    `UPDATE applications
        SET status = 'enrolled',
            student_id = $3,
            enrolled_at = CURRENT_TIMESTAMP,
            offered_programme_id = $4,
            decision_note = COALESCE($5, decision_note),
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND tenant_id = $2
      RETURNING *`,
    [application.id, ctx.tenantId, newStudentId, programmeId, input.note ?? null]
  )

  await client.query(
    `UPDATE applicants SET converted_student_id = $3, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND tenant_id = $2`,
    [application.applicant_id, ctx.tenantId, newStudentId]
  )

  await recordEvent(
    client, ctx, application.id, application.status, 'enrolled',
    input.note ?? `Enrolled as ${studentNumber}`
  )

  const invitation = await sendInvitation(client, { userId, tenantId: ctx.tenantId, invitedBy: ctx.userId })

  return {
    application: updated.rows[0] as ApplicationRow,
    studentId: newStudentId,
    userId,
    studentNumber,
    invitation,
  }
}

/**
 * A student number for a school that did not supply one.
 *
 * Shaped year-plus-sequence because that is what registrars expect to read,
 * and scoped to the tenant so two schools can both have a 2026-0001.
 */
async function allocateStudentNumber(runner: Runner, tenantId: string): Promise<string> {
  const year = new Date().getFullYear()
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const candidate = `${year}-${randomSuffix(6)}`
    const clash = await runner.query(
      `SELECT 1 FROM students WHERE tenant_id = $1 AND UPPER(student_id) = UPPER($2) LIMIT 1`,
      [tenantId, candidate]
    )
    if (clash.rowCount === 0) return candidate
  }
  throw new AdmissionsError('Could not allocate a student number; supply one explicitly', 503)
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

export interface IntakeFunnel {
  intakeId: string
  total: number
  byStatus: Record<string, number>
  submitted: number
  offers: number
  accepted: number
  enrolled: number
  rejected: number
  offerRate: number | null
  acceptanceRate: number | null
  yieldRate: number | null
}

/**
 * The funnel a registrar is actually asked about.
 *
 * Rates are null rather than zero where the denominator is zero, because "no
 * offers were accepted" and "no offers were made" are different answers and
 * reporting both as 0% loses the distinction.
 */
export async function intakeFunnel(
  tenantId: string,
  intakeId: string
): Promise<IntakeFunnel> {
  const rows = await query(
    `SELECT status, COUNT(*)::int AS n
       FROM applications
      WHERE tenant_id = $1 AND intake_id = $2
      GROUP BY status`,
    [tenantId, intakeId]
  )

  const byStatus: Record<string, number> = {}
  for (const r of rows.rows) byStatus[r.status] = Number(r.n)

  const at = (s: string) => byStatus[s] ?? 0
  const total = Object.values(byStatus).reduce((a, b) => a + b, 0)

  // Anything past draft was submitted at some point, whatever it became.
  const submitted = total - at('draft')
  const offers = at('offer') + at('accepted') + at('declined') + at('enrolled')
  const accepted = at('accepted') + at('enrolled')
  const enrolled = at('enrolled')

  const rate = (num: number, den: number) =>
    den === 0 ? null : Math.round((num / den) * 1000) / 10

  return {
    intakeId,
    total,
    byStatus,
    submitted,
    offers,
    accepted,
    enrolled,
    rejected: at('rejected'),
    offerRate: rate(offers, submitted),
    acceptanceRate: rate(accepted, offers),
    yieldRate: rate(enrolled, accepted),
  }
}
