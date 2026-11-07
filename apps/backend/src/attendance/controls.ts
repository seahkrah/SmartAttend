/**
 * Where, from what and when an employee may check in (brief 5.5).
 *
 * Four controls, each a tenant setting that is off by default:
 *
 *   checkin.geofence      the device's reported position, with its accuracy,
 *                         inside one of the tenant's sites;
 *   checkin.network       the request from one of the sites' networks (CIDR);
 *   checkin.device        the device registered to this employee, or a
 *                         registered shared kiosk;
 *   checkin.shift_window  within the employee's rostered shift, from
 *                         attendance.shift_early_minutes before it.
 *
 * "flag" records the check-in but holds its hours for a manager (the same
 * approval the manual fallback uses) and raises an alert; "enforce" refuses
 * it. Each check says what it found, and that is kept on the event.
 *
 * Two detections are not settings and only raise alerts: buddy punching (one
 * unshared device checking in different people within moments, without a
 * face match) and impossible travel (two check-ins further apart than anyone
 * could travel between them).
 *
 * A reported position is the device's claim, not a fact: a rooted phone can
 * report any coordinates. The geofence keeps honest people honest and
 * records what was claimed; the network and device checks are harder to
 * fake, and none of them is proof.
 */
import { BlockList, isIP } from 'net'
import type { PoolClient } from 'pg'

export type Mode = 'off' | 'flag' | 'enforce'
export type ControlName = 'geofence' | 'network' | 'device' | 'shift_window'

export interface ControlResult {
  control: ControlName
  mode: Mode
  ok: boolean
  /** Why it failed, or what made it pass when there was nothing to check. */
  code: string
  detail?: Record<string, unknown>
}

export interface Claim {
  employeeId: string
  deviceId: string | null
  clientIp: string | null
  latitude: number | null
  longitude: number | null
  accuracyMetres: number | null
  /** A face match backs the check-in. */
  byFace: boolean
  /**
   * The site a kiosk is registered to. A kiosk reports no position: it is
   * placed where it was installed, and fails the geofence if that site has
   * been retired.
   */
  kioskSiteId?: string | null
}

export const CONTROL_DEFAULTS = {
  /** A position reported less precisely than this cannot place anyone inside a site. */
  maxAccuracyMetres: 100,
  shiftEarlyMinutes: 60,
  /** Minutes after a shift ends that checking in is still within it (someone arriving late). */
  shiftLateMinutes: 0,
  /** Different people on one unshared device within this many seconds. */
  buddySeconds: 120,
  /** Faster than this between two check-ins is impossible travel. */
  maxSpeedKmh: 300,
}

const ALERT_FOR: Record<ControlName, string> = {
  geofence: 'outside_geofence',
  network: 'outside_network',
  device: 'unregistered_device',
  shift_window: 'outside_shift_window',
}

const MESSAGES: Record<string, string> = {
  no_location: 'Your location is needed to check in here. Allow location access and try again.',
  location_imprecise: 'Your location is too imprecise to place you at a site. Move to open sky or turn on precise location.',
  outside_geofence: 'You are not at one of your organisation\'s sites.',
  outside_network: 'Check in from your organisation\'s network.',
  no_device_id: 'This device is not identified. Use the app on a registered device.',
  unregistered_device: 'This device is not registered for your check-in. Ask HR to register it.',
  outside_shift_window: 'You are not rostered to work now.',
  kiosk_site_retired: "This kiosk's site is no longer in use. Ask an administrator.",
}

export class ControlRefusal extends Error {
  readonly status = 403
  constructor(readonly code: string, readonly results: ControlResult[]) {
    super(MESSAGES[code] ?? 'This check-in is not allowed.')
  }
}

async function settings(client: PoolClient, tenantId: string): Promise<Map<string, string>> {
  const r = await client.query(
    `SELECT setting_key, setting_value FROM tenant_settings
      WHERE tenant_id = $1 AND (setting_key LIKE 'checkin.%' OR setting_key = 'attendance.shift_early_minutes')`,
    [tenantId])
  return new Map(r.rows.map((x: any) => [x.setting_key, x.setting_value]))
}

function modeOf(s: Map<string, string>, control: ControlName): Mode {
  const v = s.get(`checkin.${control}`)
  return v === 'flag' || v === 'enforce' ? v : 'off'
}

function intOf(s: Map<string, string>, key: string, fallback: number): number {
  const raw = s.get(key)
  const v = Number(raw)
  return raw !== undefined && Number.isInteger(v) && v >= 0 ? v : fallback
}

/** Great-circle distance in metres. */
export function metresBetween(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371008.8
  const rad = (d: number) => (d * Math.PI) / 180
  const dLat = rad(lat2 - lat1)
  const dLon = rad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}

/**
 * Whether a reported position, with its accuracy, can be at a site.
 *
 * The device says it is within `accuracy` metres of the point it reports. It
 * is placed at the site when that circle reaches the site's circle, so a
 * person standing at the edge of the building is not refused for their
 * phone's error; a position less precise than maxAccuracy places nobody.
 */
export function geofence(
  pos: { latitude: number | null; longitude: number | null; accuracyMetres: number | null },
  sites: { id: string; name: string; latitude: number; longitude: number; radius_m: number }[],
  maxAccuracy: number
): { ok: boolean; code: string; detail: Record<string, unknown> } {
  if (pos.latitude === null || pos.longitude === null || !Number.isFinite(pos.latitude) || !Number.isFinite(pos.longitude)
      || Math.abs(pos.latitude) > 90 || Math.abs(pos.longitude) > 180) {
    return { ok: false, code: 'no_location', detail: {} }
  }
  const accuracy = pos.accuracyMetres
  if (accuracy === null || !Number.isFinite(accuracy) || accuracy < 0 || accuracy > maxAccuracy) {
    return { ok: false, code: 'location_imprecise', detail: { accuracyMetres: accuracy, maxAccuracyMetres: maxAccuracy } }
  }
  let nearest: { site: (typeof sites)[number]; distance: number } | null = null
  for (const site of sites) {
    const d = metresBetween(pos.latitude, pos.longitude, Number(site.latitude), Number(site.longitude))
    if (!nearest || d - site.radius_m < nearest.distance - nearest.site.radius_m) nearest = { site, distance: d }
  }
  if (!nearest) return { ok: true, code: 'no_sites', detail: {} }
  const detail = {
    site: nearest.site.name, siteId: nearest.site.id, distanceMetres: Math.round(nearest.distance),
    radiusMetres: nearest.site.radius_m, accuracyMetres: accuracy,
  }
  return nearest.distance - accuracy <= nearest.site.radius_m
    ? { ok: true, code: 'inside', detail }
    : { ok: false, code: 'outside_geofence', detail }
}

/** An IPv4-mapped IPv6 address ("::ffff:10.0.0.5") as the IPv4 it is. */
export function normaliseIp(ip: string | null | undefined): string | null {
  if (!ip) return null
  const v = ip.trim().replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i, '$1')
  return isIP(v) ? v : null
}

/** Whether an address is inside any of the CIDRs (a bare address is one host). Bad entries are skipped. */
export function inNetworks(ip: string | null, cidrs: string[]): boolean {
  const addr = normaliseIp(ip)
  if (!addr) return false
  const list = new BlockList()
  for (const raw of cidrs) {
    const [base, bits] = String(raw).trim().split('/')
    const family = isIP(base)
    if (!family) continue
    const type = family === 4 ? 'ipv4' : 'ipv6'
    const prefix = bits === undefined ? (family === 4 ? 32 : 128) : Number(bits)
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > (family === 4 ? 32 : 128)) continue
    list.addSubnet(base, prefix, type)
  }
  return list.check(addr, isIP(addr) === 4 ? 'ipv4' : 'ipv6')
}

/** Whether a string is a usable CIDR or address, for validating what an administrator enters. */
export function validCidr(raw: string): boolean {
  const [base, bits] = String(raw).trim().split('/')
  const family = isIP(base)
  if (!family) return false
  if (bits === undefined) return true
  const prefix = Number(bits)
  return /^\d+$/.test(bits) && prefix >= 0 && prefix <= (family === 4 ? 32 : 128)
}

/**
 * Runs the tenant's controls for a check-in. Returns what each found, and
 * whether the check-in is to be held for a manager; throws ControlRefusal
 * when an enforced control fails.
 */
export async function runControls(
  client: PoolClient, tenantId: string, claim: Claim
): Promise<{ results: ControlResult[]; hold: ControlResult[] }> {
  const s = await settings(client, tenantId)
  const results: ControlResult[] = []
  const sitesNeeded = modeOf(s, 'geofence') !== 'off' || modeOf(s, 'network') !== 'off'
  const sites = sitesNeeded
    ? (await client.query(
      `SELECT id, name, latitude::float8 AS latitude, longitude::float8 AS longitude, radius_m, allowed_cidrs
         FROM checkin_sites WHERE tenant_id = $1 AND is_active`, [tenantId])).rows
    : []

  const geo = modeOf(s, 'geofence')
  if (geo !== 'off' && claim.kioskSiteId) {
    const k = sites.find((x: any) => x.id === claim.kioskSiteId)
    results.push(k
      ? { control: 'geofence', mode: geo, ok: true, code: 'kiosk_site', detail: { site: k.name, siteId: k.id } }
      : { control: 'geofence', mode: geo, ok: false, code: 'kiosk_site_retired', detail: { siteId: claim.kioskSiteId } })
  } else if (geo !== 'off') {
    if (!sites.length) results.push({ control: 'geofence', mode: geo, ok: true, code: 'no_sites' })
    else {
      const g = geofence(claim, sites, intOf(s, 'checkin.max_accuracy_m', CONTROL_DEFAULTS.maxAccuracyMetres))
      results.push({ control: 'geofence', mode: geo, ...g })
    }
  }

  const net = modeOf(s, 'network')
  if (net !== 'off') {
    const cidrs = sites.flatMap((x: any) => x.allowed_cidrs ?? [])
    if (!cidrs.length) results.push({ control: 'network', mode: net, ok: true, code: 'no_networks' })
    else {
      const ok = inNetworks(claim.clientIp, cidrs)
      results.push({ control: 'network', mode: net, ok, code: ok ? 'inside' : 'outside_network',
        detail: { clientIp: normaliseIp(claim.clientIp) } })
    }
  }

  const dev = modeOf(s, 'device')
  if (dev !== 'off') {
    if (!claim.deviceId) results.push({ control: 'device', mode: dev, ok: false, code: 'no_device_id' })
    else {
      const r = await client.query(
        `SELECT employee_id FROM attendance_devices
          WHERE tenant_id = $1 AND device_id = $2 AND revoked_at IS NULL
            AND (employee_id = $3 OR employee_id IS NULL)
          ORDER BY employee_id NULLS LAST LIMIT 1`,
        [tenantId, claim.deviceId, claim.employeeId])
      const row = r.rows[0]
      results.push(row
        ? { control: 'device', mode: dev, ok: true, code: row.employee_id ? 'registered' : 'shared_kiosk' }
        : { control: 'device', mode: dev, ok: false, code: 'unregistered_device' })
    }
  }

  const win = modeOf(s, 'shift_window')
  if (win !== 'off') {
    const early = intOf(s, 'attendance.shift_early_minutes', CONTROL_DEFAULTS.shiftEarlyMinutes)
    const late = intOf(s, 'checkin.shift_late_minutes', CONTROL_DEFAULTS.shiftLateMinutes)
    const r = await client.query(
      `SELECT bool_or(LOCALTIMESTAMP BETWEEN s.starts_at - make_interval(mins => $3)
                                         AND s.ends_at + make_interval(mins => $4)) AS on_shift,
              count(*)::int AS shifts
         FROM roster_shifts s
        WHERE s.tenant_id = $1 AND s.employee_id = $2 AND s.status <> 'cancelled'
          AND s.work_date BETWEEN CURRENT_DATE - 1 AND CURRENT_DATE`,
      [tenantId, claim.employeeId, early, late])
    const { shifts, on_shift } = r.rows[0]
    // Nobody rostered today is not outside a roster: there is nothing to be outside.
    results.push(shifts === 0
      ? { control: 'shift_window', mode: win, ok: true, code: 'not_rostered' }
      : { control: 'shift_window', mode: win, ok: !!on_shift, code: on_shift ? 'on_shift' : 'outside_shift_window',
          detail: { earlyMinutes: early, lateMinutes: late } })
  }

  const refused = results.find((x) => !x.ok && x.mode === 'enforce')
  if (refused) throw new ControlRefusal(refused.code, results)
  return { results, hold: results.filter((x) => !x.ok && x.mode === 'flag') }
}

export function alertKindFor(r: ControlResult): string {
  return ALERT_FOR[r.control]
}

/**
 * Buddy punching and impossible travel, checked after the check-in is
 * written. Returns the alerts to raise; the core raises them.
 */
export async function detect(
  client: PoolClient, tenantId: string, eventId: string, claim: Claim
): Promise<{ kind: string; subject: { employeeId?: string; deviceId?: string }; detail: Record<string, unknown> }[]> {
  const s = await settings(client, tenantId)
  const out: { kind: string; subject: { employeeId?: string; deviceId?: string }; detail: Record<string, unknown> }[] = []

  if (claim.deviceId && !claim.byFace) {
    const shared = await client.query(
      `SELECT 1 FROM attendance_devices WHERE tenant_id = $1 AND device_id = $2 AND employee_id IS NULL AND revoked_at IS NULL`,
      [tenantId, claim.deviceId])
    if (!shared.rows.length) {
      const seconds = intOf(s, 'checkin.buddy_seconds', CONTROL_DEFAULTS.buddySeconds)
      const r = await client.query(
        `SELECT array_agg(DISTINCT employee_id) AS others FROM attendance_events
          WHERE tenant_id = $1 AND device_id = $2 AND kind = 'check_in' AND employee_id <> $3 AND id <> $4
            AND method NOT IN ('face', 'offline_face')
            AND server_time > CURRENT_TIMESTAMP - make_interval(secs => $5)`,
        [tenantId, claim.deviceId, claim.employeeId, eventId, seconds])
      const others: string[] = r.rows[0].others ?? []
      if (seconds > 0 && others.length) {
        out.push({ kind: 'buddy_punching', subject: { employeeId: claim.employeeId, deviceId: claim.deviceId },
          detail: { otherEmployees: others, withinSeconds: seconds } })
      }
    }
  }

  if (claim.latitude !== null && claim.longitude !== null) {
    const prev = await client.query(
      `SELECT latitude::float8 AS latitude, longitude::float8 AS longitude, location_accuracy_m::float8 AS accuracy,
              EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - server_time))::float8 AS seconds_ago
         FROM attendance_events
        WHERE tenant_id = $1 AND employee_id = $2 AND id <> $3 AND kind IN ('check_in', 'check_out')
          AND latitude IS NOT NULL AND longitude IS NOT NULL
          AND server_time > CURRENT_TIMESTAMP - INTERVAL '24 hours'
        ORDER BY server_time DESC LIMIT 1`,
      [tenantId, claim.employeeId, eventId])
    const p = prev.rows[0]
    if (p) {
      const metres = metresBetween(p.latitude, p.longitude, claim.latitude, claim.longitude)
      // Both positions may be off by their accuracy; only what is left over is travel.
      const travelled = Math.max(0, metres - (p.accuracy ?? 0) - (claim.accuracyMetres ?? 0))
      const hours = Math.max(p.seconds_ago, 60) / 3600
      const kmh = travelled / 1000 / hours
      const max = intOf(s, 'checkin.max_speed_kmh', CONTROL_DEFAULTS.maxSpeedKmh)
      if (max > 0 && travelled > 1000 && kmh > max) {
        out.push({ kind: 'impossible_travel', subject: { employeeId: claim.employeeId },
          detail: { kilometres: Math.round(travelled / 100) / 10, minutes: Math.round(p.seconds_ago / 60),
            kmh: Math.round(kmh), maxKmh: max } })
      }
    }
  }
  return out
}
