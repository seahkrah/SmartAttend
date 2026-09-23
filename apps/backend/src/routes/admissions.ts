import { Router, Response, NextFunction } from 'express'
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
import {
  AdmissionsError,
  type AdmissionsContext,
  type ApplicationRow,
  type ApplicationStatus,
  allocateReference,
  enrolApplicant,
  intakeAcceptsSubmissions,
  intakeFunnel,
  nextStatuses,
  recordEvent,
  remainingCapacity,
  transition,
} from '../services/admissionsService.js'

/**
 * SMS — admissions.
 *
 * The registrar's surface: intakes, applicants, applications, decisions and
 * the enrolment that turns an accepted applicant into a student.
 *
 * Scope, stated plainly: this is the staff-facing side. There is no public
 * applicant portal — applicants do not have accounts, and giving them one
 * needs an authentication scheme of its own. Applications are keyed in by the
 * registry, which is how paper and agent-submitted applications arrive
 * anyway. The self-service portal is a separate piece of work, not something
 * these routes half-do.
 *
 * Tenancy: every statement carries tenant_id from the resolved context. Rows
 * belonging to another school read as 404, so probing ids tells an attacker
 * nothing they did not already know.
 */

const router = Router()

router.use(
  authenticateToken,
  resolveTenantContext,
  requireTenant,
  requirePlatform('school'),
  requireRoles('admin')
)

type Ctx = ResolvedTenantContext & { tenantId: string }

function ctxOf(req: TenantRequest): AdmissionsContext {
  const c = req.ctx as Ctx
  return { tenantId: c.tenantId, platformId: c.platformId, userId: c.userId }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function fail(res: Response, label: string, e: unknown) {
  if (e instanceof AdmissionsError) {
    return res.status(e.status).json({ error: e.message })
  }
  const err = e as { code?: string; constraint?: string; message?: string }

  if (err.code === '23505') {
    if (err.constraint === 'uq_applicants_tenant_email') {
      return res.status(409).json({ error: 'An applicant already exists on this email address' })
    }
    if (err.constraint === 'uq_applications_one_live') {
      return res.status(409).json({ error: 'This applicant already has a live application to this intake' })
    }
    if (err.constraint === 'uq_application_choices_rank') {
      return res.status(409).json({ error: 'That preference rank is already used on this application' })
    }
    if (err.constraint === 'uq_application_choices_programme') {
      return res.status(409).json({ error: 'That programme is already one of this application\'s choices' })
    }
    if (err.constraint === 'uq_admission_intakes_tenant_code') {
      return res.status(409).json({ error: 'An intake with that code already exists' })
    }
    return res.status(409).json({ error: 'That record already exists' })
  }
  if (err.code === '23514') {
    return res.status(400).json({ error: 'The values supplied are outside what this record allows' })
  }
  if (err.code === '23503') {
    return res.status(400).json({ error: 'That record refers to something which does not exist' })
  }
  if (err.code === '23502') {
    return res.status(400).json({ error: 'A required field is missing' })
  }
  console.error(`[ADMISSIONS] ${label}:`, e)
  return res.status(500).json({ error: `Failed to ${label}` })
}

function notFound(res: Response, what: string) {
  return res.status(404).json({ error: `${what} not found` })
}

/** Reads a row of a tenant-owned table, or null. Never leaks across tenants. */
async function owned(table: string, ctx: AdmissionsContext, id: string): Promise<any | null> {
  if (!/^[a-z_]+$/.test(table)) throw new Error('unsafe table')
  if (!UUID.test(id ?? '')) return null
  const r = await query(`SELECT * FROM ${table} WHERE id = $1 AND tenant_id = $2`, [id, ctx.tenantId])
  return r.rows[0] ?? null
}

/**
 * Loads the path's application into the request.
 *
 * Declared as router.param so that no handler can forget it, and so the
 * tenant predicate lives in exactly one place.
 */
router.param('applicationId', async (req: TenantRequest, res: Response, next: NextFunction, id: string) => {
  try {
    if (!UUID.test(id)) return notFound(res, 'Application')
    const row = await owned('applications', ctxOf(req), id)
    if (!row) return notFound(res, 'Application')
    ;(req as any).application = row as ApplicationRow
    return next()
  } catch (e) {
    return fail(res, 'load application', e)
  }
})

router.param('intakeId', async (req: TenantRequest, res: Response, next: NextFunction, id: string) => {
  try {
    if (!UUID.test(id)) return notFound(res, 'Intake')
    const row = await owned('admission_intakes', ctxOf(req), id)
    if (!row) return notFound(res, 'Intake')
    ;(req as any).intake = row
    return next()
  } catch (e) {
    return fail(res, 'load intake', e)
  }
})

router.param('applicantId', async (req: TenantRequest, res: Response, next: NextFunction, id: string) => {
  try {
    if (!UUID.test(id)) return notFound(res, 'Applicant')
    const row = await owned('applicants', ctxOf(req), id)
    if (!row) return notFound(res, 'Applicant')
    ;(req as any).applicant = row
    return next()
  } catch (e) {
    return fail(res, 'load applicant', e)
  }
})

function appOf(req: TenantRequest): ApplicationRow {
  return (req as any).application as ApplicationRow
}

// ===========================================================================
// Intakes
// ===========================================================================

router.get('/intakes', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const status = typeof req.query.status === 'string' ? req.query.status : null

    const result = await query(
      `SELECT i.*,
              y.name AS academic_year_name,
              COUNT(a.id)::int AS application_count,
              COUNT(a.id) FILTER (WHERE a.status IN ('accepted', 'enrolled'))::int AS places_taken
         FROM admission_intakes i
         LEFT JOIN academic_years y ON y.id = i.academic_year_id AND y.tenant_id = i.tenant_id
         LEFT JOIN applications a ON a.intake_id = i.id AND a.tenant_id = i.tenant_id
        WHERE i.tenant_id = $1
          AND ($2::text IS NULL OR i.status = $2::text)
        GROUP BY i.id, y.name
        ORDER BY i.opens_at DESC, i.name`,
      [ctx.tenantId, status]
    )
    return res.json({ intakes: result.rows })
  } catch (e) {
    return fail(res, 'load intakes', e)
  }
})

router.post('/intakes', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const b = req.body ?? {}
    if (!b.code || !b.name) return res.status(400).json({ error: 'code and name are required' })
    if (!b.opensAt || !b.closesAt) {
      return res.status(400).json({ error: 'opensAt and closesAt are required' })
    }

    if (b.academicYearId) {
      const year = await owned('academic_years', ctx, b.academicYearId)
      if (!year) return notFound(res, 'Academic year')
    }

    const created = await query(
      `INSERT INTO admission_intakes
         (tenant_id, academic_year_id, code, name, description, opens_at, closes_at,
          decision_by, capacity, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        ctx.tenantId, b.academicYearId || null, b.code, b.name, b.description || null,
        b.opensAt, b.closesAt, b.decisionBy || null,
        b.capacity === undefined || b.capacity === null ? null : Number(b.capacity),
        b.status || 'draft',
      ]
    )
    return res.status(201).json({ intake: created.rows[0] })
  } catch (e) {
    return fail(res, 'create intake', e)
  }
})

router.get('/intakes/:intakeId', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const intake = (req as any).intake
    const capacity = await remainingCapacity({ query }, ctx.tenantId, intake.id)
    return res.json({ intake, capacity })
  } catch (e) {
    return fail(res, 'load intake', e)
  }
})

router.patch('/intakes/:intakeId', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const intake = (req as any).intake
    const b = req.body ?? {}

    if (b.academicYearId) {
      const year = await owned('academic_years', ctx, b.academicYearId)
      if (!year) return notFound(res, 'Academic year')
    }

    const updated = await query(
      `UPDATE admission_intakes
          SET academic_year_id = COALESCE($3, academic_year_id),
              name = COALESCE($4, name),
              description = COALESCE($5, description),
              opens_at = COALESCE($6, opens_at),
              closes_at = COALESCE($7, closes_at),
              decision_by = COALESCE($8, decision_by),
              capacity = COALESCE($9, capacity),
              status = COALESCE($10, status),
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND tenant_id = $2
        RETURNING *`,
      [
        intake.id, ctx.tenantId, b.academicYearId || null, b.name || null,
        b.description ?? null, b.opensAt || null, b.closesAt || null,
        b.decisionBy || null,
        b.capacity === undefined || b.capacity === null ? null : Number(b.capacity),
        b.status || null,
      ]
    )
    return res.json({ intake: updated.rows[0] })
  } catch (e) {
    return fail(res, 'update intake', e)
  }
})

/**
 * Removing an intake.
 *
 * Refused once applications exist. An intake with applicants attached is a
 * historical record, and the way to take it out of circulation is to archive
 * it, which the status field is for.
 */
router.delete('/intakes/:intakeId', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const intake = (req as any).intake
    const used = await query(
      `SELECT 1 FROM applications WHERE intake_id = $1 AND tenant_id = $2 LIMIT 1`,
      [intake.id, ctx.tenantId]
    )
    if (used.rowCount && used.rowCount > 0) {
      return res.status(409).json({
        error: 'This intake has applications; archive it instead of deleting it',
      })
    }
    await query(`DELETE FROM admission_intakes WHERE id = $1 AND tenant_id = $2`, [
      intake.id, ctx.tenantId,
    ])
    return res.json({ deleted: true })
  } catch (e) {
    return fail(res, 'delete intake', e)
  }
})

router.get('/intakes/:intakeId/funnel', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const intake = (req as any).intake
    const funnel = await intakeFunnel(ctx.tenantId, intake.id)
    const capacity = await remainingCapacity({ query }, ctx.tenantId, intake.id)
    return res.json({ funnel, capacity })
  } catch (e) {
    return fail(res, 'load intake funnel', e)
  }
})

// ===========================================================================
// Applicants
// ===========================================================================

router.get('/applicants', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const search = typeof req.query.q === 'string' && req.query.q.trim() ? req.query.q.trim() : null
    const limit = Math.min(Number(req.query.limit) || 100, 500)

    const result = await query(
      `SELECT ap.*,
              COUNT(a.id)::int AS application_count
         FROM applicants ap
         LEFT JOIN applications a ON a.applicant_id = ap.id AND a.tenant_id = ap.tenant_id
        WHERE ap.tenant_id = $1
          AND ($2::text IS NULL OR (
                ap.first_name ILIKE '%' || $2::text || '%'
             OR ap.last_name ILIKE '%' || $2::text || '%'
             OR ap.email ILIKE '%' || $2::text || '%'
             OR ap.reference ILIKE '%' || $2::text || '%'))
        GROUP BY ap.id
        ORDER BY ap.last_name, ap.first_name
        LIMIT $3`,
      [ctx.tenantId, search, limit]
    )
    return res.json({ applicants: result.rows })
  } catch (e) {
    return fail(res, 'load applicants', e)
  }
})

router.post('/applicants', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const b = req.body ?? {}
    if (!b.firstName || !b.lastName || !b.email) {
      return res.status(400).json({ error: 'firstName, lastName and email are required' })
    }
    if (!String(b.email).includes('@')) {
      return res.status(400).json({ error: 'A valid email address is required' })
    }

    const reference = b.reference || (await allocateReference({ query }, 'applicants', ctx.tenantId, 'APP'))

    const created = await query(
      `INSERT INTO applicants
         (tenant_id, reference, first_name, middle_name, last_name, email, phone,
          date_of_birth, gender, nationality, address, prior_school, prior_qualification)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [
        ctx.tenantId, reference, b.firstName, b.middleName || null, b.lastName,
        b.email, b.phone || null, b.dateOfBirth || null, b.gender || null,
        b.nationality || null, b.address || null, b.priorSchool || null,
        b.priorQualification || null,
      ]
    )
    return res.status(201).json({ applicant: created.rows[0] })
  } catch (e) {
    return fail(res, 'create applicant', e)
  }
})

router.get('/applicants/:applicantId', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const applicant = (req as any).applicant
    const applications = await query(
      `SELECT a.*, i.name AS intake_name, i.code AS intake_code, p.name AS offered_programme_name
         FROM applications a
         JOIN admission_intakes i ON i.id = a.intake_id AND i.tenant_id = a.tenant_id
         LEFT JOIN programmes p ON p.id = a.offered_programme_id AND p.tenant_id = a.tenant_id
        WHERE a.applicant_id = $1 AND a.tenant_id = $2
        ORDER BY a.created_at DESC`,
      [applicant.id, ctx.tenantId]
    )
    return res.json({ applicant, applications: applications.rows })
  } catch (e) {
    return fail(res, 'load applicant', e)
  }
})

router.patch('/applicants/:applicantId', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const applicant = (req as any).applicant
    const b = req.body ?? {}

    const updated = await query(
      `UPDATE applicants
          SET first_name = COALESCE($3, first_name),
              middle_name = COALESCE($4, middle_name),
              last_name = COALESCE($5, last_name),
              email = COALESCE($6, email),
              phone = COALESCE($7, phone),
              date_of_birth = COALESCE($8, date_of_birth),
              gender = COALESCE($9, gender),
              nationality = COALESCE($10, nationality),
              address = COALESCE($11, address),
              prior_school = COALESCE($12, prior_school),
              prior_qualification = COALESCE($13, prior_qualification),
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND tenant_id = $2
        RETURNING *`,
      [
        applicant.id, ctx.tenantId, b.firstName || null, b.middleName ?? null,
        b.lastName || null, b.email || null, b.phone ?? null, b.dateOfBirth || null,
        b.gender ?? null, b.nationality ?? null, b.address ?? null,
        b.priorSchool ?? null, b.priorQualification ?? null,
      ]
    )
    return res.json({ applicant: updated.rows[0] })
  } catch (e) {
    return fail(res, 'update applicant', e)
  }
})

// ===========================================================================
// Applications
// ===========================================================================

router.get('/applications', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const intakeId = typeof req.query.intakeId === 'string' && UUID.test(req.query.intakeId)
      ? req.query.intakeId : null
    const status = typeof req.query.status === 'string' ? req.query.status : null
    const search = typeof req.query.q === 'string' && req.query.q.trim() ? req.query.q.trim() : null
    const limit = Math.min(Number(req.query.limit) || 200, 1000)

    const result = await query(
      `SELECT a.*,
              ap.first_name, ap.last_name, ap.email, ap.phone,
              ap.reference AS applicant_reference,
              i.name AS intake_name, i.code AS intake_code,
              p.name AS offered_programme_name, p.code AS offered_programme_code,
              s.student_id AS student_number
         FROM applications a
         JOIN applicants ap ON ap.id = a.applicant_id AND ap.tenant_id = a.tenant_id
         JOIN admission_intakes i ON i.id = a.intake_id AND i.tenant_id = a.tenant_id
         LEFT JOIN programmes p ON p.id = a.offered_programme_id AND p.tenant_id = a.tenant_id
         LEFT JOIN students s ON s.id = a.student_id AND s.tenant_id = a.tenant_id
        WHERE a.tenant_id = $1
          AND ($2::uuid IS NULL OR a.intake_id = $2::uuid)
          AND ($3::text IS NULL OR a.status = $3::text)
          AND ($4::text IS NULL OR (
                ap.first_name ILIKE '%' || $4::text || '%'
             OR ap.last_name ILIKE '%' || $4::text || '%'
             OR ap.email ILIKE '%' || $4::text || '%'
             OR a.reference ILIKE '%' || $4::text || '%'))
        ORDER BY a.created_at DESC
        LIMIT $5`,
      [ctx.tenantId, intakeId, status, search, limit]
    )
    return res.json({ applications: result.rows })
  } catch (e) {
    return fail(res, 'load applications', e)
  }
})

/**
 * Starting an application.
 *
 * Created as a draft, or submitted straight away when the registry is keying
 * in something that already arrived on paper. Either way the intake has to be
 * open before anything can be submitted into it.
 */
router.post('/applications', async (req: TenantRequest, res: Response) => {
  const client = await getConnection()
  try {
    const ctx = ctxOf(req)
    const b = req.body ?? {}
    if (!b.applicantId || !b.intakeId) {
      return res.status(400).json({ error: 'applicantId and intakeId are required' })
    }

    const applicant = await owned('applicants', ctx, b.applicantId)
    if (!applicant) return notFound(res, 'Applicant')

    const intake = await owned('admission_intakes', ctx, b.intakeId)
    if (!intake) return notFound(res, 'Intake')

    const submitNow = b.submit === true
    if (submitNow) {
      const open = intakeAcceptsSubmissions(intake)
      if (!open.ok) return res.status(409).json({ error: open.reason })
    }

    const choices: Array<{ programmeId: string; rank?: number }> = Array.isArray(b.choices)
      ? b.choices : []
    for (const choice of choices) {
      const programme = await owned('programmes', ctx, choice.programmeId)
      if (!programme) return notFound(res, 'Programme')
    }

    await client.query('BEGIN')

    const reference = b.reference
      || (await allocateReference(client, 'applications', ctx.tenantId, 'A'))

    const status: ApplicationStatus = submitNow ? 'submitted' : 'draft'

    const created = await client.query(
      `INSERT INTO applications
         (tenant_id, applicant_id, intake_id, reference, status, submitted_at)
       VALUES ($1,$2,$3,$4,$5, CASE WHEN $6::boolean THEN CURRENT_TIMESTAMP ELSE NULL END)
       RETURNING *`,
      [ctx.tenantId, applicant.id, intake.id, reference, status, submitNow]
    )
    const application = created.rows[0] as ApplicationRow

    for (let i = 0; i < choices.length; i += 1) {
      await client.query(
        `INSERT INTO application_choices
           (tenant_id, application_id, programme_id, preference_rank)
         VALUES ($1,$2,$3,$4)`,
        [ctx.tenantId, application.id, choices[i].programmeId, choices[i].rank ?? i + 1]
      )
    }

    await recordEvent(client, ctx, application.id, null, status, b.note ?? 'Application created')

    await client.query('COMMIT')
    return res.status(201).json({ application })
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined)
    return fail(res, 'create application', e)
  } finally {
    client.release()
  }
})

router.get('/applications/:applicationId', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const application = appOf(req)

    const detail = await query(
      `SELECT a.*,
              ap.first_name, ap.middle_name, ap.last_name, ap.email, ap.phone,
              ap.date_of_birth, ap.gender, ap.nationality, ap.address,
              ap.prior_school, ap.prior_qualification,
              ap.reference AS applicant_reference,
              i.name AS intake_name, i.code AS intake_code,
              i.opens_at, i.closes_at, i.decision_by, i.status AS intake_status,
              p.name AS offered_programme_name, p.code AS offered_programme_code,
              s.student_id AS student_number,
              r.full_name AS reviewed_by_name
         FROM applications a
         JOIN applicants ap ON ap.id = a.applicant_id AND ap.tenant_id = a.tenant_id
         JOIN admission_intakes i ON i.id = a.intake_id AND i.tenant_id = a.tenant_id
         LEFT JOIN programmes p ON p.id = a.offered_programme_id AND p.tenant_id = a.tenant_id
         LEFT JOIN students s ON s.id = a.student_id AND s.tenant_id = a.tenant_id
         LEFT JOIN users r ON r.id = a.reviewed_by
        WHERE a.id = $1 AND a.tenant_id = $2`,
      [application.id, ctx.tenantId]
    )

    const choices = await query(
      `SELECT c.*, p.code AS programme_code, p.name AS programme_name
         FROM application_choices c
         JOIN programmes p ON p.id = c.programme_id AND p.tenant_id = c.tenant_id
        WHERE c.application_id = $1 AND c.tenant_id = $2
        ORDER BY c.preference_rank`,
      [application.id, ctx.tenantId]
    )

    const documents = await query(
      `SELECT d.*, u.full_name AS verified_by_name
         FROM application_documents d
         LEFT JOIN users u ON u.id = d.verified_by
        WHERE d.application_id = $1 AND d.tenant_id = $2
        ORDER BY d.is_required DESC, d.label`,
      [application.id, ctx.tenantId]
    )

    return res.json({
      application: detail.rows[0],
      choices: choices.rows,
      documents: documents.rows,
      allowedTransitions: nextStatuses(application.status),
    })
  } catch (e) {
    return fail(res, 'load application', e)
  }
})

router.get('/applications/:applicationId/events', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const application = appOf(req)
    const events = await query(
      `SELECT e.*, u.full_name AS actor_name
         FROM application_events e
         LEFT JOIN users u ON u.id = e.actor_id
        WHERE e.application_id = $1 AND e.tenant_id = $2
        ORDER BY e.occurred_at DESC`,
      [application.id, ctx.tenantId]
    )
    return res.json({ events: events.rows })
  } catch (e) {
    return fail(res, 'load application events', e)
  }
})

/**
 * Moving an application.
 *
 * The only route that changes status, so the state machine is enforced in one
 * place and the trail is written in the same transaction as the change.
 */
router.post('/applications/:applicationId/transition', async (req: TenantRequest, res: Response) => {
  const client = await getConnection()
  try {
    const ctx = ctxOf(req)
    const application = appOf(req)
    const b = req.body ?? {}
    if (!b.to) return res.status(400).json({ error: 'to is required' })

    // Submitting into a closed intake is refused here as well as at creation,
    // because a draft can sit around until after the deadline.
    if (b.to === 'submitted') {
      const intake = await owned('admission_intakes', ctx, application.intake_id)
      if (!intake) return notFound(res, 'Intake')
      const open = intakeAcceptsSubmissions(intake)
      if (!open.ok) return res.status(409).json({ error: open.reason })
    }

    // An offer that would take the intake past its capacity is refused rather
    // than made and later withdrawn.
    if (b.to === 'offer' && b.force !== true) {
      const capacity = await remainingCapacity({ query }, ctx.tenantId, application.intake_id)
      if (capacity.remaining !== null && capacity.remaining <= 0) {
        return res.status(409).json({
          error: `This intake is full (${capacity.taken} of ${capacity.capacity} places committed)`,
        })
      }
    }

    await client.query('BEGIN')
    const updated = await transition(client, ctx, application, {
      to: b.to as ApplicationStatus,
      note: b.note ?? null,
      offeredProgrammeId: b.offeredProgrammeId ?? null,
      offerExpiresAt: b.offerExpiresAt ?? null,
    })
    await client.query('COMMIT')

    return res.json({
      application: updated,
      allowedTransitions: nextStatuses(updated.status),
    })
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined)
    return fail(res, 'update application status', e)
  } finally {
    client.release()
  }
})

/**
 * Enrolment.
 *
 * Creates the login, the student record, the school association and the
 * programme enrolment in one transaction, then marks the application enrolled.
 * The temporary password is returned once, here, and never stored in readable
 * form — the account is flagged must_reset_password.
 */
router.post('/applications/:applicationId/enrol', async (req: TenantRequest, res: Response) => {
  const client = await getConnection()
  try {
    const ctx = ctxOf(req)
    const application = appOf(req)
    const b = req.body ?? {}

    if (b.programmeId && !UUID.test(b.programmeId)) {
      return res.status(400).json({ error: 'programmeId must be an identifier' })
    }

    await client.query('BEGIN')
    const result = await enrolApplicant(client, ctx, application, {
      studentId: b.studentId,
      programmeId: b.programmeId,
      academicYearId: b.academicYearId ?? null,
      departmentId: b.departmentId ?? null,
      college: b.college,
      entryYear: b.entryYear !== undefined ? Number(b.entryYear) : undefined,
      note: b.note ?? null,
    })
    await client.query('COMMIT')

    return res.status(201).json({
      application: result.application,
      student: {
        id: result.studentId,
        userId: result.userId,
        studentId: result.studentNumber,
      },
      temporaryPassword: result.temporaryPassword,
    })
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined)
    return fail(res, 'enrol applicant', e)
  } finally {
    client.release()
  }
})

// ===========================================================================
// Programme choices
// ===========================================================================

router.get('/applications/:applicationId/choices', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const application = appOf(req)
    const rows = await query(
      `SELECT c.*, p.code AS programme_code, p.name AS programme_name
         FROM application_choices c
         JOIN programmes p ON p.id = c.programme_id AND p.tenant_id = c.tenant_id
        WHERE c.application_id = $1 AND c.tenant_id = $2
        ORDER BY c.preference_rank`,
      [application.id, ctx.tenantId]
    )
    return res.json({ choices: rows.rows })
  } catch (e) {
    return fail(res, 'load application choices', e)
  }
})

router.post('/applications/:applicationId/choices', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const application = appOf(req)
    const b = req.body ?? {}
    if (!b.programmeId) return res.status(400).json({ error: 'programmeId is required' })

    const programme = await owned('programmes', ctx, b.programmeId)
    if (!programme) return notFound(res, 'Programme')

    const rank = b.rank !== undefined && b.rank !== null ? Number(b.rank) : null
    const nextRank = rank ?? (await query(
      `SELECT COALESCE(MAX(preference_rank), 0) + 1 AS n
         FROM application_choices WHERE application_id = $1 AND tenant_id = $2`,
      [application.id, ctx.tenantId]
    )).rows[0].n

    const created = await query(
      `INSERT INTO application_choices
         (tenant_id, application_id, programme_id, preference_rank)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [ctx.tenantId, application.id, programme.id, nextRank]
    )
    return res.status(201).json({ choice: created.rows[0] })
  } catch (e) {
    return fail(res, 'add application choice', e)
  }
})

router.delete('/applications/:applicationId/choices/:choiceId', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const application = appOf(req)
    const { choiceId } = req.params
    if (!UUID.test(choiceId)) return notFound(res, 'Choice')

    const removed = await query(
      `DELETE FROM application_choices
        WHERE id = $1 AND application_id = $2 AND tenant_id = $3 RETURNING id`,
      [choiceId, application.id, ctx.tenantId]
    )
    if (removed.rowCount === 0) return notFound(res, 'Choice')
    return res.json({ deleted: true })
  } catch (e) {
    return fail(res, 'remove application choice', e)
  }
})

// ===========================================================================
// Documents
// ===========================================================================

router.get('/applications/:applicationId/documents', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const application = appOf(req)
    const rows = await query(
      `SELECT d.*, u.full_name AS verified_by_name
         FROM application_documents d
         LEFT JOIN users u ON u.id = d.verified_by
        WHERE d.application_id = $1 AND d.tenant_id = $2
        ORDER BY d.is_required DESC, d.label`,
      [application.id, ctx.tenantId]
    )
    return res.json({ documents: rows.rows })
  } catch (e) {
    return fail(res, 'load application documents', e)
  }
})

router.post('/applications/:applicationId/documents', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const application = appOf(req)
    const b = req.body ?? {}
    if (!b.kind || !b.label) return res.status(400).json({ error: 'kind and label are required' })

    const status = b.fileUrl ? (b.status || 'received') : 'awaited'
    if (status !== 'awaited' && !b.fileUrl) {
      return res.status(400).json({ error: 'A document that is not awaited must have a fileUrl' })
    }

    const created = await query(
      `INSERT INTO application_documents
         (tenant_id, application_id, kind, label, file_url, is_required, status, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        ctx.tenantId, application.id, b.kind, b.label, b.fileUrl || null,
        b.isRequired !== undefined ? !!b.isRequired : true, status, b.note || null,
      ]
    )
    return res.status(201).json({ document: created.rows[0] })
  } catch (e) {
    return fail(res, 'add application document', e)
  }
})

router.patch('/applications/:applicationId/documents/:documentId', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const application = appOf(req)
    const { documentId } = req.params
    if (!UUID.test(documentId)) return notFound(res, 'Document')
    const b = req.body ?? {}

    // Verification records who did it; the rest of the fields do not.
    const verifying = b.status === 'verified' || b.status === 'rejected'

    const updated = await query(
      `UPDATE application_documents
          SET file_url = COALESCE($4, file_url),
              status = COALESCE($5, status),
              note = COALESCE($6, note),
              is_required = COALESCE($7, is_required),
              verified_by = ${verifying ? '$8' : 'verified_by'},
              verified_at = ${verifying ? 'CURRENT_TIMESTAMP' : 'verified_at'}
        WHERE id = $1 AND application_id = $2 AND tenant_id = $3
        RETURNING *`,
      verifying
        ? [
            documentId, application.id, ctx.tenantId, b.fileUrl || null,
            b.status || null, b.note ?? null,
            b.isRequired === undefined ? null : !!b.isRequired, ctx.userId,
          ]
        : [
            documentId, application.id, ctx.tenantId, b.fileUrl || null,
            b.status || null, b.note ?? null,
            b.isRequired === undefined ? null : !!b.isRequired,
          ]
    )
    if (updated.rowCount === 0) return notFound(res, 'Document')
    return res.json({ document: updated.rows[0] })
  } catch (e) {
    return fail(res, 'update application document', e)
  }
})

router.delete('/applications/:applicationId/documents/:documentId', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const application = appOf(req)
    const { documentId } = req.params
    if (!UUID.test(documentId)) return notFound(res, 'Document')

    const removed = await query(
      `DELETE FROM application_documents
        WHERE id = $1 AND application_id = $2 AND tenant_id = $3 RETURNING id`,
      [documentId, application.id, ctx.tenantId]
    )
    if (removed.rowCount === 0) return notFound(res, 'Document')
    return res.json({ deleted: true })
  } catch (e) {
    return fail(res, 'remove application document', e)
  }
})

// ===========================================================================
// Overview
// ===========================================================================

/** The admissions dashboard: open cycles and where the work is queued. */
router.get('/overview', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)

    const byStatus = await query(
      `SELECT status, COUNT(*)::int AS n FROM applications WHERE tenant_id = $1 GROUP BY status`,
      [ctx.tenantId]
    )

    const openIntakes = await query(
      `SELECT i.id, i.code, i.name, i.opens_at, i.closes_at, i.capacity,
              COUNT(a.id)::int AS application_count,
              COUNT(a.id) FILTER (WHERE a.status IN ('accepted', 'enrolled'))::int AS places_taken
         FROM admission_intakes i
         LEFT JOIN applications a ON a.intake_id = i.id AND a.tenant_id = i.tenant_id
        WHERE i.tenant_id = $1 AND i.status = 'open'
        GROUP BY i.id
        ORDER BY i.closes_at`,
      [ctx.tenantId]
    )

    const awaitingDecision = await query(
      `SELECT COUNT(*)::int AS n FROM applications
        WHERE tenant_id = $1 AND status IN ('submitted', 'under_review')`,
      [ctx.tenantId]
    )

    const offersOutstanding = await query(
      `SELECT COUNT(*)::int AS n FROM applications WHERE tenant_id = $1 AND status = 'offer'`,
      [ctx.tenantId]
    )

    const readyToEnrol = await query(
      `SELECT COUNT(*)::int AS n FROM applications WHERE tenant_id = $1 AND status = 'accepted'`,
      [ctx.tenantId]
    )

    const counts: Record<string, number> = {}
    for (const r of byStatus.rows) counts[r.status] = Number(r.n)

    return res.json({
      byStatus: counts,
      total: Object.values(counts).reduce((a, b) => a + b, 0),
      openIntakes: openIntakes.rows,
      awaitingDecision: awaitingDecision.rows[0].n,
      offersOutstanding: offersOutstanding.rows[0].n,
      readyToEnrol: readyToEnrol.rows[0].n,
    })
  } catch (e) {
    return fail(res, 'load admissions overview', e)
  }
})

export default router
