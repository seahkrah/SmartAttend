/**
 * Where, from what and when employees may check in (brief 5.5): the
 * administrator's side of src/attendance/controls.ts.
 *
 *   GET    /settings                 the four controls' modes and their numbers
 *   PUT    /settings
 *   GET    /sites                    places people work: a circle and its networks
 *   POST   /sites
 *   PATCH  /sites/:siteId
 *   DELETE /sites/:siteId            retires it (is_active false); nothing is deleted
 *   GET    /devices                  registered devices, revoked ones with ?all=true
 *   POST   /devices                  one person's device, or a shared kiosk (no employeeId)
 *   DELETE /devices/:id              revokes it
 *
 * Reading is for the admin, HR and the HR director; changing for the admin and
 * the HR director, as for the manual fallback's thresholds. Every change is
 * in the audit log. Mounted at /api/checkin-controls, employers only.
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
import { query } from '../db/connection.js'
import { CONTROL_DEFAULTS, validCidr } from '../attendance/controls.js'
import { auditActorClass, logAudit } from '../services/domainAuditService.js'
import { getClientIp } from '../utils/getClientIp.js'

const router = Router()
router.use(authenticateToken, resolveTenantContext, requireTenant, requirePlatform('corporate'))

const readers = requireRoles('admin', 'hr', 'hr_director')
const admins = requireRoles('admin', 'hr_director')

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MODES = ['off', 'flag', 'enforce']
const CONTROLS = ['geofence', 'network', 'device', 'shift_window'] as const
const NUMBERS: Record<string, { key: string; fallback: number; min: number; max: number }> = {
  maxAccuracyMetres: { key: 'checkin.max_accuracy_m', fallback: CONTROL_DEFAULTS.maxAccuracyMetres, min: 5, max: 1000 },
  shiftEarlyMinutes: { key: 'attendance.shift_early_minutes', fallback: CONTROL_DEFAULTS.shiftEarlyMinutes, min: 0, max: 720 },
  shiftLateMinutes: { key: 'checkin.shift_late_minutes', fallback: CONTROL_DEFAULTS.shiftLateMinutes, min: 0, max: 720 },
  buddySeconds: { key: 'checkin.buddy_seconds', fallback: CONTROL_DEFAULTS.buddySeconds, min: 0, max: 3600 },
  maxSpeedKmh: { key: 'checkin.max_speed_kmh', fallback: CONTROL_DEFAULTS.maxSpeedKmh, min: 0, max: 2000 },
}

class Bad extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
  }
}

function ctxOf(req: TenantRequest) {
  return req.ctx as NonNullable<TenantRequest['ctx']> & { tenantId: string }
}

function fail(res: Response, label: string, e: unknown) {
  if (e instanceof Bad) return res.status(e.status).json({ error: e.message })
  if ((e as any)?.code === '23505') return res.status(409).json({ error: 'That device is already registered' })
  console.error(`[CHECKIN_CONTROLS] ${label}:`, e)
  return res.status(500).json({ error: `Failed to ${label}` })
}

async function audit(req: TenantRequest, action: string, resourceType: string, resourceId: string | undefined, after: unknown, before?: unknown) {
  const ctx = ctxOf(req)
  const actor = ctx.isSuperadmin ? 'superadmin' : auditActorClass(ctx.roleName)
  await logAudit({
    actorId: ctx.userId, actorRole: ctx.isSuperadmin ? 'superadmin' : ctx.roleName ?? undefined,
    actionType: action, actionScope: actor === 'user' ? 'USER' : 'TENANT',
    resourceType, resourceId, beforeState: before, afterState: after,
    ipAddress: getClientIp(req), tenantId: ctx.tenantId,
  })
}

async function readSettings(tenantId: string) {
  const r = await query(
    `SELECT setting_key, setting_value FROM tenant_settings
      WHERE tenant_id = $1 AND (setting_key LIKE 'checkin.%' OR setting_key = 'attendance.shift_early_minutes')`, [tenantId])
  const s = new Map(r.rows.map((x: any) => [x.setting_key, x.setting_value]))
  const out: Record<string, unknown> = {}
  for (const c of CONTROLS) {
    const v = s.get(`checkin.${c}`)
    out[c] = MODES.includes(v) ? v : 'off'
  }
  for (const [name, n] of Object.entries(NUMBERS)) {
    const v = Number(s.get(n.key))
    out[name] = s.has(n.key) && Number.isInteger(v) && v >= n.min && v <= n.max ? v : n.fallback
  }
  return out
}

async function saveSetting(tenantId: string, userId: string, key: string, value: string) {
  await query(
    `INSERT INTO tenant_settings (tenant_id, setting_key, setting_value, updated_at, updated_by)
     VALUES ($1, $2, $3, CURRENT_TIMESTAMP, $4)
     ON CONFLICT (tenant_id, setting_key) DO UPDATE
       SET setting_value = EXCLUDED.setting_value, updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by`,
    [tenantId, key, value, userId])
}

router.get('/settings', readers, async (req: TenantRequest, res: Response) => {
  try {
    return res.json({ settings: await readSettings(ctxOf(req).tenantId) })
  } catch (e) {
    return fail(res, 'load the check-in controls', e)
  }
})

router.put('/settings', admins, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const b = req.body ?? {}
    // Everything is validated before anything is saved.
    const writes: [string, string][] = []
    for (const c of CONTROLS) {
      if (b[c] === undefined) continue
      if (!MODES.includes(b[c])) throw new Bad(`${c} must be off, flag or enforce`)
      writes.push([`checkin.${c}`, b[c]])
    }
    for (const [name, n] of Object.entries(NUMBERS)) {
      if (b[name] === undefined) continue
      const v = Number(b[name])
      if (!Number.isInteger(v) || v < n.min || v > n.max) throw new Bad(`${name} must be a whole number from ${n.min} to ${n.max}`)
      writes.push([n.key, String(v)])
    }
    const before = await readSettings(ctx.tenantId)
    for (const [k, v] of writes) await saveSetting(ctx.tenantId, ctx.userId, k, v)
    const after = await readSettings(ctx.tenantId)
    if (writes.length) await audit(req, 'CHECKIN_CONTROLS_CHANGED', 'tenant_settings', undefined, after, before)
    return res.json({ settings: after })
  } catch (e) {
    return fail(res, 'save the check-in controls', e)
  }
})

function siteInput(b: any, partial: boolean) {
  const out: Record<string, unknown> = {}
  if (!partial || b.name !== undefined) {
    const name = String(b.name ?? '').trim()
    if (name.length < 2 || name.length > 120) throw new Bad('A site needs a name of 2 to 120 characters')
    out.name = name
  }
  for (const [k, lim] of [['latitude', 90], ['longitude', 180]] as const) {
    if (partial && b[k] === undefined) continue
    const v = Number(b[k])
    if (b[k] === null || b[k] === '' || !Number.isFinite(v) || Math.abs(v) > lim) throw new Bad(`${k} must be a number from -${lim} to ${lim}`)
    out[k] = v
  }
  if (b.radiusMetres !== undefined) {
    const v = Number(b.radiusMetres)
    if (!Number.isInteger(v) || v < 10 || v > 5000) throw new Bad('radiusMetres must be a whole number from 10 to 5000')
    out.radius_m = v
  }
  if (b.allowedCidrs !== undefined) {
    if (!Array.isArray(b.allowedCidrs) || b.allowedCidrs.length > 50) throw new Bad('allowedCidrs must be a list of at most 50 networks')
    const cidrs = b.allowedCidrs.map((x: unknown) => String(x).trim()).filter(Boolean)
    const bad = cidrs.find((x: string) => !validCidr(x))
    if (bad) throw new Bad(`"${bad.slice(0, 60)}" is not a network (e.g. 203.0.113.0/24 or 2001:db8::/32)`)
    out.allowed_cidrs = cidrs
  }
  if (b.isActive !== undefined) out.is_active = b.isActive === true
  return out
}

const SITE_COLUMNS = `id, name, latitude::float8 AS latitude, longitude::float8 AS longitude, radius_m AS "radiusMetres",
  allowed_cidrs AS "allowedCidrs", is_active AS "isActive", created_at AS "createdAt", updated_at AS "updatedAt"`

router.get('/sites', readers, async (req: TenantRequest, res: Response) => {
  try {
    const r = await query(`SELECT ${SITE_COLUMNS} FROM checkin_sites WHERE tenant_id = $1 ORDER BY is_active DESC, name`,
      [ctxOf(req).tenantId])
    return res.json({ sites: r.rows })
  } catch (e) {
    return fail(res, 'load the sites', e)
  }
})

router.post('/sites', admins, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const v = siteInput(req.body ?? {}, false)
    const r = await query(
      `INSERT INTO checkin_sites (tenant_id, name, latitude, longitude, radius_m, allowed_cidrs, created_by)
       VALUES ($1, $2, $3, $4, COALESCE($5, 150), COALESCE($6, '{}'::text[]), $7)
       RETURNING ${SITE_COLUMNS}`,
      [ctx.tenantId, v.name, v.latitude, v.longitude, v.radius_m ?? null, v.allowed_cidrs ?? null, ctx.userId])
    await audit(req, 'CHECKIN_SITE_CREATED', 'checkin_site', r.rows[0].id, r.rows[0])
    return res.status(201).json({ site: r.rows[0] })
  } catch (e) {
    return fail(res, 'add the site', e)
  }
})

router.patch('/sites/:siteId', admins, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    if (!UUID.test(req.params.siteId)) throw new Bad('No such site', 404)
    const v = siteInput(req.body ?? {}, true)
    const before = await query(`SELECT ${SITE_COLUMNS} FROM checkin_sites WHERE id = $1 AND tenant_id = $2`, [req.params.siteId, ctx.tenantId])
    if (!before.rows.length) throw new Bad('No such site', 404)
    if (!Object.keys(v).length) return res.json({ site: before.rows[0] })
    // One fixed statement: a field not sent keeps its value (no SQL is built from the request).
    const r = await query(
      `UPDATE checkin_sites
          SET name = COALESCE($3, name), latitude = COALESCE($4, latitude), longitude = COALESCE($5, longitude),
              radius_m = COALESCE($6, radius_m), allowed_cidrs = COALESCE($7::text[], allowed_cidrs),
              is_active = COALESCE($8, is_active), updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND tenant_id = $2 RETURNING ${SITE_COLUMNS}`,
      [req.params.siteId, ctx.tenantId, v.name ?? null, v.latitude ?? null, v.longitude ?? null, v.radius_m ?? null,
       v.allowed_cidrs ?? null, v.is_active ?? null])
    await audit(req, 'CHECKIN_SITE_CHANGED', 'checkin_site', req.params.siteId, r.rows[0], before.rows[0])
    return res.json({ site: r.rows[0] })
  } catch (e) {
    return fail(res, 'change the site', e)
  }
})

router.delete('/sites/:siteId', admins, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    if (!UUID.test(req.params.siteId)) throw new Bad('No such site', 404)
    const r = await query(
      `UPDATE checkin_sites SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND tenant_id = $2 RETURNING ${SITE_COLUMNS}`, [req.params.siteId, ctx.tenantId])
    if (!r.rows.length) throw new Bad('No such site', 404)
    await audit(req, 'CHECKIN_SITE_RETIRED', 'checkin_site', req.params.siteId, r.rows[0])
    return res.json({ site: r.rows[0] })
  } catch (e) {
    return fail(res, 'retire the site', e)
  }
})

const DEVICE_COLUMNS = `d.id, d.device_id AS "deviceId", d.employee_id AS "employeeId", d.label,
  d.registered_at AS "registeredAt", d.revoked_at AS "revokedAt",
  CASE WHEN e.id IS NULL THEN NULL ELSE e.first_name || ' ' || e.last_name END AS "employeeName"`

router.get('/devices', readers, async (req: TenantRequest, res: Response) => {
  try {
    const r = await query(
      `SELECT ${DEVICE_COLUMNS} FROM attendance_devices d
         LEFT JOIN employees e ON e.id = d.employee_id AND e.tenant_id = d.tenant_id
        WHERE d.tenant_id = $1 AND ($2 OR d.revoked_at IS NULL)
        ORDER BY d.revoked_at NULLS FIRST, d.registered_at DESC LIMIT 500`,
      [ctxOf(req).tenantId, req.query.all === 'true'])
    return res.json({ devices: r.rows })
  } catch (e) {
    return fail(res, 'load the devices', e)
  }
})

router.post('/devices', admins, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const b = req.body ?? {}
    const deviceId = String(b.deviceId ?? '').trim()
    if (deviceId.length < 8 || deviceId.length > 128) throw new Bad('deviceId must be 8 to 128 characters')
    let employeeId: string | null = null
    if (b.employeeId !== undefined && b.employeeId !== null && b.employeeId !== '') {
      if (!UUID.test(String(b.employeeId))) throw new Bad('No such employee', 404)
      const emp = await query(`SELECT id FROM employees WHERE id = $1 AND tenant_id = $2`, [b.employeeId, ctx.tenantId])
      if (!emp.rows.length) throw new Bad('No such employee', 404)
      employeeId = emp.rows[0].id
    }
    const label = b.label === undefined || b.label === null ? null : String(b.label).trim().slice(0, 120) || null
    const r = await query(
      `INSERT INTO attendance_devices (tenant_id, device_id, employee_id, label, registered_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`, [ctx.tenantId, deviceId, employeeId, label, ctx.userId])
    const row = await query(
      `SELECT ${DEVICE_COLUMNS} FROM attendance_devices d
         LEFT JOIN employees e ON e.id = d.employee_id AND e.tenant_id = d.tenant_id WHERE d.id = $1`, [r.rows[0].id])
    await audit(req, 'ATTENDANCE_DEVICE_REGISTERED', 'attendance_device', r.rows[0].id, row.rows[0])
    return res.status(201).json({ device: row.rows[0] })
  } catch (e) {
    return fail(res, 'register the device', e)
  }
})

router.delete('/devices/:id', admins, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    if (!UUID.test(req.params.id)) throw new Bad('No such device', 404)
    const r = await query(
      `UPDATE attendance_devices SET revoked_at = CURRENT_TIMESTAMP, revoked_by = $3
        WHERE id = $1 AND tenant_id = $2 AND revoked_at IS NULL RETURNING id, device_id AS "deviceId", employee_id AS "employeeId"`,
      [req.params.id, ctx.tenantId, ctx.userId])
    if (!r.rows.length) throw new Bad('No such device, or it is already revoked', 404)
    await audit(req, 'ATTENDANCE_DEVICE_REVOKED', 'attendance_device', req.params.id, r.rows[0])
    return res.json({ revoked: r.rows[0] })
  } catch (e) {
    return fail(res, 'revoke the device', e)
  }
})

export default router
