import { Router, Response, NextFunction } from 'express'
import { query } from '../db/connection.js'
import { authenticateToken } from '../auth/middleware.js'
import {
  resolveTenantContext,
  requireTenant,
  requireRoles,
  type ResolvedTenantContext,
  type TenantRequest,
} from '../auth/tenantContextMiddleware.js'
import {
  NotificationError,
  channelStatus,
  notify,
  resolveRecipients,
  resolveTemplate,
  runOnce,
  suppress,
} from '../notifications/service.js'
import { DEFAULT_TEMPLATES, SENSITIVE_EVENTS, knownEventKeys } from '../notifications/templates.js'
import { render, variablesIn } from '../notifications/render.js'
import type { Channel } from '../notifications/types.js'

/**
 * Notifications.
 *
 * Two audiences on one router:
 *
 *   everyone   their own inbox, and their own preferences about what they
 *              receive on which channel
 *   admin      channel configuration, templates, the outbox, suppressions,
 *              and a test send
 *
 * Not gated on a platform: SMS and EMS both send notifications, and the
 * templates that differ do so by event key rather than by platform.
 *
 * A note on the configuration surface: a channel stores the NAME of an
 * environment variable holding its password, never the password. That is
 * enforced here as well as in the schema — an administrator who pastes a
 * secret into the config blob gets a 400 rather than a shared table with a
 * credential in it.
 */

const router = Router()

router.use(authenticateToken, resolveTenantContext, requireTenant)

type Ctx = ResolvedTenantContext & { tenantId: string }

function ctxOf(req: TenantRequest): Ctx {
  return req.ctx as Ctx
}

const admin = requireRoles('admin', 'hr', 'hr_director')
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CHANNELS: Channel[] = ['email', 'sms', 'push', 'in_app']

function fail(res: Response, label: string, e: unknown) {
  if (e instanceof NotificationError) return res.status(e.status).json({ error: e.message })
  const err = e as { code?: string; constraint?: string; message?: string }

  if (err.code === '2F003' || err.code === 'P0001' || err.code === '23001') {
    return res.status(409).json({ error: err.message ?? 'That record can no longer be changed' })
  }
  if (err.code === '23505') {
    if (err.constraint === 'uq_notification_channels_tenant') {
      return res.status(409).json({ error: 'This channel is already configured' })
    }
    if (err.constraint === 'uq_notification_templates_key') {
      return res.status(409).json({ error: 'A template for that event and channel already exists' })
    }
    return res.status(409).json({ error: 'That record already exists' })
  }
  if (err.code === '23514') {
    return res.status(400).json({ error: 'The values supplied are outside what this record allows' })
  }
  if (err.code === '23503') {
    return res.status(400).json({ error: 'That record refers to something which does not exist' })
  }
  console.error(`[NOTIFICATIONS] ${label}:`, e)
  return res.status(500).json({ error: `Failed to ${label}` })
}

function notFound(res: Response, what: string) {
  return res.status(404).json({ error: `${what} not found` })
}

function isChannel(value: unknown): value is Channel {
  return typeof value === 'string' && (CHANNELS as string[]).includes(value)
}

/**
 * Rejects a configuration blob that looks like it contains a secret.
 *
 * The schema cannot express "this JSON must not hold a password", and an
 * administrator following a vendor's setup guide will paste one in without
 * thinking. Refusing by key name catches the realistic mistake; it is not
 * meant to defeat somebody determined to store a secret in a field called
 * `host`.
 */
const SECRET_KEYS = /^(pass|password|secret|token|key|api_?key|credential|auth)/i

function secretLike(config: Record<string, unknown>): string | null {
  for (const key of Object.keys(config ?? {})) {
    if (SECRET_KEYS.test(key)) return key
  }
  return null
}

// ===========================================================================
// A person's own inbox
// ===========================================================================

router.get('/inbox', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const unreadOnly = req.query.unread === 'true'
    const limit = Math.min(Number(req.query.limit) || 50, 200)

    // Scoped to this user AND this tenant: a person who belongs to two
    // tenants sees one inbox at a time, not both merged.
    const rows = await query(
      `SELECT n.id, n.category, n.subject, n.body, n.status, n.read_at, n.created_at,
              n.message_id, m.event_key
         FROM notifications n
         LEFT JOIN notification_messages m
                ON m.id = n.message_id AND m.tenant_id = n.tenant_id
        WHERE n.recipient_user_id = $1 AND n.tenant_id = $2
          AND ($3::boolean IS FALSE OR n.read_at IS NULL)
        ORDER BY n.created_at DESC
        LIMIT $4`,
      [ctx.userId, ctx.tenantId, unreadOnly, limit]
    )

    const unread = await query(
      `SELECT COUNT(*)::int AS n FROM notifications
        WHERE recipient_user_id = $1 AND tenant_id = $2 AND read_at IS NULL`,
      [ctx.userId, ctx.tenantId]
    )

    return res.json({ notifications: rows.rows, unread: unread.rows[0].n })
  } catch (e) {
    return fail(res, 'load your inbox', e)
  }
})

router.post('/inbox/:notificationId/read', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const { notificationId } = req.params
    if (!UUID.test(notificationId)) return notFound(res, 'Notification')

    // The recipient predicate is what makes this safe: another person's
    // notification simply is not found.
    const updated = await query(
      `UPDATE notifications
          SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP), status = 'read'
        WHERE id = $1 AND recipient_user_id = $2 AND tenant_id = $3
        RETURNING id, read_at`,
      [notificationId, ctx.userId, ctx.tenantId]
    )
    if (updated.rowCount === 0) return notFound(res, 'Notification')
    return res.json({ notification: updated.rows[0] })
  } catch (e) {
    return fail(res, 'mark that as read', e)
  }
})

router.post('/inbox/read-all', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const updated = await query(
      `UPDATE notifications
          SET read_at = CURRENT_TIMESTAMP, status = 'read'
        WHERE recipient_user_id = $1 AND tenant_id = $2 AND read_at IS NULL
        RETURNING id`,
      [ctx.userId, ctx.tenantId]
    )
    return res.json({ marked: updated.rowCount ?? 0 })
  } catch (e) {
    return fail(res, 'mark everything as read', e)
  }
})

// ===========================================================================
// A person's own preferences
// ===========================================================================

/**
 * What this person receives, and where.
 *
 * Returns every category and channel with its effective setting rather than
 * only the rows that exist, because "no row" means "yes" and a UI that only
 * shows stored rows would show an empty page to someone receiving everything.
 */
router.get('/preferences', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const stored = await query(
      `SELECT category, channel, is_enabled FROM notification_preferences
        WHERE tenant_id = $1 AND user_id = $2`,
      [ctx.tenantId, ctx.userId]
    )

    const set = new Map<string, boolean>()
    for (const row of stored.rows) set.set(`${row.category}:${row.channel}`, row.is_enabled)

    const categories = [...new Set(Object.values(DEFAULT_TEMPLATES)
      .flatMap((t) => Object.values(t).map((d) => d.category)))].sort()

    const preferences = categories.flatMap((category) =>
      CHANNELS.map((channel) => ({
        category,
        channel,
        enabled: set.get(`${category}:${channel}`) ?? true,
        // account and system carry password resets and channel tests; an
        // opt-out there locks the person out of their own account recovery.
        locked: category === 'account' || category === 'system',
      }))
    )

    return res.json({ preferences })
  } catch (e) {
    return fail(res, 'load your preferences', e)
  }
})

router.put('/preferences', async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const b = req.body ?? {}
    if (!b.category || !isChannel(b.channel)) {
      return res.status(400).json({ error: 'category and a valid channel are required' })
    }
    if (b.enabled === undefined) {
      return res.status(400).json({ error: 'enabled is required' })
    }
    if (b.category === 'account' || b.category === 'system') {
      return res.status(409).json({
        error: 'Account and system messages cannot be switched off; they carry account recovery',
      })
    }

    // user_id comes from the token. A body that names somebody else changes
    // nothing about whose preference this is.
    const saved = await query(
      `INSERT INTO notification_preferences (tenant_id, user_id, category, channel, is_enabled)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (tenant_id, user_id, category, channel)
         DO UPDATE SET is_enabled = EXCLUDED.is_enabled, updated_at = CURRENT_TIMESTAMP
       RETURNING category, channel, is_enabled`,
      [ctx.tenantId, ctx.userId, b.category, b.channel, !!b.enabled]
    )
    return res.json({ preference: saved.rows[0] })
  } catch (e) {
    return fail(res, 'save your preference', e)
  }
})

// ===========================================================================
// Channels
// ===========================================================================

/** Every channel with its configuration and whether it can actually send. */
router.get('/channels', admin, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const channels = []
    for (const channel of CHANNELS) {
      const { config, ready, reason } = await channelStatus(ctx.tenantId, channel)
      channels.push({
        channel,
        provider: config.provider,
        isEnabled: config.isEnabled,
        config: config.config,
        // The variable's name is safe to show — it is what the administrator
        // typed. Whether it is set on this server is useful and not secret.
        secretEnvVar: config.secretEnvVar,
        secretIsSet: config.secretEnvVar ? Boolean(process.env[config.secretEnvVar]) : null,
        fromName: config.fromName,
        fromAddress: config.fromAddress,
        replyTo: config.replyTo,
        hourlyLimit: config.hourlyLimit,
        ready,
        reason,
      })
    }
    return res.json({ channels })
  } catch (e) {
    return fail(res, 'load channels', e)
  }
})

router.put('/channels/:channel', admin, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const channel = req.params.channel
    if (!isChannel(channel)) return res.status(400).json({ error: 'Unknown channel' })

    const b = req.body ?? {}
    if (!b.provider) return res.status(400).json({ error: 'provider is required' })

    const config = (b.config ?? {}) as Record<string, unknown>
    const offending = secretLike(config)
    if (offending) {
      return res.status(400).json({
        error: `Do not put credentials in the configuration. Remove '${offending}' and set `
          + `secretEnvVar to the name of an environment variable holding it instead.`,
      })
    }

    const saved = await query(
      `INSERT INTO notification_channels
         (tenant_id, channel, provider, is_enabled, config, secret_env_var,
          from_name, from_address, reply_to, hourly_limit)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (tenant_id, channel) DO UPDATE
         SET provider = EXCLUDED.provider,
             is_enabled = EXCLUDED.is_enabled,
             config = EXCLUDED.config,
             secret_env_var = EXCLUDED.secret_env_var,
             from_name = EXCLUDED.from_name,
             from_address = EXCLUDED.from_address,
             reply_to = EXCLUDED.reply_to,
             hourly_limit = EXCLUDED.hourly_limit,
             updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [
        ctx.tenantId, channel, b.provider,
        b.isEnabled !== undefined ? !!b.isEnabled : true,
        JSON.stringify(config), b.secretEnvVar || null,
        b.fromName || null, b.fromAddress || null, b.replyTo || null,
        b.hourlyLimit === undefined || b.hourlyLimit === null ? null : Number(b.hourlyLimit),
      ]
    )

    const status = await channelStatus(ctx.tenantId, channel)
    return res.json({
      channel: saved.rows[0],
      ready: status.ready,
      reason: status.reason,
    })
  } catch (e) {
    return fail(res, 'save that channel', e)
  }
})

/**
 * Sends a test message on a channel.
 *
 * Always to the caller's own address. A test send that takes an arbitrary
 * destination is a way to use somebody else's configured relay to mail a
 * stranger from the school's domain.
 */
router.post('/channels/:channel/test', admin, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const channel = req.params.channel
    if (!isChannel(channel)) return res.status(400).json({ error: 'Unknown channel' })

    const me = await resolveRecipients({ query }, ctx.tenantId, [ctx.userId])
    if (me.length === 0) return notFound(res, 'Your account in this tenant')

    const summary = await notify({ query }, { tenantId: ctx.tenantId, userId: ctx.userId }, {
      eventKey: 'system.test',
      channels: [channel],
      recipients: me,
      priority: 1,
      data: {
        channelName: channel,
        actorName: me[0].name ?? 'an administrator',
        sentAt: new Date().toISOString(),
      },
    })

    // Sent immediately rather than left for the dispatcher: the point of a
    // test is to find out now whether the channel works.
    const swept = await runOnce(10, ctx.tenantId)

    const delivered = summary.queued.length > 0
      ? (await query(
          `SELECT m.status, m.last_error, m.provider, d.provider_response
             FROM notification_messages m
             LEFT JOIN notification_deliveries d
                    ON d.message_id = m.id AND d.attempt = m.attempts
            WHERE m.id = $1 AND m.tenant_id = $2`,
          [summary.queued[0].id, ctx.tenantId]
        )).rows[0]
      : null

    return res.json({ summary, swept, result: delivered })
  } catch (e) {
    return fail(res, 'send a test message', e)
  }
})

// ===========================================================================
// Templates
// ===========================================================================

/** Every event, its channels, and whether this tenant has overridden it. */
router.get('/templates', admin, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const own = await query(
      `SELECT * FROM notification_templates WHERE tenant_id = $1
        ORDER BY event_key, channel`,
      [ctx.tenantId]
    )

    const overrides = new Map<string, any>()
    for (const row of own.rows) overrides.set(`${row.event_key}:${row.channel}:${row.locale}`, row)

    const events = knownEventKeys().map((eventKey) => ({
      eventKey,
      channels: Object.entries(DEFAULT_TEMPLATES[eventKey]).map(([channel, def]) => {
        const override = overrides.get(`${eventKey}:${channel}:en`)
        return {
          channel,
          category: def.category,
          required: def.required,
          variables: variablesIn(`${def.subject ?? ''} ${def.body}`),
          source: override ? 'tenant' : 'default',
          subject: override?.subject ?? def.subject ?? null,
          body: override?.body ?? def.body,
          templateId: override?.id ?? null,
          isActive: override ? override.is_active : true,
          // Carries a password link; the wording is fixed.
          locked: SENSITIVE_EVENTS.has(eventKey),
        }
      }),
    }))

    return res.json({ events })
  } catch (e) {
    return fail(res, 'load templates', e)
  }
})

router.put('/templates', admin, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const b = req.body ?? {}
    if (!b.eventKey || !isChannel(b.channel)) {
      return res.status(400).json({ error: 'eventKey and a valid channel are required' })
    }
    if (!b.body || !String(b.body).trim()) {
      return res.status(400).json({ error: 'body is required' })
    }
    if (b.channel === 'email' && !String(b.subject ?? '').trim()) {
      return res.status(400).json({ error: 'An email template needs a subject' })
    }

    // An override for an event the platform does not raise would never be
    // used, and silently storing it is how an administrator concludes the
    // system ignores their edits.
    if (!DEFAULT_TEMPLATES[b.eventKey]) {
      return res.status(400).json({
        error: `'${b.eventKey}' is not an event this system raises`,
        knownEvents: knownEventKeys(),
      })
    }
    if (SENSITIVE_EVENTS.has(b.eventKey)) {
      return res.status(403).json({
        error: 'This message carries a password link, so its wording cannot be changed',
      })
    }

    // A rewritten template that introduces a variable nothing supplies would
    // render a hole, and the renderer would then refuse to queue it. Better
    // to refuse the edit, where there is somebody to tell.
    const known = new Set([
      ...variablesIn(
        `${DEFAULT_TEMPLATES[b.eventKey][b.channel as Channel]?.subject ?? ''} `
        + `${DEFAULT_TEMPLATES[b.eventKey][b.channel as Channel]?.body ?? ''}`
      ),
      // Every template may use these regardless of the event.
      'tenantName', 'firstName', 'lastName', 'fullName',
    ])
    const unknown = variablesIn(`${b.subject ?? ''} ${b.body}`).filter((v) => !known.has(v))
    if (unknown.length > 0) {
      return res.status(400).json({
        error: `This event does not provide ${unknown.join(', ')}`,
        available: [...known].sort(),
      })
    }

    const saved = await query(
      `INSERT INTO notification_templates
         (tenant_id, event_key, channel, locale, subject, body, is_active, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (tenant_id, event_key, channel, locale) DO UPDATE
         SET subject = EXCLUDED.subject, body = EXCLUDED.body,
             is_active = EXCLUDED.is_active, updated_by = EXCLUDED.updated_by,
             updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [
        ctx.tenantId, b.eventKey, b.channel, b.locale || 'en',
        b.subject || null, String(b.body).trim(),
        b.isActive !== undefined ? !!b.isActive : true, ctx.userId,
      ]
    )
    return res.json({ template: saved.rows[0] })
  } catch (e) {
    return fail(res, 'save that template', e)
  }
})

/** Drops a tenant's override, returning the event to the platform default. */
router.delete('/templates/:templateId', admin, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const { templateId } = req.params
    if (!UUID.test(templateId)) return notFound(res, 'Template')

    const removed = await query(
      `DELETE FROM notification_templates WHERE id = $1 AND tenant_id = $2 RETURNING id`,
      [templateId, ctx.tenantId]
    )
    if (removed.rowCount === 0) return notFound(res, 'Template')
    return res.json({ deleted: true, revertedToDefault: true })
  } catch (e) {
    return fail(res, 'remove that template', e)
  }
})

/** Renders a template against sample data without sending anything. */
router.post('/templates/preview', admin, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const b = req.body ?? {}
    if (!b.eventKey || !isChannel(b.channel)) {
      return res.status(400).json({ error: 'eventKey and a valid channel are required' })
    }

    const template = await resolveTemplate({ query }, ctx.tenantId, b.eventKey, b.channel)
    if (!template) return notFound(res, 'Template')

    const data = { tenantName: 'Your institution', ...(b.data ?? {}) }
    const body = render(b.body ?? template.body, data)
    const subject = (b.subject ?? template.subject)
      ? render(b.subject ?? template.subject!, data)
      : null

    return res.json({
      source: template.source,
      subject: subject?.text ?? null,
      body: body.text,
      missing: [...new Set([...body.missing, ...(subject?.missing ?? [])])],
      required: template.required,
    })
  } catch (e) {
    return fail(res, 'preview that template', e)
  }
})

// ===========================================================================
// The outbox
// ===========================================================================

router.get('/messages', admin, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const status = typeof req.query.status === 'string' ? req.query.status : null
    const channel = typeof req.query.channel === 'string' ? req.query.channel : null
    const eventKey = typeof req.query.eventKey === 'string' ? req.query.eventKey : null
    // Everything sent about one invoice, application or leave request.
    const relatedId = typeof req.query.relatedId === 'string' && UUID.test(req.query.relatedId)
      ? req.query.relatedId : null
    const limit = Math.min(Number(req.query.limit) || 100, 500)

    const rows = await query(
      `SELECT m.id, m.channel, m.category, m.event_key, m.destination, m.recipient_name,
              m.subject, m.status, m.attempts, m.max_attempts, m.provider,
              m.provider_message_id, m.last_error, m.next_attempt_at,
              m.sent_at, m.failed_at, m.created_at,
              m.related_type, m.related_id,
              u.full_name AS recipient_full_name
         FROM notification_messages m
         LEFT JOIN users u ON u.id = m.recipient_user_id
        WHERE m.tenant_id = $1
          AND ($2::text IS NULL OR m.status = $2::text)
          AND ($3::text IS NULL OR m.channel = $3::text)
          AND ($4::text IS NULL OR m.event_key = $4::text)
          AND ($5::uuid IS NULL OR m.related_id = $5::uuid)
        ORDER BY m.created_at DESC
        LIMIT $6`,
      [ctx.tenantId, status, channel, eventKey, relatedId, limit]
    )

    const counts = await query(
      `SELECT status, COUNT(*)::int AS n FROM notification_messages
        WHERE tenant_id = $1 GROUP BY status`,
      [ctx.tenantId]
    )
    const byStatus: Record<string, number> = {}
    for (const row of counts.rows) byStatus[row.status] = Number(row.n)

    return res.json({ messages: rows.rows, byStatus })
  } catch (e) {
    return fail(res, 'load the outbox', e)
  }
})

router.get('/messages/:messageId', admin, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const { messageId } = req.params
    if (!UUID.test(messageId)) return notFound(res, 'Message')

    const message = await query(
      `SELECT * FROM notification_messages WHERE id = $1 AND tenant_id = $2`,
      [messageId, ctx.tenantId]
    )
    if (message.rowCount === 0) return notFound(res, 'Message')
    const msg = message.rows[0]
    // An invitation or reset carries a link that sets the recipient's
    // password. Showing it to an administrator would let them take over the
    // account, so the body never leaves the outbox.
    if (SENSITIVE_EVENTS.has(msg.event_key)) {
      msg.body = null
      msg.body_withheld = true
      if (msg.payload !== undefined) msg.payload = null
      if (msg.data !== undefined) msg.data = null
    }

    const attempts = await query(
      `SELECT * FROM notification_deliveries
        WHERE message_id = $1 AND tenant_id = $2 ORDER BY attempt`,
      [messageId, ctx.tenantId]
    )

    return res.json({ message: msg, attempts: attempts.rows })
  } catch (e) {
    return fail(res, 'load that message', e)
  }
})

/**
 * Puts a failed message back in the queue.
 *
 * The body and destination cannot change — the schema refuses — so this is a
 * retry of the same message, not a way to edit and re-send it. Sending to a
 * different address means a new message with its own record.
 */
router.post('/messages/:messageId/retry', admin, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const { messageId } = req.params
    if (!UUID.test(messageId)) return notFound(res, 'Message')

    const existing = await query(
      `SELECT status FROM notification_messages WHERE id = $1 AND tenant_id = $2`,
      [messageId, ctx.tenantId]
    )
    if (existing.rowCount === 0) return notFound(res, 'Message')
    if (['sent', 'simulated'].includes(existing.rows[0].status)) {
      return res.status(409).json({ error: 'This message has already been delivered' })
    }

    const updated = await query(
      `UPDATE notification_messages
          SET status = 'pending', next_attempt_at = CURRENT_TIMESTAMP,
              failed_at = NULL,
              max_attempts = GREATEST(max_attempts, attempts + 1)
        WHERE id = $1 AND tenant_id = $2
        RETURNING *`,
      [messageId, ctx.tenantId]
    )
    return res.json({ message: updated.rows[0] })
  } catch (e) {
    return fail(res, 'retry that message', e)
  }
})

router.post('/messages/:messageId/cancel', admin, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const { messageId } = req.params
    if (!UUID.test(messageId)) return notFound(res, 'Message')

    const updated = await query(
      `UPDATE notification_messages
          SET status = 'cancelled', last_error = 'Cancelled before it was sent'
        WHERE id = $1 AND tenant_id = $2 AND status IN ('pending', 'failed')
        RETURNING id, status`,
      [messageId, ctx.tenantId]
    )
    if (updated.rowCount === 0) {
      return res.status(409).json({
        error: 'Only a message that is still waiting or has failed can be cancelled',
      })
    }
    return res.json({ message: updated.rows[0] })
  } catch (e) {
    return fail(res, 'cancel that message', e)
  }
})

/** Runs the dispatcher now, rather than waiting for the next sweep. */
router.post('/dispatch', admin, async (req: TenantRequest, res: Response) => {
  try {
    // This tenant's queue only; the background worker is what sweeps all.
    return res.json({ swept: await runOnce(50, ctxOf(req).tenantId) })
  } catch (e) {
    return fail(res, 'run the dispatcher', e)
  }
})

// ===========================================================================
// Suppressions
// ===========================================================================

router.get('/suppressions', admin, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const rows = await query(
      `SELECT s.*, u.full_name AS created_by_name
         FROM notification_suppressions s
         LEFT JOIN users u ON u.id = s.created_by
        WHERE s.tenant_id = $1
        ORDER BY s.created_at DESC
        LIMIT 500`,
      [ctx.tenantId]
    )
    return res.json({ suppressions: rows.rows })
  } catch (e) {
    return fail(res, 'load suppressions', e)
  }
})

router.post('/suppressions', admin, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const b = req.body ?? {}
    if (!isChannel(b.channel) || !b.destination) {
      return res.status(400).json({ error: 'A valid channel and a destination are required' })
    }
    await suppress(
      { query }, ctx.tenantId, b.channel, String(b.destination).trim(),
      b.reason || 'manual', b.note ?? null, ctx.userId
    )
    return res.status(201).json({ suppressed: true })
  } catch (e) {
    return fail(res, 'suppress that address', e)
  }
})

/**
 * Lifts a suppression.
 *
 * Worth doing when an address was suppressed by a relay outage that looked
 * like a bounce, and worth being deliberate about: writing to a genuinely
 * dead address again damages the sending domain for every other message.
 */
router.delete('/suppressions/:suppressionId', admin, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)
    const { suppressionId } = req.params
    if (!UUID.test(suppressionId)) return notFound(res, 'Suppression')

    const removed = await query(
      `DELETE FROM notification_suppressions WHERE id = $1 AND tenant_id = $2 RETURNING id`,
      [suppressionId, ctx.tenantId]
    )
    if (removed.rowCount === 0) return notFound(res, 'Suppression')
    return res.json({ deleted: true })
  } catch (e) {
    return fail(res, 'lift that suppression', e)
  }
})

// ===========================================================================
// Overview
// ===========================================================================

router.get('/overview', admin, async (req: TenantRequest, res: Response) => {
  try {
    const ctx = ctxOf(req)

    const byStatus = await query(
      `SELECT status, COUNT(*)::int AS n FROM notification_messages
        WHERE tenant_id = $1 GROUP BY status`,
      [ctx.tenantId]
    )

    const byChannel = await query(
      `SELECT channel,
              COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status = 'sent')::int AS sent,
              COUNT(*) FILTER (WHERE status = 'simulated')::int AS simulated,
              COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
              COUNT(*) FILTER (WHERE status = 'pending')::int AS pending
         FROM notification_messages
        WHERE tenant_id = $1
        GROUP BY channel`,
      [ctx.tenantId]
    )

    const channels = []
    for (const channel of CHANNELS) {
      const { config, ready, reason } = await channelStatus(ctx.tenantId, channel)
      channels.push({ channel, provider: config.provider, ready, reason })
    }

    const recentFailures = await query(
      `SELECT id, channel, event_key, destination, last_error, attempts, failed_at
         FROM notification_messages
        WHERE tenant_id = $1 AND status = 'failed'
        ORDER BY failed_at DESC NULLS LAST
        LIMIT 10`,
      [ctx.tenantId]
    )

    const counts: Record<string, number> = {}
    for (const row of byStatus.rows) counts[row.status] = Number(row.n)

    return res.json({
      byStatus: counts,
      byChannel: byChannel.rows,
      channels,
      recentFailures: recentFailures.rows,
      suppressed: (await query(
        `SELECT COUNT(*)::int AS n FROM notification_suppressions WHERE tenant_id = $1`,
        [ctx.tenantId]
      )).rows[0].n,
    })
  } catch (e) {
    return fail(res, 'load the notifications overview', e)
  }
})

export default router
