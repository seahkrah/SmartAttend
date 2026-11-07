/**
 * Attendance kiosks (brief 5.5, 5.7): a shared device at a site where
 * employees check in and out by face, or by hand with the attendant's PIN.
 *
 * Administration, with a user session (mounted at /api/kiosk/admin):
 *   GET    /devices                     the tenant's kiosks
 *   POST   /devices                     create one at a site, with a PIN; answers with its pairing code, once
 *   POST   /devices/:kioskId/pairing-code  a new code; the paired device must pair again
 *   POST   /devices/:kioskId/pin        change the attendant PIN
 *   DELETE /devices/:kioskId            revoke: its token stops working at once
 * The admin and HR director create and change; HR reads. Every change is audited.
 *
 * The kiosk itself, with its token (mounted at /api/kiosk):
 *   POST /pair                 a pairing code for a token
 *   GET  /session              what kiosk this is, and whether face check-in is on
 *   POST /lookup               an employee number: who, whether on the clock, whether face is possible
 *   POST /face/challenge       a face challenge for that employee, bound to this kiosk
 *   POST /face/verify          the photos; a match the punch can cite
 *   POST /punch                check in or out: with that match, or with the attendant's PIN and a reason
 *
 * A kiosk sees one employee at a time, by the number they type, and learns
 * their first name and initial: it cannot list anyone. Its check-ins go
 * through the attendance core like any other, with the kiosk's device id and
 * address, and the tenant's check-in controls apply (controls.ts): the
 * kiosk is placed at its registered site, its network is checked, its device
 * is registered as a shared kiosk, the shift window applies to the employee.
 * An idempotency key makes a retried punch answer with the first result.
 */
import { Router, type Response } from 'express'
import multer from 'multer'
import bcrypt from 'bcryptjs'
import { randomUUID } from 'crypto'
import { authenticateToken } from '../auth/middleware.js'
import {
  requirePlatform, requireRoles, requireTenant, resolveTenantContext,
  type ResolvedTenantContext, type TenantRequest,
} from '../auth/tenantContextMiddleware.js'
import { publicRoute } from '../auth/guards.js'
import { query, getConnection } from '../db/connection.js'
import { asEmployee, kioskAuth, newPairingCode, pair, PAIRING_MINUTES, sha256, type KioskRequest } from '../kiosk/auth.js'
import { assertUsableMatch, BiometricError, getSettings, issueChallenge, verify } from '../biometrics/service.js'
import { IMAGE_LIMITS } from '../biometrics/engine.js'
import { checkIn, checkOut, WorkforceError } from '../services/workforceService.js'
import { AttendanceInputError, REASON_CODES } from '../attendance/core.js'
import { auditIn } from '../services/domainAuditService.js'
import { getClientIp } from '../utils/getClientIp.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PIN = /^\d{4,8}$/
export const PIN_FAILURES_BEFORE_LOCK = 5
export const PIN_LOCK_MINUTES = 15

function fail(res: Response, label: string, e: unknown) {
  if (e instanceof BiometricError) return res.status(e.status).json({ error: e.message, code: e.code })
  if (e instanceof AttendanceInputError) return res.status(e.status).json({ error: e.message, code: e.code })
  if (e instanceof WorkforceError) return res.status(e.status).json({ error: e.message })
  if ((e as any)?.status === 400 || (e as any)?.status === 404) return res.status((e as any).status).json({ error: (e as Error).message })
  if ((e as any)?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'A photo is too large', code: 'too_large' })
  if ((e as any)?.code === '23505' && (e as any)?.constraint === 'uq_corporate_checkins_face_match') {
    return res.status(409).json({ error: 'That face match has already been used', code: 'match_used' })
  }
  console.error(`[KIOSK] ${label}:`, e)
  return res.status(500).json({ error: `Failed to ${label}` })
}

class Bad extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
  }
}

// ===========================================================================
// Administration
// ===========================================================================

export const kioskAdminRouter = Router()
kioskAdminRouter.use(authenticateToken, resolveTenantContext, requireTenant, requirePlatform('corporate'))
const readers = requireRoles('admin', 'hr', 'hr_director')
const admins = requireRoles('admin', 'hr_director')

const adminCtx = (req: TenantRequest) => req.ctx as ResolvedTenantContext & { tenantId: string }

const KIOSK_COLUMNS = `k.id, k.label, k.device_id AS "deviceId", k.site_id AS "siteId", s.name AS "siteName",
  k.created_at AS "createdAt", k.paired_at AS "pairedAt", k.last_seen_at AS "lastSeenAt", k.revoked_at AS "revokedAt",
  (k.token_hash IS NOT NULL) AS paired, (k.pairing_hash IS NOT NULL AND k.pairing_expires_at > CURRENT_TIMESTAMP) AS "awaitingPairing",
  (k.pin_locked_until > CURRENT_TIMESTAMP) AS "pinLocked"`

async function kioskRow(runner: { query: (s: string, p?: unknown[]) => Promise<any> }, tenantId: string, id: string) {
  const r = await runner.query(
    `SELECT ${KIOSK_COLUMNS} FROM kiosks k JOIN checkin_sites s ON s.id = k.site_id AND s.tenant_id = k.tenant_id
      WHERE k.id = $1 AND k.tenant_id = $2`, [id, tenantId])
  return r.rows[0] ?? null
}

kioskAdminRouter.get('/devices', readers, async (req: TenantRequest, res: Response) => {
  try {
    const r = await query(
      `SELECT ${KIOSK_COLUMNS} FROM kiosks k JOIN checkin_sites s ON s.id = k.site_id AND s.tenant_id = k.tenant_id
        WHERE k.tenant_id = $1 AND ($2 OR k.revoked_at IS NULL) ORDER BY k.revoked_at NULLS FIRST, k.created_at DESC`,
      [adminCtx(req).tenantId, req.query.all === 'true'])
    return res.json({ kiosks: r.rows })
  } catch (e) {
    return fail(res, 'load the kiosks', e)
  }
})

kioskAdminRouter.post('/devices', admins, async (req: TenantRequest, res: Response) => {
  const ctx = adminCtx(req)
  const b = req.body ?? {}
  const label = String(b.label ?? '').trim()
  if (label.length < 2 || label.length > 120) return res.status(400).json({ error: 'A kiosk needs a label of 2 to 120 characters' })
  if (!PIN.test(String(b.pin ?? ''))) return res.status(400).json({ error: 'The attendant PIN is 4 to 8 digits' })
  if (!UUID.test(String(b.siteId ?? ''))) return res.status(404).json({ error: 'No such site' })
  const client = await getConnection()
  try {
    await client.query('BEGIN')
    const site = await client.query(`SELECT id FROM checkin_sites WHERE id = $1 AND tenant_id = $2 AND is_active`, [b.siteId, ctx.tenantId])
    if (!site.rows.length) {
      await client.query('ROLLBACK')
      return res.status(404).json({ error: 'No such site' })
    }
    const deviceId = `kiosk-${randomUUID()}`
    const code = newPairingCode()
    const created = await client.query(
      `INSERT INTO kiosks (tenant_id, site_id, device_id, label, pairing_hash, pairing_expires_at, pin_hash, created_by)
       VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP + make_interval(mins => $6), $7, $8)
       RETURNING id, pairing_expires_at`,
      [ctx.tenantId, b.siteId, deviceId, label, sha256(code), PAIRING_MINUTES, await bcrypt.hash(String(b.pin), 10), ctx.userId])
    // Registered as a shared kiosk, so the device control lets it through.
    await client.query(
      `INSERT INTO attendance_devices (tenant_id, device_id, employee_id, label, registered_by) VALUES ($1, $2, NULL, $3, $4)`,
      [ctx.tenantId, deviceId, `Kiosk: ${label}`, ctx.userId])
    const kiosk = await kioskRow(client, ctx.tenantId, created.rows[0].id)
    await auditIn(client, ctx, { actionType: 'KIOSK_CREATED', resourceType: 'kiosk', resourceId: kiosk.id,
      afterState: { label, siteId: b.siteId, deviceId }, ipAddress: getClientIp(req) })
    await client.query('COMMIT')
    return res.status(201).json({ kiosk, pairingCode: code, pairingExpiresAt: created.rows[0].pairing_expires_at })
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined)
    return fail(res, 'create the kiosk', e)
  } finally {
    client.release()
  }
})

kioskAdminRouter.post('/devices/:kioskId/pairing-code', admins, async (req: TenantRequest, res: Response) => {
  const ctx = adminCtx(req)
  if (!UUID.test(req.params.kioskId)) return res.status(404).json({ error: 'No such kiosk' })
  const client = await getConnection()
  try {
    await client.query('BEGIN')
    const code = newPairingCode()
    // A new code unpairs the device that had it: it must pair again.
    const r = await client.query(
      `UPDATE kiosks SET pairing_hash = $3, pairing_expires_at = CURRENT_TIMESTAMP + make_interval(mins => $4), token_hash = NULL
        WHERE id = $1 AND tenant_id = $2 AND revoked_at IS NULL RETURNING pairing_expires_at`,
      [req.params.kioskId, ctx.tenantId, sha256(code), PAIRING_MINUTES])
    if (!r.rows.length) {
      await client.query('ROLLBACK')
      return res.status(404).json({ error: 'No such kiosk, or it is revoked' })
    }
    await auditIn(client, ctx, { actionType: 'KIOSK_PAIRING_CODE_ISSUED', resourceType: 'kiosk', resourceId: req.params.kioskId,
      ipAddress: getClientIp(req) })
    await client.query('COMMIT')
    return res.json({ pairingCode: code, pairingExpiresAt: r.rows[0].pairing_expires_at })
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined)
    return fail(res, 'issue a pairing code', e)
  } finally {
    client.release()
  }
})

kioskAdminRouter.post('/devices/:kioskId/pin', admins, async (req: TenantRequest, res: Response) => {
  const ctx = adminCtx(req)
  if (!UUID.test(req.params.kioskId)) return res.status(404).json({ error: 'No such kiosk' })
  if (!PIN.test(String(req.body?.pin ?? ''))) return res.status(400).json({ error: 'The attendant PIN is 4 to 8 digits' })
  const client = await getConnection()
  try {
    await client.query('BEGIN')
    const r = await client.query(
      `UPDATE kiosks SET pin_hash = $3, pin_failures = 0, pin_locked_until = NULL
        WHERE id = $1 AND tenant_id = $2 AND revoked_at IS NULL RETURNING id`,
      [req.params.kioskId, ctx.tenantId, await bcrypt.hash(String(req.body.pin), 10)])
    if (!r.rows.length) {
      await client.query('ROLLBACK')
      return res.status(404).json({ error: 'No such kiosk, or it is revoked' })
    }
    await auditIn(client, ctx, { actionType: 'KIOSK_PIN_CHANGED', resourceType: 'kiosk', resourceId: req.params.kioskId,
      ipAddress: getClientIp(req) })
    await client.query('COMMIT')
    return res.json({ changed: true })
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined)
    return fail(res, 'change the PIN', e)
  } finally {
    client.release()
  }
})

kioskAdminRouter.delete('/devices/:kioskId', admins, async (req: TenantRequest, res: Response) => {
  const ctx = adminCtx(req)
  if (!UUID.test(req.params.kioskId)) return res.status(404).json({ error: 'No such kiosk' })
  const client = await getConnection()
  try {
    await client.query('BEGIN')
    const r = await client.query(
      `UPDATE kiosks SET revoked_at = CURRENT_TIMESTAMP, revoked_by = $3, token_hash = NULL, pairing_hash = NULL, pairing_expires_at = NULL
        WHERE id = $1 AND tenant_id = $2 AND revoked_at IS NULL RETURNING device_id, label`,
      [req.params.kioskId, ctx.tenantId, ctx.userId])
    if (!r.rows.length) {
      await client.query('ROLLBACK')
      return res.status(404).json({ error: 'No such kiosk, or it is already revoked' })
    }
    await client.query(
      `UPDATE attendance_devices SET revoked_at = CURRENT_TIMESTAMP, revoked_by = $3
        WHERE tenant_id = $1 AND device_id = $2 AND revoked_at IS NULL`, [ctx.tenantId, r.rows[0].device_id, ctx.userId])
    await auditIn(client, ctx, { actionType: 'KIOSK_REVOKED', resourceType: 'kiosk', resourceId: req.params.kioskId,
      afterState: { label: r.rows[0].label }, ipAddress: getClientIp(req) })
    await client.query('COMMIT')
    return res.json({ revoked: true })
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined)
    return fail(res, 'revoke the kiosk', e)
  } finally {
    client.release()
  }
})

// ===========================================================================
// The kiosk
// ===========================================================================

export const kioskRouter = Router()

kioskRouter.post('/pair', publicRoute('a pairing code, shown once to an administrator and valid for 15 minutes, is the credential'),
  async (req: TenantRequest, res: Response) => {
    try {
      const done = await pair(req.body?.code)
      if (!done) return res.status(401).json({ error: 'That pairing code is not valid, or has expired', code: 'bad_pairing_code' })
      return res.status(201).json({ token: done.token, kiosk: { id: done.kiosk.id, label: done.kiosk.label } })
    } catch (e) {
      return fail(res, 'pair the kiosk', e)
    }
  })

kioskRouter.use(kioskAuth('a paired kiosk: one employee at a time, by the number they type, at its own site'))

const kioskOf = (req: KioskRequest) => req.kiosk!

interface KioskEmployee { id: string; userId: string; firstName: string; lastName: string; platformId: string }

async function employeeByCode(req: KioskRequest, raw: unknown): Promise<KioskEmployee> {
  const code = String(raw ?? '').trim()
  if (!code || code.length > 50) throw new Bad('Type your employee number')
  const r = await query(
    `SELECT e.id, e.user_id, e.first_name, e.last_name, u.platform_id
       FROM employees e JOIN users u ON u.id = e.user_id
      WHERE e.tenant_id = $1 AND upper(e.employee_id) = upper($2) AND e.is_currently_employed`,
    [kioskOf(req).tenantId, code])
  // An employee with no account cannot be the actor of their own check-in here.
  if (!r.rows.length) throw new Bad('No employee with that number. Ask the attendant.', 404)
  const x = r.rows[0]
  return { id: x.id, userId: x.user_id, firstName: x.first_name, lastName: x.last_name, platformId: x.platform_id }
}

/** The employee as the actor of what they do at the kiosk. */
function employeeCtx(req: KioskRequest, emp: KioskEmployee): ResolvedTenantContext & { tenantId: string } {
  return {
    userId: emp.userId, roleId: '', roleName: 'employee', platformId: emp.platformId, platformKind: 'corporate',
    tenantId: kioskOf(req).tenantId, tenantName: null, memberships: [], isSuperadmin: false,
  }
}

kioskRouter.get('/session', async (req: KioskRequest, res: Response) => {
  try {
    const k = kioskOf(req)
    const site = await query(`SELECT name, is_active FROM checkin_sites WHERE id = $1 AND tenant_id = $2`, [k.siteId, k.tenantId])
    const tenant = await query(`SELECT name FROM tenants WHERE id = $1`, [k.tenantId])
    const face = await getSettings(k.tenantId)
    return res.json({
      kiosk: { id: k.id, label: k.label, site: site.rows[0]?.name ?? null, siteActive: site.rows[0]?.is_active === true },
      organisation: tenant.rows[0]?.name ?? null,
      faceEnabled: face.enabled && face.configured,
      reasonCodes: REASON_CODES,
    })
  } catch (e) {
    return fail(res, 'load the kiosk', e)
  }
})

kioskRouter.post('/lookup', async (req: KioskRequest, res: Response) => {
  try {
    const k = kioskOf(req)
    const emp = await employeeByCode(req, req.body?.employeeCode)
    const open = await query(
      `SELECT 1 FROM corporate_checkins WHERE tenant_id = $1 AND employee_id = $2 AND check_out_time IS NULL
          AND check_in_time > LOCALTIMESTAMP - INTERVAL '24 hours'`, [k.tenantId, emp.id])
    const settings = await getSettings(k.tenantId)
    const ready = await query(
      `SELECT (SELECT count(*) FROM biometric_consents c WHERE c.tenant_id = $1 AND c.subject_type = 'employee' AND c.subject_id = $2
                 AND c.withdrawn_at IS NULL)::int AS consent,
              (SELECT count(*) FROM face_templates t WHERE t.tenant_id = $1 AND t.subject_type = 'employee' AND t.subject_id = $2)::int AS template`,
      [k.tenantId, emp.id])
    return res.json({
      employee: { displayName: `${emp.firstName} ${(emp.lastName ?? '').slice(0, 1)}.`.trim() },
      onTheClock: open.rows.length > 0,
      faceAvailable: settings.enabled && settings.configured && ready.rows[0].consent > 0 && ready.rows[0].template > 0,
    })
  } catch (e) {
    return fail(res, 'look up that number', e)
  }
})

kioskRouter.post('/face/challenge', async (req: KioskRequest, res: Response) => {
  try {
    const k = kioskOf(req)
    const emp = await employeeByCode(req, req.body?.employeeCode)
    const ch = await asEmployee(k, emp.userId, () => issueChallenge(employeeCtx(req, emp), 'verify', { deviceId: k.deviceId }))
    return res.status(201).json(ch)
  } catch (e) {
    return fail(res, 'start the face check', e)
  }
})

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: IMAGE_LIMITS.maxBytes, files: 5, fields: 6, fieldSize: 1024 } })

kioskRouter.post('/face/verify', (req, res, next) => {
  upload.array('frames', 5)(req as any, res as any, (err: unknown) => (err ? fail(res, 'read the photos', err) : next()))
}, async (req: KioskRequest, res: Response) => {
  try {
    const k = kioskOf(req)
    const emp = await employeeByCode(req, req.body?.employeeCode)
    const challengeId = String(req.body?.challengeId ?? '')
    // The challenge must be this kiosk's, for this employee.
    const ch = UUID.test(challengeId)
      ? await query(`SELECT 1 FROM biometric_challenges WHERE id = $1 AND tenant_id = $2 AND device_id = $3 AND issued_to = $4`,
        [challengeId, k.tenantId, k.deviceId, emp.userId])
      : { rows: [] }
    if (!ch.rows.length) return res.status(404).json({ error: 'No such face check at this kiosk', code: 'not_found' })
    const files = ((req as any).files ?? []) as Array<{ buffer: Buffer }>
    if (files.length < 2) return res.status(400).json({ error: 'Send between 2 and 5 photos', code: 'bad_frames' })
    let times: number[] | null = null
    if (req.body?.frameTimes) {
      try {
        const v = JSON.parse(String(req.body.frameTimes))
        if (Array.isArray(v) && v.length <= 5) times = v.map(Number)
      } catch {
        return res.status(400).json({ error: 'frameTimes must be a JSON array', code: 'bad_frame_times' })
      }
    }
    const out = await asEmployee(k, emp.userId, () => verify(employeeCtx(req, emp), challengeId, files.map((f) => f.buffer), times))
    return res.json({ matched: true, matchId: out.matchId, statement: (out as any).statement ?? null })
  } catch (e) {
    return fail(res, 'check the face', e)
  }
})

/**
 * The attendant's PIN, for a check-in or out without a face. Five wrong in a
 * row lock the PIN for 15 minutes, for the whole kiosk.
 */
async function checkPin(k: { id: string; tenantId: string }, pin: unknown): Promise<void> {
  const r = await query(
    `SELECT pin_hash, (pin_locked_until > CURRENT_TIMESTAMP) AS locked FROM kiosks WHERE id = $1 AND tenant_id = $2`, [k.id, k.tenantId])
  if (r.rows[0]?.locked) throw new AttendanceInputError('Too many wrong PINs. The attendant PIN is locked for a while.', 429, 'pin_locked')
  if (PIN.test(String(pin ?? '')) && (await bcrypt.compare(String(pin), r.rows[0].pin_hash))) {
    await query(`UPDATE kiosks SET pin_failures = 0 WHERE id = $1 AND tenant_id = $2`, [k.id, k.tenantId])
    return
  }
  // The fifth wrong PIN in a row locks it and starts the count again.
  await query(
    `UPDATE kiosks SET pin_failures = CASE WHEN pin_failures + 1 >= $3 THEN 0 ELSE pin_failures + 1 END,
            pin_locked_until = CASE WHEN pin_failures + 1 >= $3 THEN CURRENT_TIMESTAMP + make_interval(mins => $4) ELSE pin_locked_until END
      WHERE id = $1 AND tenant_id = $2`, [k.id, k.tenantId, PIN_FAILURES_BEFORE_LOCK, PIN_LOCK_MINUTES])
  throw new AttendanceInputError('That PIN is not right', 403, 'wrong_pin')
}

kioskRouter.post('/punch', async (req: KioskRequest, res: Response) => {
  let client
  try {
    const k = kioskOf(req)
    const b = req.body ?? {}
    const action = String(b.action ?? '')
    if (action !== 'in' && action !== 'out') return res.status(400).json({ error: "action must be 'in' or 'out'" })
    const emp = await employeeByCode(req, b.employeeCode)
    const key = b.idempotencyKey ?? req.header('idempotency-key') ?? null
    const idem = key ? `kiosk:${k.id}:${String(key).slice(0, 100)}` : null

    // A retry answers with the first result rather than recording twice.
    if (idem) {
      const prior = await query(
        `SELECT e.kind, e.checkin_id, e.employee_id, e.approval_state FROM attendance_events e
          WHERE e.tenant_id = $1 AND e.idempotency_key = $2`, [k.tenantId, idem])
      if (prior.rows.length) {
        const p = prior.rows[0]
        if (p.employee_id !== emp.id) return res.status(409).json({ error: 'That key was used for someone else', code: 'key_reused' })
        return res.json({ replayed: true, action: p.kind === 'check_out' ? 'out' : 'in', checkinId: p.checkin_id, approval: p.approval_state })
      }
    }

    const faceMatchId = b.faceMatchId ? String(b.faceMatchId) : null
    if (!faceMatchId) await checkPin(k, b.pin)

    client = await getConnection()
    const ctx = employeeCtx(req, emp)
    const site = await query(`SELECT name FROM checkin_sites WHERE id = $1 AND tenant_id = $2`, [k.siteId, k.tenantId])
    const result = await asEmployee(k, emp.userId, async () => {
      await client!.query('BEGIN')
      if (action === 'in') {
        let match: string | null = null
        if (faceMatchId) {
          match = await assertUsableMatch(client!, ctx, faceMatchId, { action: 'verified', subject: { type: 'employee', id: emp.id } })
        }
        const row = await checkIn(client!, { tenantId: k.tenantId, userId: emp.userId, platformId: emp.platformId }, emp.id, {
          checkInType: 'office', siteLocation: site.rows[0]?.name ?? k.label, faceMatchId: match,
          reasonCode: faceMatchId ? null : b.reasonCode, reasonText: faceMatchId ? null : (b.reasonText ? `${b.reasonText}` : null),
          deviceId: k.deviceId, idempotencyKey: idem, clientIp: getClientIp(req), kioskSiteId: k.siteId,
        })
        await client!.query('COMMIT')
        return { action: 'in', checkIn: row, approval: row.approval }
      }
      const row = await checkOut(client!, { tenantId: k.tenantId, userId: emp.userId, platformId: emp.platformId }, emp.id,
        { deviceId: k.deviceId, clientIp: getClientIp(req), idempotencyKey: idem })
      await client!.query('COMMIT')
      return { action: 'out', checkIn: row }
    })
    return res.status(action === 'in' ? 201 : 200).json({ replayed: false, employee: { displayName: `${emp.firstName} ${(emp.lastName ?? '').slice(0, 1)}.` }, ...result })
  } catch (e) {
    if (client) await client.query('ROLLBACK').catch(() => undefined)
    return fail(res, 'record that', e)
  } finally {
    if (client) client.release()
  }
})

