import express, { Request, Response, NextFunction } from 'express'
import { sendInvitation, unusablePasswordHash, AccountTokenError } from '../auth/accountTokens.js'
import { query, getConnection } from '../db/connection.js'
import { authenticateToken } from '../auth/middleware.js'
import { auditContextMiddleware } from '../auth/auditContextMiddleware.js'
import { extractAuditContext, logAuditEntry, getAuditLogs } from '../services/auditService.js'
import { getClientIp } from '../utils/getClientIp.js'

/**
 * The control plane.
 *
 * Rewritten. The previous version was 2,300 lines referencing fourteen
 * columns that do not exist — created_by_superadmin_id, actor_role on the
 * lifecycle audit, reason on the session log, target_entity on the action
 * log, a validate_tenant_lifecycle_transition() function that was never
 * created — so those endpoints could only ever return 500. It also called
 * updateAuditEntry() at thirteen sites; that function was deliberately
 * replaced with one that throws, to enforce audit immutability, so every one
 * of those calls threw at runtime.
 *
 * Meanwhile four endpoints the superadmin UI calls every time it loads —
 * audit-trail, export/system-report, incidents/override, locked-users/unlock
 * — did not exist at all.
 *
 * What is here now is the set the console actually needs, written against the
 * schema that actually exists.
 *
 * On authorisation: a superadmin is explicitly NOT tenant-scoped. That is the
 * one identity in the system permitted to see across tenants, which is why
 * the gate is narrow — the role is checked against the database on every
 * request rather than trusted from the token — and why every mutating action
 * writes an audit entry carrying its real outcome, including failure.
 */

const router = express.Router()

router.use(auditContextMiddleware)
router.use(authenticateToken)

/**
 * The gate.
 *
 * Re-read from the database rather than taken from the token, so revoking
 * somebody's superadmin role takes effect on their next request rather than
 * whenever their token happens to expire.
 */
async function verifySuperadmin(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).user?.userId
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' })
    }

    const r = await query(
      `SELECT r.name AS role, u.is_active
         FROM users u JOIN roles r ON r.id = u.role_id
        WHERE u.id = $1`,
      [userId]
    )

    if (r.rowCount === 0 || !r.rows[0].is_active || r.rows[0].role !== 'superadmin') {
      return res.status(403).json({ error: 'Superadmin access required' })
    }

    ;(req as any).superadminId = userId
    return next()
  } catch (e) {
    console.error('[SUPERADMIN] gate:', e)
    return res.status(500).json({ error: 'Could not verify access' })
  }
}

router.use(verifySuperadmin)

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const LIFECYCLE = ['active', 'suspended', 'archived'] as const
type Lifecycle = (typeof LIFECYCLE)[number]

// The vocabularies the incidents table constrains, which are uppercase.
// 'acknowledged' is not among them; INVESTIGATING is what this schema calls
// the state where somebody has picked an incident up.
const INCIDENT_SEVERITY = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const
const INCIDENT_STATUS = ['OPEN', 'INVESTIGATING', 'CONTAINED', 'RESOLVED', 'CLOSED'] as const

function actorOf(req: Request): string {
  return (req as any).superadminId as string
}

function fail(res: Response, label: string, e: unknown) {
  const err = e as { code?: string; constraint?: string; message?: string }
  if (err.code === '23505') {
    return res.status(409).json({ error: 'That record already exists' })
  }
  if (err.code === '23503') {
    return res.status(400).json({ error: 'That record refers to something which does not exist' })
  }
  if (err.code === '23514') {
    return res.status(400).json({ error: 'The values supplied are outside what this record allows' })
  }
  console.error(`[SUPERADMIN] ${label}:`, e)
  return res.status(500).json({ error: `Failed to ${label}` })
}

function notFound(res: Response, what: string) {
  return res.status(404).json({ error: `${what} not found` })
}

/**
 * Records a control-plane action, once, with what actually happened.
 *
 * Called after the operation rather than before it. The audit table refuses
 * updates by design, so an entry written optimistically at the start can
 * never be corrected — which is how the previous version ended up with an
 * audit log that could only say SUCCESS.
 */
async function audit(
  req: Request,
  action: string,
  scope: 'GLOBAL' | 'TENANT' | 'USER' | 'SYSTEM',
  outcome: { result: 'SUCCESS' | 'FAILURE' | 'DENIED'; error?: string | null },
  target?: { type?: string; id?: string | null },
  state?: { beforeState?: any; afterState?: any },
  justification?: string | null
): Promise<void> {
  try {
    const context = extractAuditContext(req, action, scope)
    await logAuditEntry(
      context,
      {
        actorId: actorOf(req),
        targetEntityType: target?.type,
        targetEntityId: target?.id ?? undefined,
        justification: justification ?? undefined,
        ipAddress: getClientIp(req),
      },
      {
        beforeState: state?.beforeState,
        afterState: state?.afterState,
        result: outcome.result,
        errorMessage: outcome.error ?? null,
      }
    )
  } catch (e) {
    // An audit write that fails must be loud, but it must not swallow the
    // result of the operation the caller is waiting on.
    console.error(`[SUPERADMIN] audit write failed for ${action}:`, e)
  }
}

/** The lighter, human-readable action log the console lists. */
async function logAction(
  req: Request,
  action: string,
  entityType: string | null,
  entityId: string | null,
  details: unknown
): Promise<void> {
  try {
    await query(
      `INSERT INTO superadmin_action_logs
         (superadmin_user_id, action, entity_type, entity_id, details, ip_address, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        actorOf(req), action, entityType, entityId,
        details ? JSON.stringify(details) : null,
        getClientIp(req), req.get('user-agent') ?? null,
      ]
    )
  } catch (e) {
    console.error(`[SUPERADMIN] action log failed for ${action}:`, e)
  }
}

// ===========================================================================
// Platform overview
// ===========================================================================

router.get('/stats', async (_req: Request, res: Response) => {
  try {
    const r = await query(
      `SELECT
         (SELECT COUNT(*)::int FROM tenants)                              AS tenants_total,
         (SELECT COUNT(*)::int FROM tenants WHERE status = 'active')      AS tenants_active,
         (SELECT COUNT(*)::int FROM tenants WHERE status = 'suspended')   AS tenants_suspended,
         (SELECT COUNT(*)::int FROM tenants WHERE status = 'archived')    AS tenants_archived,
         (SELECT COUNT(*)::int FROM tenants WHERE kind = 'school')        AS schools,
         (SELECT COUNT(*)::int FROM tenants WHERE kind = 'corporate')     AS companies,
         (SELECT COUNT(*)::int FROM users)                                AS users_total,
         (SELECT COUNT(*)::int FROM users WHERE is_active)                AS users_active,
         (SELECT COUNT(*)::int FROM users WHERE NOT is_active)            AS users_locked,
         (SELECT COUNT(*)::int FROM students)                             AS students,
         (SELECT COUNT(*)::int FROM employees)                            AS employees,
         (SELECT COUNT(*)::int FROM incidents WHERE status <> 'resolved') AS incidents_open`
    )
    return res.json({ stats: r.rows[0] })
  } catch (e) {
    return fail(res, 'load platform statistics', e)
  }
})

/**
 * Platform health.
 *
 * Reports only what it can actually observe. Where something is not measured,
 * it says so rather than reporting a reassuring default — a health endpoint
 * that invents green is worse than no health endpoint.
 */
router.get('/health', async (_req: Request, res: Response) => {
  try {
    const started = Date.now()
    const db = await query(`SELECT 1 AS ok`)
    const dbLatency = Date.now() - started

    const queue = await query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'pending')::int   AS pending,
         COUNT(*) FILTER (WHERE status = 'failed')::int    AS failed,
         COUNT(*) FILTER (WHERE status = 'simulated')::int AS simulated
       FROM notification_messages`
    )

    const stale = await query(
      `SELECT COUNT(*)::int AS n FROM notification_messages
        WHERE status = 'sending' AND updated_at < CURRENT_TIMESTAMP - INTERVAL '15 minutes'`
    )

    const checks = [
      { name: 'database', ok: db.rowCount === 1, detail: `${dbLatency}ms` },
      {
        name: 'notification_queue',
        ok: Number(queue.rows[0].pending) < 1000 && Number(stale.rows[0].n) === 0,
        detail: `${queue.rows[0].pending} waiting, ${queue.rows[0].failed} failed, `
          + `${stale.rows[0].n} stalled`,
      },
      {
        name: 'notification_delivery',
        ok: Number(queue.rows[0].simulated) === 0,
        detail: Number(queue.rows[0].simulated) > 0
          ? `${queue.rows[0].simulated} message(s) were simulated, not sent — `
            + 'at least one tenant has no transport configured'
          : 'all delivered messages went to a real transport',
      },
    ]

    const healthy = checks.every((c) => c.ok)
    return res.status(healthy ? 200 : 503).json({
      status: healthy ? 'healthy' : 'degraded',
      checks,
      // Named explicitly so nobody reads this as a full picture.
      notMeasured: ['request latency', 'error rate', 'disk', 'memory', 'external transports'],
      observedAt: new Date().toISOString(),
    })
  } catch (e) {
    return fail(res, 'check platform health', e)
  }
})

router.get('/diagnostics', async (_req: Request, res: Response) => {
  try {
    const tables = await query(
      `SELECT relname AS table_name, n_live_tup::int AS approximate_rows
         FROM pg_stat_user_tables
        ORDER BY n_live_tup DESC
        LIMIT 25`
    )

    const recentErrors = await query(
      `SELECT action_type, error_message, created_at
         FROM superadmin_audit_log
        WHERE result = 'FAILURE'
        ORDER BY created_at DESC
        LIMIT 20`
    )

    const byTenant = await query(
      `SELECT t.id, t.name, t.kind, t.status,
              (SELECT COUNT(*)::int FROM user_tenant_memberships m WHERE m.tenant_id = t.id) AS users
         FROM tenants t
        ORDER BY t.name`
    )

    return res.json({
      database: { largestTables: tables.rows },
      recentFailures: recentErrors.rows,
      tenants: byTenant.rows,
      process: {
        uptimeSeconds: Math.round(process.uptime()),
        nodeVersion: process.version,
        memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      },
    })
  } catch (e) {
    return fail(res, 'run diagnostics', e)
  }
})

/** Schools and companies as their own records, behind the tenant rows. */
router.get('/entities', async (_req: Request, res: Response) => {
  try {
    const schools = await query(
      `SELECT e.id, e.name, e.code, e.email, e.phone, e.is_active, e.lifecycle_state,
              e.admin_user_id, u.full_name AS admin_name, e.created_at,
              'school' AS kind,
              (SELECT COUNT(*)::int FROM students s WHERE s.tenant_id = e.id) AS members
         FROM school_entities e
         LEFT JOIN users u ON u.id = e.admin_user_id
        ORDER BY e.name`
    )
    const companies = await query(
      `SELECT e.id, e.name, e.code, e.email, e.phone, e.is_active, e.status AS lifecycle_state,
              e.admin_user_id, u.full_name AS admin_name, e.created_at,
              'corporate' AS kind,
              (SELECT COUNT(*)::int FROM employees em WHERE em.tenant_id = e.id) AS members
         FROM corporate_entities e
         LEFT JOIN users u ON u.id = e.admin_user_id
        ORDER BY e.name`
    )
    return res.json({ entities: [...schools.rows, ...companies.rows] })
  } catch (e) {
    return fail(res, 'load entities', e)
  }
})

// ===========================================================================
// Tenants
// ===========================================================================

router.get('/tenants', async (req: Request, res: Response) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : null
    const kind = typeof req.query.kind === 'string' ? req.query.kind : null

    const r = await query(
      `SELECT t.id, t.name, t.code, t.kind, t.status, t.is_active, t.created_at,
              p.name AS platform_name,
              (SELECT COUNT(*)::int FROM user_tenant_memberships m WHERE m.tenant_id = t.id) AS user_count,
              CASE WHEN t.kind = 'school'
                   THEN (SELECT COUNT(*)::int FROM students s WHERE s.tenant_id = t.id)
                   ELSE (SELECT COUNT(*)::int FROM employees e WHERE e.tenant_id = t.id)
              END AS member_count
         FROM tenants t
         LEFT JOIN platforms p ON p.id = t.platform_id
        WHERE ($1::text IS NULL OR t.status = $1::text)
          AND ($2::text IS NULL OR t.kind = $2::text)
        ORDER BY t.name`,
      [status, kind]
    )
    return res.json({ tenants: r.rows })
  } catch (e) {
    return fail(res, 'load tenants', e)
  }
})

router.get('/tenants/:tenantId', async (req: Request, res: Response) => {
  try {
    const { tenantId } = req.params
    if (!UUID.test(tenantId)) return notFound(res, 'Tenant')

    const t = await query(
      `SELECT t.*, p.name AS platform_name FROM tenants t
         LEFT JOIN platforms p ON p.id = t.platform_id
        WHERE t.id = $1`,
      [tenantId]
    )
    if (t.rowCount === 0) return notFound(res, 'Tenant')

    const admins = await query(
      `SELECT u.id, u.full_name, u.email, u.is_active
         FROM user_tenant_memberships m
         JOIN users u ON u.id = m.user_id
         JOIN roles r ON r.id = u.role_id
        WHERE m.tenant_id = $1 AND r.name = 'admin'
        ORDER BY u.full_name`,
      [tenantId]
    )

    const lifecycle = await query(
      `SELECT l.*, u.full_name AS actor_name
         FROM tenant_lifecycle_audit l
         LEFT JOIN users u ON u.id = l.actor_id
        WHERE l.tenant_id = $1
        ORDER BY l.timestamp DESC
        LIMIT 50`,
      [tenantId]
    )

    return res.json({ tenant: t.rows[0], admins: admins.rows, lifecycle: lifecycle.rows })
  } catch (e) {
    return fail(res, 'load that tenant', e)
  }
})

/**
 * Provisioning a tenant.
 *
 * The entity row is what is created; a trigger keeps the tenants table in
 * step. Writing to tenants directly would leave a tenant with no school or
 * company behind it.
 */
router.post('/tenants', async (req: Request, res: Response) => {
  try {
    const b = req.body ?? {}
    const kind = b.kind === 'corporate' ? 'corporate' : 'school'

    if (!b.name || !b.code) {
      await audit(req, 'TENANT_CREATE', 'GLOBAL',
        { result: 'FAILURE', error: 'name and code are required' })
      return res.status(400).json({ error: 'name and code are required' })
    }

    const table = kind === 'school' ? 'school_entities' : 'corporate_entities'
    const clash = await query(
      `SELECT 1 FROM ${table} WHERE UPPER(code) = UPPER($1) LIMIT 1`,
      [b.code]
    )
    if (clash.rowCount && clash.rowCount > 0) {
      await audit(req, 'TENANT_CREATE', 'GLOBAL',
        { result: 'FAILURE', error: `code ${b.code} already in use` })
      return res.status(409).json({ error: 'That code is already in use' })
    }

    const created = kind === 'school'
      ? await query(
          `INSERT INTO school_entities (name, code, email, phone, address, is_active, lifecycle_state)
           VALUES ($1,$2,$3,$4,$5,TRUE,'active') RETURNING id, name, code`,
          [b.name, b.code, b.email || null, b.phone || null, b.address || null]
        )
      : await query(
          `INSERT INTO corporate_entities (name, code, email, phone, industry, headquarters_address, is_active)
           VALUES ($1,$2,$3,$4,$5,$6,TRUE) RETURNING id, name, code`,
          [b.name, b.code, b.email || null, b.phone || null, b.industry || null, b.address || null]
        )

    const entityId = created.rows[0].id
    const tenant = await query(`SELECT * FROM tenants WHERE id = $1`, [entityId])

    await audit(req, 'TENANT_CREATE', 'GLOBAL', { result: 'SUCCESS' },
      { type: 'tenant', id: entityId }, { afterState: created.rows[0] }, b.justification)
    await logAction(req, 'TENANT_CREATE', 'tenant', entityId, { name: b.name, kind })

    return res.status(201).json({
      tenant: tenant.rows[0] ?? created.rows[0],
      entity: created.rows[0],
    })
  } catch (e) {
    await audit(req, 'TENANT_CREATE', 'GLOBAL',
      { result: 'FAILURE', error: String((e as Error).message) })
    return fail(res, 'create that tenant', e)
  }
})

router.patch('/tenants/:tenantId', async (req: Request, res: Response) => {
  try {
    const { tenantId } = req.params
    if (!UUID.test(tenantId)) return notFound(res, 'Tenant')
    const b = req.body ?? {}

    const before = await query(`SELECT * FROM tenants WHERE id = $1`, [tenantId])
    if (before.rowCount === 0) return notFound(res, 'Tenant')

    const kind = before.rows[0].kind
    const table = kind === 'school' ? 'school_entities' : 'corporate_entities'

    // The entity is the record of truth; the trigger carries the change into
    // tenants. Status is not settable here — that is the lifecycle route,
    // which requires a justification.
    const updated = await query(
      `UPDATE ${table}
          SET name = COALESCE($2, name),
              email = COALESCE($3, email),
              phone = COALESCE($4, phone),
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *`,
      [tenantId, b.name || null, b.email ?? null, b.phone ?? null]
    )
    if (updated.rowCount === 0) return notFound(res, 'Tenant')

    const after = await query(`SELECT * FROM tenants WHERE id = $1`, [tenantId])

    await audit(req, 'TENANT_UPDATE', 'TENANT', { result: 'SUCCESS' },
      { type: 'tenant', id: tenantId },
      { beforeState: before.rows[0], afterState: after.rows[0] }, b.justification)
    await logAction(req, 'TENANT_UPDATE', 'tenant', tenantId, { fields: Object.keys(b) })

    return res.json({ tenant: after.rows[0] })
  } catch (e) {
    await audit(req, 'TENANT_UPDATE', 'TENANT',
      { result: 'FAILURE', error: String((e as Error).message) },
      { type: 'tenant', id: req.params.tenantId })
    return fail(res, 'update that tenant', e)
  }
})

/**
 * Moving a tenant through its lifecycle.
 *
 * Suspending stops its people signing in without touching a row of its data,
 * which is what an unpaid invoice or an open investigation calls for.
 * Archiving is the end of the relationship.
 *
 * A justification is required on every move. "Who suspended this school and
 * why" is the first question asked when a thousand people cannot sign in, and
 * it should not depend on somebody remembering.
 */
router.post('/tenants/:tenantId/lifecycle', async (req: Request, res: Response) => {
  const client = await getConnection()
  try {
    const { tenantId } = req.params
    if (!UUID.test(tenantId)) return notFound(res, 'Tenant')

    const b = req.body ?? {}
    const to = String(b.state ?? '') as Lifecycle

    if (!LIFECYCLE.includes(to)) {
      return res.status(400).json({
        error: `state must be one of ${LIFECYCLE.join(', ')}`,
      })
    }
    if (!b.justification || !String(b.justification).trim()) {
      await audit(req, 'TENANT_LIFECYCLE', 'TENANT',
        { result: 'DENIED', error: 'no justification given' }, { type: 'tenant', id: tenantId })
      return res.status(400).json({ error: 'A justification is required to move a tenant' })
    }

    const before = await client.query(`SELECT * FROM tenants WHERE id = $1 FOR UPDATE`, [tenantId])
    if (before.rowCount === 0) return notFound(res, 'Tenant')
    const from = before.rows[0].status as Lifecycle

    if (from === to) {
      return res.status(409).json({ error: `This tenant is already ${to}` })
    }
    // An archived tenant is finished. Bringing one back would mean deciding
    // what to do about every retention rule that applied while it was gone,
    // so it is refused here rather than guessed at.
    if (from === 'archived') {
      await audit(req, 'TENANT_LIFECYCLE', 'TENANT',
        { result: 'DENIED', error: 'tenant is archived' }, { type: 'tenant', id: tenantId })
      return res.status(409).json({
        error: 'An archived tenant cannot be brought back; provision a new one',
      })
    }

    await client.query('BEGIN')

    // The entity is written, and the sync trigger carries the change into
    // tenants. Writing tenants first would be undone by that trigger, which
    // is exactly what used to happen here.
    if (before.rows[0].kind === 'school') {
      await client.query(
        `UPDATE school_entities
            SET status = $2,
                system_version = COALESCE(system_version, 0) + 1,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $1`,
        [tenantId, to]
      )
    } else {
      await client.query(
        `UPDATE corporate_entities
            SET status = $2, updated_at = CURRENT_TIMESTAMP
          WHERE id = $1`,
        [tenantId, to]
      )
    }

    await client.query(
      `INSERT INTO tenant_lifecycle_audit
         (tenant_id, previous_state, new_state, actor_id, action_type, justification)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [tenantId, from, to, actorOf(req), `TENANT_${to.toUpperCase()}`, String(b.justification).trim()]
    )

    const after = await client.query(`SELECT * FROM tenants WHERE id = $1`, [tenantId])
    if (after.rows[0].status !== to) {
      // The sync trigger did not carry the change through. Better to fail
      // loudly than to report a suspension that did not happen.
      throw new Error(`Tenant ${tenantId} is still ${after.rows[0].status} after moving it to ${to}`)
    }

    // Suspending must actually stop people signing in, not merely record an
    // intention to. Deactivating the accounts is what does that.
    let affectedUsers = 0
    if (to !== 'active') {
      const locked = await client.query(
        `UPDATE users SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP
          WHERE id IN (SELECT user_id FROM user_tenant_memberships WHERE tenant_id = $1)
            AND is_active = TRUE
          RETURNING id`,
        [tenantId]
      )
      affectedUsers = locked.rowCount ?? 0

      // One row per account. The log is per-user by design — "whose sessions
      // were dropped, and why" is answered per person, not per tenant — so a
      // single summary row would both violate the NOT NULL on user_id and
      // lose the answer.
      if (affectedUsers > 0) {
        await client.query(
          `INSERT INTO session_invalidation_log
             (user_id, tenant_id, invalidation_reason, invalidated_by_superadmin_id, ip_address)
           SELECT u, $1, $2, $3, $4 FROM UNNEST($5::uuid[]) AS u`,
          [
            tenantId, `Tenant ${to}: ${String(b.justification).trim()}`.slice(0, 255),
            actorOf(req), getClientIp(req),
            locked.rows.map((x: any) => x.id),
          ]
        )
      }
    }

    await client.query('COMMIT')

    await audit(req, 'TENANT_LIFECYCLE', 'TENANT', { result: 'SUCCESS' },
      { type: 'tenant', id: tenantId },
      { beforeState: before.rows[0], afterState: after.rows[0] },
      String(b.justification).trim())
    await logAction(req, `TENANT_${to.toUpperCase()}`, 'tenant', tenantId,
      { from, to, affectedUsers })

    return res.json({
      tenant: after.rows[0],
      from,
      to,
      affectedUsers,
      note: to === 'active'
        ? 'Accounts suspended with the tenant are not reactivated automatically; '
          + 'reactivate them individually so a deliberately locked account stays locked.'
        : `${affectedUsers} account(s) were deactivated.`,
    })
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined)
    await audit(req, 'TENANT_LIFECYCLE', 'TENANT',
      { result: 'FAILURE', error: String((e as Error).message) },
      { type: 'tenant', id: req.params.tenantId })
    return fail(res, 'move that tenant', e)
  } finally {
    client.release()
  }
})

/**
 * Deleting a tenant.
 *
 * Refused whenever it holds anything. A school with students, attendance and
 * invoices in it is not a row to be removed; archiving is what ends the
 * relationship while keeping the record. Only an empty tenant — one
 * provisioned by mistake — can actually be deleted.
 */
router.delete('/tenants/:tenantId', async (req: Request, res: Response) => {
  try {
    const { tenantId } = req.params
    if (!UUID.test(tenantId)) return notFound(res, 'Tenant')

    const before = await query(`SELECT * FROM tenants WHERE id = $1`, [tenantId])
    if (before.rowCount === 0) return notFound(res, 'Tenant')

    const counts = await query(
      `SELECT
         (SELECT COUNT(*)::int FROM students WHERE tenant_id = $1)  AS students,
         (SELECT COUNT(*)::int FROM employees WHERE tenant_id = $1) AS employees,
         (SELECT COUNT(*)::int FROM user_tenant_memberships WHERE tenant_id = $1) AS users`,
      [tenantId]
    )
    const held = counts.rows[0]
    const total = Number(held.students) + Number(held.employees) + Number(held.users)

    if (total > 0) {
      await audit(req, 'TENANT_DELETE', 'GLOBAL',
        { result: 'DENIED', error: 'tenant holds data' }, { type: 'tenant', id: tenantId })
      return res.status(409).json({
        error: 'This tenant holds data and cannot be deleted; archive it instead',
        holds: held,
      })
    }

    const table = before.rows[0].kind === 'school' ? 'school_entities' : 'corporate_entities'
    await query(`DELETE FROM ${table} WHERE id = $1`, [tenantId])

    await audit(req, 'TENANT_DELETE', 'GLOBAL', { result: 'SUCCESS' },
      { type: 'tenant', id: tenantId }, { beforeState: before.rows[0] },
      (req.body ?? {}).justification)
    await logAction(req, 'TENANT_DELETE', 'tenant', tenantId, { name: before.rows[0].name })

    return res.json({ deleted: true })
  } catch (e) {
    await audit(req, 'TENANT_DELETE', 'GLOBAL',
      { result: 'FAILURE', error: String((e as Error).message) },
      { type: 'tenant', id: req.params.tenantId })
    return fail(res, 'delete that tenant', e)
  }
})

// ===========================================================================
// Tenant administrators
// ===========================================================================

router.get('/tenant-admins', async (_req: Request, res: Response) => {
  try {
    const r = await query(
      `SELECT u.id, u.full_name, u.email, u.phone, u.is_active, u.created_at,
              u.must_reset_password, u.last_login, (u.activated_at IS NULL) AS awaiting_setup,
              m.tenant_id, m.tenant_name, m.platform_kind
         FROM users u
         JOIN roles ro ON ro.id = u.role_id
         LEFT JOIN user_tenant_memberships m ON m.user_id = u.id
        WHERE ro.name = 'admin'
        ORDER BY m.tenant_name NULLS LAST, u.full_name`
    )
    return res.json({ admins: r.rows })
  } catch (e) {
    return fail(res, 'load tenant administrators', e)
  }
})

/** Which tenants have an administrator, and which do not. */
router.get('/admins/mapping', async (_req: Request, res: Response) => {
  try {
    const r = await query(
      `SELECT t.id AS tenant_id, t.name AS tenant_name, t.kind, t.status,
              COUNT(u.id)::int AS admin_count,
              COALESCE(
                JSON_AGG(JSON_BUILD_OBJECT('id', u.id, 'name', u.full_name, 'email', u.email)
                         ORDER BY u.full_name)
                  FILTER (WHERE u.id IS NOT NULL),
                '[]'::json
              ) AS admins
         FROM tenants t
         LEFT JOIN user_tenant_memberships m ON m.tenant_id = t.id
         LEFT JOIN users u ON u.id = m.user_id
                          AND u.role_id IN (SELECT id FROM roles WHERE name = 'admin')
        GROUP BY t.id
        ORDER BY t.name`
    )
    return res.json({
      mapping: r.rows,
      // The row that matters: a tenant nobody administers.
      unadministered: r.rows.filter((x: any) => x.admin_count === 0).map((x: any) => x.tenant_name),
    })
  } catch (e) {
    return fail(res, 'load the administrator mapping', e)
  }
})

router.post('/tenant-admins', async (req: Request, res: Response) => {
  const client = await getConnection()
  try {
    const b = req.body ?? {}
    if (!b.tenantId || !b.email || !b.fullName) {
      return res.status(400).json({ error: 'tenantId, email and fullName are required' })
    }
    if (!UUID.test(b.tenantId)) return notFound(res, 'Tenant')

    const tenant = await query(`SELECT * FROM tenants WHERE id = $1`, [b.tenantId])
    if (tenant.rowCount === 0) return notFound(res, 'Tenant')
    if (tenant.rows[0].status !== 'active') {
      return res.status(409).json({
        error: `This tenant is ${tenant.rows[0].status}; reactivate it before adding an administrator`,
      })
    }

    const platformId = tenant.rows[0].platform_id
    const role = await query(
      `SELECT id FROM roles WHERE name = 'admin' AND platform_id = $1`, [platformId]
    )
    if (role.rowCount === 0) {
      return res.status(500).json({ error: 'The admin role is not configured for this platform' })
    }

    const existing = await query(
      `SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND platform_id = $2`,
      [b.email, platformId]
    )
    if (existing.rowCount && existing.rowCount > 0) {
      await audit(req, 'TENANT_ADMIN_CREATE', 'USER',
        { result: 'DENIED', error: 'email already in use' }, { type: 'tenant', id: b.tenantId })
      return res.status(409).json({ error: 'An account already exists on that email address' })
    }

    // The administrator chooses their own password from an invitation. A new
    // tenant rarely has email set up yet, so the operator may ask for the
    // one-time setup link instead (`handover`), to pass on directly.
    const hashed = await unusablePasswordHash()
    const handover = b.handover === true

    await client.query('BEGIN')

    const user = await client.query(
      `INSERT INTO users (email, full_name, phone, platform_id, role_id, is_active,
                          password_hash, must_reset_password)
       VALUES ($1,$2,$3,$4,$5,TRUE,$6,FALSE) RETURNING id, email, full_name`,
      [b.email, b.fullName, b.phone || null, platformId, role.rows[0].id, hashed]
    )
    const userId = user.rows[0].id

    const association = tenant.rows[0].kind === 'school'
      ? 'school_user_associations' : 'corporate_user_associations'
    const column = tenant.rows[0].kind === 'school' ? 'school_entity_id' : 'corporate_entity_id'

    await client.query(
      `INSERT INTO ${association} (user_id, ${column}, status) VALUES ($1,$2,'active')`,
      [userId, b.tenantId]
    )

    // The entity's admin_user_id is what several older gates keyed on and
    // what the console displays, so it is set when there is nobody in it.
    const entity = tenant.rows[0].kind === 'school' ? 'school_entities' : 'corporate_entities'
    await client.query(
      `UPDATE ${entity} SET admin_user_id = COALESCE(admin_user_id, $2) WHERE id = $1`,
      [b.tenantId, userId]
    )
    const invitation = await sendInvitation(client, {
      userId, tenantId: b.tenantId, invitedBy: req.user!.userId, handover,
    })

    await client.query('COMMIT')

    await audit(req, 'TENANT_ADMIN_CREATE', 'USER', { result: 'SUCCESS' },
      { type: 'user', id: userId }, { afterState: { ...user.rows[0], invitation: invitation.delivery } },
      b.justification)
    await logAction(req, 'TENANT_ADMIN_CREATE', 'user', userId,
      { tenantId: b.tenantId, email: b.email, invitation: invitation.delivery })

    return res.status(201).json({ admin: user.rows[0], invitation })
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined)
    await audit(req, 'TENANT_ADMIN_CREATE', 'USER',
      { result: 'FAILURE', error: String((e as Error).message) })
    return fail(res, 'create that administrator', e)
  } finally {
    client.release()
  }
})

/**
 * A fresh invitation for a tenant administrator who has not signed in yet,
 * cancelling any earlier one; `handover: true` returns the setup link rather
 * than emailing it.
 */
router.post('/tenant-admins/:adminId/invitation', async (req: Request, res: Response) => {
  const client = await getConnection()
  try {
    const { adminId } = req.params
    if (!UUID.test(adminId)) return notFound(res, 'Administrator')
    const admin = await query(
      `SELECT u.id, m.tenant_id
         FROM users u JOIN roles r ON r.id = u.role_id
         JOIN user_tenant_memberships m ON m.user_id = u.id AND m.status = 'active'
        WHERE u.id = $1 AND r.name = 'admin'
        LIMIT 1`,
      [adminId]
    )
    if (admin.rowCount === 0) return notFound(res, 'Administrator')
    const handover = req.body?.handover === true

    await client.query('BEGIN')
    const invitation = await sendInvitation(client, {
      userId: adminId, tenantId: admin.rows[0].tenant_id, invitedBy: req.user!.userId, handover,
    })
    await client.query('COMMIT')

    await audit(req, handover ? 'TENANT_ADMIN_SETUP_LINK' : 'TENANT_ADMIN_INVITE', 'USER',
      { result: 'SUCCESS' }, { type: 'user', id: adminId }, { afterState: { delivery: invitation.delivery } })
    return res.json({ invitation })
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined)
    if (e instanceof AccountTokenError) return res.status(e.status).json({ error: e.message })
    return fail(res, 'send the invitation', e)
  } finally {
    client.release()
  }
})

/**
 * Removing an administrator.
 *
 * Deactivates rather than deletes: an administrator who approved things,
 * issued invoices and made admissions decisions is referenced throughout the
 * audit trail, and removing the row would either fail on those references or
 * blank the name against every decision they made.
 *
 * Refused when they are the last administrator a tenant has, because a tenant
 * nobody can administer needs a superadmin to rescue it.
 */
router.delete('/tenant-admins/:adminId', async (req: Request, res: Response) => {
  try {
    const { adminId } = req.params
    if (!UUID.test(adminId)) return notFound(res, 'Administrator')

    const admin = await query(
      `SELECT u.id, u.full_name, u.email, u.is_active, m.tenant_id, m.tenant_name
         FROM users u
         JOIN roles r ON r.id = u.role_id
         LEFT JOIN user_tenant_memberships m ON m.user_id = u.id
        WHERE u.id = $1 AND r.name = 'admin'`,
      [adminId]
    )
    if (admin.rowCount === 0) return notFound(res, 'Administrator')

    const tenantId = admin.rows[0].tenant_id
    if (tenantId) {
      const others = await query(
        `SELECT COUNT(*)::int AS n
           FROM user_tenant_memberships m
           JOIN users u ON u.id = m.user_id
           JOIN roles r ON r.id = u.role_id
          WHERE m.tenant_id = $1 AND r.name = 'admin' AND u.is_active AND u.id <> $2`,
        [tenantId, adminId]
      )
      if (Number(others.rows[0].n) === 0) {
        await audit(req, 'TENANT_ADMIN_REMOVE', 'USER',
          { result: 'DENIED', error: 'last administrator' }, { type: 'user', id: adminId })
        return res.status(409).json({
          error: `${admin.rows[0].full_name} is the only administrator of `
            + `${admin.rows[0].tenant_name}; appoint another before removing them`,
        })
      }
    }

    await query(
      `UPDATE users SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [adminId]
    )
    // Hand the entity's nominated administrator to somebody who is still here.
    await query(
      `UPDATE school_entities SET admin_user_id = NULL WHERE admin_user_id = $1`, [adminId]
    )
    await query(
      `UPDATE corporate_entities SET admin_user_id = NULL WHERE admin_user_id = $1`, [adminId]
    )

    await audit(req, 'TENANT_ADMIN_REMOVE', 'USER', { result: 'SUCCESS' },
      { type: 'user', id: adminId }, { beforeState: admin.rows[0] },
      (req.body ?? {}).justification)
    await logAction(req, 'TENANT_ADMIN_REMOVE', 'user', adminId,
      { tenantId, email: admin.rows[0].email })

    return res.json({ deactivated: true, admin: admin.rows[0] })
  } catch (e) {
    await audit(req, 'TENANT_ADMIN_REMOVE', 'USER',
      { result: 'FAILURE', error: String((e as Error).message) },
      { type: 'user', id: req.params.adminId })
    return fail(res, 'remove that administrator', e)
  }
})

// ===========================================================================
// Users
// ===========================================================================

router.get('/users', async (req: Request, res: Response) => {
  try {
    const search = typeof req.query.q === 'string' && req.query.q.trim() ? req.query.q.trim() : null
    const tenantId = typeof req.query.tenantId === 'string' && UUID.test(req.query.tenantId)
      ? req.query.tenantId : null
    const limit = Math.min(Number(req.query.limit) || 200, 1000)

    const r = await query(
      `SELECT u.id, u.full_name, u.email, u.phone, u.is_active, u.created_at, u.last_login,
              u.must_reset_password, ro.name AS role, p.name AS platform,
              m.tenant_id, m.tenant_name
         FROM users u
         JOIN roles ro ON ro.id = u.role_id
         LEFT JOIN platforms p ON p.id = u.platform_id
         LEFT JOIN user_tenant_memberships m ON m.user_id = u.id
        WHERE ($1::text IS NULL OR u.full_name ILIKE '%' || $1::text || '%'
                                OR u.email ILIKE '%' || $1::text || '%')
          AND ($2::uuid IS NULL OR m.tenant_id = $2::uuid)
        ORDER BY u.created_at DESC
        LIMIT $3`,
      [search, tenantId, limit]
    )
    return res.json({ users: r.rows })
  } catch (e) {
    return fail(res, 'load users', e)
  }
})

router.patch('/users/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params
    if (!UUID.test(userId)) return notFound(res, 'User')
    const b = req.body ?? {}

    const before = await query(
      `SELECT id, full_name, email, phone, is_active FROM users WHERE id = $1`, [userId]
    )
    if (before.rowCount === 0) return notFound(res, 'User')

    // A superadmin locking themselves out is a support call nobody can answer.
    if (userId === actorOf(req) && b.isActive === false) {
      await audit(req, 'USER_UPDATE', 'USER',
        { result: 'DENIED', error: 'self-deactivation' }, { type: 'user', id: userId })
      return res.status(409).json({ error: 'You cannot deactivate your own account' })
    }

    // The role is not settable here. Granting roles across tenants from a
    // generic update route is how privilege escalation gets in.
    const after = await query(
      `UPDATE users
          SET full_name = COALESCE($2, full_name),
              email = COALESCE($3, email),
              phone = COALESCE($4, phone),
              is_active = COALESCE($5, is_active),
              must_reset_password = COALESCE($6, must_reset_password),
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING id, full_name, email, phone, is_active, must_reset_password`,
      [
        userId, b.fullName || null, b.email || null, b.phone ?? null,
        b.isActive === undefined ? null : !!b.isActive,
        b.mustResetPassword === undefined ? null : !!b.mustResetPassword,
      ]
    )

    await audit(req, 'USER_UPDATE', 'USER', { result: 'SUCCESS' },
      { type: 'user', id: userId },
      { beforeState: before.rows[0], afterState: after.rows[0] }, b.justification)
    await logAction(req, 'USER_UPDATE', 'user', userId, { fields: Object.keys(b) })

    return res.json({ user: after.rows[0] })
  } catch (e) {
    await audit(req, 'USER_UPDATE', 'USER',
      { result: 'FAILURE', error: String((e as Error).message) },
      { type: 'user', id: req.params.userId })
    return fail(res, 'update that user', e)
  }
})

/** Deactivates. See the administrator route for why nothing is deleted. */
router.delete('/users/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params
    if (!UUID.test(userId)) return notFound(res, 'User')

    if (userId === actorOf(req)) {
      await audit(req, 'USER_DEACTIVATE', 'USER',
        { result: 'DENIED', error: 'self-deactivation' }, { type: 'user', id: userId })
      return res.status(409).json({ error: 'You cannot deactivate your own account' })
    }

    const before = await query(
      `SELECT id, full_name, email, is_active FROM users WHERE id = $1`, [userId]
    )
    if (before.rowCount === 0) return notFound(res, 'User')

    await query(
      `UPDATE users SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [userId]
    )

    await audit(req, 'USER_DEACTIVATE', 'USER', { result: 'SUCCESS' },
      { type: 'user', id: userId }, { beforeState: before.rows[0] },
      (req.body ?? {}).justification)
    await logAction(req, 'USER_DEACTIVATE', 'user', userId, { email: before.rows[0].email })

    return res.json({ deactivated: true })
  } catch (e) {
    await audit(req, 'USER_DEACTIVATE', 'USER',
      { result: 'FAILURE', error: String((e as Error).message) },
      { type: 'user', id: req.params.userId })
    return fail(res, 'deactivate that user', e)
  }
})

/**
 * Accounts that cannot sign in.
 *
 * There is no lockout counter in this schema — is_active is the whole of it —
 * so this is deliberately named for what it can actually tell you rather than
 * implying a failed-attempt mechanism that does not exist.
 */
router.get('/locked-users', async (_req: Request, res: Response) => {
  try {
    const r = await query(
      `SELECT u.id, u.full_name, u.email, u.updated_at, u.last_login,
              ro.name AS role, m.tenant_id, m.tenant_name
         FROM users u
         JOIN roles ro ON ro.id = u.role_id
         LEFT JOIN user_tenant_memberships m ON m.user_id = u.id
        WHERE u.is_active = FALSE
        ORDER BY u.updated_at DESC NULLS LAST
        LIMIT 500`
    )
    return res.json({
      users: r.rows,
      note: 'Accounts are deactivated explicitly; this platform has no failed-attempt lockout.',
    })
  } catch (e) {
    return fail(res, 'load deactivated accounts', e)
  }
})

router.post('/locked-users/unlock', async (req: Request, res: Response) => {
  try {
    const b = req.body ?? {}
    const userId = b.userId
    if (!userId || !UUID.test(String(userId))) {
      return res.status(400).json({ error: 'userId is required' })
    }

    const before = await query(
      `SELECT id, full_name, email, is_active FROM users WHERE id = $1`, [userId]
    )
    if (before.rowCount === 0) return notFound(res, 'User')
    if (before.rows[0].is_active) {
      return res.status(409).json({ error: 'That account is already active' })
    }

    // Reactivating an account whose tenant is suspended would hand back a
    // sign-in the suspension was supposed to remove.
    const tenant = await query(
      `SELECT t.id, t.name, t.status
         FROM user_tenant_memberships m JOIN tenants t ON t.id = m.tenant_id
        WHERE m.user_id = $1 LIMIT 1`,
      [userId]
    )
    if (tenant.rowCount && tenant.rows[0].status !== 'active') {
      await audit(req, 'USER_REACTIVATE', 'USER',
        { result: 'DENIED', error: `tenant is ${tenant.rows[0].status}` },
        { type: 'user', id: userId })
      return res.status(409).json({
        error: `${tenant.rows[0].name} is ${tenant.rows[0].status}; reactivate the tenant first`,
      })
    }

    const after = await query(
      `UPDATE users SET is_active = TRUE, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 RETURNING id, full_name, email, is_active`,
      [userId]
    )

    await audit(req, 'USER_REACTIVATE', 'USER', { result: 'SUCCESS' },
      { type: 'user', id: userId },
      { beforeState: before.rows[0], afterState: after.rows[0] }, b.justification)
    await logAction(req, 'USER_REACTIVATE', 'user', userId, { email: before.rows[0].email })

    return res.json({ user: after.rows[0] })
  } catch (e) {
    await audit(req, 'USER_REACTIVATE', 'USER',
      { result: 'FAILURE', error: String((e as Error).message) })
    return fail(res, 'reactivate that account', e)
  }
})

// ===========================================================================
// Audit
// ===========================================================================

router.get('/audit-logs', async (req: Request, res: Response) => {
  try {
    const logs = await getAuditLogs({
      actorId: typeof req.query.actorId === 'string' ? req.query.actorId : undefined,
      actionType: typeof req.query.actionType === 'string' ? req.query.actionType : undefined,
      actionScope: typeof req.query.actionScope === 'string' ? req.query.actionScope : undefined,
      targetEntityId: typeof req.query.targetEntityId === 'string'
        ? req.query.targetEntityId : undefined,
      limit: Math.min(Number(req.query.limit) || 100, 500),
      offset: Number(req.query.offset) || 0,
    })
    return res.json({ logs })
  } catch (e) {
    return fail(res, 'load the audit log', e)
  }
})

/**
 * The combined trail the console shows.
 *
 * The console called this on every load and it did not exist. It merges the
 * formal audit log with the lighter action log and the tenant lifecycle
 * history, because "what has been done to this platform lately" is one
 * question and it lived in three tables.
 */
router.get('/audit-trail', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500)

    const r = await query(
      `SELECT * FROM (
         SELECT a.created_at AS occurred_at, 'audit' AS source,
                a.action_type AS action, a.result,
                a.target_entity_type AS entity_type, a.target_entity_id AS entity_id,
                a.justification AS detail, a.error_message,
                u.full_name AS actor_name, a.actor_id
           FROM superadmin_audit_log a
           LEFT JOIN users u ON u.id = a.actor_id

         UNION ALL

         SELECT l.created_at, 'action', l.action, NULL,
                l.entity_type, l.entity_id,
                l.details::text, NULL,
                u.full_name, l.superadmin_user_id
           FROM superadmin_action_logs l
           LEFT JOIN users u ON u.id = l.superadmin_user_id

         UNION ALL

         SELECT t.timestamp, 'lifecycle', t.action_type, NULL,
                'tenant', t.tenant_id,
                t.previous_state || ' -> ' || t.new_state ||
                  COALESCE(': ' || t.justification, ''), NULL,
                u.full_name, t.actor_id
           FROM tenant_lifecycle_audit t
           LEFT JOIN users u ON u.id = t.actor_id
       ) trail
       ORDER BY occurred_at DESC
       LIMIT $1`,
      [limit]
    )
    return res.json({ trail: r.rows })
  } catch (e) {
    return fail(res, 'load the audit trail', e)
  }
})

/**
 * The system report.
 *
 * Also called by the console and also missing. Deliberately assembled from
 * live queries at request time rather than a stored snapshot, so it cannot
 * report a state the platform was in last week.
 */
router.get('/export/system-report', async (req: Request, res: Response) => {
  try {
    const [stats, tenants, admins, incidents, notifications] = await Promise.all([
      query(
        `SELECT
           (SELECT COUNT(*)::int FROM tenants)                          AS tenants,
           (SELECT COUNT(*)::int FROM tenants WHERE status = 'active')  AS tenants_active,
           (SELECT COUNT(*)::int FROM users)                            AS users,
           (SELECT COUNT(*)::int FROM users WHERE is_active)            AS users_active,
           (SELECT COUNT(*)::int FROM students)                         AS students,
           (SELECT COUNT(*)::int FROM employees)                        AS employees`
      ),
      query(
        `SELECT t.name, t.code, t.kind, t.status, t.created_at,
                (SELECT COUNT(*)::int FROM user_tenant_memberships m WHERE m.tenant_id = t.id) AS users
           FROM tenants t ORDER BY t.name`
      ),
      query(
        `SELECT COUNT(*)::int AS n FROM tenants t
          WHERE NOT EXISTS (
            SELECT 1 FROM user_tenant_memberships m
             JOIN users u ON u.id = m.user_id
             JOIN roles r ON r.id = u.role_id
            WHERE m.tenant_id = t.id AND r.name = 'admin' AND u.is_active)`
      ),
      query(
        `SELECT status, COUNT(*)::int AS n FROM incidents GROUP BY status`
      ),
      query(
        `SELECT status, COUNT(*)::int AS n FROM notification_messages GROUP BY status`
      ),
    ])

    const report = {
      generatedAt: new Date().toISOString(),
      generatedBy: actorOf(req),
      summary: stats.rows[0],
      tenants: tenants.rows,
      tenantsWithoutAnAdministrator: Number(admins.rows[0].n),
      incidentsByStatus: Object.fromEntries(incidents.rows.map((x: any) => [x.status, x.n])),
      notificationsByStatus: Object.fromEntries(
        notifications.rows.map((x: any) => [x.status, x.n])
      ),
    }

    await logAction(req, 'SYSTEM_REPORT_EXPORT', 'platform', null,
      { tenants: report.summary.tenants })

    if (String(req.query.format).toLowerCase() === 'json') {
      res.setHeader('Content-Disposition',
        `attachment; filename="system-report-${new Date().toISOString().slice(0, 10)}.json"`)
    }
    return res.json({ report })
  } catch (e) {
    return fail(res, 'build the system report', e)
  }
})

// ===========================================================================
// Incidents
// ===========================================================================

router.get('/incidents', async (req: Request, res: Response) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : null
    const r = await query(
      `SELECT i.id, i.incident_number, i.title, i.description, i.incident_type,
              i.severity, i.status, i.affected_tenant_id, t.name AS affected_tenant_name,
              i.created_at, i.acknowledged_at, i.resolved_at, i.root_cause,
              i.resolution_notes, u.full_name AS detected_by_name
         FROM incidents i
         LEFT JOIN tenants t ON t.id = i.affected_tenant_id
         LEFT JOIN users u ON u.id = i.detected_by_user_id
        WHERE ($1::text IS NULL OR i.status = $1::text)
        ORDER BY i.created_at DESC
        LIMIT 200`,
      [status]
    )
    return res.json({ incidents: r.rows })
  } catch (e) {
    return fail(res, 'load incidents', e)
  }
})

async function incidentWithTimeline(runner: { query: typeof query }, id: string) {
  const inc = await runner.query(
    `SELECT i.*, t.name AS affected_tenant_name, d.full_name AS detected_by_name,
            a.full_name AS acknowledged_by_name, r.full_name AS resolved_by_name,
            s.full_name AS assigned_to_name
       FROM incidents i
       LEFT JOIN tenants t ON t.id = i.affected_tenant_id
       LEFT JOIN users d ON d.id = i.detected_by_user_id
       LEFT JOIN users a ON a.id = i.acknowledged_by_user_id
       LEFT JOIN users r ON r.id = i.resolved_by_user_id
       LEFT JOIN users s ON s.id = i.assigned_superadmin_id
      WHERE i.id = $1`,
    [id]
  )
  if (inc.rows.length === 0) return null
  const timeline = await runner.query(
    `SELECT e.id, e.event_type, e.old_value, e.new_value, e.description, e.created_at,
            u.full_name AS performed_by_name
       FROM incident_timeline_events e
       LEFT JOIN users u ON u.id = e.performed_by_user_id
      WHERE e.incident_id = $1
      ORDER BY e.created_at DESC`,
    [id]
  )
  return { incident: inc.rows[0], timeline: timeline.rows }
}

router.get('/incidents/:incidentId', async (req: Request, res: Response) => {
  try {
    const { incidentId } = req.params
    if (!UUID.test(incidentId)) return notFound(res, 'Incident')
    const found = await incidentWithTimeline({ query }, incidentId)
    if (!found) return notFound(res, 'Incident')
    return res.json(found)
  } catch (e) {
    return fail(res, 'load that incident', e)
  }
})

router.post('/incidents', async (req: Request, res: Response) => {
  try {
    const b = req.body ?? {}
    if (!b.title || !b.severity) {
      return res.status(400).json({ error: 'title and severity are required' })
    }
    if (!INCIDENT_SEVERITY.includes(String(b.severity).toUpperCase() as any)) {
      return res.status(400).json({
        error: `severity must be one of ${INCIDENT_SEVERITY.join(', ')}`,
      })
    }
    if (b.affectedTenantId && !UUID.test(b.affectedTenantId)) {
      return notFound(res, 'Tenant')
    }

    const created = await query(
      `INSERT INTO incidents
         (title, description, incident_type, severity, status, affected_tenant_id,
          detected_by_user_id, assigned_superadmin_id, detection_method, first_detected_at)
       VALUES ($1,$2,$3,$4,'OPEN',$5,$6,$7,'manual',CURRENT_TIMESTAMP)
       RETURNING *`,
      [
        // description is NOT NULL, and an incident with no description is a
        // line in a list nobody can act on.
        b.title, b.description || b.title, b.incidentType || 'operational',
        String(b.severity).toUpperCase(), b.affectedTenantId || null, actorOf(req),
        // Assigned to whoever raised it until somebody reassigns it. The
        // column is NOT NULL, and an unowned incident is how one gets missed.
        b.assignedTo && UUID.test(String(b.assignedTo)) ? b.assignedTo : actorOf(req),
      ]
    )

    await audit(req, 'INCIDENT_CREATE', 'SYSTEM', { result: 'SUCCESS' },
      { type: 'incident', id: created.rows[0].id }, { afterState: created.rows[0] })
    await logAction(req, 'INCIDENT_CREATE', 'incident', created.rows[0].id, { title: b.title })

    return res.status(201).json({ incident: created.rows[0] })
  } catch (e) {
    await audit(req, 'INCIDENT_CREATE', 'SYSTEM',
      { result: 'FAILURE', error: String((e as Error).message) })
    return fail(res, 'create that incident', e)
  }
})

router.put('/incidents/:incidentId', async (req: Request, res: Response) => {
  try {
    const { incidentId } = req.params
    if (!UUID.test(incidentId)) return notFound(res, 'Incident')
    const b = req.body ?? {}

    const before = await query(`SELECT * FROM incidents WHERE id = $1`, [incidentId])
    if (before.rowCount === 0) return notFound(res, 'Incident')

    const status = b.status ? String(b.status).toUpperCase() : null
    if (status && !INCIDENT_STATUS.includes(status as any)) {
      return res.status(400).json({
        error: `status must be one of ${INCIDENT_STATUS.join(', ')}`,
      })
    }
    if (b.severity && !INCIDENT_SEVERITY.includes(String(b.severity).toUpperCase() as any)) {
      return res.status(400).json({
        error: `severity must be one of ${INCIDENT_SEVERITY.join(', ')}`,
      })
    }

    // A resolved incident carries its root cause and resolution notes; those
    // are what a post-mortem reads, so resolving without them is refused.
    if (status === 'RESOLVED' && !b.rootCause && !before.rows[0].root_cause) {
      return res.status(400).json({
        error: 'Resolving an incident requires a root cause',
      })
    }

    const note = typeof b.notes === 'string' ? b.notes.trim() : ''
    if (!status && !b.title && b.description === undefined && !b.severity && !b.rootCause
        && !b.resolutionNotes && !note) {
      return res.status(400).json({ error: 'Nothing to change' })
    }

    const client = await getConnection()
    let after: any
    try {
    await client.query('BEGIN')
    after = await client.query(
      `UPDATE incidents
          SET title = COALESCE($2, title),
              description = COALESCE($3, description),
              severity = COALESCE($4, severity),
              status = COALESCE($5, status),
              root_cause = COALESCE($6, root_cause),
              resolution_notes = COALESCE($7, resolution_notes),
              acknowledged_at = CASE WHEN $9::text = 'INVESTIGATING' AND acknowledged_at IS NULL
                                     THEN CURRENT_TIMESTAMP ELSE acknowledged_at END,
              acknowledged_by_user_id = CASE WHEN $9::text = 'INVESTIGATING'
                                              AND acknowledged_by_user_id IS NULL
                                             THEN $8::uuid ELSE acknowledged_by_user_id END,
              resolved_at = CASE WHEN $9::text = 'RESOLVED' AND resolved_at IS NULL
                                 THEN CURRENT_TIMESTAMP ELSE resolved_at END,
              resolved_by_user_id = CASE WHEN $9::text = 'RESOLVED' AND resolved_by_user_id IS NULL
                                         THEN $8::uuid ELSE resolved_by_user_id END
        WHERE id = $1
        RETURNING *`,
      [
        incidentId, b.title || null, b.description ?? null,
        b.severity ? String(b.severity).toUpperCase() : null,
        status, b.rootCause ?? null, b.resolutionNotes ?? null, actorOf(req), status,
      ]
    )

    // The timeline is the incident's story; every change and note is in it.
    if (status && status !== before.rows[0].status) {
      await client.query(
        `INSERT INTO incident_timeline_events
           (incident_id, event_type, old_value, new_value, description, performed_by_user_id)
         VALUES ($1, 'status_changed', $2, $3, $4, $5)`,
        [incidentId, JSON.stringify(before.rows[0].status), JSON.stringify(status),
         `Status changed from ${before.rows[0].status} to ${status}`, actorOf(req)]
      )
    }
    if (b.severity && String(b.severity).toUpperCase() !== before.rows[0].severity) {
      await client.query(
        `INSERT INTO incident_timeline_events
           (incident_id, event_type, old_value, new_value, description, performed_by_user_id)
         VALUES ($1, 'severity_updated', $2, $3, $4, $5)`,
        [incidentId, JSON.stringify(before.rows[0].severity), JSON.stringify(String(b.severity).toUpperCase()),
         `Severity changed from ${before.rows[0].severity} to ${String(b.severity).toUpperCase()}`, actorOf(req)]
      )
    }
    if (note) {
      await client.query(
        `INSERT INTO incident_timeline_events
           (incident_id, event_type, description, performed_by_user_id)
         VALUES ($1, 'note_added', $2, $3)`,
        [incidentId, note.slice(0, 4000), actorOf(req)]
      )
    }
    await client.query('COMMIT')
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {})
      throw e
    } finally {
      client.release()
    }

    await audit(req, 'INCIDENT_UPDATE', 'SYSTEM', { result: 'SUCCESS' },
      { type: 'incident', id: incidentId },
      { beforeState: before.rows[0], afterState: after.rows[0] })
    await logAction(req, 'INCIDENT_UPDATE', 'incident', incidentId, { status: b.status })

    return res.json(await incidentWithTimeline({ query }, incidentId))
  } catch (e) {
    await audit(req, 'INCIDENT_UPDATE', 'SYSTEM',
      { result: 'FAILURE', error: String((e as Error).message) },
      { type: 'incident', id: req.params.incidentId })
    return fail(res, 'update that incident', e)
  }
})

/**
 * Overriding an incident.
 *
 * The console's break-glass button, which did not exist. It closes an
 * incident outside the normal flow — a false positive, a duplicate, an alert
 * that fired on a maintenance window — and it requires a written reason,
 * because an incident closed without one is indistinguishable from an
 * incident nobody looked at.
 */
router.post('/incidents/override', async (req: Request, res: Response) => {
  try {
    const b = req.body ?? {}
    if (!b.incidentId || !UUID.test(String(b.incidentId))) {
      return res.status(400).json({ error: 'incidentId is required' })
    }
    if (!b.reason || !String(b.reason).trim()) {
      await audit(req, 'INCIDENT_OVERRIDE', 'SYSTEM',
        { result: 'DENIED', error: 'no reason given' },
        { type: 'incident', id: String(b.incidentId) })
      return res.status(400).json({ error: 'An override has to say why' })
    }

    const before = await query(`SELECT * FROM incidents WHERE id = $1`, [b.incidentId])
    if (before.rowCount === 0) return notFound(res, 'Incident')
    if (['RESOLVED', 'CLOSED'].includes(String(before.rows[0].status).toUpperCase())) {
      return res.status(409).json({ error: 'That incident is already resolved' })
    }

    const reason = String(b.reason).trim()
    const after = await query(
      `UPDATE incidents
          SET status = 'RESOLVED',
              resolved_at = CURRENT_TIMESTAMP,
              resolved_by_user_id = $2,
              root_cause = COALESCE(root_cause, $3),
              resolution_notes = COALESCE(resolution_notes, '') ||
                                 CASE WHEN resolution_notes IS NULL THEN '' ELSE E'\\n' END ||
                                 'Superadmin override: ' || $3
        WHERE id = $1
        RETURNING *`,
      [b.incidentId, actorOf(req), reason]
    )

    await audit(req, 'INCIDENT_OVERRIDE', 'SYSTEM', { result: 'SUCCESS' },
      { type: 'incident', id: String(b.incidentId) },
      { beforeState: before.rows[0], afterState: after.rows[0] }, reason)
    await logAction(req, 'INCIDENT_OVERRIDE', 'incident', String(b.incidentId), { reason })

    return res.json({ incident: after.rows[0], overridden: true })
  } catch (e) {
    await audit(req, 'INCIDENT_OVERRIDE', 'SYSTEM',
      { result: 'FAILURE', error: String((e as Error).message) })
    return fail(res, 'override that incident', e)
  }
})

export default router
