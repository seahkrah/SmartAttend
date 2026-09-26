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
import { analyzeFrame, IMAGE_LIMITS, ImageRejected, EngineUnavailable, type FaceObservation } from './engine.js'
import { randomSequence, sequenceMatches, type Pose, POSES } from './pose.js'
import {
  MODEL_ID, THRESHOLDS, clampThreshold, distance, identify as identifyAmong, mean, spread,
} from './matching.js'
import { openTemplate, sealTemplate, templateContext, templateKeyConfigured } from './templateCrypto.js'

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
const FAILED_MATCHES_BEFORE_PAUSE = 5
const PAUSE_MINUTES = 15
/** A match must be used for attendance within this long of being made. */
export const MATCH_USABLE_SECONDS = 300

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const HR_ROLES = new Set(['admin', 'hr', 'hr_director'])

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface BiometricSettings { enabled: boolean; threshold: number; configured: boolean }

export async function getSettings(tenantId: string): Promise<BiometricSettings> {
  const r = await query(
    `SELECT setting_key, setting_value FROM tenant_settings
      WHERE tenant_id = $1 AND setting_key IN ('biometrics.enabled', 'biometrics.match_threshold')`,
    [tenantId]
  )
  const map = Object.fromEntries(r.rows.map((x: any) => [x.setting_key, x.setting_value]))
  return {
    enabled: map['biometrics.enabled'] === 'true',
    threshold: clampThreshold(map['biometrics.match_threshold'] ?? THRESHOLDS.default),
    configured: templateKeyConfigured(),
  }
}

export async function saveSettings(ctx: Ctx, enabled: boolean, threshold: number): Promise<BiometricSettings> {
  if (!['admin', 'hr_director'].includes(ctx.roleName) && !ctx.isSuperadmin) {
    throw new BiometricError(403, 'forbidden', 'Only an administrator may change face matching settings')
  }
  const t = clampThreshold(threshold)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    for (const [key, value] of [['biometrics.enabled', String(!!enabled)], ['biometrics.match_threshold', t.toFixed(2)]]) {
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
}

async function recordEvent(runner: { query: PoolClient['query'] }, ctx: Ctx, e: EventInput): Promise<string> {
  const r = await runner.query(
    `INSERT INTO biometric_events
       (tenant_id, actor_user_id, action, outcome, reason, subject_type, subject_id,
        challenge_id, schedule_id, distance, threshold, model)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
    [ctx.tenantId, ctx.userId, e.action, e.outcome, e.reason ?? null,
     e.subject?.type ?? null, e.subject?.id ?? null, e.challengeId ?? null, e.scheduleId ?? null,
     e.distance ?? null, e.threshold ?? null,
     ['enrolled', 'verified', 'identified'].includes(e.action) ? MODEL_ID : null]
  )
  return r.rows[0].id
}

// ---------------------------------------------------------------------------
// Consent
// ---------------------------------------------------------------------------

export async function grantConsent(ctx: Ctx, s: Subject, basis: string) {
  await authorizeSubject(ctx, s, 'consent')
  const text = String(basis ?? '').trim()
  if (text.length < 5) {
    throw new BiometricError(400, 'basis_required',
      'Say how consent was obtained, for example "Signed consent form, 12 March"')
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const r = await client.query(
      `INSERT INTO biometric_consents (tenant_id, subject_type, subject_id, basis, granted_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [ctx.tenantId, s.type, s.id, text.slice(0, 1000), ctx.userId]
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

export type Purpose = 'enroll' | 'verify' | 'identify'

export async function issueChallenge(
  ctx: Ctx,
  purpose: Purpose,
  opts: { subject?: Subject; scheduleId?: string }
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
    await refuseIfPaused(ctx, subject)
  } else if (purpose === 'identify') {
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
    throw new BiometricError(400, 'bad_purpose', 'purpose must be enroll, verify or identify')
  }

  const recent = await query(
    `SELECT COUNT(*)::int AS n FROM biometric_challenges
      WHERE issued_to = $1 AND created_at > CURRENT_TIMESTAMP - INTERVAL '10 minutes'`,
    [ctx.userId]
  )
  if (recent.rows[0].n >= CHALLENGES_PER_TEN_MINUTES) {
    throw new BiometricError(429, 'rate_limited', 'Too many face captures started. Wait a few minutes and try again.')
  }

  const steps = randomSequence((n) => crypto.randomInt(n))
  const r = await query(
    `INSERT INTO biometric_challenges
       (tenant_id, issued_to, purpose, subject_type, subject_id, schedule_id, steps, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7, CURRENT_TIMESTAMP + ($8 || ' seconds')::interval)
     RETURNING id, steps, expires_at`,
    [ctx.tenantId, ctx.userId, purpose, subject?.type ?? null, subject?.id ?? null, scheduleId,
     steps, String(CHALLENGE_TTL_SECONDS)]
  )
  return { challengeId: r.rows[0].id, steps: r.rows[0].steps as Pose[], expiresAt: r.rows[0].expires_at }
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

async function refuseIfPaused(ctx: Ctx, s: Subject): Promise<void> {
  const r = await query(
    `SELECT COUNT(*)::int AS n FROM biometric_events
      WHERE tenant_id = $1 AND subject_type = $2 AND subject_id = $3
        AND action = 'verified' AND outcome = 'failure'
        AND created_at > CURRENT_TIMESTAMP - ($4 || ' minutes')::interval`,
    [ctx.tenantId, s.type, s.id, String(PAUSE_MINUTES)]
  )
  if (r.rows[0].n >= FAILED_MATCHES_BEFORE_PAUSE) {
    throw new BiometricError(429, 'paused',
      `Face check-in is paused for ${PAUSE_MINUTES} minutes after repeated failed matches. Check in without it, or try later.`)
  }
}

interface ChallengeRow {
  id: string; purpose: Purpose; steps: Pose[]; subject_type: SubjectType | null
  subject_id: string | null; schedule_id: string | null
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
      RETURNING id, purpose, steps, subject_type, subject_id, schedule_id`,
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

interface Capture { faces: FaceObservation[] }

async function analyzeCapture(frames: Buffer[], steps: Pose[]): Promise<Capture | Failure> {
  if (frames.length !== steps.length) {
    return { reason: 'wrong_frame_count', message: `Send exactly ${steps.length} images, one per step` }
  }
  const faces: FaceObservation[] = []
  for (let i = 0; i < frames.length; i++) {
    let analysis
    try {
      analysis = await analyzeFrame(frames[i])
    } catch (e) {
      if (e instanceof ImageRejected) return { reason: `image_${e.code}`, message: `Image ${i + 1}: ${e.message}` }
      // The server cannot run the engine at all: say so plainly, and let the
      // operator find the cause in the log rather than in a stack trace.
      if (e instanceof EngineUnavailable) {
        console.error('[BIOMETRICS]', e.message)
        throw new BiometricError(503, 'engine_unavailable',
          'Face matching is temporarily unavailable on this server. Please try again later or use another method.')
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
  }
  return { faces }
}

function captureFailure(c: Capture | Failure): c is Failure {
  return (c as Failure).reason !== undefined
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

export async function enroll(ctx: Ctx, challengeId: string, frames: Buffer[]) {
  await requireAvailable(ctx.tenantId)
  const ch = await consumeChallenge(ctx, challengeId, 'enroll')
  const subject: Subject = { type: ch.subject_type!, id: ch.subject_id! }
  await authorizeSubject(ctx, subject, 'enroll')
  const consentId = await requireConsent(ctx, subject)

  const capture = await analyzeCapture(frames, ch.steps)
  const fail = captureFailure(capture) ? capture : checkSameAndLive(capture.faces, ch.steps)
  if (fail) {
    await recordEvent({ query: query as any }, ctx, {
      action: 'enrolled', outcome: 'failure', reason: fail.reason, subject, challengeId: ch.id })
    throw new BiometricError(422, fail.reason, fail.message)
  }
  const faces = (capture as Capture).faces
  const template = mean(faces.map((f) => f.descriptor))
  const sealed = sealTemplate(template, templateContext(ctx.tenantId, subject.type, subject.id, MODEL_ID))

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
          key_version, frames_used, spread, enrolled_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [ctx.tenantId, subject.type, subject.id, consentId, MODEL_ID, sealed.ciphertext, sealed.iv,
       sealed.authTag, sealed.keyVersion, faces.length, spread(faces.map((f) => f.descriptor)), ctx.userId]
    )
    const eventId = await recordEvent(client, ctx, {
      action: 'enrolled', outcome: 'success', subject, challengeId: ch.id })
    await client.query('COMMIT')
    return { eventId, framesUsed: faces.length }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

async function loadTemplate(ctx: Ctx, s: Subject): Promise<Float32Array | null> {
  const r = await query(
    `SELECT ciphertext, iv, auth_tag, key_version, model FROM face_templates
      WHERE tenant_id = $1 AND subject_type = $2 AND subject_id = $3`,
    [ctx.tenantId, s.type, s.id]
  )
  const row = r.rows[0]
  if (!row) return null
  return openTemplate(
    { ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag, keyVersion: row.key_version },
    templateContext(ctx.tenantId, s.type, s.id, row.model)
  )
}

export async function verify(ctx: Ctx, challengeId: string, frames: Buffer[]) {
  const settings = await requireAvailable(ctx.tenantId)
  const ch = await consumeChallenge(ctx, challengeId, 'verify')
  const subject: Subject = { type: ch.subject_type!, id: ch.subject_id! }
  // The challenge was issued for the caller's own record; check it still is.
  if ((await ownEmployeeId(ctx)) !== subject.id) {
    throw new BiometricError(403, 'forbidden', 'You can only check yourself in')
  }
  await refuseIfPaused(ctx, subject)
  const template = await loadTemplate(ctx, subject)
  if (!template) throw new BiometricError(409, 'not_enrolled', 'No face is enrolled for you')

  const fail = async (f: Failure, d: number | null = null): Promise<never> => {
    await recordEvent({ query: query as any }, ctx, {
      action: 'verified', outcome: 'failure', reason: f.reason, subject, challengeId: ch.id,
      distance: d, threshold: settings.threshold })
    throw new BiometricError(422, f.reason, f.message)
  }

  const capture = await analyzeCapture(frames, ch.steps)
  if (captureFailure(capture)) return fail(capture)
  const probe = mean(capture.faces.map((f) => f.descriptor))
  const d = distance(probe, template)
  if (d > settings.threshold) {
    return fail({ reason: 'not_matched', message: 'The face does not match the one enrolled.' }, d)
  }
  const other = checkSameAndLive(capture.faces, ch.steps)
  if (other) return fail(other, d)

  const eventId = await recordEvent({ query: query as any }, ctx, {
    action: 'verified', outcome: 'success', subject, challengeId: ch.id,
    distance: d, threshold: settings.threshold })
  return { matchId: eventId, subject, distance: Math.round(d * 1000) / 1000, threshold: settings.threshold }
}

export async function identifyInClass(ctx: Ctx, challengeId: string, frames: Buffer[]) {
  const settings = await requireAvailable(ctx.tenantId)
  const ch = await consumeChallenge(ctx, challengeId, 'identify')
  const scheduleId = ch.schedule_id!

  const fail = async (f: Failure, d: number | null = null): Promise<never> => {
    await recordEvent({ query: query as any }, ctx, {
      action: 'identified', outcome: 'failure', reason: f.reason, challengeId: ch.id,
      scheduleId, distance: d, threshold: settings.threshold })
    throw new BiometricError(422, f.reason, f.message)
  }

  const capture = await analyzeCapture(frames, ch.steps)
  if (captureFailure(capture)) return fail(capture)

  // Candidates: this class's enrolled students with a current template.
  const rows = await query(
    `SELECT t.subject_id, t.ciphertext, t.iv, t.auth_tag, t.key_version, t.model
       FROM face_templates t
       JOIN student_courses sc ON sc.student_id = t.subject_id AND sc.tenant_id = t.tenant_id
      WHERE t.tenant_id = $1 AND t.subject_type = 'student'
        AND sc.schedule_id = $2 AND sc.status = 'enrolled'`,
    [ctx.tenantId, scheduleId]
  )
  const candidates = rows.rows.map((row: any) => ({
    id: row.subject_id,
    template: openTemplate(
      { ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag, keyVersion: row.key_version },
      templateContext(ctx.tenantId, 'student', row.subject_id, row.model)
    ),
  }))
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
  const other = checkSameAndLive(capture.faces, ch.steps)
  if (other) return fail(other, result.distance)

  const subject: Subject = { type: 'student', id: result.id }
  const eventId = await recordEvent({ query: query as any }, ctx, {
    action: 'identified', outcome: 'success', subject, challengeId: ch.id, scheduleId,
    distance: result.distance, threshold: settings.threshold })
  const student = await query(
    `SELECT id, student_id, first_name, last_name FROM students WHERE id = $1 AND tenant_id = $2`,
    [result.id, ctx.tenantId]
  )
  return {
    matchId: eventId,
    student: student.rows[0],
    distance: Math.round(result.distance * 1000) / 1000,
    threshold: settings.threshold,
  }
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
  expect: { action: 'verified' | 'identified'; subject: Subject; scheduleId?: string | string[] }
): Promise<string> {
  const schedules = expect.scheduleId === undefined ? null
    : Array.isArray(expect.scheduleId) ? expect.scheduleId : [expect.scheduleId]
  if (!UUID.test(String(matchId ?? ''))) {
    throw new BiometricError(400, 'match_required', 'A face match id is required')
  }
  const r = await runner.query(
    `SELECT id FROM biometric_events
      WHERE id = $1 AND tenant_id = $2 AND actor_user_id = $3 AND action = $4 AND outcome = 'success'
        AND subject_type = $5 AND subject_id = $6
        AND ($7::uuid[] IS NULL OR schedule_id = ANY($7::uuid[]))
        AND created_at > CURRENT_TIMESTAMP - ($8 || ' seconds')::interval`,
    [matchId, ctx.tenantId, ctx.userId, expect.action, expect.subject.type, expect.subject.id,
     schedules, String(MATCH_USABLE_SECONDS)]
  )
  if (r.rows.length === 0) {
    throw new BiometricError(409, 'match_unusable',
      'That face match is not valid for this record, or has expired. Capture again.')
  }
  return r.rows[0].id
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
            c.granted_at AS consent_granted_at, t.enrolled_at,
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
    params
  )
  return {
    total: r.rows[0]?.total ?? 0,
    people: r.rows.map(({ total, ...row }: any) => row),
  }
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
            e.threshold, e.model, e.created_at, u.full_name AS actor_name
       FROM biometric_events e LEFT JOIN users u ON u.id = e.actor_user_id
      WHERE ${where}
      ORDER BY e.created_at DESC
      LIMIT $${params.length}`,
    params
  )
  return r.rows
}
