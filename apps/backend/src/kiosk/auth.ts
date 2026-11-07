/**
 * A kiosk's identity (migration 093).
 *
 * An administrator creates a kiosk for one of the tenant's sites and is
 * shown a pairing code once. The device sends the code to POST
 * /api/kiosk/pair within 15 minutes and receives a token, which it presents
 * as `Authorization: Kiosk <token>` on the kiosk routes, and nowhere else:
 * a user session's middleware does not accept it, and this one accepts
 * nothing but it. Only SHA-256 hashes of the code and the token are stored.
 *
 * Neither the code nor the token says which tenant it belongs to, so both
 * are looked up on the system pool, as a session is; the tenant found is
 * then the only one this request sees (withTenant). This file is allow-listed
 * for both in scripts/checks/no-raw-query.mjs.
 */
import { createHash, randomBytes, randomInt } from 'crypto'
import type { NextFunction, Response } from 'express'
import { query } from '../db/connection.js'
import { runAsSystem, withTenant } from '../db/dbContext.js'
import { tagged } from '../auth/guards.js'
import type { TenantRequest } from '../auth/tenantContextMiddleware.js'

export interface Kiosk {
  id: string
  tenantId: string
  siteId: string
  deviceId: string
  label: string
  createdBy: string
}

export interface KioskRequest extends TenantRequest {
  kiosk?: Kiosk
}

export const PAIRING_MINUTES = 15
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex')
}

/** Eight characters from 32 (40 bits), shown as XXXX-XXXX; spaces, dashes and case do not matter. */
export function newPairingCode(): string {
  let c = ''
  for (let i = 0; i < 8; i++) c += ALPHABET[randomInt(ALPHABET.length)]
  return `${c.slice(0, 4)}-${c.slice(4)}`
}

export function normalisePairingCode(raw: unknown): string | null {
  const c = String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  return c.length === 8 && [...c].every((ch) => ALPHABET.includes(ch)) ? `${c.slice(0, 4)}-${c.slice(4)}` : null
}

/** Pairs a device: the code is spent, a fresh token replaces any earlier one. */
export async function pair(rawCode: unknown): Promise<{ token: string; kiosk: { id: string; label: string; tenantId: string } } | null> {
  const code = normalisePairingCode(rawCode)
  if (!code) return null
  const token = randomBytes(32).toString('base64url')
  const r = await runAsSystem('kiosk pairing: the code names its kiosk before any session', () => query(
    `UPDATE kiosks SET token_hash = $2, pairing_hash = NULL, pairing_expires_at = NULL, paired_at = CURRENT_TIMESTAMP
      WHERE pairing_hash = $1 AND pairing_expires_at > CURRENT_TIMESTAMP AND revoked_at IS NULL
      RETURNING id, label, tenant_id`,
    [sha256(code), sha256(token)]))
  const row = r.rows[0]
  return row ? { token, kiosk: { id: row.id, label: row.label, tenantId: row.tenant_id } } : null
}

const TOKEN = /^Kiosk ([A-Za-z0-9_-]{40,64})$/

/** The kiosk routes' authentication: a paired, unrevoked kiosk's token, bound to its tenant. */
export function kioskAuth(what: string) {
  return tagged(async (req: KioskRequest, res: Response, next: NextFunction) => {
    try {
      const m = TOKEN.exec(req.header('authorization') ?? '')
      if (!m) return res.status(401).json({ error: 'This kiosk is not paired', code: 'kiosk_unpaired' })
      const r = await runAsSystem('kiosk token: names its kiosk and tenant before any session', () => query(
        `UPDATE kiosks SET last_seen_at = CURRENT_TIMESTAMP
          WHERE token_hash = $1 AND revoked_at IS NULL
          RETURNING id, tenant_id, site_id, device_id, label, created_by`, [sha256(m[1])]))
      const k = r.rows[0]
      if (!k) {
        return res.status(401).json({ error: 'This kiosk is no longer paired. Ask an administrator to pair it again.', code: 'kiosk_revoked' })
      }
      req.kiosk = { id: k.id, tenantId: k.tenant_id, siteId: k.site_id, deviceId: k.device_id, label: k.label, createdBy: k.created_by }
      return withTenant({ tenantId: k.tenant_id, userId: null }, next)
    } catch (e) {
      console.error('[KIOSK] auth', e)
      return res.status(500).json({ error: 'The kiosk could not be checked' })
    }
  }, { kind: 'kiosk', what })
}

/**
 * Runs fn as the employee at the kiosk: their user id is the actor of what
 * they do there (their face check, their check-in), inside the kiosk's tenant.
 */
export function asEmployee<T>(kiosk: Kiosk, userId: string, fn: () => T): T {
  return withTenant({ tenantId: kiosk.tenantId, userId }, fn)
}
