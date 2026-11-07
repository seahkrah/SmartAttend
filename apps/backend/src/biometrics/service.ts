/**
 * Face matching: consent, enrolment, verification and identification.
 *
 * Who may do what
 * ---------------
 *   consent   students: the school's administrators record it (for a minor,
 *             on the guardian's signed form) and may withdraw it.
 *             employees: HR, an administrator or the employee themselves;
 *             either may withdraw it.
 *   enrol     always supervised. students: an administrator, or a lecturer
 *             who teaches the student. employees: HR or an administrator.
 *             Self-enrolment is refused: enrolling a friend's face against
 *             your own record is exactly how someone else clocks in for you.
 *   verify    one-to-one, the employee checking themselves in.
 *   identify  one-to-many, a lecturer taking attendance for a class they
 *             teach, among that class's enrolled students.
 *
 * Every capture answers a challenge the server issued moments earlier, used
 * once. Every outcome, including failures, is written to biometric_events.
 */
import crypto from 'crypto'
import type { PoolClient } from 'pg'
import pool, { query } from '../db/connection.js'
import type { ResolvedTenantContext } from '../auth/tenantContextMiddleware.js'
import { type FaceObservation, type FrameQuality } from './engine.js'
import { assessPad, clampPadThreshold, PAD_THRESHOLD, type PadResult } from './pad.js'
import { analyzeFrame, IMAGE_LIMITS, ImageRejected, EngineUnavailable } from './faceEngine.js'
import { randomSequence, sequenceMatches, type Pose, POSES } from './pose.js'
import {
  MODEL_ID, THRESHOLDS, clampThreshold, distance, identify as identifyAmong, mean, spread,
} from './matching.js'
import { markStudent } from '../attendance/core.js'
import { auditActorClass } from '../services/domainAuditService.js'
import { BiometricKeyError, openStoredTemplate, sealTemplateForStorage, templateContext, templateKeyConfigured } from './templateCrypto.js'

export type SubjectType = 'student' | 'employee'
export interface Subject { type: SubjectType; id: string }
type Ctx = ResolvedTenantContext & { tenantId: string }

export class BiometricError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
  }
}

const CHALLENGE_TTL_SECONDS = 120
const CHALLENGES_PER_TEN_MINUTES = 30
/**
 * Per device (a lecturer's tablet identifying a class of 40, a kiosk at a
 * door) and per tenant (what the face workers can carry): set per tenant as
 * biometrics.device_challenges_per_10min and biometrics.tenant_challenges_per_minute.
 */
const DEVICE_CHALLENGES_PER_TEN_MINUTES = 200
const TENANT_CHALLENGES_PER_MINUTE = 600
/** Failed identifications from one device in ten minutes before an alert. */
const DEVICE_FAILURES_BEFORE_ALERT = 10
const FAILED_MATCHES_BEFORE_PAUSE = 5
const PAUSE_MINUTES = 15
/** A match must be used for attendance within this long of being made. */
export const MATCH_USABLE_SECONDS = 300

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const HR_ROLES = new Set(['admin', 'hr', 'hr_director'])

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface BiometricSettings { enabled: boolean; threshold: number; padThreshold: number; configured: boolean }

export async function getSettings(tenantId: string): Promise<BiometricSettings> {
  const r = await query(
    `SELECT setting_key, setting_value FROM tenant_settings
      WHERE tenant_id = $1 AND setting_key IN ('biometrics.enabled', 'biometrics.match_threshold', 'biometrics.pad_threshold')`,
    [tenantId]
  )
  const map = Object.fromEntries(r.rows.map((x: any) => [x.setting_key, x.setting_value]))
  return {
    enabled: map['biometrics.enabled'] === 'true',
    threshold: clampThreshold(map['biometrics.match_threshold'] ?? THRESHOLDS.default),
    padThreshold: clampPadThreshold(map['biometrics.pad_threshold'] ?? PAD_THRESHOLD.default),
    configured: templateKeyConfigured(),
  }
}

export async function saveSettings(ctx: Ctx, enabled: boolean, threshold: number, padThreshold?: unknown): Promise<BiometricSettings> {
  if (!['admin', 'hr_director'].includes(ctx.roleName) && !ctx.isSuperadmin) {
    throw new BiometricError(403, 'forbidden', 'Only an administrator may change face matching settings')
  }
  const t = clampThreshold(threshold)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const writes: Array<[string, string]> = [['biometrics.enabled', String(!!enabled)], ['biometrics.match_threshold', t.toFixed(2)]]
    // Tunable, but clamped to [0.5, 0.9]: a tenant cannot turn the check off.
    if (padThreshold !== undefined && padThreshold !== null) writes.push(['biometrics.pad_threshold', clampPadThreshold(padThreshold).toFixed(2)])
    for (const [key, value] of writes) {
      await client.query(
        `INSERT INTO tenant_settings (tenant_id, setting_key, setting_value, updated_at, updated_by)
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP, $4)
         ON CONFLICT (tenant_id, setting_key)
         DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = CURRENT_TIMESTAMP,
                       updated_by = EXCLUDED.updated_by`,
        [ctx.tenantId, key, value, ctx.userId]
      )
    }
    await recordEvent(client, ctx, { action: 'settings_changed', outcome: 'success',
      reason: `enabled=${!!enabled} threshold=${t.toFixed(2)}`, threshold: t })
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
  return getSettings(ctx.tenantId)
}

async function requireAvailable(tenantId: string): Promise<BiometricSettings> {
  const s = await getSettings(tenantId)
  if (!s.configured) {
    throw new BiometricError(503, 'not_configured',
      'Face matching is not configured on this server. Attendance can still be recorded manually.')
  }
  if (!s.enabled) {
    throw new BiometricError(409, 'disabled',
      'Face matching is turned off for this organisation. An administrator can turn it on.')
  }
  return s
}

// ---------------------------------------------------------------------------
// Who is who
// ---------------------------------------------------------------------------

async function subjectExists(ctx: Ctx, s: Subject): Promise<boolean> {
  if (!UUID.test(s.id)) return false
  const table = s.type === 'student' ? 'students' : 'employees'
  const r = await query(`SELECT 1 FROM ${table} WHERE id = $1 AND tenant_id = $2`, [s.id, ctx.tenantId])
  return r.rows.length > 0
}

/** The employee record of the signed-in user, if they have one here. */
export async function ownEmployeeId(ctx: Ctx): Promise<string | null> {
  const r = await query(`SELECT id FROM employees WHERE user_id = $1 AND tenant_id = $2`, [ctx.userId, ctx.tenantId])
  return r.rows[0]?.id ?? null
}

async function ownStudentId(ctx: Ctx): Promise<string | null> {
  const r = await query(`SELECT id FROM students WHERE user_id = $1 AND tenant_id = $2`, [ctx.userId, ctx.tenantId])
  return r.rows[0]?.id ?? null
}

async function lecturerTeaches(ctx: Ctx, studentId: string, scheduleId?: string): Promise<boolean> {
  const r = await query(
    `SELECT 1
       FROM class_schedules cs
       JOIN faculty f ON f.id = cs.faculty_id AND f.tenant_id = cs.tenant_id
       JOIN student_courses sc ON sc.schedule_id = cs.id AND sc.tenant_id = cs.tenant_id
      WHERE cs.tenant_id = $1 AND f.user_id = $2 AND sc.student_id = $3
        AND ($4::uuid IS NULL OR cs.id = $4::uuid)
      LIMIT 1`,
    [ctx.tenantId, ctx.userId, studentId, scheduleId ?? null]
  )
  return r.rows.length > 0
}

type Capability = 'view' | 'consent' | 'enroll' | 'delete'

/**
 * Resolves a subject inside the caller's tenant and checks the caller may act
 * on it. Another tenant's subject, or one that does not exist, is 404.
 */
export async function authorizeSubject(ctx: Ctx, s: Subject, what: Capability): Promise<void> {
  if (!(s.type === 'student' || s.type === 'employee') || !(await subjectExists(ctx, s))) {
    throw new BiometricError(404, 'not_found', 'No such person in this organisation')
  }
  const platformOk = s.type === 'student' ? ctx.platformKind === 'school' : ctx.platformKind === 'corporate'
  if (!platformOk && !ctx.isSuperadmin) {
    throw new BiometricError(404, 'not_found', 'No such person in this organisation')
  }
  const role = ctx.roleName
  let allowed = false
  if (s.type === 'student') {
    const isAdmin = role === 'admin'
    const teaches = role === 'faculty' && (await lecturerTeaches(ctx, s.id))
    const self = role === 'student' && (await ownStudentId(ctx)) === s.id
    allowed = {
      view: isAdmin || teaches || self,
      consent: isAdmin,
      enroll: isAdmin || teaches,
      delete: isAdmin,
    }[what]
  } else {
    const hr = HR_ROLES.has(role)
    const self = (await ownEmployeeId(ctx)) === s.id
    allowed = {
      view: hr || self,
      consent: hr || self,
      enroll: hr && !self,
      delete: hr,
    }[what]
  }
  if (!allowed) {
    throw new BiometricError(403, 'forbidden', 'You may not do this for this person')
  }
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

interface EventInput {
  action: 'consent_granted' | 'consent_withdrawn' | 'enrolled' | 'template_deleted' |
    'verified' | 'identified' | 'settings_changed'
  outcome: 'success' | 'failure'
  reason?: string | null
  subject?: Subject | null
  challengeId?: string | null
  scheduleId?: string | null
  distance?: number | null
  threshold?: number | null
  pad?: PadResult | null
}

async function recordEvent(runner: { query: PoolClient['query'] }, ctx: Ctx, e: EventInput): Promise<string> {
  const r = await runner.query(
    `INSERT INTO biometric_events
       (tenant_id, actor_user_id, action, outcome, reason, subject_type, subject_id,
        challenge_id, schedule_id, distance, threshold, model, pad_score, pad_signals)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
    [ctx.tenantId, ctx.userId, e.action, e.outcome, e.reason ?? null,
     e.subject?.type ?? null, e.subject?.id ?? null, e.challengeId ?? null, e.scheduleId ?? null,
     e.distance ?? null, e.threshold ?? null,
     ['enrolled', 'verified', 'identified'].includes(e.action) ? MODEL_ID : null,
     e.pad ? e.pad.score : null, e.pad ? JSON.stringify({ reasons: e.pad.reasons, ...e.pad.signals }) : null]
  )
  // The same event in the tenant's audit trail, whose rows are hash-chained
  // (migration 079), in the same transaction: a biometric event cannot be
  // removed or altered without breaking the chain (brief 5.8). What is
  // recorded is what happened and to whom, never a face or a descriptor.
  // The scope follows the actor (check_audit_scope_actor): an administrator
  // acts on the tenant, anyone else (a lecturer, an employee) as a user.
  const actorClass = ctx.isSuperadmin ? 'superadmin' : auditActorClass(ctx.roleName)
  // The device the capture came from (a kiosk's, or what a phone said it
  // was), so a face check made at a kiosk says so in the trail (audit F4).
  const device = e.challengeId
    ? (await runner.query(`SELECT device_id FROM biometric_challenges WHERE id = $1 AND tenant_id = $2`,
      [e.challengeId, ctx.tenantId])).rows[0]?.device_id ?? null
    : null
  await runner.query(
    `INSERT INTO audit_logs
       (actor_id, actor_role, action_type, action, action_scope, resource_type, resource_id,
        after_state, tenant_id, platform_id)
     VALUES ($1, $2, $3, $3, $8, 'biometric_event', $4, $5, $6, $7)`,
    [ctx.userId, actorClass,
     `BIOMETRIC_${e.action.toUpperCase()}_${e.outcome.toUpperCase()}`, r.rows[0].id,
     JSON.stringify({
       subjectType: e.subject?.type ?? null, subjectId: e.subject?.id ?? null, reason: e.reason ?? null,
       scheduleId: e.scheduleId ?? null, distance: e.distance ?? null, threshold: e.threshold ?? null,
       padScore: e.pad?.score ?? null, challengeId: e.challengeId ?? null, deviceId: device,
     }), ctx.tenantId, ctx.platformId, actorClass === 'user' ? 'USER' : 'TENANT']
  )
  return r.rows[0].id
}

/**
 * recordEvent in a transaction of its own, for callers not already in one:
 * the event and its audit row commit together or not at all (audit F3).
 * Before, these callers passed the pool's autocommit query, so each insert
 * committed on its own and an event could exist without its audit row.
 */
async function recordEventAtomic(ctx: Ctx, e: EventInput): Promise<string> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const id = await recordEvent(client, ctx, e)
    await client.query('COMMIT')
    return id
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw err
  } finally {
    client.release()
  }
}

// ---------------------------------------------------------------------------
// Consent
// ---------------------------------------------------------------------------

/**
 * Whether a student is a minor for face-matching consent: younger than the
 * tenant's biometrics.minor_age (default 18, the age of majority in Liberia;
 * a tenant elsewhere sets its own). With no date of birth recorded, a K-12
 * school's student is taken to be a minor and a college's or university's an
 * adult: the safe answer for the school, the likely one for the college.
 */
export async function isMinor(ctx: Ctx, studentId: string): Promise<boolean> {
  const r = await query(
    `SELECT s.date_of_birth, t.school_type,
            (SELECT setting_value FROM tenant_settings
              WHERE tenant_id = s.tenant_id AND setting_key = 'biometrics.minor_age') AS minor_age
       FROM students s JOIN tenants t ON t.id = s.tenant_id
      WHERE s.id = $1 AND s.tenant_id = $2`,
    [studentId, ctx.tenantId]
  )
  const row = r.rows[0]
  if (!row) return true
  const age = Number(row.minor_age)
  const minorAge = Number.isInteger(age) && age >= 1 && age <= 30 ? age : 18
  if (!row.date_of_birth) return row.school_type === 'grade_school'
  const dob = new Date(row.date_of_birth)
  const adult = new Date(dob.getFullYear() + minorAge, dob.getMonth(), dob.getDate())
  return adult.getTime() > Date.now()
}

export async function grantConsent(ctx: Ctx, s: Subject, basis: string, guardianId?: unknown) {
  await authorizeSubject(ctx, s, 'consent')
  const text = String(basis ?? '').trim()
  if (text.length < 5) {
    throw new BiometricError(400, 'basis_required',
      'Say how consent was obtained, for example "Signed consent form, 12 March"')
  }
  // A minor's consent is a guardian's: it names one of the student's own
  // linked guardians in this school (brief 5.3).
  let guardian: string | null = null
  if (s.type === 'student' && (await isMinor(ctx, s.id))) {
    if (!UUID.test(String(guardianId ?? ''))) {
      throw new BiometricError(400, 'guardian_consent_required',
        "This student is a minor: consent must name the guardian who gave it (guardianId, one of the student's guardians)")
    }
    const linked = await query(
      `SELECT 1 FROM guardian_students WHERE tenant_id = $1 AND student_id = $2 AND guardian_id = $3`,
      [ctx.tenantId, s.id, guardianId]
    )
    if (!linked.rows.length) {
      throw new BiometricError(400, 'guardian_consent_required', "That guardian is not one of this student's guardians")
    }
    guardian = String(guardianId)
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const r = await client.query(
      `INSERT INTO biometric_consents (tenant_id, subject_type, subject_id, basis, granted_by, guardian_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [ctx.tenantId, s.type, s.id, text.slice(0, 1000), ctx.userId, guardian]
    )
    await recordEvent(client, ctx, { action: 'consent_granted', outcome: 'success', subject: s })
    await client.query('COMMIT')
    return r.rows[0]
  } catch (e: any) {
    await client.query('ROLLBACK').catch(() => {})
    if (e.code === '23505') throw new BiometricError(409, 'already_consented', 'Consent is already on record')
    throw e
  } finally {
    client.release()
  }
}

export async function withdrawConsent(ctx: Ctx, s: Subject, reason: string | undefined) {
  await authorizeSubject(ctx, s, 'consent')
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // The trigger on biometric_consents deletes the template in this transaction.
    const r = await client.query(
      `UPDATE biometric_consents
          SET withdrawn_at = CURRENT_TIMESTAMP, withdrawn_by = $4, withdrawal_reason = $5
        WHERE tenant_id = $1 AND subject_type = $2 AND subject_id = $3 AND withdrawn_at IS NULL
        RETURNING id`,
      [ctx.tenantId, s.type, s.id, ctx.userId, reason ? String(reason).slice(0, 500) : null]
    )
    if (r.rows.length === 0) {
      throw new BiometricError(404, 'no_consent', 'There is no current consent to withdraw')
    }
    await recordEvent(client, ctx, { action: 'consent_withdrawn', outcome: 'success', subject: s })
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

export async function subjectStatus(ctx: Ctx, s: Subject) {
  await authorizeSubject(ctx, s, 'view')
  const consent = await query(
    `SELECT c.granted_at, c.basis, u.full_name AS granted_by_name
       FROM biometric_consents c LEFT JOIN users u ON u.id = c.granted_by
      WHERE c.tenant_id = $1 AND c.subject_type = $2 AND c.subject_id = $3 AND c.withdrawn_at IS NULL`,
    [ctx.tenantId, s.type, s.id]
  )
  const template = await query(
    `SELECT t.enrolled_at, t.frames_used, t.model, u.full_name AS enrolled_by_name
       FROM face_templates t LEFT JOIN users u ON u.id = t.enrolled_by
      WHERE t.tenant_id = $1 AND t.subject_type = $2 AND t.subject_id = $3`,
    [ctx.tenantId, s.type, s.id]
  )
  return {
    consent: consent.rows[0] ?? null,
    enrolment: template.rows[0] ?? null,
  }
}

export async function deleteTemplate(ctx: Ctx, s: Subject) {
  await authorizeSubject(ctx, s, 'delete')
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const r = await client.query(
      `DELETE FROM face_templates WHERE tenant_id = $1 AND subject_type = $2 AND subject_id = $3 RETURNING id`,
      [ctx.tenantId, s.type, s.id]
    )
    if (r.rows.length === 0) throw new BiometricError(404, 'not_enrolled', 'This person has no face template')
    await recordEvent(client, ctx, { action: 'template_deleted', outcome: 'success', subject: s })
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

// ---------------------------------------------------------------------------
// Challenges
// ---------------------------------------------------------------------------

export type Purpose = 'enroll' | 'verify' | 'identify' | 'group'

export async function issueChallenge(
  ctx: Ctx,
  purpose: Purpose,
  opts: { subject?: Subject; scheduleId?: string; deviceId?: string | null }
) {
  await requireAvailable(ctx.tenantId)
  let subject: Subject | null = null
  let scheduleId: string | null = null

  if (purpose === 'enroll') {
    if (!opts.subject) throw new BiometricError(400, 'subject_required', 'Say whose face is being enrolled')
    await authorizeSubject(ctx, opts.subject, 'enroll')
    subject = opts.subject
    await requireConsent(ctx, subject)
  } else if (purpose === 'verify') {
    const own = await ownEmployeeId(ctx)
    if (!own) throw new BiometricError(404, 'not_found', 'You have no employee record here')
    subject = { type: 'employee', id: own }
    await requireTemplate(ctx, subject)
    await refuseIfPaused(ctx, subject, opts.deviceId ?? null)
  } else if (purpose === 'identify' || purpose === 'group') {
    if (ctx.roleName !== 'faculty') {
      throw new BiometricError(403, 'forbidden', 'Identification is for the lecturer taking attendance')
    }
    if (!opts.scheduleId || !UUID.test(opts.scheduleId)) {
      throw new BiometricError(400, 'schedule_required', 'Say which class this is for')
    }
    const teaches = await query(
      `SELECT 1 FROM class_schedules cs JOIN faculty f ON f.id = cs.faculty_id AND f.tenant_id = cs.tenant_id
        WHERE cs.id = $1 AND cs.tenant_id = $2 AND f.user_id = $3`,
      [opts.scheduleId, ctx.tenantId, ctx.userId]
    )
    if (teaches.rows.length === 0) throw new BiometricError(404, 'not_found', 'No such class of yours')
    scheduleId = opts.scheduleId
  } else {
    throw new BiometricError(400, 'bad_purpose', 'purpose must be enroll, verify, identify or group')
  }

  // Counted and inserted under a per-tenant lock, so requests sent at once
  // cannot all pass a limit before any of them is recorded (audit F12).
  const c = await pool.connect()
  try {
    await c.query('BEGIN')
    await c.query(`SELECT pg_advisory_xact_lock(hashtext('biometric_challenges:' || $1))`, [ctx.tenantId])
    const recent = await c.query(
      `SELECT COUNT(*)::int AS n FROM biometric_challenges
        WHERE issued_to = $1 AND created_at > CURRENT_TIMESTAMP - INTERVAL '10 minutes'`,
      [ctx.userId]
    )
    if (recent.rows[0].n >= CHALLENGES_PER_TEN_MINUTES) {
      throw new BiometricError(429, 'rate_limited', 'Too many face captures started. Wait a few minutes and try again.')
    }
    const device = opts.deviceId ? String(opts.deviceId).slice(0, 128) : null
    const limits = await c.query(
      `SELECT setting_key, setting_value FROM tenant_settings
        WHERE tenant_id = $1 AND setting_key IN ('biometrics.device_challenges_per_10min', 'biometrics.tenant_challenges_per_minute')`,
      [ctx.tenantId])
    const limit = (key: string, fallback: number) => {
      const v = Number(limits.rows.find((x: any) => x.setting_key === key)?.setting_value)
      return Number.isInteger(v) && v > 0 ? v : fallback
    }
    if (device) {
      const byDevice = await c.query(
        `SELECT COUNT(*)::int AS n FROM biometric_challenges
          WHERE tenant_id = $1 AND device_id = $2 AND created_at > CURRENT_TIMESTAMP - INTERVAL '10 minutes'`,
        [ctx.tenantId, device])
      if (byDevice.rows[0].n >= limit('biometrics.device_challenges_per_10min', DEVICE_CHALLENGES_PER_TEN_MINUTES)) {
        throw new BiometricError(429, 'device_rate_limited', 'This device has started too many face captures. Wait a few minutes, or mark by hand.')
      }
    }
    const byTenant = await c.query(
      `SELECT COUNT(*)::int AS n FROM biometric_challenges
        WHERE tenant_id = $1 AND created_at > CURRENT_TIMESTAMP - INTERVAL '1 minute'`, [ctx.tenantId])
    if (byTenant.rows[0].n >= limit('biometrics.tenant_challenges_per_minute', TENANT_CHALLENGES_PER_MINUTE)) {
      throw new BiometricError(429, 'tenant_rate_limited', 'Face matching is busy for this organisation just now. Mark by hand, or try again in a minute.')
    }

    // A group capture is one photograph of the class: one frame, facing the camera.
    const steps: Pose[] = purpose === 'group' ? ['center'] : randomSequence((n) => crypto.randomInt(n))
    const r = await c.query(
      `INSERT INTO biometric_challenges
         (tenant_id, issued_to, purpose, subject_type, subject_id, schedule_id, steps, expires_at, device_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7, CURRENT_TIMESTAMP + ($8 || ' seconds')::interval, $9)
       RETURNING id, steps, expires_at`,
      [ctx.tenantId, ctx.userId, purpose, subject?.type ?? null, subject?.id ?? null, scheduleId,
       steps, String(CHALLENGE_TTL_SECONDS), device]
    )
    await c.query('COMMIT')
    return { challengeId: r.rows[0].id, steps: r.rows[0].steps as Pose[], expiresAt: r.rows[0].expires_at }
  } catch (err) {
    await c.query('ROLLBACK').catch(() => undefined)
    throw err
  } finally {
    c.release()
  }
}

async function requireConsent(ctx: Ctx, s: Subject): Promise<string> {
  const r = await query(
    `SELECT id FROM biometric_consents
      WHERE tenant_id = $1 AND subject_type = $2 AND subject_id = $3 AND withdrawn_at IS NULL`,
    [ctx.tenantId, s.type, s.id]
  )
  if (r.rows.length === 0) {
    throw new BiometricError(409, 'no_consent', 'Consent must be recorded before a face can be enrolled')
  }
  return r.rows[0].id
}

async function requireTemplate(ctx: Ctx, s: Subject): Promise<void> {
  const r = await query(
    `SELECT 1 FROM face_templates WHERE tenant_id = $1 AND subject_type = $2 AND subject_id = $3`,
    [ctx.tenantId, s.type, s.id]
  )
  if (r.rows.length === 0) {
    throw new BiometricError(409, 'not_enrolled', 'No face is enrolled for you. Ask HR to enrol you.')
  }
}

/** Raises a face_lockout alert when this failure brings on the pause (brief 5.8). */
async function alertIfLockedOut(ctx: Ctx, s: Subject, challengeId: string): Promise<void> {
  const ch = await query(`SELECT device_id FROM biometric_challenges WHERE id = $1 AND tenant_id = $2`, [challengeId, ctx.tenantId])
  const kiosk = await kioskDevice(ctx, ch.rows[0]?.device_id ?? null)
  const n = await failuresInChannel(ctx, s, kiosk)
  if (n < FAILED_MATCHES_BEFORE_PAUSE) return
  // At a kiosk the alert names it: the failures may not have been the employee's own.
  await query(
    `INSERT INTO attendance_alerts (tenant_id, kind, student_id, employee_id, device_id, detail)
     VALUES ($1, 'face_lockout', $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
    [ctx.tenantId, s.type === 'student' ? s.id : null, s.type === 'employee' ? s.id : null, kiosk,
     JSON.stringify({ failures: n, withinMinutes: PAUSE_MINUTES, pausedMinutes: PAUSE_MINUTES, atKiosk: !!kiosk })])
}

/** Raises a device_face_failures alert when one device keeps failing to identify anyone. */
async function alertOnDeviceFailures(ctx: Ctx, challengeId: string): Promise<void> {
  const r = await query(
    `SELECT c.device_id,
            (SELECT COUNT(*)::int FROM biometric_events e JOIN biometric_challenges c2 ON c2.id = e.challenge_id
              WHERE e.tenant_id = $1 AND e.action = 'identified' AND e.outcome = 'failure'
                AND c2.device_id = c.device_id AND e.created_at > CURRENT_TIMESTAMP - INTERVAL '10 minutes') AS n
       FROM biometric_challenges c WHERE c.id = $2 AND c.tenant_id = $1 AND c.device_id IS NOT NULL`,
    [ctx.tenantId, challengeId])
  const row = r.rows[0]
  if (!row || row.n < DEVICE_FAILURES_BEFORE_ALERT) return
  await query(
    `INSERT INTO attendance_alerts (tenant_id, kind, device_id, detail) VALUES ($1, 'device_face_failures', $2, $3)
     ON CONFLICT DO NOTHING`,
    [ctx.tenantId, row.device_id, JSON.stringify({ failures: row.n, withinMinutes: 10 })])
}

/**
 * The administrator's view of face matching (brief 5.8): outcomes by day
 * and kind over the last 30 days, the reasons for failures, the spread of
 * presentation-attack scores, the thresholds in force and open alerts.
 */
export async function overview(ctx: Ctx) {
  if (!(['admin', 'hr', 'hr_director'].includes(ctx.roleName) || ctx.isSuperadmin)) {
    throw new BiometricError(403, 'forbidden', 'Only administrators may see the face-matching overview')
  }
  const daily = await query(
    `SELECT to_char(created_at::date, 'YYYY-MM-DD') AS day, action, outcome, COUNT(*)::int AS n
       FROM biometric_events WHERE tenant_id = $1 AND created_at > CURRENT_TIMESTAMP - INTERVAL '30 days'
      GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`, [ctx.tenantId])
  const reasons = await query(
    `SELECT reason, COUNT(*)::int AS n FROM biometric_events
      WHERE tenant_id = $1 AND outcome = 'failure' AND created_at > CURRENT_TIMESTAMP - INTERVAL '30 days'
      GROUP BY 1 ORDER BY 2 DESC`, [ctx.tenantId])
  const pad = await query(
    `SELECT width_bucket(pad_score, 0, 1.0001, 10) AS bucket, COUNT(*)::int AS n FROM biometric_events
      WHERE tenant_id = $1 AND pad_score IS NOT NULL AND created_at > CURRENT_TIMESTAMP - INTERVAL '30 days'
      GROUP BY 1 ORDER BY 1`, [ctx.tenantId])
  const alerts = await query(
    `SELECT kind, COUNT(*)::int AS n FROM attendance_alerts
      WHERE tenant_id = $1 AND acknowledged_at IS NULL GROUP BY 1`, [ctx.tenantId])
  const settings = await getSettings(ctx.tenantId)
  return {
    windowDays: 30,
    settings,
    daily: daily.rows,
    failureReasons: reasons.rows,
    padScores: pad.rows.map((r: any) => ({ from: (r.bucket - 1) / 10, to: r.bucket / 10, n: r.n })),
    openAlerts: alerts.rows,
  }
}

/** The device id, if it is one of the tenant's kiosks; null for anything else. */
async function kioskDevice(ctx: Ctx, deviceId: string | null | undefined): Promise<string | null> {
  if (!deviceId) return null
  const r = await query(`SELECT 1 FROM kiosks WHERE tenant_id = $1 AND device_id = $2`, [ctx.tenantId, deviceId])
  return r.rows.length ? deviceId : null
}

/**
 * Failed verifications for a person in the pause window, counted per
 * channel (audit F4): at a kiosk, only that kiosk's; anywhere else, only
 * those not made at a kiosk. Someone at a kiosk typing a colleague's number
 * and failing can pause face check-in for that colleague at that kiosk (the
 * attendant can still check them in), not on the colleague's own phone.
 */
async function failuresInChannel(ctx: Ctx, s: Subject, kiosk: string | null): Promise<number> {
  const r = await query(
    `SELECT COUNT(*)::int AS n FROM biometric_events e
       LEFT JOIN biometric_challenges c ON c.id = e.challenge_id AND c.tenant_id = e.tenant_id
      WHERE e.tenant_id = $1 AND e.subject_type = $2 AND e.subject_id = $3
        AND e.action = 'verified' AND e.outcome = 'failure'
        AND e.created_at > CURRENT_TIMESTAMP - ($4 || ' minutes')::interval
        AND CASE WHEN $5::text IS NULL
                 THEN NOT EXISTS (SELECT 1 FROM kiosks k WHERE k.tenant_id = e.tenant_id AND k.device_id = c.device_id)
                 ELSE c.device_id = $5::text END`,
    [ctx.tenantId, s.type, s.id, String(PAUSE_MINUTES), kiosk])
  return r.rows[0].n
}

async function refuseIfPaused(ctx: Ctx, s: Subject, deviceId: string | null = null): Promise<void> {
  if ((await failuresInChannel(ctx, s, await kioskDevice(ctx, deviceId))) >= FAILED_MATCHES_BEFORE_PAUSE) {
    throw new BiometricError(429, 'paused',
      `Face check-in is paused for ${PAUSE_MINUTES} minutes after repeated failed matches. Check in without it, or try later.`)
  }
}

interface ChallengeRow {
  id: string; purpose: Purpose; steps: Pose[]; subject_type: SubjectType | null
  subject_id: string | null; schedule_id: string | null; created_at: Date; consumed_at: Date; device_id: string | null
}

/**
 * Spends a challenge. It is consumed whether or not the capture then passes,
 * so a failed attempt cannot be retried against the same challenge.
 */
async function consumeChallenge(ctx: Ctx, challengeId: string, purpose: Purpose): Promise<ChallengeRow> {
  if (!UUID.test(String(challengeId ?? ''))) {
    throw new BiometricError(400, 'challenge_required', 'Start a new capture first')
  }
  const r = await query(
    `UPDATE biometric_challenges
        SET consumed_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND tenant_id = $2 AND issued_to = $3 AND purpose = $4
        AND consumed_at IS NULL AND expires_at > CURRENT_TIMESTAMP
      RETURNING id, purpose, steps, subject_type, subject_id, schedule_id, created_at, consumed_at, device_id`,
    [challengeId, ctx.tenantId, ctx.userId, purpose]
  )
  if (r.rows.length === 0) {
    throw new BiometricError(410, 'challenge_expired',
      'This capture has expired or was already used. Start again.')
  }
  const row = r.rows[0]
  if (!Array.isArray(row.steps) || !row.steps.every((p: string) => (POSES as readonly string[]).includes(p))) {
    throw new BiometricError(500, 'bad_challenge', 'The capture could not be checked')
  }
  return row
}

// ---------------------------------------------------------------------------
// Capture analysis
// ---------------------------------------------------------------------------

type Failure = { reason: string; message: string }

interface Capture { faces: FaceObservation[]; quality: Array<FrameQuality | undefined> }

async function analyzeCapture(frames: Buffer[], steps: Pose[]): Promise<Capture | Failure> {
  if (frames.length !== steps.length) {
    return { reason: 'wrong_frame_count', message: `Send exactly ${steps.length} images, one per step` }
  }
  const faces: FaceObservation[] = []
  const quality: Array<FrameQuality | undefined> = []
  // The frames are analysed together (across workers, when there are
  // several), then judged in order, so the first bad frame is the one named.
  const settled = await Promise.allSettled(frames.map((f) => analyzeFrame(f)))
  for (let i = 0; i < frames.length; i++) {
    let analysis
    try {
      const s = settled[i]
      if (s.status === 'rejected') throw s.reason
      analysis = s.value
    } catch (e) {
      if (e instanceof ImageRejected) return { reason: `image_${e.code}`, message: `Image ${i + 1}: ${e.message}` }
      // The server cannot run the engine at all: say so plainly, and let the
      // operator find the cause in the log rather than in a stack trace.
      if (e instanceof EngineUnavailable) {
        console.error('[BIOMETRICS]', e.message)
        throw new BiometricError(503, 'engine_unavailable',
          'Face matching is unavailable just now. Take attendance by hand, with the reason network_outage or camera_failure, and try face matching again later.')
      }
      throw e
    }
    if (analysis.faces.length === 0) {
      return { reason: 'no_face', message: `No face was found in image ${i + 1}. Face the camera in good light.` }
    }
    if (analysis.faces.length > 1) {
      return { reason: 'multiple_faces', message: `More than one face is in image ${i + 1}. Only one person at a time.` }
    }
    if (analysis.faces[0].width < IMAGE_LIMITS.minFaceWidth) {
      return { reason: 'face_too_small', message: `The face in image ${i + 1} is too small. Come closer to the camera.` }
    }
    faces.push(analysis.faces[0])
    quality.push(analysis.quality)
  }
  return { faces, quality }
}

function captureFailure(c: Capture | Failure): c is Failure {
  return (c as Failure).reason !== undefined
}

/**
 * The capture's presentation-attack signals (pad.ts): identical frames,
 * frame times the client reports, how soon after the challenge it arrived,
 * and the frames' image quality, against the tenant's clamped threshold.
 */
async function padCheck(ctx: Ctx, ch: ChallengeRow, frames: Buffer[], capture: Capture, frameTimes: number[] | null) {
  const hashes = frames.map((f) => crypto.createHash('sha256').update(f).digest('hex'))
  const threshold = await query(
    `SELECT setting_value FROM tenant_settings WHERE tenant_id = $1 AND setting_key = 'biometrics.pad_threshold'`,
    [ctx.tenantId])
  const pad = assessPad({
    // From the challenge to the capture's arrival (consumption happens before
    // analysis, which takes longer than any human floor).
    frameTimes, elapsedMs: new Date(ch.consumed_at).getTime() - new Date(ch.created_at).getTime(), steps: ch.steps.length,
    quality: capture.quality, duplicateFrames: new Set(hashes).size !== hashes.length,
  }, clampPadThreshold(threshold.rows[0]?.setting_value ?? PAD_THRESHOLD.default))
  let failure: Failure | null = null
  if (!pad.pass) {
    if (pad.hard === 'duplicate_frames') {
      failure = { reason: 'duplicate_frames', message: 'The same image was sent for more than one step. Take each picture as asked.' }
    } else if (pad.hard === 'implausible_timing') {
      failure = { reason: 'implausible_timing', message: 'The pictures were not taken as a person turning their head would take them. Start again.' }
    } else {
      failure = { reason: 'presentation_attack_suspected',
        message: `The capture looks like a photo or a screen (score ${pad.score}, needs ${pad.signals.threshold}: ${pad.reasons.join(', ')}). Try again in good light, or mark by hand.` }
    }
  }
  return { pad, failure }
}

/** What a match result says (brief 5.8): never "identity verified". */
function statement(distance: number, threshold: number): string {
  return `face matched at distance ${Math.round(distance * 1000) / 1000} under threshold ${threshold}`
}

/**
 * Enrolment asks more of its frames than a check-in does (brief 5.3): a
 * template made from a soft, dark or small face matches poorly for years.
 */
// Measured on the face region. 80 px: the recognition network works on a
// 150 px aligned crop, and a face much smaller is upsampled into it.
export const ENROL_QUALITY = { minSharpness: 0.1, minContrast: 0.08, brightness: [0.15, 0.9], minFaceWidth: 80, minScore: 0.8 }

function enrolmentQuality(capture: Capture): Failure | null {
  for (let i = 0; i < capture.faces.length; i++) {
    const f = capture.faces[i]
    const q = capture.quality[i]
    const n = i + 1
    if (f.width < ENROL_QUALITY.minFaceWidth) {
      return { reason: 'enrolment_face_too_small', message: `The face in image ${n} is too small to enrol. Come closer.` }
    }
    if (f.score < ENROL_QUALITY.minScore) {
      return { reason: 'enrolment_face_unclear', message: `The face in image ${n} is not clear enough to enrol: partly hidden or at an angle.` }
    }
    if (q && q.sharpness < ENROL_QUALITY.minSharpness) {
      return { reason: 'enrolment_blurred', message: `Image ${n} is blurred. Hold still in good light.` }
    }
    if (q && (q.brightness < ENROL_QUALITY.brightness[0] || q.brightness > ENROL_QUALITY.brightness[1])) {
      return { reason: 'enrolment_lighting', message: `Image ${n} is too dark or too bright. Move to even light.` }
    }
    if (q && q.contrast < ENROL_QUALITY.minContrast) {
      return { reason: 'enrolment_lighting', message: `Image ${n} is too flat. Move to even light.` }
    }
  }
  return null
}

function checkSameAndLive(faces: FaceObservation[], steps: Pose[]): Failure | null {
  if (spread(faces.map((f) => f.descriptor)) > THRESHOLDS.withinCapture) {
    return { reason: 'inconsistent_frames', message: 'The images are not all of the same person.' }
  }
  if (!sequenceMatches(steps, faces.map((f) => f.yaw))) {
    return { reason: 'liveness_failed',
      message: 'The head movements did not follow the instructions. Start again and follow each step.' }
  }
  return null
}

// ---------------------------------------------------------------------------
// Enrol, verify, identify
// ---------------------------------------------------------------------------

export async function enroll(ctx: Ctx, challengeId: string, frames: Buffer[], frameTimes: number[] | null = null) {
  await requireAvailable(ctx.tenantId)
  const ch = await consumeChallenge(ctx, challengeId, 'enroll')
  const subject: Subject = { type: ch.subject_type!, id: ch.subject_id! }
  await authorizeSubject(ctx, subject, 'enroll')
  const consentId = await requireConsent(ctx, subject)

  const capture = await analyzeCapture(frames, ch.steps)
  let fail: Failure | null = captureFailure(capture) ? capture : null
  let pad: PadResult | null = null
  if (!fail) ({ pad, failure: fail } = await padCheck(ctx, ch, frames, capture as Capture, frameTimes))
  if (!fail) fail = checkSameAndLive((capture as Capture).faces, ch.steps)
  if (fail) {
    await recordEventAtomic(ctx, {
      action: 'enrolled', outcome: 'failure', reason: fail.reason, subject, challengeId: ch.id, pad })
    throw new BiometricError(422, fail.reason, fail.message)
  }
  const faces = (capture as Capture).faces
  const poor = enrolmentQuality(capture as Capture)
  if (poor) {
    await recordEventAtomic(ctx, {
      action: 'enrolled', outcome: 'failure', reason: poor.reason, subject, challengeId: ch.id, pad })
    throw new BiometricError(422, poor.reason, poor.message)
  }
  const template = mean(faces.map((f) => f.descriptor))
  // One person, one template in a tenant: a face that already matches someone
  // else enrolled here is refused, for an administrator to look into. Not
  // compared across tenants, which never see each other's templates.
  const settings = await getSettings(ctx.tenantId)
  const others = await query(
    `SELECT subject_id, ciphertext, iv, auth_tag, key_version, dek_version, model FROM face_templates
      WHERE tenant_id = $1 AND subject_type = $2 AND subject_id <> $3`,
    [ctx.tenantId, subject.type, subject.id]
  )
  for (const row of others.rows) {
    let other: Float32Array
    try {
      other = await openStoredTemplate(ctx.tenantId,
        { ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag, keyVersion: row.key_version, dekVersion: row.dek_version },
        templateContext(ctx.tenantId, subject.type, row.subject_id, row.model))
    } catch (e) {
      if (e instanceof BiometricKeyError) throw e
      continue
    }
    if (distance(template, other) <= settings.threshold) {
      await recordEventAtomic(ctx, {
        action: 'enrolled', outcome: 'failure', reason: 'duplicate_identity', subject, challengeId: ch.id, pad })
      throw new BiometricError(409, 'duplicate_identity',
        'This face matches someone already enrolled in this organisation. An administrator should check before it is enrolled again.')
    }
  }
  const sealed = await sealTemplateForStorage(
    ctx.tenantId, template, templateContext(ctx.tenantId, subject.type, subject.id, MODEL_ID))

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `DELETE FROM face_templates WHERE tenant_id = $1 AND subject_type = $2 AND subject_id = $3`,
      [ctx.tenantId, subject.type, subject.id]
    )
    await client.query(
      `INSERT INTO face_templates
         (tenant_id, subject_type, subject_id, consent_id, model, ciphertext, iv, auth_tag,
          key_version, dek_version, frames_used, spread, enrolled_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [ctx.tenantId, subject.type, subject.id, consentId, MODEL_ID, sealed.ciphertext, sealed.iv,
       sealed.authTag, sealed.keyVersion, sealed.dekVersion, faces.length, spread(faces.map((f) => f.descriptor)), ctx.userId]
    )
    const eventId = await recordEvent(client, ctx, {
      action: 'enrolled', outcome: 'success', subject, challengeId: ch.id, pad })
    await client.query('COMMIT')
    return { eventId, framesUsed: faces.length, padScore: pad?.score ?? null }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

async function loadTemplate(ctx: Ctx, s: Subject): Promise<Float32Array | null> {
  const r = await query(
    `SELECT ciphertext, iv, auth_tag, key_version, dek_version, model FROM face_templates
      WHERE tenant_id = $1 AND subject_type = $2 AND subject_id = $3`,
    [ctx.tenantId, s.type, s.id]
  )
  const row = r.rows[0]
  if (!row) return null
  return openStoredTemplate(
    ctx.tenantId,
    { ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag, keyVersion: row.key_version, dekVersion: row.dek_version },
    templateContext(ctx.tenantId, s.type, s.id, row.model)
  )
}

export async function verify(ctx: Ctx, challengeId: string, frames: Buffer[], frameTimes: number[] | null = null) {
  const settings = await requireAvailable(ctx.tenantId)
  const ch = await consumeChallenge(ctx, challengeId, 'verify')
  const subject: Subject = { type: ch.subject_type!, id: ch.subject_id! }
  // The challenge was issued for the caller's own record; check it still is.
  if ((await ownEmployeeId(ctx)) !== subject.id) {
    throw new BiometricError(403, 'forbidden', 'You can only check yourself in')
  }
  await refuseIfPaused(ctx, subject, ch.device_id)
  const template = await loadTemplate(ctx, subject)
  if (!template) throw new BiometricError(409, 'not_enrolled', 'No face is enrolled for you')

  const fail = async (f: Failure, d: number | null = null, pad: PadResult | null = null): Promise<never> => {
    await recordEventAtomic(ctx, {
      action: 'verified', outcome: 'failure', reason: f.reason, subject, challengeId: ch.id,
      distance: d, threshold: settings.threshold, pad })
    await alertIfLockedOut(ctx, subject, ch.id)
    throw new BiometricError(422, f.reason, f.message)
  }

  const capture = await analyzeCapture(frames, ch.steps)
  if (captureFailure(capture)) return fail(capture)
  const probe = mean(capture.faces.map((f) => f.descriptor))
  const d = distance(probe, template)
  if (d > settings.threshold) {
    return fail({ reason: 'not_matched', message: 'The face does not match the one enrolled.' }, d)
  }
  const { pad, failure } = await padCheck(ctx, ch, frames, capture, frameTimes)
  if (failure) return fail(failure, d, pad)
  const other = checkSameAndLive(capture.faces, ch.steps)
  if (other) return fail(other, d, pad)

  const eventId = await recordEventAtomic(ctx, {
    action: 'verified', outcome: 'success', subject, challengeId: ch.id,
    distance: d, threshold: settings.threshold, pad })
  return { matchId: eventId, subject, distance: Math.round(d * 1000) / 1000, threshold: settings.threshold,
    padScore: pad.score, statement: statement(d, settings.threshold) }
}

/** This class's enrolled students, each with a template that opens. */
async function classCandidates(ctx: Ctx, scheduleId: string) {
  // Candidates: this class's enrolled students with a current template.
  const rows = await query(
    `SELECT t.subject_id, t.ciphertext, t.iv, t.auth_tag, t.key_version, t.dek_version, t.model
       FROM face_templates t
       JOIN student_courses sc ON sc.student_id = t.subject_id AND sc.tenant_id = t.tenant_id
      WHERE t.tenant_id = $1 AND t.subject_type = 'student'
        AND sc.schedule_id = $2 AND sc.status = 'enrolled'`,
    [ctx.tenantId, scheduleId]
  )
  // Unwrapping the tenant's data key is cached, so a class of forty costs
  // one KMS call at most, not forty.
  // A template that does not open under this tenant's key and this student's
  // context (copied from another tenant or another person, or damaged) is
  // nobody's: it is left out and reported, and the rest of the class is still
  // identified. Before, one such row failed identification for the class.
  const opened = await Promise.all(rows.rows.map(async (row: any) => {
    try {
      return {
        id: row.subject_id as string,
        template: await openStoredTemplate(
          ctx.tenantId,
          { ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag, keyVersion: row.key_version, dekVersion: row.dek_version },
          templateContext(ctx.tenantId, 'student', row.subject_id, row.model)
        ),
      }
    } catch (e) {
      if (e instanceof BiometricKeyError) throw e
      console.error(`[BIOMETRICS] template for student ${row.subject_id} in tenant ${ctx.tenantId} does not open; left out`)
      return null
    }
  }))
  return opened.filter((c): c is NonNullable<typeof c> => c !== null)
}

export async function identifyInClass(ctx: Ctx, challengeId: string, frames: Buffer[], frameTimes: number[] | null = null) {
  const settings = await requireAvailable(ctx.tenantId)
  const ch = await consumeChallenge(ctx, challengeId, 'identify')
  const scheduleId = ch.schedule_id!

  const fail = async (f: Failure, d: number | null = null, pad: PadResult | null = null): Promise<never> => {
    await recordEventAtomic(ctx, {
      action: 'identified', outcome: 'failure', reason: f.reason, challengeId: ch.id,
      scheduleId, distance: d, threshold: settings.threshold, pad })
    await alertOnDeviceFailures(ctx, ch.id)
    throw new BiometricError(422, f.reason, f.message)
  }

  const capture = await analyzeCapture(frames, ch.steps)
  if (captureFailure(capture)) return fail(capture)

  const candidates = await classCandidates(ctx, scheduleId)
  const probe = mean(capture.faces.map((f) => f.descriptor))
  const result = identifyAmong(probe, candidates, settings.threshold)

  if (result.outcome === 'no_match') {
    return fail({ reason: 'not_matched',
      message: candidates.length === 0
        ? 'No student in this class has an enrolled face.'
        : 'This face does not match any enrolled student in this class.' }, result.best)
  }
  if (result.outcome === 'ambiguous') {
    return fail({ reason: 'ambiguous',
      message: 'The face is too close to more than one student. Mark this student by hand.' }, result.best)
  }

  // Identity first, then that the frames are one live, turning head.
  const { pad, failure } = await padCheck(ctx, ch, frames, capture, frameTimes)
  if (failure) return fail(failure, result.distance, pad)
  const other = checkSameAndLive(capture.faces, ch.steps)
  if (other) return fail(other, result.distance, pad)

  const subject: Subject = { type: 'student', id: result.id }
  const eventId = await recordEventAtomic(ctx, {
    action: 'identified', outcome: 'success', subject, challengeId: ch.id, scheduleId,
    distance: result.distance, threshold: settings.threshold, pad })
  const student = await query(
    `SELECT id, student_id, first_name, last_name FROM students WHERE id = $1 AND tenant_id = $2`,
    [result.id, ctx.tenantId]
  )
  return {
    matchId: eventId,
    student: student.rows[0],
    distance: Math.round(result.distance * 1000) / 1000,
    threshold: settings.threshold,
    padScore: pad.score,
    statement: statement(result.distance, settings.threshold),
  }
}

// ---------------------------------------------------------------------------
// Group capture (brief 5.4): one photograph of the class, several faces.
// ---------------------------------------------------------------------------

const GROUP_PROPOSAL_MINUTES = 10

/**
 * Proposes who is in a class photograph. Each face large enough to describe
 * is matched against the class's enrolled students, with the same threshold
 * and margin as one-at-a-time identification. A student matched by two faces
 * goes to the closer one. Nothing is recorded as attendance: the lecturer
 * confirms each proposal (confirmGroup) within ten minutes.
 */
export async function proposeGroup(ctx: Ctx, challengeId: string, frames: Buffer[], date?: string | null) {
  const settings = await requireAvailable(ctx.tenantId)
  const ch = await consumeChallenge(ctx, challengeId, 'group')
  const scheduleId = ch.schedule_id!
  if (frames.length !== 1) throw new BiometricError(422, 'wrong_frame_count', 'Send one photograph of the class')
  const day = date ? String(date) : new Date().toISOString().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new BiometricError(400, 'bad_date', 'date must be YYYY-MM-DD')

  let analysis
  try {
    analysis = await analyzeFrame(frames[0])
  } catch (e) {
    if (e instanceof ImageRejected) throw new BiometricError(422, `image_${e.code}`, e.message)
    if (e instanceof EngineUnavailable) {
      throw new BiometricError(503, 'engine_unavailable',
        'Face matching is unavailable just now. Take attendance by hand, with the reason network_outage or camera_failure, and try face matching again later.')
    }
    throw e
  }
  const faces = analysis.faces.filter((f) => f.width >= IMAGE_LIMITS.minFaceWidth)
  if (faces.length === 0) throw new BiometricError(422, 'no_face', 'No face large enough to recognise was found. Come closer, in good light.')

  const candidates = await classCandidates(ctx, scheduleId)
  const best = new Map<string, { face: number; distance: number }>()
  let ambiguous = 0
  faces.forEach((f, face) => {
    const r = identifyAmong(f.descriptor, candidates, settings.threshold)
    if (r.outcome === 'ambiguous') ambiguous++
    if (r.outcome !== 'match') return
    const held = best.get(r.id)
    if (!held || r.distance < held.distance) best.set(r.id, { face, distance: r.distance })
  })
  const ids = [...best.keys()]
  const people = ids.length
    ? await query(`SELECT id, student_id, first_name, last_name FROM students WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
        [ctx.tenantId, ids])
    : { rows: [] as any[] }
  const byId = new Map(people.rows.map((p: any) => [p.id, p]))
  const proposals = ids.map((id, i) => ({ proposal: i + 1, studentId: id, distance: Math.round(best.get(id)!.distance * 1000) / 1000 }))

  const g = await query(
    `INSERT INTO group_captures (tenant_id, issued_to, schedule_id, challenge_id, attendance_date, proposals, faces_found, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP + ($8 || ' minutes')::interval)
     RETURNING id, expires_at`,
    [ctx.tenantId, ctx.userId, scheduleId, ch.id, day, JSON.stringify(proposals), faces.length, String(GROUP_PROPOSAL_MINUTES)]
  )
  return {
    groupId: g.rows[0].id,
    expiresAt: g.rows[0].expires_at,
    facesFound: faces.length,
    unmatched: faces.length - proposals.length,
    ambiguous,
    threshold: settings.threshold,
    proposals: proposals.map((p) => ({
      ...p,
      student: byId.get(p.studentId) ?? null,
      statement: statement(p.distance, settings.threshold),
    })),
    note: 'Nothing is recorded until you confirm each proposal.',
  }
}

/**
 * The lecturer confirms some of a group capture's proposals. Each confirmed
 * one becomes a match event and a face mark, through the attendance core;
 * the rest are discarded. A group is decided once.
 */
export async function confirmGroup(ctx: Ctx, groupId: string, confirmed: unknown) {
  if (!UUID.test(String(groupId ?? ''))) throw new BiometricError(404, 'not_found', 'No such group capture')
  const picks = Array.isArray(confirmed) ? confirmed.map(Number).filter(Number.isInteger) : []
  const settings = await getSettings(ctx.tenantId)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const g = await client.query(
      `SELECT * FROM group_captures
        WHERE id = $1 AND tenant_id = $2 AND issued_to = $3 AND decided_at IS NULL AND expires_at > CURRENT_TIMESTAMP
        FOR UPDATE`,
      [groupId, ctx.tenantId, ctx.userId]
    )
    if (!g.rows.length) throw new BiometricError(404, 'not_found', 'No such group capture of yours waiting for confirmation')
    const group = g.rows[0]
    const proposals: Array<{ proposal: number; studentId: string; distance: number }> = group.proposals
    const unknown = picks.filter((n) => !proposals.some((p) => p.proposal === n))
    if (unknown.length) throw new BiometricError(400, 'bad_proposal', `No proposal ${unknown.join(', ')} in this capture`)
    const faculty = await client.query(`SELECT id FROM faculty WHERE user_id = $1 AND tenant_id = $2 LIMIT 1`,
      [ctx.userId, ctx.tenantId])
    const recorded: Array<{ proposal: number; studentId: string; matchId: string; attendanceId: string }> = []
    for (const p of proposals.filter((x) => picks.includes(x.proposal))) {
      const subject: Subject = { type: 'student', id: p.studentId }
      const matchId = await recordEvent(client, ctx, {
        action: 'identified', outcome: 'success', subject, challengeId: group.challenge_id, scheduleId: group.schedule_id,
        distance: p.distance, threshold: settings.threshold, reason: 'group_capture_confirmed' })
      const { attendanceId } = await markStudent(client, { tenantId: ctx.tenantId, userId: ctx.userId }, {
        scheduleId: group.schedule_id, studentId: p.studentId, date: toDay(group.attendance_date), status: 'present',
        markerFacultyId: faculty.rows[0]?.id ?? null, verificationMethod: 'FACE_MATCH', attendanceState: 'VERIFIED',
        capture: { method: 'face', matchEventId: matchId },
      })
      recorded.push({ proposal: p.proposal, studentId: p.studentId, matchId, attendanceId })
    }
    await client.query(`UPDATE group_captures SET decided_at = CURRENT_TIMESTAMP WHERE id = $1 AND tenant_id = $2`,
      [groupId, ctx.tenantId])
    await client.query('COMMIT')
    return { recorded, discarded: proposals.length - recorded.length }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

function toDay(d: unknown): string {
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10)
}

// ---------------------------------------------------------------------------
// Spending a match on attendance
// ---------------------------------------------------------------------------

/**
 * Confirms a match may back an attendance record: it is a successful match,
 * made by this caller in this tenant, for this person (and class, for
 * identification), and recent. The unique indexes on the attendance tables
 * stop the same match being spent twice.
 */
export async function assertUsableMatch(
  runner: { query: PoolClient['query'] },
  ctx: Ctx,
  matchId: unknown,
  expect: {
    action: 'verified' | 'identified'; subject: Subject; scheduleId?: string | string[]
    /**
     * Where the match may have been made (audit F2). A kiosk passes its
     * device id: only a match from a challenge that kiosk was issued will do.
     * Anywhere else passes nothing: a match made at a kiosk will not do, so a
     * match cannot be carried between a phone and a kiosk either way.
     */
    kioskDevice?: string | null
  }
): Promise<string> {
  const schedules = expect.scheduleId === undefined ? null
    : Array.isArray(expect.scheduleId) ? expect.scheduleId : [expect.scheduleId]
  if (!UUID.test(String(matchId ?? ''))) {
    throw new BiometricError(400, 'match_required', 'A face match id is required')
  }
  const r = await runner.query(
    `SELECT e.id FROM biometric_events e
       LEFT JOIN biometric_challenges c ON c.id = e.challenge_id AND c.tenant_id = e.tenant_id
      WHERE e.id = $1 AND e.tenant_id = $2 AND e.actor_user_id = $3 AND e.action = $4 AND e.outcome = 'success'
        AND e.subject_type = $5 AND e.subject_id = $6
        AND ($7::uuid[] IS NULL OR e.schedule_id = ANY($7::uuid[]))
        AND e.created_at > CURRENT_TIMESTAMP - ($8 || ' seconds')::interval
        AND CASE WHEN $9::text IS NULL
                 THEN NOT EXISTS (SELECT 1 FROM kiosks k WHERE k.tenant_id = e.tenant_id AND k.device_id = c.device_id)
                 ELSE c.device_id IS NOT DISTINCT FROM $9::text END`,
    [matchId, ctx.tenantId, ctx.userId, expect.action, expect.subject.type, expect.subject.id,
     schedules, String(MATCH_USABLE_SECONDS), expect.kioskDevice ?? null]
  )
  if (r.rows.length === 0) {
    throw new BiometricError(409, 'match_unusable',
      'That face match is not valid for this record, or has expired. Capture again.')
  }
  return r.rows[0].id
}

/**
 * Spends a face match: the second spend, on anything, is refused (audit F1).
 * In the caller's transaction, so a spend that rolls back is not spent.
 */
export async function spendMatch(
  runner: { query: PoolClient['query'] }, tenantId: string, matchId: string, spentFor: string
): Promise<void> {
  const r = await runner.query(
    `INSERT INTO face_match_spends (match_event_id, tenant_id, spent_for) VALUES ($1, $2, $3)
     ON CONFLICT (match_event_id) DO NOTHING RETURNING match_event_id`, [matchId, tenantId, spentFor])
  if (!r.rows.length) throw new BiometricError(409, 'match_used', 'That face match has already been used')
}

/**
 * People on this tenant's platform with their consent and enrolment status,
 * for the administrators who manage it. Never includes a template.
 */
export async function listSubjects(
  ctx: Ctx,
  type: SubjectType,
  opts: { search?: string; limit?: number; offset?: number }
) {
  const isAdmin = type === 'student' ? ctx.roleName === 'admin' : HR_ROLES.has(ctx.roleName)
  const platformOk = type === 'student' ? ctx.platformKind === 'school' : ctx.platformKind === 'corporate'
  if (!platformOk) throw new BiometricError(404, 'not_found', 'Nothing of that kind in this organisation')
  if (!isAdmin && !ctx.isSuperadmin) {
    throw new BiometricError(403, 'forbidden', 'Only administrators may list face matching status')
  }
  const limit = Math.min(200, Math.max(1, Number(opts.limit) || 50))
  const offset = Math.max(0, Number(opts.offset) || 0)
  const table = type === 'student' ? 'students' : 'employees'
  const code = type === 'student' ? 'student_id' : 'employee_id'
  const active = type === 'student' ? 'is_currently_enrolled IS NOT FALSE' : 'is_currently_employed IS NOT FALSE'
  const params: unknown[] = [ctx.tenantId, type]
  let filter = ''
  const q = String(opts.search ?? '').trim()
  if (q) {
    params.push(`%${q}%`)
    filter = ` AND (p.first_name ILIKE $3 OR p.last_name ILIKE $3 OR p.${code} ILIKE $3)`
  }
  params.push(limit, offset)
  const r = await query(
    `SELECT p.id, p.${code} AS code, p.first_name, p.last_name,
            c.granted_at AS consent_granted_at, t.enrolled_at, t.model,
            (t.id IS NOT NULL AND (t.model <> $${params.length + 1}
              OR t.enrolled_at < CURRENT_TIMESTAMP - make_interval(months => $${params.length + 2}))) AS stale,
            COUNT(*) OVER()::int AS total
       FROM ${table} p
       LEFT JOIN biometric_consents c
              ON c.tenant_id = p.tenant_id AND c.subject_type = $2 AND c.subject_id = p.id
             AND c.withdrawn_at IS NULL
       LEFT JOIN face_templates t
              ON t.tenant_id = p.tenant_id AND t.subject_type = $2 AND t.subject_id = p.id
      WHERE p.tenant_id = $1 AND p.${active}${filter}
      ORDER BY p.last_name, p.first_name
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    [...params, MODEL_ID, await reenrolMonths(ctx.tenantId)]
  )
  return {
    total: r.rows[0]?.total ?? 0,
    // Stale: made by another model version, or older than the tenant's
    // re-enrolment interval (biometrics.reenrol_months, default 24). Each is
    // a reminder to re-enrol (src/scripts/staleTemplates.ts lists them).
    people: r.rows.map(({ total, ...row }: any) => row),
  }
}

export async function reenrolMonths(tenantId: string): Promise<number> {
  const r = await query(
    `SELECT setting_value FROM tenant_settings WHERE tenant_id = $1 AND setting_key = 'biometrics.reenrol_months'`, [tenantId])
  const v = Number(r.rows[0]?.setting_value)
  return Number.isInteger(v) && v >= 1 && v <= 120 ? v : 24
}

export async function listEvents(ctx: Ctx, opts: { limit?: number; subject?: Subject }) {
  if (!(ctx.roleName === 'admin' || HR_ROLES.has(ctx.roleName) || ctx.isSuperadmin)) {
    throw new BiometricError(403, 'forbidden', 'Only administrators may read the face matching log')
  }
  const limit = Math.min(200, Math.max(1, Number(opts.limit) || 50))
  const params: unknown[] = [ctx.tenantId]
  let where = 'e.tenant_id = $1'
  if (opts.subject) {
    params.push(opts.subject.type, opts.subject.id)
    where += ` AND e.subject_type = $2 AND e.subject_id = $3`
  }
  params.push(limit)
  const r = await query(
    `SELECT e.id, e.action, e.outcome, e.reason, e.subject_type, e.subject_id, e.distance,
            e.threshold, e.model, e.pad_score, e.pad_signals, e.created_at, u.full_name AS actor_name
       FROM biometric_events e LEFT JOIN users u ON u.id = e.actor_user_id
      WHERE ${where}
      ORDER BY e.created_at DESC
      LIMIT $${params.length}`,
    params
  )
  return r.rows
}
