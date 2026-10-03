/**
 * Watching the manual fallback (brief 5.2), on both platforms.
 *
 *   GET  /alerts                     open abuse alerts (and, with ?all=true, acknowledged ones)
 *   POST /alerts/:alertId/acknowledge
 *   GET  /manual                     manual entries by person and by device, last 30 days
 *   GET  /approvals                  manual check-ins waiting for a manager (employers)
 *   POST /approvals/:eventId         approve or reject one; nobody decides their own
 *   GET  /settings, PUT /settings    the thresholds
 *
 * Mounted at /api/attendance-review.
 */
import { Router, type Response } from 'express'
import { authenticateToken } from '../auth/middleware.js'
import {
  requirePlatform,
  requireRoles,
  requireTenant,
  resolveTenantContext,
  type TenantRequest,
} from '../auth/tenantContextMiddleware.js'
import { getConnection, query } from '../db/connection.js'
import {
  ALERT_DEFAULTS,
  AttendanceInputError,
  decideCheckIn,
} from '../attendance/core.js'

const router = Router()
router.use(authenticateToken, resolveTenantContext, requireTenant)

const reviewers = requireRoles('admin', 'hr', 'hr_director', 'manager')
const approvers = requireRoles('admin', 'hr', 'hr_director', 'manager')
const settingsAdmins = requireRoles('admin', 'hr_director')

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function ctxOf(req: TenantRequest) {
  return req.ctx as NonNullable<TenantRequest['ctx']> & { tenantId: string }
}

function fail(res: Response, label: string, e: unknown) {
  if (e instanceof AttendanceInputError) return res.status(e.status).json({ error: e.message, code: e.code })
  console.error(`[ATTENDANCE_REVIEW] ${label}:`, e)
  return res.status(500).json({ error: `Failed to ${label}` })
}

router.get('/alerts', reviewers, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const all = req.query.all === 'true'
    const r = await query(
      `SELECT a.id, a.kind, a.student_id, a.employee_id, a.device_id, a.event_id, a.alert_day, a.detail,
              a.acknowledged_at, a.created_at,
              COALESCE(s.first_name || ' ' || s.last_name, e.first_name || ' ' || e.last_name) AS person
         FROM attendance_alerts a
         LEFT JOIN students s ON s.id = a.student_id AND s.tenant_id = a.tenant_id
         LEFT JOIN employees e ON e.id = a.employee_id AND e.tenant_id = a.tenant_id
        WHERE a.tenant_id = $1 AND ($2 OR a.acknowledged_at IS NULL)
        ORDER BY a.created_at DESC LIMIT 200`,
      [ctx.tenantId, all]
    )
    return res.json({ alerts: r.rows })
  } catch (e) {
    return fail(res, 'load alerts', e)
  }
})

router.post('/alerts/:alertId/acknowledge', reviewers, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    if (!UUID.test(req.params.alertId)) return res.status(404).json({ error: 'Alert not found' })
    const r = await query(
      `UPDATE attendance_alerts SET acknowledged_at = CURRENT_TIMESTAMP, acknowledged_by = $3
        WHERE id = $1 AND tenant_id = $2 AND acknowledged_at IS NULL
        RETURNING id, acknowledged_at`,
      [req.params.alertId, ctx.tenantId, ctx.userId]
    )
    if (!r.rows.length) return res.status(404).json({ error: 'Alert not found, or already acknowledged' })
    return res.json({ alert: r.rows[0] })
  } catch (e) {
    return fail(res, 'acknowledge the alert', e)
  }
})

/** Manual against face entries, by person and by device, over the last 30 days. */
router.get('/manual', reviewers, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const people = await query(
      `SELECT COALESCE(e.student_id, e.employee_id) AS person_id,
              CASE WHEN e.student_id IS NOT NULL THEN 'student' ELSE 'employee' END AS person_type,
              count(*) FILTER (WHERE e.method IN ('manual', 'offline_manual'))::int AS manual,
              count(*) FILTER (WHERE e.method IN ('face', 'offline_face'))::int AS face,
              count(*) FILTER (WHERE e.reason_code = 'face_not_recognised')::int AS not_recognised
         FROM attendance_events e
        WHERE e.tenant_id = $1 AND e.kind IN ('mark', 'check_in')
          AND e.server_time > CURRENT_TIMESTAMP - INTERVAL '30 days'
        GROUP BY 1, 2
        ORDER BY manual DESC LIMIT 200`,
      [ctx.tenantId]
    )
    const devices = await query(
      `SELECT device_id,
              count(*) FILTER (WHERE method IN ('manual', 'offline_manual'))::int AS manual,
              count(*) FILTER (WHERE method IN ('face', 'offline_face'))::int AS face,
              count(DISTINCT COALESCE(student_id, employee_id))::int AS people
         FROM attendance_events
        WHERE tenant_id = $1 AND kind IN ('mark', 'check_in') AND device_id IS NOT NULL
          AND server_time > CURRENT_TIMESTAMP - INTERVAL '30 days'
        GROUP BY device_id
        ORDER BY manual DESC LIMIT 200`,
      [ctx.tenantId]
    )
    const share = (m: number, f: number) => (m + f === 0 ? null : Math.round((1000 * m) / (m + f)) / 10)
    return res.json({
      windowDays: 30,
      people: people.rows.map((p: any) => ({ ...p, manualPercent: share(p.manual, p.face) })),
      devices: devices.rows.map((d: any) => ({ ...d, manualPercent: share(d.manual, d.face) })),
    })
  } catch (e) {
    return fail(res, 'load manual entries', e)
  }
})

router.get('/approvals', requirePlatform('corporate'), approvers, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const r = await query(
      `SELECT ev.id AS event_id, ev.checkin_id, ev.employee_id, ev.reason_code, ev.reason_text, ev.device_id,
              ev.server_time, c.check_in_time, c.check_out_time, e.first_name, e.last_name, e.employee_id AS employee_number
         FROM attendance_events ev
         JOIN corporate_checkins c ON c.id = ev.checkin_id AND c.tenant_id = ev.tenant_id
         JOIN employees e ON e.id = ev.employee_id AND e.tenant_id = ev.tenant_id
        WHERE ev.tenant_id = $1 AND ev.kind = 'check_in' AND ev.approval_state = 'pending'
          AND NOT EXISTS (SELECT 1 FROM attendance_events d
                           WHERE d.tenant_id = ev.tenant_id AND d.kind = 'approval' AND d.supersedes_event_id = ev.id)
        ORDER BY ev.server_time`,
      [ctx.tenantId]
    )
    return res.json({ approvals: r.rows })
  } catch (e) {
    return fail(res, 'load approvals', e)
  }
})

router.post('/approvals/:eventId', requirePlatform('corporate'), approvers, async (req: TenantRequest, res: Response) => {
  const client = await getConnection()
  try {
    const ctx = ctxOf(req)
    const decision = String(req.body?.decision ?? '')
    if (decision !== 'approved' && decision !== 'rejected') {
      return res.status(400).json({ error: "decision must be 'approved' or 'rejected'" })
    }
    const note = req.body?.note ? String(req.body.note) : null
    if (decision === 'rejected' && !(note && note.trim().length >= 3)) {
      return res.status(400).json({ error: 'Rejecting a check-in has to say why' })
    }
    // Nobody approves their own check-in (as with pay and timesheets).
    if (UUID.test(req.params.eventId)) {
      const own = await query(
        `SELECT 1 FROM attendance_events ev JOIN employees e ON e.id = ev.employee_id AND e.tenant_id = ev.tenant_id
          WHERE ev.id = $1 AND ev.tenant_id = $2 AND e.user_id = $3`,
        [req.params.eventId, ctx.tenantId, ctx.userId]
      )
      if (own.rows.length && !ctx.isSuperadmin) {
        return res.status(403).json({ error: 'You cannot decide your own check-in; somebody else has to' })
      }
    }
    await client.query('BEGIN')
    const done = await decideCheckIn(client, { tenantId: ctx.tenantId, userId: ctx.userId }, req.params.eventId, decision, note)
    await client.query('COMMIT')
    return res.json({ decided: decision, ...done })
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined)
    return fail(res, 'decide the check-in', e)
  } finally {
    client.release()
  }
})

const SETTINGS: Record<string, { key: string; fallback: number; max: number }> = {
  manualApprovalThreshold: { key: 'attendance.manual_approval_threshold', fallback: 3, max: 1000 },
  deviceManualAlert: { key: 'attendance.device_manual_alert', fallback: ALERT_DEFAULTS.deviceManualPerHour, max: 1000 },
  faceNotRecognisedAlert: { key: 'attendance.face_not_recognised_alert', fallback: ALERT_DEFAULTS.faceNotRecognisedPerWeek, max: 1000 },
  shiftEarlyMinutes: { key: 'attendance.shift_early_minutes', fallback: ALERT_DEFAULTS.shiftEarlyMinutes, max: 600 },
}

async function readSettings(tenantId: string) {
  const r = await query(
    `SELECT setting_key, setting_value FROM tenant_settings WHERE tenant_id = $1 AND setting_key = ANY($2)`,
    [tenantId, Object.values(SETTINGS).map((s) => s.key)]
  )
  const have = new Map(r.rows.map((x: any) => [x.setting_key, Number(x.setting_value)]))
  return Object.fromEntries(Object.entries(SETTINGS).map(([name, s]) => {
    const v = have.get(s.key)
    return [name, v !== undefined && Number.isInteger(v) && v >= 0 ? v : s.fallback]
  }))
}

router.get('/settings', reviewers, async (req: TenantRequest, res: Response) => {
  try {
    return res.json({ settings: await readSettings(ctxOf(req).tenantId) })
  } catch (e) {
    return fail(res, 'load settings', e)
  }
})

router.put('/settings', settingsAdmins, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const b = req.body ?? {}
    for (const [name, s] of Object.entries(SETTINGS)) {
      if (b[name] === undefined) continue
      const v = Number(b[name])
      if (!Number.isInteger(v) || v < 0 || v > s.max) {
        return res.status(400).json({ error: `${name} must be a whole number from 0 to ${s.max}` })
      }
      await query(
        `INSERT INTO tenant_settings (tenant_id, setting_key, setting_value, updated_at, updated_by)
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP, $4)
         ON CONFLICT (tenant_id, setting_key) DO UPDATE
           SET setting_value = EXCLUDED.setting_value, updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by`,
        [ctx.tenantId, s.key, String(v), ctx.userId]
      )
    }
    return res.json({ settings: await readSettings(ctx.tenantId) })
  } catch (e) {
    return fail(res, 'save settings', e)
  }
})

export default router
