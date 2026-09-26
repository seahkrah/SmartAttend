import { Router, Request, Response, NextFunction } from 'express'
import { query } from '../db/connection.js'
import { authenticateToken } from '../auth/middleware.js'
import { resolveTenantContext, type TenantRequest } from '../auth/tenantContextMiddleware.js'
import { enquiryLimiter } from '../security/httpSecurity.js'
import { logAudit } from '../services/domainAuditService.js'
import { getClientIp } from '../utils/getClientIp.js'

/**
 * Access requests: a school or employer asking to use the platform.
 *
 *   POST  /api/access-requests        public — the "Request access" form
 *   GET   /api/access-requests        superadmin — the enquiries, newest first
 *   PATCH /api/access-requests/:id    superadmin — mark contacted/closed, add notes
 *
 * Only what is needed to answer the enquiry is accepted (see migration 063).
 * Anything else a client sends is ignored, not stored.
 */

const router = Router()

export const CONSENT_VERSION = '2026-09'

const ORG_TYPES = ['school', 'employer', 'both'] as const
const SIZE_BANDS = ['1-50', '51-200', '201-1000', '1001-5000', '5000+'] as const
const CONTACT = ['email', 'phone', 'whatsapp'] as const
const STATUSES = ['new', 'contacted', 'closed'] as const
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

class InputError extends Error {}

function text(value: unknown, label: string, max: number, required = false): string | null {
  if (value === undefined || value === null || value === '') {
    if (required) throw new InputError(`${label} is required`)
    return null
  }
  if (typeof value !== 'string') throw new InputError(`${label} must be text`)
  const t = value.trim().replace(/\s+/g, ' ')
  if (!t) {
    if (required) throw new InputError(`${label} is required`)
    return null
  }
  if (t.length > max) throw new InputError(`${label} must be at most ${max} characters`)
  return t
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], label: string, fallback?: T): T | null {
  if (value === undefined || value === null || value === '') {
    if (fallback !== undefined) return fallback
    return null
  }
  if (!allowed.includes(value as T)) throw new InputError(`${label} must be one of: ${allowed.join(', ')}`)
  return value as T
}

/**
 * A phone number in E.164 (the international format: '+', country code,
 * number). Spaces, dashes, dots and brackets are accepted and removed, since
 * that is how people write numbers; a leading "00" is read as "+".
 */
export function e164(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') throw new InputError('Phone must be text')
  let n = value.trim().replace(/[\s\-.()]/g, '')
  if (n.startsWith('00')) n = '+' + n.slice(2)
  if (!/^\+[1-9]\d{6,14}$/.test(n)) {
    throw new InputError('Give the phone number in international format, starting with + and the country code (e.g. +231 77 123 4567)')
  }
  return n
}

router.post('/', enquiryLimiter, async (req: Request, res: Response) => {
  try {
    const b = req.body ?? {}

    // A field no person can see. A bot fills it; it is told the request was
    // received and nothing is stored, so it learns nothing to adapt to.
    if (typeof b.website === 'string' && b.website.trim() !== '') {
      return res.status(201).json({ received: true })
    }

    const organisationName = text(b.organisationName, 'Organisation name', 200, true)!
    const organisationType = oneOf(b.organisationType, ORG_TYPES, 'Organisation type')
    if (!organisationType) throw new InputError('Organisation type is required')
    const countryCode = text(b.countryCode, 'Country', 2, true)!.toUpperCase()
    if (!/^[A-Z]{2}$/.test(countryCode)) throw new InputError('Country must be a two-letter ISO 3166 code')
    const sizeBand = oneOf(b.sizeBand, SIZE_BANDS, 'Size')
    const contactName = text(b.contactName, 'Your name', 150, true)!
    const jobTitle = text(b.jobTitle, 'Job title', 150)
    const email = text(b.email, 'Email', 255, true)!.toLowerCase()
    if (!EMAIL.test(email)) throw new InputError('Email is not a valid address')
    const phone = e164(b.phone)
    const preferredContact = oneOf(b.preferredContact, CONTACT, 'Preferred contact', 'email')!
    if (preferredContact !== 'email' && !phone) {
      throw new InputError(`Add a phone number to be contacted by ${preferredContact === 'whatsapp' ? 'WhatsApp' : 'phone'}`)
    }
    const message = text(b.message, 'Message', 2000)
    if (b.consent !== true) {
      throw new InputError('Please agree to be contacted about this request')
    }

    const r = await query(
      `INSERT INTO access_requests
         (organisation_name, organisation_type, country_code, size_band, contact_name, job_title,
          email, phone, preferred_contact, message, consent_at, consent_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP, $11)
       RETURNING id, created_at`,
      [organisationName, organisationType, countryCode, sizeBand, contactName, jobTitle,
       email, phone, preferredContact, message, CONSENT_VERSION]
    )
    return res.status(201).json({ received: true, reference: String(r.rows[0].id).slice(0, 8).toUpperCase() })
  } catch (e) {
    if (e instanceof InputError) return res.status(400).json({ error: e.message })
    console.error('[ACCESS_REQUESTS] create:', e)
    return res.status(500).json({ error: 'Your request could not be saved. Please try again.' })
  }
})

// ---------------------------------------------------------------- operator

async function requireSuperadmin(req: TenantRequest, res: Response, next: NextFunction) {
  if (!req.ctx?.isSuperadmin) return res.status(403).json({ error: 'Superadmin only' })
  return next()
}

router.get('/', authenticateToken, resolveTenantContext, requireSuperadmin, async (req: TenantRequest, res: Response) => {
  try {
    const status = typeof req.query.status === 'string' && STATUSES.includes(req.query.status as any)
      ? req.query.status : null
    const r = await query(
      `SELECT a.*, u.full_name AS handled_by_name
         FROM access_requests a
         LEFT JOIN users u ON u.id = a.handled_by
        WHERE ($1::text IS NULL OR a.status = $1)
        ORDER BY (a.status = 'new') DESC, a.created_at DESC
        LIMIT 500`,
      [status]
    )
    const counts = await query(`SELECT status, COUNT(*)::int AS n FROM access_requests GROUP BY status`)
    return res.json({
      requests: r.rows,
      counts: Object.fromEntries(counts.rows.map((x: any) => [x.status, x.n])),
    })
  } catch (e) {
    console.error('[ACCESS_REQUESTS] list:', e)
    return res.status(500).json({ error: 'Failed to load access requests' })
  }
})

router.patch('/:id', authenticateToken, resolveTenantContext, requireSuperadmin, async (req: TenantRequest, res: Response) => {
  try {
    if (!UUID.test(req.params.id)) return res.status(404).json({ error: 'Request not found' })
    const status = oneOf(req.body?.status, STATUSES, 'Status')
    const notes = req.body && 'internalNotes' in req.body ? text(req.body.internalNotes, 'Notes', 4000) : undefined
    if (!status && notes === undefined) return res.status(400).json({ error: 'Nothing to change' })

    const r = await query(
      `UPDATE access_requests
          SET status = COALESCE($2, status),
              internal_notes = CASE WHEN $3::boolean THEN $4 ELSE internal_notes END,
              handled_by = $5, handled_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *`,
      [req.params.id, status, notes !== undefined, notes ?? null, req.ctx!.userId]
    )
    if (r.rowCount === 0) return res.status(404).json({ error: 'Request not found' })
    await logAudit({
      actorId: req.ctx!.userId, actorRole: req.ctx!.roleName, actionType: 'ACCESS_REQUEST_UPDATED',
      actionScope: 'GLOBAL', resourceType: 'access_request', resourceId: req.params.id,
      afterState: { status: r.rows[0].status }, ipAddress: getClientIp(req),
    }).catch((err) => console.error('[ACCESS_REQUESTS] audit failed:', err))
    return res.json({ request: r.rows[0] })
  } catch (e) {
    if (e instanceof InputError) return res.status(400).json({ error: e.message })
    console.error('[ACCESS_REQUESTS] update:', e)
    return res.status(500).json({ error: 'Failed to update the request' })
  }
})

export default router
