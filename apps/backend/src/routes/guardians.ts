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
import { sendInvitation, unusablePasswordHash, AccountTokenError } from '../auth/accountTokens.js'
import { logAudit } from '../services/domainAuditService.js'
import { getClientIp } from '../utils/getClientIp.js'

/**
 * SMS — guardians, as the school's administrators manage them.
 *
 *   GET    /api/guardians                         list, with ?search= and ?studentId=
 *   POST   /api/guardians                         record a guardian (optionally linked)
 *   GET    /api/guardians/:guardianId             one guardian and their children
 *   PATCH  /api/guardians/:guardianId             correct their details
 *   DELETE /api/guardians/:guardianId             remove them from the school
 *   POST   /api/guardians/:guardianId/students    link a student
 *   PATCH  /api/guardians/:guardianId/students/:linkId   change a link's access
 *   DELETE /api/guardians/:guardianId/students/:linkId   unlink
 *   POST   /api/guardians/:guardianId/invitation  give them a portal account
 *
 * Guardians are recorded before they are invited. A school's first contact
 * with a parent is a name and a phone number on an admission form, and the
 * absence alerts and fee notices go to that number whether or not the parent
 * ever signs in. An account is an optional second step.
 *
 * Every read and write is confined to the administrator's school by
 * tenant_id; the database refuses a link between two schools independently
 * (migration 062). A guardian or link id from another school answers 404,
 * the same as one that does not exist.
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

function ctxOf(req: TenantRequest): Ctx {
  return req.ctx as Ctx
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const RELATIONSHIPS = [
  'mother', 'father', 'parent', 'guardian', 'grandparent', 'sibling', 'relative', 'sponsor', 'other',
] as const

const LINK_FLAGS = [
  'can_view_attendance', 'can_view_results', 'can_view_fees', 'receives_notifications',
] as const

class InputError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
  }
}

function fail(res: Response, label: string, e: unknown) {
  if (e instanceof InputError) return res.status(e.status).json({ error: e.message })
  if (e instanceof AccountTokenError) return res.status(e.status).json({ error: e.message })
  const err = e as { code?: string; constraint?: string }
  if (err.code === '23505') {
    if (err.constraint === 'idx_guardian_students_one_primary') {
      return res.status(409).json({ error: 'That student already has a primary contact' })
    }
    if (err.constraint === 'guardian_students_unique') {
      return res.status(409).json({ error: 'That guardian is already linked to that student' })
    }
    return res.status(409).json({ error: 'A guardian with that email address is already recorded at your school' })
  }
  if (err.code === '23514') {
    return res.status(400).json({ error: 'The values supplied are outside what this record allows' })
  }
  console.error(`[GUARDIANS] ${label}:`, e)
  return res.status(500).json({ error: `Failed to ${label}` })
}

function notFound(res: Response, what: string) {
  return res.status(404).json({ error: `${what} not found` })
}

/** Trimmed text or null; refuses anything longer than the column allows. */
function text(value: unknown, label: string, max: number): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new InputError(`${label} must be text`)
  const trimmed = value.trim()
  if (trimmed.length > max) throw new InputError(`${label} must be at most ${max} characters`)
  return trimmed || null
}

interface GuardianInput {
  first_name: string
  last_name: string
  email: string | null
  phone: string | null
  address: string | null
  occupation: string | null
  notes: string | null
}

/**
 * Reads the guardian fields present in a body. With `partial`, absent fields
 * are left out rather than defaulted, so a PATCH only changes what it names.
 */
function guardianInput(body: any, partial: boolean): Partial<GuardianInput> {
  const out: Partial<GuardianInput> = {}
  const fields: Array<[keyof GuardianInput, string, string, number]> = [
    ['first_name', 'firstName', 'First name', 100],
    ['last_name', 'lastName', 'Last name', 100],
    ['email', 'email', 'Email', 255],
    ['phone', 'phone', 'Phone', 30],
    ['address', 'address', 'Address', 500],
    ['occupation', 'occupation', 'Occupation', 150],
    ['notes', 'notes', 'Notes', 2000],
  ]
  for (const [column, key, label, max] of fields) {
    if (partial && !(key in (body ?? {}))) continue
    ;(out as any)[column] = text(body?.[key], label, max)
  }
  if (!partial || 'firstName' in body) {
    if (!out.first_name) throw new InputError('First name is required')
  }
  if (!partial || 'lastName' in body) {
    if (!out.last_name) throw new InputError('Last name is required')
  }
  if (out.email) {
    if (!EMAIL.test(out.email)) throw new InputError('Email is not a valid address')
    out.email = out.email.toLowerCase()
  }
  return out
}

interface LinkInput {
  relationship?: string
  is_primary?: boolean
  can_view_attendance?: boolean
  can_view_results?: boolean
  can_view_fees?: boolean
  receives_notifications?: boolean
}

const LINK_KEYS: Record<string, keyof LinkInput> = {
  relationship: 'relationship',
  isPrimary: 'is_primary',
  canViewAttendance: 'can_view_attendance',
  canViewResults: 'can_view_results',
  canViewFees: 'can_view_fees',
  receivesNotifications: 'receives_notifications',
}

function linkInput(body: any): LinkInput {
  const out: LinkInput = {}
  for (const [key, column] of Object.entries(LINK_KEYS)) {
    if (!(key in (body ?? {}))) continue
    const value = body[key]
    if (column === 'relationship') {
      if (!RELATIONSHIPS.includes(value)) {
        throw new InputError(`Relationship must be one of: ${RELATIONSHIPS.join(', ')}`)
      }
      out.relationship = value
    } else {
      if (typeof value !== 'boolean') throw new InputError(`${key} must be true or false`)
      ;(out as any)[column] = value
    }
  }
  return out
}

async function ownedGuardian(ctx: Ctx, id: string): Promise<any | null> {
  if (!UUID.test(id)) return null
  const r = await query(`SELECT * FROM guardians WHERE id = $1 AND tenant_id = $2`, [id, ctx.tenantId])
  return r.rows[0] ?? null
}

async function ownedStudent(ctx: Ctx, id: unknown): Promise<any | null> {
  if (typeof id !== 'string' || !UUID.test(id)) return null
  const r = await query(`SELECT * FROM students WHERE id = $1 AND tenant_id = $2`, [id, ctx.tenantId])
  return r.rows[0] ?? null
}

/** A guardian with their links, in the shape every response uses. */
async function guardianView(tenantId: string, guardianId: string) {
  const g = await query(
    `SELECT g.*, u.is_active AS account_active, u.last_login AS account_last_login,
            u.activated_at AS account_activated_at
       FROM guardians g
       LEFT JOIN users u ON u.id = g.user_id
      WHERE g.id = $1 AND g.tenant_id = $2`,
    [guardianId, tenantId]
  )
  if (g.rowCount === 0) return null
  const links = await query(
    `SELECT gs.id, gs.student_id, gs.relationship, gs.is_primary,
            gs.can_view_attendance, gs.can_view_results, gs.can_view_fees,
            gs.receives_notifications, gs.created_at,
            s.student_id AS student_number, s.first_name, s.last_name, s.status AS student_status
       FROM guardian_students gs
       JOIN students s ON s.id = gs.student_id AND s.tenant_id = gs.tenant_id
      WHERE gs.guardian_id = $1 AND gs.tenant_id = $2
      ORDER BY s.last_name, s.first_name`,
    [guardianId, tenantId]
  )
  return { ...presentGuardian(g.rows[0]), students: links.rows }
}

/** Says where an account stands in words a school office uses. */
function accountState(row: any): 'none' | 'invited' | 'active' | 'disabled' {
  if (!row.user_id) return 'none'
  if (row.account_active === false) return 'disabled'
  return row.account_last_login ? 'active' : 'invited'
}

function presentGuardian(row: any) {
  const { account_active, account_last_login, account_activated_at, ...rest } = row
  return { ...rest, account: accountState(row), last_login: account_last_login ?? null }
}

// ---------------------------------------------------------------------------
// Guardians
// ---------------------------------------------------------------------------

router.get('/', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : ''
    const studentId = typeof req.query.studentId === 'string' ? req.query.studentId : null
    if (studentId && !UUID.test(studentId)) return notFound(res, 'Student')

    const r = await query(
      `SELECT g.*, u.is_active AS account_active, u.last_login AS account_last_login,
              COUNT(gs.id)::int AS student_count,
              COALESCE(
                json_agg(json_build_object(
                  'link_id', gs.id, 'student_id', s.id, 'student_number', s.student_id,
                  'first_name', s.first_name, 'last_name', s.last_name,
                  'relationship', gs.relationship, 'is_primary', gs.is_primary)
                  ORDER BY s.last_name, s.first_name)
                FILTER (WHERE gs.id IS NOT NULL), '[]') AS students
         FROM guardians g
         LEFT JOIN users u ON u.id = g.user_id
         LEFT JOIN guardian_students gs ON gs.guardian_id = g.id AND gs.tenant_id = g.tenant_id
         LEFT JOIN students s ON s.id = gs.student_id AND s.tenant_id = gs.tenant_id
        WHERE g.tenant_id = $1
          AND ($2 = '' OR g.first_name ILIKE '%' || $2 || '%' OR g.last_name ILIKE '%' || $2 || '%'
               OR g.email ILIKE '%' || $2 || '%' OR g.phone ILIKE '%' || $2 || '%'
               OR (g.first_name || ' ' || g.last_name) ILIKE '%' || $2 || '%'
               OR EXISTS (SELECT 1 FROM guardian_students gs2
                            JOIN students s2 ON s2.id = gs2.student_id AND s2.tenant_id = gs2.tenant_id
                           WHERE gs2.guardian_id = g.id AND gs2.tenant_id = g.tenant_id
                             AND ((s2.first_name || ' ' || s2.last_name) ILIKE '%' || $2 || '%'
                                  OR s2.student_id ILIKE '%' || $2 || '%')))
          AND ($3::uuid IS NULL OR EXISTS (
                SELECT 1 FROM guardian_students gs3
                 WHERE gs3.guardian_id = g.id AND gs3.tenant_id = g.tenant_id AND gs3.student_id = $3::uuid))
        GROUP BY g.id, u.is_active, u.last_login
        ORDER BY g.last_name, g.first_name
        LIMIT 500`,
      [ctx.tenantId, search, studentId]
    )
    return res.json({ guardians: r.rows.map(presentGuardian) })
  } catch (e) {
    return fail(res, 'list guardians', e)
  }
})

router.post('/', async (req: TenantRequest, res: Response) => {
  const client = await getConnection()
  try {
    const ctx = ctxOf(req)
    const input = guardianInput(req.body, false) as GuardianInput
    if (!input.email && !input.phone) {
      throw new InputError('Give an email address or a phone number, so the school can reach them')
    }

    // Links may be made in the same request, so that recording a parent from
    // a student's page is one step. Each is checked before anything is saved.
    const rawLinks: any[] = Array.isArray(req.body?.students) ? req.body.students : []
    if (rawLinks.length > 20) throw new InputError('At most 20 students can be linked at once')
    const links: Array<{ student: any; link: LinkInput }> = []
    for (const raw of rawLinks) {
      const student = await ownedStudent(ctx, raw?.studentId)
      if (!student) throw new InputError('Student not found', 404)
      links.push({ student, link: linkInput(raw) })
    }

    await client.query('BEGIN')
    const created = await client.query(
      `INSERT INTO guardians (tenant_id, first_name, last_name, email, phone, address, occupation, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [ctx.tenantId, input.first_name, input.last_name, input.email, input.phone,
       input.address, input.occupation, input.notes, ctx.userId]
    )
    const guardianId = created.rows[0].id
    for (const { student, link } of links) {
      await insertLink(client, ctx, guardianId, student.id, link)
    }
    await logAudit({
      actorId: ctx.userId, actorRole: ctx.roleName, actionType: 'GUARDIAN_CREATED',
      actionScope: 'TENANT', resourceType: 'guardian', resourceId: guardianId, tenantId: ctx.tenantId,
      afterState: { students: links.map((l) => l.student.id) }, ipAddress: getClientIp(req),
    })
    await client.query('COMMIT')

    return res.status(201).json({ guardian: await guardianView(ctx.tenantId, guardianId) })
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    return fail(res, 'record the guardian', e)
  } finally {
    client.release()
  }
})

router.get('/:guardianId', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    if (!(await ownedGuardian(ctx, req.params.guardianId))) return notFound(res, 'Guardian')
    return res.json({ guardian: await guardianView(ctx.tenantId, req.params.guardianId) })
  } catch (e) {
    return fail(res, 'load the guardian', e)
  }
})

/**
 * Refuses an email that already signs somebody else in on the school
 * platform. Sign-in finds an account by email and platform, so two school
 * accounts sharing an address would leave one of them unable to sign in.
 */
async function assertEmailUsableForGuardian(
  runner: { query: typeof query },
  email: string,
  platformId: string,
  exceptUserId: string | null
): Promise<any | null> {
  const r = await runner.query(
    `SELECT u.id, u.is_active, u.last_login, r.name AS role_name
       FROM users u JOIN roles r ON r.id = u.role_id
      WHERE LOWER(u.email) = LOWER($1) AND u.platform_id = $2
        AND ($3::uuid IS NULL OR u.id <> $3::uuid)`,
    [email, platformId, exceptUserId]
  )
  const other = r.rows.find((row: any) => row.role_name !== 'guardian')
  if (other) {
    throw new InputError(
      'That email address already signs in to another school account, so it cannot also be a guardian login. Use a different address.',
      409
    )
  }
  return r.rows[0] ?? null
}

router.patch('/:guardianId', async (req: TenantRequest, res: Response) => {
  const client = await getConnection()
  try {
    const ctx = ctxOf(req)
    const guardian = await ownedGuardian(ctx, req.params.guardianId)
    if (!guardian) return notFound(res, 'Guardian')

    const changes = guardianInput(req.body ?? {}, true)
    const columns = Object.keys(changes)
    if (columns.length === 0) return res.status(400).json({ error: 'Nothing to change' })

    const nextEmail = 'email' in changes ? changes.email : guardian.email
    const nextPhone = 'phone' in changes ? changes.phone : guardian.phone
    if (!nextEmail && !nextPhone) {
      throw new InputError('A guardian needs an email address or a phone number')
    }
    // Their account signs in with this address, so it cannot be removed.
    if (guardian.user_id && 'email' in changes && !changes.email) {
      throw new InputError('This guardian has a portal account, which needs an email address')
    }

    await client.query('BEGIN')
    const sets = columns.map((c, i) => `${c} = $${i + 3}`)
    await client.query(
      `UPDATE guardians SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND tenant_id = $2`,
      [guardian.id, ctx.tenantId, ...columns.map((c) => (changes as any)[c])]
    )

    // Their account carries the same name, phone and address; keep it true.
    if (guardian.user_id) {
      if (changes.email && changes.email !== guardian.email?.toLowerCase()) {
        const clash = await assertEmailUsableForGuardian(client, changes.email, ctx.platformId, guardian.user_id)
        if (clash) {
          throw new InputError('Another guardian account already uses that email address', 409)
        }
      }
      const g = await client.query(`SELECT * FROM guardians WHERE id = $1`, [guardian.id])
      const row = g.rows[0]
      await client.query(
        `UPDATE users SET email = $2, full_name = $3, phone = $4, updated_at = CURRENT_TIMESTAMP
          WHERE id = $1`,
        [guardian.user_id, row.email, `${row.first_name} ${row.last_name}`, row.phone?.slice(0, 20) ?? null]
      )
    }

    await logAudit({
      actorId: ctx.userId, actorRole: ctx.roleName, actionType: 'GUARDIAN_UPDATED',
      actionScope: 'TENANT', resourceType: 'guardian', resourceId: guardian.id, tenantId: ctx.tenantId,
      beforeState: Object.fromEntries(columns.map((c) => [c, guardian[c]])),
      afterState: changes, ipAddress: getClientIp(req),
    })
    await client.query('COMMIT')
    return res.json({ guardian: await guardianView(ctx.tenantId, guardian.id) })
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    return fail(res, 'update the guardian', e)
  } finally {
    client.release()
  }
})

/**
 * Removes a guardian from the school.
 *
 * Their record and links go. Their account, if they have one, loses this
 * school; it is deactivated only when it belongs to no other school, since a
 * parent may have children at two.
 */
router.delete('/:guardianId', async (req: TenantRequest, res: Response) => {
  const client = await getConnection()
  try {
    const ctx = ctxOf(req)
    const guardian = await ownedGuardian(ctx, req.params.guardianId)
    if (!guardian) return notFound(res, 'Guardian')

    await client.query('BEGIN')
    await client.query(`DELETE FROM guardians WHERE id = $1 AND tenant_id = $2`, [guardian.id, ctx.tenantId])
    let deactivated = false
    if (guardian.user_id) {
      await client.query(
        `DELETE FROM school_user_associations WHERE user_id = $1 AND school_entity_id = $2`,
        [guardian.user_id, ctx.tenantId]
      )
      const elsewhere = await client.query(
        `SELECT 1 FROM user_tenant_memberships WHERE user_id = $1 AND status = 'active' LIMIT 1`,
        [guardian.user_id]
      )
      if (elsewhere.rowCount === 0) {
        await client.query(
          `UPDATE users SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
          [guardian.user_id]
        )
        deactivated = true
      }
    }
    await logAudit({
      actorId: ctx.userId, actorRole: ctx.roleName, actionType: 'GUARDIAN_REMOVED',
      actionScope: 'TENANT', resourceType: 'guardian', resourceId: guardian.id, tenantId: ctx.tenantId,
      beforeState: { name: `${guardian.first_name} ${guardian.last_name}`, userId: guardian.user_id },
      afterState: { accountDeactivated: deactivated }, ipAddress: getClientIp(req),
    })
    await client.query('COMMIT')
    return res.json({ removed: true, accountDeactivated: deactivated })
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    return fail(res, 'remove the guardian', e)
  } finally {
    client.release()
  }
})

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

type Runner = { query: (text: string, params?: any[]) => Promise<any> }

async function insertLink(runner: Runner, ctx: Ctx, guardianId: string, studentId: string, link: LinkInput) {
  // One primary contact per student: naming a new one demotes the old, which
  // is what an office means when it says "call her first from now on".
  if (link.is_primary) {
    await runner.query(
      `UPDATE guardian_students SET is_primary = FALSE, updated_at = CURRENT_TIMESTAMP
        WHERE student_id = $1 AND tenant_id = $2 AND is_primary`,
      [studentId, ctx.tenantId]
    )
  }
  const r = await runner.query(
    `INSERT INTO guardian_students
       (tenant_id, guardian_id, student_id, relationship, is_primary,
        can_view_attendance, can_view_results, can_view_fees, receives_notifications, created_by)
     VALUES ($1, $2, $3, COALESCE($4, 'guardian'), COALESCE($5, FALSE),
             COALESCE($6, TRUE), COALESCE($7, TRUE), COALESCE($8, TRUE), COALESCE($9, TRUE), $10)
     RETURNING id`,
    [ctx.tenantId, guardianId, studentId, link.relationship ?? null, link.is_primary ?? null,
     link.can_view_attendance ?? null, link.can_view_results ?? null, link.can_view_fees ?? null,
     link.receives_notifications ?? null, ctx.userId]
  )
  return r.rows[0].id as string
}

router.post('/:guardianId/students', async (req: TenantRequest, res: Response) => {
  const client = await getConnection()
  try {
    const ctx = ctxOf(req)
    const guardian = await ownedGuardian(ctx, req.params.guardianId)
    if (!guardian) return notFound(res, 'Guardian')
    const student = await ownedStudent(ctx, req.body?.studentId)
    if (!student) return notFound(res, 'Student')
    const link = linkInput(req.body)

    await client.query('BEGIN')
    const linkId = await insertLink(client, ctx, guardian.id, student.id, link)
    await logAudit({
      actorId: ctx.userId, actorRole: ctx.roleName, actionType: 'GUARDIAN_LINKED',
      actionScope: 'TENANT', resourceType: 'guardian', resourceId: guardian.id, tenantId: ctx.tenantId,
      afterState: { linkId, studentId: student.id, ...link }, ipAddress: getClientIp(req),
    })
    await client.query('COMMIT')
    return res.status(201).json({ guardian: await guardianView(ctx.tenantId, guardian.id), linkId })
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    return fail(res, 'link the student', e)
  } finally {
    client.release()
  }
})

async function ownedLink(ctx: Ctx, guardianId: string, linkId: string): Promise<any | null> {
  if (!UUID.test(linkId)) return null
  const r = await query(
    `SELECT * FROM guardian_students WHERE id = $1 AND guardian_id = $2 AND tenant_id = $3`,
    [linkId, guardianId, ctx.tenantId]
  )
  return r.rows[0] ?? null
}

router.patch('/:guardianId/students/:linkId', async (req: TenantRequest, res: Response) => {
  const client = await getConnection()
  try {
    const ctx = ctxOf(req)
    const guardian = await ownedGuardian(ctx, req.params.guardianId)
    if (!guardian) return notFound(res, 'Guardian')
    const existing = await ownedLink(ctx, guardian.id, req.params.linkId)
    if (!existing) return notFound(res, 'Link')

    const changes = linkInput(req.body)
    const columns = Object.keys(changes) as Array<keyof LinkInput>
    if (columns.length === 0) return res.status(400).json({ error: 'Nothing to change' })

    await client.query('BEGIN')
    if (changes.is_primary) {
      await client.query(
        `UPDATE guardian_students SET is_primary = FALSE, updated_at = CURRENT_TIMESTAMP
          WHERE student_id = $1 AND tenant_id = $2 AND is_primary AND id <> $3`,
        [existing.student_id, ctx.tenantId, existing.id]
      )
    }
    const sets = columns.map((c, i) => `${c} = $${i + 3}`)
    await client.query(
      `UPDATE guardian_students SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND tenant_id = $2`,
      [existing.id, ctx.tenantId, ...columns.map((c) => changes[c])]
    )
    await logAudit({
      actorId: ctx.userId, actorRole: ctx.roleName, actionType: 'GUARDIAN_ACCESS_CHANGED',
      actionScope: 'TENANT', resourceType: 'guardian', resourceId: guardian.id, tenantId: ctx.tenantId,
      beforeState: Object.fromEntries(columns.map((c) => [c, existing[c]])),
      afterState: { linkId: existing.id, studentId: existing.student_id, ...changes },
      ipAddress: getClientIp(req),
    })
    await client.query('COMMIT')
    return res.json({ guardian: await guardianView(ctx.tenantId, guardian.id) })
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    return fail(res, 'change the link', e)
  } finally {
    client.release()
  }
})

router.delete('/:guardianId/students/:linkId', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const guardian = await ownedGuardian(ctx, req.params.guardianId)
    if (!guardian) return notFound(res, 'Guardian')
    const existing = await ownedLink(ctx, guardian.id, req.params.linkId)
    if (!existing) return notFound(res, 'Link')

    await query(`DELETE FROM guardian_students WHERE id = $1 AND tenant_id = $2`, [existing.id, ctx.tenantId])
    await logAudit({
      actorId: ctx.userId, actorRole: ctx.roleName, actionType: 'GUARDIAN_UNLINKED',
      actionScope: 'TENANT', resourceType: 'guardian', resourceId: guardian.id, tenantId: ctx.tenantId,
      beforeState: { linkId: existing.id, studentId: existing.student_id }, ipAddress: getClientIp(req),
    }).catch((e) => console.error('[GUARDIANS] audit failed:', e))
    return res.json({ guardian: await guardianView(ctx.tenantId, guardian.id) })
  } catch (e) {
    return fail(res, 'unlink the student', e)
  }
})

// ---------------------------------------------------------------------------
// Portal account
// ---------------------------------------------------------------------------

/**
 * Gives a guardian a parent-portal account, or re-sends the invitation.
 *
 * Nobody chooses another person's password: the account starts with one
 * nobody knows and the guardian sets their own from a single-use link,
 * emailed or (with `handover`) returned for the office to pass on.
 *
 * A parent already holding a guardian account at another school keeps that
 * one account; this school is added to it. If they have already signed in,
 * there is nothing to invite them to — they simply see this school's
 * children next time.
 */
router.post('/:guardianId/invitation', async (req: TenantRequest, res: Response) => {
  const client = await getConnection()
  try {
    const ctx = ctxOf(req)
    const guardian = await ownedGuardian(ctx, req.params.guardianId)
    if (!guardian) return notFound(res, 'Guardian')
    if (!guardian.email) {
      throw new InputError('Add an email address for this guardian first; their account signs in with it')
    }
    const handover = req.body?.handover === true

    await client.query('BEGIN')
    let userId: string = guardian.user_id
    let reusedAccount = false
    if (!userId) {
      const existing = await assertEmailUsableForGuardian(client, guardian.email, ctx.platformId, null)
      if (existing) {
        userId = existing.id
        reusedAccount = true
        await client.query(`UPDATE users SET is_active = TRUE, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [userId])
      } else {
        const role = await client.query(
          `SELECT id FROM roles WHERE name = 'guardian' AND platform_id = $1`, [ctx.platformId])
        if (role.rowCount === 0) throw new InputError('The guardian role is not set up on this platform', 500)
        const created = await client.query(
          `INSERT INTO users (email, full_name, phone, platform_id, role_id, is_active,
                              password_hash, must_reset_password)
           VALUES ($1, $2, $3, $4, $5, TRUE, $6, FALSE) RETURNING id`,
          [guardian.email, `${guardian.first_name} ${guardian.last_name}`,
           guardian.phone?.slice(0, 20) ?? null, ctx.platformId, role.rows[0].id,
           await unusablePasswordHash()]
        )
        userId = created.rows[0].id
      }
      await client.query(
        `INSERT INTO school_user_associations (user_id, school_entity_id, status)
         VALUES ($1, $2, 'active')
         ON CONFLICT (user_id, school_entity_id) DO UPDATE SET status = 'active'`,
        [userId, ctx.tenantId]
      )
      await client.query(
        `UPDATE guardians SET user_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND tenant_id = $3`,
        [userId, guardian.id, ctx.tenantId]
      )
    }

    const signedIn = await client.query(`SELECT last_login FROM users WHERE id = $1`, [userId])
    let invitation = null
    if (!signedIn.rows[0]?.last_login) {
      invitation = await sendInvitation(client, {
        userId, tenantId: ctx.tenantId, invitedBy: ctx.userId, handover,
      })
    } else if (!reusedAccount) {
      throw new InputError(
        'This guardian has already signed in. If they have lost access, reset it from the Users page.',
        409
      )
    }

    // Recorded before the link can be used: if the record cannot be written,
    // the link is not issued.
    await logAudit({
      actorId: ctx.userId, actorRole: ctx.roleName,
      actionType: invitation
        ? (handover ? 'USER_SETUP_LINK_ISSUED' : 'USER_INVITATION_SENT')
        : 'GUARDIAN_ACCOUNT_LINKED',
      actionScope: 'TENANT', resourceType: 'user', resourceId: userId, tenantId: ctx.tenantId,
      afterState: { guardianId: guardian.id, reusedAccount, delivery: invitation?.delivery ?? null },
      ipAddress: getClientIp(req),
    })
    await client.query('COMMIT')

    return res.json({
      invitation,
      reusedAccount,
      guardian: await guardianView(ctx.tenantId, guardian.id),
    })
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    return fail(res, 'invite the guardian', e)
  } finally {
    client.release()
  }
})

export default router
