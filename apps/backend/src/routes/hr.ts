import { Router, Response } from 'express'
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
import { findScoped, insertScoped, TenantScopeError } from '../db/tenantScoped.js'

/**
 * EMS — HR command centre.
 *
 * The workforce side of the platform: attendance across the organisation,
 * department metrics, absence patterns, and the notification campaigns HR
 * uses to act on them.
 *
 * This is a distinct business domain from the SMS. It shares infrastructure
 * (identity, notifications, audit) but not domain logic, and a school
 * identity can never reach it: requirePlatform('corporate') rejects before
 * any handler runs.
 *
 * Every aggregate below is computed inside the tenant in SQL. An HR director
 * at one employer must not be able to infer another employer's headcount,
 * attendance or absence patterns from any figure this API returns.
 */

const router = Router()

router.use(
  authenticateToken,
  resolveTenantContext,
  requireTenant,
  requirePlatform('corporate'),
  requireRoles('hr', 'hr_director', 'admin', 'manager')
)

function fail(res: Response, e: unknown) {
  if (e instanceof TenantScopeError) {
    return res.status(e.status).json({ error: 'Request refused', message: e.message })
  }
  console.error('[HR]', e)
  return res.status(500).json({ error: 'Internal error' })
}

/** Attendance rate per employee over a window, computed in the database. */
const ATTENDANCE_CTE = `
  WITH window_days AS (
    SELECT GREATEST($2::int, 1) AS days
  ),
  per_employee AS (
    SELECT e.id,
           e.first_name || ' ' || e.last_name AS name,
           e.email,
           e.department_id,
           COUNT(cc.id)::int AS sessions_attended,
           (SELECT days FROM window_days)::int AS sessions_total,
           MAX(cc.check_in_time) AS last_check_in
      FROM employees e
      LEFT JOIN corporate_checkins cc
        ON cc.employee_id = e.id
       AND cc.tenant_id = e.tenant_id
       AND cc.check_in_time > NOW() - ((SELECT days FROM window_days) || ' days')::interval
     WHERE e.tenant_id = $1
       AND e.is_currently_employed
     GROUP BY e.id, e.first_name, e.last_name, e.email, e.department_id
  )
`

function bandFor(pct: number): 'EXCELLENT' | 'GOOD' | 'AT_RISK' | 'CRITICAL' {
  if (pct >= 95) return 'EXCELLENT'
  if (pct >= 80) return 'GOOD'
  if (pct >= 60) return 'AT_RISK'
  return 'CRITICAL'
}

function windowDays(req: TenantRequest): number {
  const raw = parseInt(String(req.query.days ?? '30'), 10)
  return Number.isFinite(raw) && raw > 0 && raw <= 365 ? raw : 30
}

// ---------------------------------------------------------------------------
// GET /api/hr/overview
// ---------------------------------------------------------------------------
router.get('/overview', async (req: TenantRequest, res: Response) => {
  const ctx = req.ctx!
  try {
    const days = windowDays(req)
    const r = await query(
      `${ATTENDANCE_CTE}
       SELECT COUNT(*)::int AS total_members,
              COALESCE(ROUND(AVG(sessions_attended::numeric / NULLIF(sessions_total,0) * 100), 1), 0) AS average_attendance,
              COUNT(*) FILTER (
                WHERE sessions_attended::numeric / NULLIF(sessions_total,0) < 0.80
              )::int AS at_risk_count,
              COUNT(*) FILTER (
                WHERE sessions_attended::numeric / NULLIF(sessions_total,0) < 0.60
              )::int AS chronic_absentees
         FROM per_employee`,
      [ctx.tenantId, days]
    )
    const row = r.rows[0]
    res.json({
      total_members: row.total_members,
      average_attendance: Number(row.average_attendance),
      at_risk_count: row.at_risk_count,
      chronic_absentees: row.chronic_absentees,
      window_days: days,
    })
  } catch (e) {
    fail(res, e)
  }
})

// ---------------------------------------------------------------------------
// GET /api/hr/departments/metrics
// ---------------------------------------------------------------------------
router.get('/departments/metrics', async (req: TenantRequest, res: Response) => {
  const ctx = req.ctx!
  try {
    const days = windowDays(req)
    // The trend compares this window with the one immediately before it, both
    // bounded by tenant_id so neither period can pick up another employer.
    const r = await query(
      `SELECT d.name,
              COUNT(DISTINCT e.id)::int AS total_members,
              COALESCE(ROUND(AVG(cur.rate) * 100, 1), 0) AS average_attendance,
              COUNT(DISTINCT e.id) FILTER (WHERE cur.rate < 0.80)::int AS at_risk_count,
              COALESCE(ROUND((AVG(cur.rate) - AVG(prev.rate)) * 100, 1), 0) AS attendance_trend
         FROM corporate_departments d
         LEFT JOIN employees e
           ON e.department_id = d.id AND e.tenant_id = $1 AND e.is_currently_employed
         LEFT JOIN LATERAL (
           SELECT COUNT(*)::numeric / $2 AS rate
             FROM corporate_checkins c
            WHERE c.employee_id = e.id AND c.tenant_id = $1
              AND c.check_in_time > NOW() - ($2 || ' days')::interval
         ) cur ON TRUE
         LEFT JOIN LATERAL (
           SELECT COUNT(*)::numeric / $2 AS rate
             FROM corporate_checkins c
            WHERE c.employee_id = e.id AND c.tenant_id = $1
              AND c.check_in_time <= NOW() - ($2 || ' days')::interval
              AND c.check_in_time > NOW() - ($2 * 2 || ' days')::interval
         ) prev ON TRUE
        WHERE d.tenant_id = $1
        GROUP BY d.id, d.name
        ORDER BY d.name`,
      [ctx.tenantId, days]
    )
    res.json(
      r.rows.map((x: any) => ({
        name: x.name,
        total_members: x.total_members,
        average_attendance: Number(x.average_attendance),
        at_risk_count: x.at_risk_count,
        attendance_trend: Number(x.attendance_trend),
      }))
    )
  } catch (e) {
    fail(res, e)
  }
})

// ---------------------------------------------------------------------------
// GET /api/hr/members
// ---------------------------------------------------------------------------
router.get('/members', async (req: TenantRequest, res: Response) => {
  const ctx = req.ctx!
  try {
    const days = windowDays(req)
    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1)
    const pageSize = Math.min(200, Math.max(1, parseInt(String(req.query.page_size ?? '50'), 10) || 50))
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : ''
    const status = typeof req.query.status === 'string' ? req.query.status.toUpperCase() : ''

    const r = await query(
      `${ATTENDANCE_CTE}
       SELECT p.*, d.name AS department_name,
              ROUND(p.sessions_attended::numeric / NULLIF(p.sessions_total,0) * 100, 1) AS pct
         FROM per_employee p
         LEFT JOIN corporate_departments d ON d.id = p.department_id AND d.tenant_id = $1
        WHERE ($3 = '' OR p.name ILIKE '%' || $3 || '%' OR p.email ILIKE '%' || $3 || '%')
        ORDER BY pct ASC NULLS LAST, p.name`,
      [ctx.tenantId, days, search]
    )

    // Banding is derived from the scoped rows, so filtering on it cannot
    // widen the set beyond the tenant.
    let rows = r.rows.map((x: any) => {
      const pct = Number(x.pct ?? 0)
      return {
        id: x.id,
        name: x.name,
        role: 'EMPLOYEE' as const,
        email: x.email,
        department: x.department_name ?? undefined,
        attendance_percentage: pct,
        status: bandFor(pct),
        sessions_attended: x.sessions_attended,
        sessions_total: x.sessions_total,
        recent_absences: Math.max(0, x.sessions_total - x.sessions_attended),
        last_absence_date: undefined,
        notification_sent: false,
        last_check_in: x.last_check_in,
      }
    })
    if (status) rows = rows.filter(m => m.status === status)

    const total = rows.length
    const paged = rows.slice((page - 1) * pageSize, page * pageSize)

    // Whether each member has already been contacted, counted inside the tenant.
    const ids = paged.map(m => m.id)
    if (ids.length > 0) {
      const notified = await query(
        `SELECT e.id AS employee_id, COUNT(n.id)::int AS n
           FROM employees e
           JOIN notifications n
             ON n.recipient_user_id = e.user_id AND n.tenant_id = $1
          WHERE e.tenant_id = $1 AND e.id = ANY($2::uuid[])
          GROUP BY e.id`,
        [ctx.tenantId, ids]
      )
      const seen = new Map(notified.rows.map((x: any) => [x.employee_id, x.n > 0]))
      for (const m of paged) m.notification_sent = seen.get(m.id) ?? false
    }

    res.json({ data: paged, page, page_size: pageSize, total })
  } catch (e) {
    fail(res, e)
  }
})

// ---------------------------------------------------------------------------
// GET /api/hr/members/:memberId
// ---------------------------------------------------------------------------
router.get('/members/:memberId', async (req: TenantRequest, res: Response) => {
  const ctx = req.ctx!
  try {
    // Scoped lookup first: an employee id from another tenant is not found,
    // so this endpoint cannot be used to confirm that an id exists elsewhere.
    const employee = await findScoped<any>('employees', ctx, req.params.memberId)
    if (!employee) {
      return res.status(404).json({ error: 'Not found', message: 'No such employee in this tenant' })
    }

    const days = windowDays(req)
    const stats = await query(
      `SELECT COUNT(*)::int AS attended,
              MAX(check_in_time) AS last_check_in
         FROM corporate_checkins
        WHERE tenant_id = $1 AND employee_id = $2
          AND check_in_time > NOW() - ($3 || ' days')::interval`,
      [ctx.tenantId, employee.id, days]
    )
    const dept = employee.department_id
      ? await query(`SELECT name FROM corporate_departments WHERE id = $1 AND tenant_id = $2`,
          [employee.department_id, ctx.tenantId])
      : { rows: [] }

    const attended = stats.rows[0].attended
    const pct = days > 0 ? Math.round((attended / days) * 1000) / 10 : 0

    res.json({
      id: employee.id,
      name: `${employee.first_name} ${employee.last_name}`,
      role: 'EMPLOYEE',
      email: employee.email,
      department: dept.rows[0]?.name,
      attendance_percentage: pct,
      status: bandFor(pct),
      sessions_attended: attended,
      sessions_total: days,
      recent_absences: Math.max(0, days - attended),
      last_check_in: stats.rows[0].last_check_in,
      notification_sent: false,
    })
  } catch (e) {
    fail(res, e)
  }
})

// ---------------------------------------------------------------------------
// GET /api/hr/patterns
// ---------------------------------------------------------------------------
router.get('/patterns', async (req: TenantRequest, res: Response) => {
  const ctx = req.ctx!
  try {
    const days = windowDays(req)
    // Day-of-week concentration is what distinguishes a Monday absentee from
    // someone simply absent a lot. Computed over the tenant's own check-ins.
    const r = await query(
      `WITH expected AS (SELECT GREATEST($2::int, 1) AS days),
      per_emp AS (
        SELECT e.id,
               e.first_name || ' ' || e.last_name AS name,
               COUNT(cc.id)::int AS attended,
               (SELECT days FROM expected)::int AS expected_days,
               COUNT(cc.id) FILTER (WHERE EXTRACT(DOW FROM cc.check_in_time) = 1)::int AS mondays,
               COUNT(cc.id) FILTER (WHERE EXTRACT(DOW FROM cc.check_in_time) = 5)::int AS fridays,
               MAX(cc.check_in_time) AS last_seen
          FROM employees e
          LEFT JOIN corporate_checkins cc
            ON cc.employee_id = e.id AND cc.tenant_id = e.tenant_id
           AND cc.check_in_time > NOW() - ((SELECT days FROM expected) || ' days')::interval
         WHERE e.tenant_id = $1 AND e.is_currently_employed
         GROUP BY e.id, e.first_name, e.last_name
      )
      SELECT * FROM per_emp
       WHERE attended < expected_days
       ORDER BY attended ASC`,
      [ctx.tenantId, days]
    )

    const expectedMondays = Math.max(1, Math.round(days / 7))
    const patterns = r.rows.map((x: any) => {
      const rate = x.expected_days > 0 ? x.attended / x.expected_days : 0
      let pattern: string = 'NONE'
      let confidence = 0

      if (rate < 0.6) {
        pattern = 'CHRONIC_ABSENTEE'
        confidence = Math.round((1 - rate) * 100) / 100
      } else if (x.mondays === 0 && expectedMondays >= 2) {
        pattern = 'MONDAY_ABSENTEE'
        confidence = 0.8
      } else if (x.fridays === 0 && expectedMondays >= 2) {
        pattern = 'FRIDAY_ABSENTEE'
        confidence = 0.8
      } else if (rate < 0.85) {
        pattern = 'PATTERNS_IRREGULAR'
        confidence = Math.round((1 - rate) * 100) / 100
      }

      return {
        member_id: x.id,
        member_name: x.name,
        pattern,
        confidence,
        absences_in_period: Math.max(0, x.expected_days - x.attended),
        last_absence_date: x.last_seen ?? undefined,
      }
    }).filter((p: any) => p.pattern !== 'NONE')

    res.json(patterns)
  } catch (e) {
    fail(res, e)
  }
})

// ---------------------------------------------------------------------------
// GET /api/hr/compliance/summary
// ---------------------------------------------------------------------------
router.get('/compliance/summary', async (req: TenantRequest, res: Response) => {
  const ctx = req.ctx!
  try {
    const days = windowDays(req)
    const r = await query(
      `SELECT COUNT(*)::int AS total_checkins,
              COUNT(*) FILTER (WHERE face_verified)::int AS face_verified,
              COUNT(*) FILTER (WHERE NOT face_verified OR face_verified IS NULL)::int AS manual,
              COUNT(*) FILTER (WHERE drift_category IS NOT NULL AND drift_category <> 'none')::int AS time_drift_flagged,
              COUNT(DISTINCT employee_id)::int AS distinct_employees
         FROM corporate_checkins
        WHERE tenant_id = $1
          AND check_in_time > NOW() - ($2 || ' days')::interval`,
      [ctx.tenantId, days]
    )
    const headcount = await query(
      `SELECT COUNT(*)::int AS n FROM employees WHERE tenant_id = $1 AND is_currently_employed`,
      [ctx.tenantId]
    )
    const row = r.rows[0]
    const verifiedPct = row.total_checkins > 0
      ? Math.round((row.face_verified / row.total_checkins) * 1000) / 10
      : 0

    res.json({
      window_days: days,
      headcount: headcount.rows[0].n,
      total_checkins: row.total_checkins,
      face_verified: row.face_verified,
      manual_checkins: row.manual,
      face_verified_percent: verifiedPct,
      time_drift_flagged: row.time_drift_flagged,
      employees_with_activity: row.distinct_employees,
      employees_without_activity: Math.max(0, headcount.rows[0].n - row.distinct_employees),
    })
  } catch (e) {
    fail(res, e)
  }
})

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------

const CRITERIA = new Set([
  'ATTENDANCE_BELOW_60',
  'CHRONIC_ABSENTEE',
  'MONDAY_PATTERN',
  'NO_ACTIVITY_30DAYS',
])

/**
 * Resolves a campaign's recipients from the tenant's own data.
 *
 * The client never supplies recipients: it names a rule, and the server
 * decides who that rule selects within the tenant. This is what keeps a
 * campaign from being addressed at another employer's staff.
 */
async function resolveRecipients(tenantId: string, criteria: string): Promise<Array<{ userId: string; name: string }>> {
  const sql: Record<string, string> = {
    ATTENDANCE_BELOW_60: `
      SELECT e.user_id, e.first_name || ' ' || e.last_name AS name
        FROM employees e
       WHERE e.tenant_id = $1 AND e.is_currently_employed
         AND (SELECT COUNT(*) FROM corporate_checkins c
               WHERE c.employee_id = e.id AND c.tenant_id = $1
                 AND c.check_in_time > NOW() - INTERVAL '30 days')::numeric / 30 < 0.60`,
    CHRONIC_ABSENTEE: `
      SELECT e.user_id, e.first_name || ' ' || e.last_name AS name
        FROM employees e
       WHERE e.tenant_id = $1 AND e.is_currently_employed
         AND (SELECT COUNT(*) FROM corporate_checkins c
               WHERE c.employee_id = e.id AND c.tenant_id = $1
                 AND c.check_in_time > NOW() - INTERVAL '30 days')::numeric / 30 < 0.40`,
    MONDAY_PATTERN: `
      SELECT e.user_id, e.first_name || ' ' || e.last_name AS name
        FROM employees e
       WHERE e.tenant_id = $1 AND e.is_currently_employed
         AND NOT EXISTS (
           SELECT 1 FROM corporate_checkins c
            WHERE c.employee_id = e.id AND c.tenant_id = $1
              AND EXTRACT(DOW FROM c.check_in_time) = 1
              AND c.check_in_time > NOW() - INTERVAL '30 days')`,
    NO_ACTIVITY_30DAYS: `
      SELECT e.user_id, e.first_name || ' ' || e.last_name AS name
        FROM employees e
       WHERE e.tenant_id = $1 AND e.is_currently_employed
         AND NOT EXISTS (
           SELECT 1 FROM corporate_checkins c
            WHERE c.employee_id = e.id AND c.tenant_id = $1
              AND c.check_in_time > NOW() - INTERVAL '30 days')`,
  }
  const r = await query(sql[criteria], [tenantId])
  return r.rows.map((x: any) => ({ userId: x.user_id, name: x.name }))
}

router.post('/campaigns', async (req: TenantRequest, res: Response) => {
  const ctx = req.ctx!
  const { name, criteria, message_template } = req.body ?? {}

  if (!name || typeof name !== 'string' || name.trim().length < 2) {
    return res.status(400).json({ error: 'Validation failed', message: 'name is required' })
  }
  if (!CRITERIA.has(String(criteria))) {
    return res.status(400).json({ error: 'Validation failed', message: `criteria must be one of ${[...CRITERIA].join(', ')}` })
  }
  if (!message_template || typeof message_template !== 'string' || message_template.trim().length < 5) {
    return res.status(400).json({ error: 'Validation failed', message: 'message_template is required' })
  }

  try {
    const created = await insertScoped<any>('notification_campaigns', ctx, {
      platform_id: ctx.platformId,
      name: name.trim(),
      criteria: String(criteria),
      target_group: 'employees',
      message_template: message_template.trim(),
      status: 'DRAFT',
      created_by_user_id: ctx.userId,
    })
    const recipients = await resolveRecipients(ctx.tenantId!, String(criteria))
    res.status(201).json({
      id: created.id,
      name: created.name,
      target_group: created.target_group,
      criteria: created.criteria,
      created_at: created.created_at,
      sent_count: 0,
      recipients: recipients.map(r => r.name),
      message_template: created.message_template,
      status: created.status,
    })
  } catch (e) {
    fail(res, e)
  }
})

router.get('/campaigns', async (req: TenantRequest, res: Response) => {
  const ctx = req.ctx!
  try {
    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1)
    const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.page_size ?? '50'), 10) || 50))
    const status = typeof req.query.status === 'string' ? req.query.status.toUpperCase() : ''

    const params: unknown[] = [ctx.tenantId]
    let where = 'tenant_id = $1'
    if (status) { params.push(status); where += ` AND status = $${params.length}` }

    const total = await query(`SELECT COUNT(*)::int AS n FROM notification_campaigns WHERE ${where}`, params)
    params.push(pageSize, (page - 1) * pageSize)
    const rows = await query(
      `SELECT * FROM notification_campaigns WHERE ${where}
        ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    )

    res.json({
      data: rows.rows.map((c: any) => ({
        id: c.id,
        name: c.name,
        target_group: c.target_group,
        criteria: c.criteria,
        created_at: c.created_at,
        sent_count: c.sent_count,
        recipients: [],
        message_template: c.message_template,
        status: c.status,
      })),
      page,
      page_size: pageSize,
      total: total.rows[0].n,
    })
  } catch (e) {
    fail(res, e)
  }
})

router.post('/campaigns/:campaignId/send', async (req: TenantRequest, res: Response) => {
  const ctx = req.ctx!
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // Locked and tenant-scoped, so two concurrent sends cannot double-deliver
    // and a campaign id from another tenant is not found.
    const found = await client.query(
      `SELECT * FROM notification_campaigns
        WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
      [req.params.campaignId, ctx.tenantId]
    )
    if (found.rows.length === 0) {
      await client.query('ROLLBACK')
      return res.status(404).json({ error: 'Not found', message: 'No such campaign in this tenant' })
    }
    const campaign = found.rows[0]
    if (campaign.status === 'SENT') {
      await client.query('ROLLBACK')
      return res.status(409).json({ error: 'Conflict', message: 'Campaign has already been sent' })
    }
    if (campaign.status === 'CANCELLED') {
      await client.query('ROLLBACK')
      return res.status(409).json({ error: 'Conflict', message: 'Campaign was cancelled' })
    }

    const recipients = await resolveRecipients(ctx.tenantId!, campaign.criteria)

    // The database trigger refuses any recipient who is not a member of this
    // tenant, so a mistake here fails loudly rather than delivering.
    for (const r of recipients) {
      await client.query(
        `INSERT INTO notifications
           (tenant_id, recipient_user_id, campaign_id, category, subject, body, channel, status, sent_by_user_id, sent_at)
         VALUES ($1,$2,$3,'attendance',$4,$5,'in_app','sent',$6,CURRENT_TIMESTAMP)`,
        [ctx.tenantId, r.userId, campaign.id, campaign.name, campaign.message_template, ctx.userId]
      )
    }

    await client.query(
      `UPDATE notification_campaigns
          SET status = 'SENT', sent_count = $1, sent_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = $2 AND tenant_id = $3`,
      [recipients.length, campaign.id, ctx.tenantId]
    )
    await client.query('COMMIT')

    res.json({ success: true, sent_count: recipients.length, recipients: recipients.map(r => r.name) })
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    fail(res, e)
  } finally {
    client.release()
  }
})

router.delete('/campaigns/:campaignId', async (req: TenantRequest, res: Response) => {
  const ctx = req.ctx!
  try {
    // Cancelled, not deleted: a campaign that has been sent is a record of
    // who was contacted and must survive.
    const r = await query(
      `UPDATE notification_campaigns
          SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND tenant_id = $2 AND status <> 'SENT'
        RETURNING id, status`,
      [req.params.campaignId, ctx.tenantId]
    )
    if (r.rows.length === 0) {
      const exists = await query(
        `SELECT status FROM notification_campaigns WHERE id = $1 AND tenant_id = $2`,
        [req.params.campaignId, ctx.tenantId]
      )
      if (exists.rows.length > 0) {
        return res.status(409).json({ error: 'Conflict', message: 'A sent campaign cannot be cancelled' })
      }
      return res.status(404).json({ error: 'Not found', message: 'No such campaign in this tenant' })
    }
    res.json({ success: true, status: r.rows[0].status })
  } catch (e) {
    fail(res, e)
  }
})

// ---------------------------------------------------------------------------
// POST /api/hr/notifications/send
// ---------------------------------------------------------------------------
router.post('/notifications/send', async (req: TenantRequest, res: Response) => {
  const ctx = req.ctx!
  const { member_ids, subject, message } = req.body ?? {}

  if (!Array.isArray(member_ids) || member_ids.length === 0) {
    return res.status(400).json({ error: 'Validation failed', message: 'member_ids must be a non-empty array' })
  }
  if (member_ids.length > 500) {
    return res.status(400).json({ error: 'Validation failed', message: 'At most 500 recipients per request' })
  }
  if (!message || typeof message !== 'string' || message.trim().length < 5) {
    return res.status(400).json({ error: 'Validation failed', message: 'message is required' })
  }

  try {
    // Every id is resolved inside the tenant. Any that is not ours simply has
    // no row here, so the count mismatch below rejects the whole request
    // rather than partially delivering.
    const resolved = await query(
      `SELECT id, user_id, first_name || ' ' || last_name AS name
         FROM employees
        WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
      [ctx.tenantId, member_ids.map(String)]
    )
    if (resolved.rows.length !== new Set(member_ids.map(String)).size) {
      return res.status(404).json({
        error: 'Not found',
        message: 'One or more recipients are not members of this tenant',
      })
    }

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      for (const r of resolved.rows) {
        await client.query(
          `INSERT INTO notifications
             (tenant_id, recipient_user_id, category, subject, body, channel, status, sent_by_user_id, sent_at)
           VALUES ($1,$2,'attendance',$3,$4,'in_app','sent',$5,CURRENT_TIMESTAMP)`,
          [ctx.tenantId, r.user_id, String(subject ?? 'Attendance notice'), message.trim(), ctx.userId]
        )
      }
      await client.query('COMMIT')
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {})
      throw e
    } finally {
      client.release()
    }

    res.json({ success: true, sent_count: resolved.rows.length, recipients: resolved.rows.map((r: any) => r.name) })
  } catch (e) {
    fail(res, e)
  }
})

// ---------------------------------------------------------------------------
// GET /api/hr/export/organization-report
// ---------------------------------------------------------------------------
router.get('/export/organization-report', async (req: TenantRequest, res: Response) => {
  const ctx = req.ctx!
  const format = String(req.query.format ?? 'CSV').toUpperCase()
  if (format !== 'CSV') {
    return res.status(415).json({
      error: 'Unsupported format',
      message: `${format} export is not implemented; request format=CSV`,
    })
  }
  try {
    const days = windowDays(req)
    const r = await query(
      `${ATTENDANCE_CTE}
       SELECT p.name, p.email, d.name AS department,
              p.sessions_attended, p.sessions_total,
              ROUND(p.sessions_attended::numeric / NULLIF(p.sessions_total,0) * 100, 1) AS pct,
              p.last_check_in
         FROM per_employee p
         LEFT JOIN corporate_departments d ON d.id = p.department_id AND d.tenant_id = $1
        ORDER BY pct ASC NULLS LAST, p.name`,
      [ctx.tenantId, days]
    )

    const escape = (v: unknown) => {
      const s = v === null || v === undefined ? '' : String(v)
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const csv = [
      ['name', 'email', 'department', 'attended', 'expected', 'attendance_percent', 'band', 'last_check_in'].join(','),
      ...r.rows.map((x: any) =>
        [x.name, x.email, x.department, x.sessions_attended, x.sessions_total, x.pct, bandFor(Number(x.pct ?? 0)), x.last_check_in]
          .map(escape).join(',')
      ),
    ].join('\n')

    const safeName = (ctx.tenantName ?? 'organization').replace(/[^a-z0-9]+/gi, '-').toLowerCase()
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}-attendance.csv"`)
    res.send(csv)
  } catch (e) {
    fail(res, e)
  }
})

export default router
