/**
 * The attendance core: the one place either platform records attendance
 * (brief 5.1).
 *
 * A school mark, a cleared register, an employee's check-in and check-out,
 * and the approval of a manual check-in each go through here. Each writes the
 * current-state row (school_attendance, corporate_checkins), which reports,
 * registers and timesheets read, and one append-only attendance_events row
 * saying how presence was established. Both are written in the caller's
 * transaction, so they commit or roll back together.
 * scripts/checks/attendance-core-only.mjs fails if any other file writes
 * these tables.
 *
 * Server time is authoritative; a client's time is kept for drift analysis
 * only. An idempotency key makes a retried capture return the first result
 * instead of recording twice.
 */
import type { PoolClient } from 'pg'

export const REASON_CODES = [
  'camera_failure', 'consent_withheld', 'enrolment_pending', 'face_not_recognised', 'network_outage', 'other',
] as const
export type ReasonCode = (typeof REASON_CODES)[number]
/** Recorded, never chosen: the tenant has face matching off, so manual is how attendance is taken. */
export const FACE_NOT_IN_USE = 'face_not_in_use'

export type Method = 'face' | 'manual' | 'offline_face' | 'offline_manual'

export interface Capture {
  method: Method
  /** A match event the server made, for face methods. */
  matchEventId?: string | null
  reasonCode?: string | null
  reasonText?: string | null
  deviceId?: string | null
  clientTime?: string | null
  idempotencyKey?: string | null
  latitude?: number | null
  longitude?: number | null
  accuracyMetres?: number | null
}

export interface CoreContext {
  tenantId: string
  userId: string
}

export class AttendanceInputError extends Error {
  constructor(message: string, readonly status = 400, readonly code = 'invalid') {
    super(message)
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isManual = (m: Method) => m === 'manual' || m === 'offline_manual'
const isFace = (m: Method) => m === 'face' || m === 'offline_face'

async function setting(client: PoolClient, tenantId: string, key: string): Promise<string | null> {
  const r = await client.query(
    `SELECT setting_value FROM tenant_settings WHERE tenant_id = $1 AND setting_key = $2`, [tenantId, key])
  return r.rows[0]?.setting_value ?? null
}

/** Whether the tenant uses face matching, so that a manual entry is a fallback. */
export async function faceInUse(client: PoolClient, tenantId: string): Promise<boolean> {
  return (await setting(client, tenantId, 'biometrics.enabled')) === 'true'
}

/** How many manual check-ins an employee may make in 30 days before each further one waits for a manager. */
export async function manualApprovalThreshold(client: PoolClient, tenantId: string): Promise<number> {
  const v = Number(await setting(client, tenantId, 'attendance.manual_approval_threshold'))
  return Number.isInteger(v) && v >= 0 ? v : 3
}

/**
 * Checks a capture and fills in what the server decides. A manual entry where
 * the tenant uses face matching needs a reason; where it does not, the reason
 * is recorded as face_not_in_use. "other" needs words.
 */
export async function settleCapture(client: PoolClient, tenantId: string, c: Capture): Promise<Required<Pick<Capture, 'method'>> & Capture> {
  if (!['face', 'manual', 'offline_face', 'offline_manual'].includes(c.method)) {
    throw new AttendanceInputError('method must be face, manual, offline_face or offline_manual')
  }
  if (isFace(c.method)) {
    if (!c.matchEventId) throw new AttendanceInputError('A face entry cites the match the server made', 400, 'match_required')
    return { ...c, reasonCode: null, reasonText: null }
  }
  let reason = c.reasonCode ? String(c.reasonCode) : null
  if (reason && !(REASON_CODES as readonly string[]).includes(reason)) {
    throw new AttendanceInputError(`reason_code must be one of ${REASON_CODES.join(', ')}`, 400, 'bad_reason')
  }
  if (!reason) {
    if (await faceInUse(client, tenantId)) {
      throw new AttendanceInputError(
        `A manual entry needs a reason_code (${REASON_CODES.join(', ')}): this organisation takes attendance by face`,
        400, 'reason_required')
    }
    reason = FACE_NOT_IN_USE
  }
  const text = c.reasonText ? String(c.reasonText).trim().slice(0, 500) : null
  if (reason === 'other' && (!text || text.length < 3)) {
    throw new AttendanceInputError('Say why, when the reason is "other"', 400, 'reason_text_required')
  }
  return { ...c, matchEventId: null, reasonCode: reason, reasonText: text }
}

interface EventRow {
  platform: 'school' | 'corporate'
  kind: 'mark' | 'clear' | 'check_in' | 'check_out' | 'approval'
  studentId?: string | null
  employeeId?: string | null
  scheduleId?: string | null
  attendanceDate?: string | null
  status?: string | null
  attendanceId?: string | null
  checkinId?: string | null
  method: Method | 'system'
  capture?: Capture
  approvalState?: 'not_needed' | 'pending' | 'approved' | 'rejected'
  supersedes?: string | null
}

function clientTime(v: unknown): Date | null {
  if (!v) return null
  const d = new Date(String(v))
  return Number.isNaN(d.getTime()) ? null : d
}

async function writeEvent(client: PoolClient, ctx: CoreContext, e: EventRow): Promise<string> {
  const c = e.capture ?? ({} as Capture)
  const ct = clientTime(c.clientTime)
  const r = await client.query(
    `INSERT INTO attendance_events
       (tenant_id, platform, kind, student_id, employee_id, schedule_id, attendance_date, status,
        attendance_id, checkin_id, method, device_id, client_time, drift_seconds,
        latitude, longitude, location_accuracy_m, match_event_id, reason_code, reason_text,
        actor_user_id, approval_state, idempotency_key, supersedes_event_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
             CASE WHEN $13::timestamptz IS NULL THEN NULL
                  ELSE EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - $13::timestamptz)) END,
             $14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
     RETURNING id`,
    [ctx.tenantId, e.platform, e.kind, e.studentId ?? null, e.employeeId ?? null, e.scheduleId ?? null,
     e.attendanceDate ?? null, e.status ?? null, e.attendanceId ?? null, e.checkinId ?? null, e.method,
     c.deviceId ? String(c.deviceId).slice(0, 128) : null, ct,
     num(c.latitude), num(c.longitude), num(c.accuracyMetres), c.matchEventId ?? null,
     c.reasonCode ?? null, c.reasonText ?? null, ctx.userId, e.approvalState ?? 'not_needed',
     c.idempotencyKey ? String(c.idempotencyKey).slice(0, 128) : null, e.supersedes ?? null]
  )
  return r.rows[0].id
}

function num(v: unknown): number | null {
  const n = Number(v)
  return v === null || v === undefined || v === '' || !Number.isFinite(n) ? null : n
}

/** A capture already recorded under this key, if the client is retrying. */
async function replayed(client: PoolClient, ctx: CoreContext, key: string | null | undefined) {
  if (!key) return null
  const r = await client.query(
    `SELECT id, attendance_id, checkin_id, approval_state FROM attendance_events
      WHERE tenant_id = $1 AND idempotency_key = $2`, [ctx.tenantId, String(key).slice(0, 128)])
  return r.rows[0] ?? null
}

// ---------------------------------------------------------------------------
// School
// ---------------------------------------------------------------------------

export interface Mark {
  scheduleId: string
  studentId: string
  date: string
  status: 'present' | 'absent' | 'late' | 'excused'
  markerFacultyId: string | null
  remarks?: string | null
  sessionId?: string | null
  /** What school_attendance.verification_method says; defaults from the method. */
  verificationMethod?: string
  /** VERIFIED when a face match established it. */
  attendanceState?: string | null
  /** Refuse a second mark for the same class and day rather than replacing it. */
  insertOnly?: boolean
  capture: Capture
}

/** Records one student's attendance for one class on one day. */
export async function markStudent(client: PoolClient, ctx: CoreContext, m: Mark): Promise<{ attendanceId: string; eventId: string }> {
  const again = await replayed(client, ctx, m.capture.idempotencyKey)
  if (again) return { attendanceId: again.attendance_id, eventId: again.id }
  const capture = await settleCapture(client, ctx.tenantId, m.capture)
  const byFace = isFace(capture.method)
  const verification = m.verificationMethod ?? (byFace ? 'FACE_MATCH' : 'MANUAL')
  const values = [m.scheduleId, m.studentId, m.markerFacultyId, m.date, m.status, m.remarks ?? null,
    byFace, capture.matchEventId ?? null, verification, m.sessionId ?? null, m.attendanceState ?? null, ctx.tenantId]
  const insert = `INSERT INTO school_attendance
       (schedule_id, student_id, marked_by_id, attendance_date, status, remarks,
        face_verified, face_match_event_id, verification_method, session_id, attendance_state, marked_at, tenant_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11, 'VERIFIED'),CURRENT_TIMESTAMP,$12)`
  const r = await client.query(
    m.insertOnly
      ? `${insert} RETURNING id`
      : `${insert}
         ON CONFLICT (schedule_id, student_id, attendance_date)
         DO UPDATE SET status = EXCLUDED.status, remarks = EXCLUDED.remarks, face_verified = EXCLUDED.face_verified,
                       face_match_event_id = EXCLUDED.face_match_event_id, verification_method = EXCLUDED.verification_method,
                       marked_by_id = EXCLUDED.marked_by_id, marked_at = CURRENT_TIMESTAMP,
                       session_id = COALESCE(EXCLUDED.session_id, school_attendance.session_id),
                       attendance_state = CASE WHEN $11::text IS NULL THEN school_attendance.attendance_state
                                               ELSE EXCLUDED.attendance_state END
         RETURNING id`,
    values
  )
  const attendanceId = r.rows[0].id
  const eventId = await writeEvent(client, ctx, {
    platform: 'school', kind: 'mark', studentId: m.studentId, scheduleId: m.scheduleId, attendanceDate: m.date,
    status: m.status, attendanceId, method: capture.method, capture,
  })
  return { attendanceId, eventId }
}

/** Removes a day's marks for some classes, recording what was removed. */
export async function clearRegister(client: PoolClient, ctx: CoreContext, scheduleIds: string[], date: string): Promise<number> {
  const r = await client.query(
    `DELETE FROM school_attendance
      WHERE tenant_id = $1 AND attendance_date = $2 AND schedule_id = ANY($3::uuid[])
      RETURNING id, student_id, schedule_id, status`,
    [ctx.tenantId, date, scheduleIds]
  )
  for (const row of r.rows) {
    await writeEvent(client, ctx, {
      platform: 'school', kind: 'clear', studentId: row.student_id, scheduleId: row.schedule_id,
      attendanceDate: date, status: null, attendanceId: row.id, method: 'system',
    })
  }
  return r.rowCount ?? 0
}

// ---------------------------------------------------------------------------
// Employer
// ---------------------------------------------------------------------------

export interface CheckIn {
  employeeId: string
  checkInType: string
  siteLocation: string | null
  capture: Capture
}

export interface CheckInResult {
  checkinId: string
  eventId: string
  approval: 'not_needed' | 'pending'
}

/**
 * Records a check-in. A manual one, where the tenant takes attendance by
 * face, beyond the tenant's monthly allowance for that employee, waits for a
 * manager: its hours count as flagged, not worked, until approved.
 */
export async function checkIn(client: PoolClient, ctx: CoreContext, c: CheckIn): Promise<CheckInResult> {
  const again = await replayed(client, ctx, c.capture.idempotencyKey)
  if (again) return { checkinId: again.checkin_id, eventId: again.id, approval: again.approval_state }
  const capture = await settleCapture(client, ctx.tenantId, c.capture)
  let approval: CheckInResult['approval'] = 'not_needed'
  if (isManual(capture.method) && capture.reasonCode !== FACE_NOT_IN_USE) {
    const used = await client.query(
      `SELECT count(*)::int AS n FROM attendance_events
        WHERE tenant_id = $1 AND employee_id = $2 AND kind = 'check_in'
          AND method IN ('manual', 'offline_manual') AND reason_code <> $3
          AND server_time > CURRENT_TIMESTAMP - INTERVAL '30 days'`,
      [ctx.tenantId, c.employeeId, FACE_NOT_IN_USE]
    )
    if (used.rows[0].n >= (await manualApprovalThreshold(client, ctx.tenantId))) approval = 'pending'
  }
  const created = await client.query(
    `INSERT INTO corporate_checkins
       (tenant_id, employee_id, check_in_type, check_in_time, site_location, face_verified, face_match_event_id,
        device_id, checkin_state, state_reason)
     VALUES ($1, $2, $3, LOCALTIMESTAMP, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [ctx.tenantId, c.employeeId, c.checkInType, c.siteLocation, isFace(capture.method), capture.matchEventId ?? null,
     capture.deviceId ? String(capture.deviceId).slice(0, 255) : null,
     approval === 'pending' ? 'FLAGGED' : 'VERIFIED',
     approval === 'pending' ? 'Manual check-in awaiting a manager' : null]
  )
  const checkinId = created.rows[0].id
  const eventId = await writeEvent(client, ctx, {
    platform: 'corporate', kind: 'check_in', employeeId: c.employeeId, checkinId, method: capture.method,
    capture, approvalState: approval,
  })
  return { checkinId, eventId, approval }
}

/**
 * Closes an open check-in. A check-out establishes no more about presence
 * than the check-in did, so it carries the check-in's method and reason.
 */
export async function checkOut(
  client: PoolClient, ctx: CoreContext, employeeId: string, checkinId: string,
  extra: Pick<Capture, 'deviceId' | 'clientTime' | 'idempotencyKey' | 'latitude' | 'longitude' | 'accuracyMetres'> = {}
): Promise<string> {
  const how = await client.query(
    `SELECT method, match_event_id, reason_code, reason_text FROM attendance_events
      WHERE tenant_id = $1 AND checkin_id = $2 AND kind = 'check_in' ORDER BY server_time LIMIT 1`,
    [ctx.tenantId, checkinId])
  const first = how.rows[0]
  // A check-in made before the core existed has no event: say so.
  const settled: Capture = first
    ? { ...extra, method: first.method, matchEventId: first.match_event_id, reasonCode: first.reason_code, reasonText: first.reason_text }
    : { ...extra, method: 'manual', reasonCode: 'other', reasonText: 'checked in before attendance events were recorded' }
  const r = await client.query(
    `UPDATE corporate_checkins SET check_out_time = LOCALTIMESTAMP
      WHERE id = $1 AND tenant_id = $2 AND employee_id = $3 AND check_out_time IS NULL
      RETURNING id`,
    [checkinId, ctx.tenantId, employeeId]
  )
  if (!r.rows.length) throw new AttendanceInputError('That check-in is not open', 409, 'not_open')
  await writeEvent(client, ctx, {
    platform: 'corporate', kind: 'check_out', employeeId, checkinId, method: settled.method as Method, capture: settled,
  })
  return checkinId
}

/**
 * A manager's decision on a check-in waiting for approval. Approved, its
 * hours count; rejected, they do not.
 */
export async function decideCheckIn(
  client: PoolClient, ctx: CoreContext, eventId: string, decision: 'approved' | 'rejected', note?: string | null
): Promise<{ checkinId: string; employeeId: string }> {
  if (!UUID.test(eventId)) throw new AttendanceInputError('No such check-in awaiting approval', 404, 'not_found')
  const pending = await client.query(
    `SELECT e.id, e.checkin_id, e.employee_id FROM attendance_events e
      WHERE e.id = $1 AND e.tenant_id = $2 AND e.kind = 'check_in' AND e.approval_state = 'pending'
        AND NOT EXISTS (SELECT 1 FROM attendance_events d
                         WHERE d.tenant_id = e.tenant_id AND d.kind = 'approval' AND d.supersedes_event_id = e.id)
      FOR UPDATE`,
    [eventId, ctx.tenantId]
  )
  if (!pending.rows.length) throw new AttendanceInputError('No such check-in awaiting approval', 404, 'not_found')
  const p = pending.rows[0]
  await client.query(
    `UPDATE corporate_checkins SET checkin_state = $3, state_reason = $4, state_changed_by = $5, state_changed_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND tenant_id = $2`,
    [p.checkin_id, ctx.tenantId, decision === 'approved' ? 'VERIFIED' : 'REVOKED',
     decision === 'approved' ? 'Manual check-in approved' : `Manual check-in rejected${note ? `: ${String(note).slice(0, 200)}` : ''}`,
     ctx.userId]
  )
  await writeEvent(client, ctx, {
    platform: 'corporate', kind: 'approval', employeeId: p.employee_id, checkinId: p.checkin_id, method: 'system',
    approvalState: decision, supersedes: p.id,
    capture: { method: 'manual', reasonText: note ? String(note).slice(0, 500) : null },
  })
  return { checkinId: p.checkin_id, employeeId: p.employee_id }
}
