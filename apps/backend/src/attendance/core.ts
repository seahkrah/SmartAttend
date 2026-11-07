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
import { ControlRefusal, alertKindFor, checkOutFindings, detect, runControls, type ControlResult } from './controls.js'

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
  /** The request's address, as the API saw it (TRUST_PROXY). */
  clientIp?: string | null
  /** The site of the kiosk the capture was made at (controls.ts). */
  kioskSiteId?: string | null
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
  kind: 'mark' | 'clear' | 'check_in' | 'check_out' | 'approval' | 'break_start' | 'break_end'
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
  /** What each check-in control found (controls.ts). */
  controls?: ControlResult[] | null
}

/** A tenant's whole-number setting, or the default when unset or not a non-negative integer. */
async function intSetting(client: PoolClient, tenantId: string, key: string, fallback: number): Promise<number> {
  const raw = await setting(client, tenantId, key)
  const v = Number(raw)
  return raw !== null && Number.isInteger(v) && v >= 0 ? v : fallback
}

export const ALERT_DEFAULTS = {
  /** Different people entered manually from one device within an hour. */
  deviceManualPerHour: 5,
  /** "Face not recognised" for one person within seven days. */
  faceNotRecognisedPerWeek: 3,
  /** Minutes before a rostered shift that a check-in still counts as on time. */
  shiftEarlyMinutes: 60,
}

async function raiseAlert(
  client: PoolClient, ctx: CoreContext, kind: string,
  subject: { studentId?: string | null; employeeId?: string | null; deviceId?: string | null },
  eventId: string, detail: Record<string, unknown>
) {
  await client.query(
    `INSERT INTO attendance_alerts (tenant_id, kind, student_id, employee_id, device_id, event_id, detail)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT DO NOTHING`,
    [ctx.tenantId, kind, subject.studentId ?? null, subject.employeeId ?? null, subject.deviceId ?? null, eventId,
     JSON.stringify(detail)]
  )
}

/**
 * The fallback's abuse alerts (brief 5.2), checked as each manual capture is
 * recorded: many people entered by hand from one device within an hour; one
 * person "not recognised" again and again; a manual check-in outside the
 * employee's rostered shift. At most one alert of a kind per subject and day.
 */
async function checkForAbuse(
  client: PoolClient, ctx: CoreContext, eventId: string, capture: Capture,
  subject: { studentId?: string | null; employeeId?: string | null }, isCheckIn: boolean
) {
  if (!isManual(capture.method) || capture.reasonCode === FACE_NOT_IN_USE) return
  const device = capture.deviceId ? String(capture.deviceId).slice(0, 128) : null
  if (device) {
    const limit = await intSetting(client, ctx.tenantId, 'attendance.device_manual_alert', ALERT_DEFAULTS.deviceManualPerHour)
    const r = await client.query(
      `SELECT count(DISTINCT COALESCE(student_id, employee_id))::int AS people FROM attendance_events
        WHERE tenant_id = $1 AND device_id = $2 AND method IN ('manual', 'offline_manual')
          AND kind IN ('mark', 'check_in') AND server_time > CURRENT_TIMESTAMP - INTERVAL '1 hour'`,
      [ctx.tenantId, device])
    if (limit > 0 && r.rows[0].people >= limit) {
      await raiseAlert(client, ctx, 'device_manual_burst', { deviceId: device }, eventId,
        { people: r.rows[0].people, withinMinutes: 60, limit })
    }
  }
  if (capture.reasonCode === 'face_not_recognised') {
    const limit = await intSetting(client, ctx.tenantId, 'attendance.face_not_recognised_alert', ALERT_DEFAULTS.faceNotRecognisedPerWeek)
    const r = await client.query(
      `SELECT count(*)::int AS n FROM attendance_events
        WHERE tenant_id = $1 AND reason_code = 'face_not_recognised'
          AND (student_id = $2 OR employee_id = $3) AND server_time > CURRENT_TIMESTAMP - INTERVAL '7 days'`,
      [ctx.tenantId, subject.studentId ?? null, subject.employeeId ?? null])
    if (limit > 0 && r.rows[0].n >= limit) {
      await raiseAlert(client, ctx, 'repeated_face_not_recognised', subject, eventId, { times: r.rows[0].n, withinDays: 7, limit })
    }
  }
  if (isCheckIn && subject.employeeId) {
    const early = await intSetting(client, ctx.tenantId, 'attendance.shift_early_minutes', ALERT_DEFAULTS.shiftEarlyMinutes)
    // Only for someone rostered today or yesterday: with no roster there is no shift to be outside.
    const r = await client.query(
      `SELECT bool_or(LOCALTIMESTAMP BETWEEN s.starts_at - make_interval(mins => $3) AND s.ends_at) AS on_shift,
              count(*)::int AS shifts
         FROM roster_shifts s
        WHERE s.tenant_id = $1 AND s.employee_id = $2 AND s.status <> 'cancelled'
          AND s.work_date BETWEEN CURRENT_DATE - 1 AND CURRENT_DATE`,
      [ctx.tenantId, subject.employeeId, early])
    if (r.rows[0].shifts > 0 && !r.rows[0].on_shift) {
      await raiseAlert(client, ctx, 'manual_outside_shift', subject, eventId, { shiftsToday: r.rows[0].shifts, earlyMinutes: early })
    }
  }
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
        actor_user_id, approval_state, idempotency_key, supersedes_event_id, client_ip, controls)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
             CASE WHEN $13::timestamptz IS NULL THEN NULL
                  ELSE EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - $13::timestamptz)) END,
             $14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
     RETURNING id`,
    [ctx.tenantId, e.platform, e.kind, e.studentId ?? null, e.employeeId ?? null, e.scheduleId ?? null,
     e.attendanceDate ?? null, e.status ?? null, e.attendanceId ?? null, e.checkinId ?? null, e.method,
     c.deviceId ? String(c.deviceId).slice(0, 128) : null, ct,
     num(c.latitude), num(c.longitude), num(c.accuracyMetres), c.matchEventId ?? null,
     c.reasonCode ?? null, c.reasonText ?? null, ctx.userId, e.approvalState ?? 'not_needed',
     c.idempotencyKey ? String(c.idempotencyKey).slice(0, 128) : null, e.supersedes ?? null,
     c.clientIp ? String(c.clientIp).slice(0, 64) : null, e.controls ? JSON.stringify(e.controls) : null]
  )
  return r.rows[0].id
}

function num(v: unknown): number | null {
  const n = Number(v)
  return v === null || v === undefined || v === '' || !Number.isFinite(n) ? null : n
}

/**
 * A capture already recorded under this key, if the client is retrying. Only
 * the same kind of capture for the same person replays: a key that belongs
 * to someone else's capture is refused, never answered with it (audit F7).
 */
async function replayed(
  client: PoolClient, ctx: CoreContext, key: string | null | undefined,
  who: { kind: 'mark' | 'check_in'; studentId?: string | null; employeeId?: string | null }
) {
  if (!key) return null
  const r = await client.query(
    `SELECT id, attendance_id, checkin_id, approval_state, kind, student_id, employee_id FROM attendance_events
      WHERE tenant_id = $1 AND idempotency_key = $2`, [ctx.tenantId, String(key).slice(0, 128)])
  const row = r.rows[0]
  if (!row) return null
  const same = row.kind === who.kind
    && (who.studentId ? row.student_id === who.studentId : row.employee_id === who.employeeId)
  if (!same) throw new AttendanceInputError('That idempotency key was used for a different capture', 409, 'key_reused')
  return row
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
  const again = await replayed(client, ctx, m.capture.idempotencyKey, { kind: 'mark', studentId: m.studentId })
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
  await checkForAbuse(client, ctx, eventId, capture, { studentId: m.studentId }, false)
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
  const again = await replayed(client, ctx, c.capture.idempotencyKey, { kind: 'check_in', employeeId: c.employeeId })
  if (again) return { checkinId: again.checkin_id, eventId: again.id, approval: again.approval_state }
  const capture = await settleCapture(client, ctx.tenantId, c.capture)
  const claim = {
    employeeId: c.employeeId,
    deviceId: capture.deviceId ? String(capture.deviceId).slice(0, 128) : null,
    clientIp: capture.clientIp ?? null,
    latitude: num(capture.latitude), longitude: num(capture.longitude), accuracyMetres: num(capture.accuracyMetres),
    byFace: isFace(capture.method),
    kioskSiteId: capture.kioskSiteId ?? null,
  }
  // Where, from what and when (brief 5.5): an enforced control refuses here;
  // a flagged one holds the hours for a manager, as a manual check-in can.
  let controls: { results: ControlResult[]; hold: ControlResult[] }
  try {
    controls = await runControls(client, ctx.tenantId, claim)
  } catch (e) {
    if (e instanceof ControlRefusal) throw new AttendanceInputError(e.message, 403, e.code)
    throw e
  }
  let approval: CheckInResult['approval'] = controls.hold.length ? 'pending' : 'not_needed'
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
     approval !== 'pending' ? null
       : controls.hold.length ? `Awaiting a manager: ${controls.hold.map((x) => x.code.replace(/_/g, ' ')).join(', ')}`
         : 'Manual check-in awaiting a manager']
  )
  const checkinId = created.rows[0].id
  const eventId = await writeEvent(client, ctx, {
    platform: 'corporate', kind: 'check_in', employeeId: c.employeeId, checkinId, method: capture.method,
    capture, approvalState: approval, controls: controls.results.length ? controls.results : null,
  })
  await checkForAbuse(client, ctx, eventId, capture, { employeeId: c.employeeId }, true)
  for (const held of controls.hold) {
    await raiseAlert(client, ctx, alertKindFor(held), { employeeId: c.employeeId }, eventId, { code: held.code, ...held.detail })
  }
  for (const a of await detect(client, ctx.tenantId, eventId, claim)) {
    await raiseAlert(client, ctx, a.kind, a.subject, eventId, a.detail)
  }
  return { checkinId, eventId, approval }
}

/**
 * Closes an open check-in. A check-out establishes no more about presence
 * than the check-in did, so it carries the check-in's method and reason.
 */
type Extra = Pick<Capture, 'deviceId' | 'clientTime' | 'idempotencyKey' | 'latitude' | 'longitude' | 'accuracyMetres' | 'clientIp' | 'kioskSiteId'>

/** A later event on a check-in carries the check-in's method and reason: it establishes no more about presence. */
async function asCheckedIn(client: PoolClient, ctx: CoreContext, checkinId: string, extra: Extra): Promise<Capture> {
  const how = await client.query(
    `SELECT method, match_event_id, reason_code, reason_text FROM attendance_events
      WHERE tenant_id = $1 AND checkin_id = $2 AND kind = 'check_in' ORDER BY server_time LIMIT 1`,
    [ctx.tenantId, checkinId])
  const first = how.rows[0]
  // A check-in made before the core existed has no event: say so.
  return first
    ? { ...extra, method: first.method, matchEventId: first.match_event_id, reasonCode: first.reason_code, reasonText: first.reason_text }
    : { ...extra, method: 'manual', reasonCode: 'other', reasonText: 'checked in before attendance events were recorded' }
}

export async function checkOut(
  client: PoolClient, ctx: CoreContext, employeeId: string, checkinId: string, extra: Extra = {}
): Promise<string> {
  const settled = await asCheckedIn(client, ctx, checkinId, extra)
  const r = await client.query(
    `UPDATE corporate_checkins SET check_out_time = LOCALTIMESTAMP
      WHERE id = $1 AND tenant_id = $2 AND employee_id = $3 AND check_out_time IS NULL
      RETURNING id`,
    [checkinId, ctx.tenantId, employeeId]
  )
  if (!r.rows.length) throw new AttendanceInputError('That check-in is not open', 409, 'not_open')
  // A break still open at check-out ends with it.
  const open = await client.query(
    `UPDATE checkin_breaks SET ended_at = LOCALTIMESTAMP
      WHERE tenant_id = $1 AND checkin_id = $2 AND ended_at IS NULL RETURNING id`, [ctx.tenantId, checkinId])
  if (open.rows.length) {
    await writeEvent(client, ctx, {
      platform: 'corporate', kind: 'break_end', employeeId, checkinId, method: settled.method as Method,
      capture: { ...settled, idempotencyKey: null },
    })
  }
  // Where the check-out came from, and whether it is long after the shift:
  // recorded on the event, and alerted when something fails (audit F9).
  const findings = await checkOutFindings(client, ctx.tenantId, {
    employeeId, deviceId: extra.deviceId ? String(extra.deviceId).slice(0, 128) : null, clientIp: extra.clientIp ?? null,
    latitude: num(extra.latitude), longitude: num(extra.longitude), accuracyMetres: num(extra.accuracyMetres),
    byFace: false, kioskSiteId: extra.kioskSiteId ?? null,
  })
  const eventId = await writeEvent(client, ctx, {
    platform: 'corporate', kind: 'check_out', employeeId, checkinId, method: settled.method as Method, capture: settled,
    controls: findings.length ? findings : null,
  })
  const failed = findings.filter((x) => !x.ok)
  if (failed.length) {
    await raiseAlert(client, ctx, 'checkout_flagged', { employeeId }, eventId,
      { checkinId, failed: failed.map((x) => ({ control: x.control, code: x.code, ...x.detail })) })
  }
  return checkinId
}

/**
 * Starts or ends a break inside an open check-in (brief 5.5). Worked hours
 * are the check-in's span less its breaks, so a break taken is a break
 * unpaid, as the roster's break_minutes assumes.
 */
export async function takeBreak(
  client: PoolClient, ctx: CoreContext, employeeId: string, checkinId: string, which: 'start' | 'end', extra: Extra = {}
): Promise<{ breakId: string; startedAt: string; endedAt: string | null }> {
  const ci = await client.query(
    `SELECT 1 FROM corporate_checkins
      WHERE id = $1 AND tenant_id = $2 AND employee_id = $3 AND check_out_time IS NULL FOR UPDATE`,
    [checkinId, ctx.tenantId, employeeId])
  if (!ci.rows.length) throw new AttendanceInputError('Check in before taking a break', 409, 'not_checked_in')
  let row
  if (which === 'start') {
    const r = await client.query(
      `INSERT INTO checkin_breaks (tenant_id, checkin_id, employee_id, started_at)
       SELECT $1, $2, $3, LOCALTIMESTAMP
        WHERE NOT EXISTS (SELECT 1 FROM checkin_breaks WHERE tenant_id = $1 AND checkin_id = $2 AND ended_at IS NULL)
       RETURNING id, started_at, ended_at`, [ctx.tenantId, checkinId, employeeId])
    if (!r.rows.length) throw new AttendanceInputError('You are already on a break', 409, 'on_break')
    row = r.rows[0]
  } else {
    const r = await client.query(
      `UPDATE checkin_breaks SET ended_at = LOCALTIMESTAMP
        WHERE tenant_id = $1 AND checkin_id = $2 AND ended_at IS NULL RETURNING id, started_at, ended_at`,
      [ctx.tenantId, checkinId])
    if (!r.rows.length) throw new AttendanceInputError('You are not on a break', 409, 'not_on_break')
    row = r.rows[0]
  }
  const settled = await asCheckedIn(client, ctx, checkinId, extra)
  await writeEvent(client, ctx, {
    platform: 'corporate', kind: which === 'start' ? 'break_start' : 'break_end', employeeId, checkinId,
    method: settled.method as Method, capture: settled,
  })
  return { breakId: row.id, startedAt: row.started_at, endedAt: row.ended_at }
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
