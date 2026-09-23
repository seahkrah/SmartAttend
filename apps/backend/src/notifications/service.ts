import type { PoolClient } from 'pg'
import pool, { query } from '../db/connection.js'
import {
  DEFAULT_TEMPLATES, categoryFor, defaultChannelsFor, defaultTemplate,
  type TemplateDefinition,
} from './templates.js'
import { render, tidy, variablesIn } from './render.js'
import { transportFor } from './providers/index.js'
import type { Channel, ChannelConfig, DeliveryResult, OutboundMessage, ProviderName } from './types.js'

/**
 * Notification delivery.
 *
 * The shape of a send, in order:
 *
 *   1. Work out which channels this event should use for this tenant.
 *   2. For each recipient, resolve the destination for that channel — an
 *      email address, a phone number — from the server's own records.
 *   3. Render the tenant's template, or the platform default.
 *   4. Drop anything the recipient has opted out of, or that is addressed to
 *      a suppressed address.
 *   5. Insert into the outbox. Nothing is sent inside the caller's
 *      transaction: the domain work commits or it does not, and the message
 *      goes when the dispatcher next runs.
 *
 * That last point is the one that matters. Sending inside a transaction means
 * either holding an SMTP connection open while a database lock is held, or
 * telling a student their result is published and then rolling back the
 * publication. The outbox pattern is the standard answer and it is why this
 * is a table rather than a function call.
 */

export class NotificationError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.name = 'NotificationError'
    this.status = status
  }
}

export interface NotifyContext {
  tenantId: string
  /** Who caused this. Null for a scheduled sweep with no human behind it. */
  userId?: string | null
}

type Runner = { query: (text: string, params?: any[]) => Promise<any> }

export interface Recipient {
  /** A platform account, when the recipient has one. */
  userId?: string | null
  name?: string | null
  email?: string | null
  phone?: string | null
  /** Per-recipient variables merged over the shared data. */
  data?: Record<string, unknown>
}

export interface NotifyInput {
  eventKey: string
  recipients: Recipient[]
  data?: Record<string, unknown>
  /** Defaults to every channel the event has a template for. */
  channels?: Channel[]
  category?: string
  priority?: number
  scheduledFor?: Date | string | null
  relatedType?: string | null
  relatedId?: string | null
  /**
   * Makes the message idempotent. Built per recipient and channel, so one key
   * covers a whole fan-out without collapsing it.
   */
  dedupeKey?: string | null
  maxAttempts?: number
}

export interface QueuedMessage {
  id: string
  channel: Channel
  destination: string
  status: string
}

export interface NotifySummary {
  queued: QueuedMessage[]
  /** Everything that was not queued, and why. Never silent. */
  skipped: Array<{
    channel: Channel
    destination: string | null
    recipient: string | null
    reason: string
  }>
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * The channel configuration for a tenant.
 *
 * A tenant that has configured nothing still gets in-app delivery, because it
 * needs no credentials and cannot fail, and the log transport for everything
 * else — which records what would have been sent and reports it as simulated,
 * never as sent.
 */
export async function channelConfig(
  runner: Runner,
  tenantId: string,
  channel: Channel
): Promise<ChannelConfig> {
  const r = await runner.query(
    `SELECT * FROM notification_channels WHERE tenant_id = $1 AND channel = $2`,
    [tenantId, channel]
  )

  if (r.rowCount === 0) {
    return {
      channel,
      provider: channel === 'in_app' ? 'in_app' : 'log',
      isEnabled: true,
      config: {},
      secretEnvVar: null,
      fromName: null,
      fromAddress: null,
      replyTo: null,
      hourlyLimit: null,
    }
  }

  const row = r.rows[0]
  return {
    channel: row.channel,
    provider: row.provider,
    isEnabled: row.is_enabled,
    config: row.config ?? {},
    secretEnvVar: row.secret_env_var,
    fromName: row.from_name,
    fromAddress: row.from_address,
    replyTo: row.reply_to,
    hourlyLimit: row.hourly_limit,
  }
}

/** A channel's readiness, for the admin UI and for the dispatcher. */
export async function channelStatus(
  tenantId: string,
  channel: Channel
): Promise<{ config: ChannelConfig; ready: boolean; reason: string | null }> {
  const config = await channelConfig({ query }, tenantId, channel)
  if (!config.isEnabled) {
    return { config, ready: false, reason: 'This channel is switched off' }
  }
  const reason = transportFor(config.provider).unavailableReason(config)
  return { config, ready: reason === null, reason }
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export interface ResolvedTemplate extends TemplateDefinition {
  source: 'tenant' | 'default'
}

/**
 * The template to use, tenant's own before the platform default.
 *
 * A tenant's row has no `required` list of its own — an administrator editing
 * an offer letter is not going to maintain one — so the default's list is
 * carried over where there is a default, and otherwise every variable the
 * tenant's own body mentions is treated as required. Either way a message
 * with a hole in it does not go out.
 */
export async function resolveTemplate(
  runner: Runner,
  tenantId: string,
  eventKey: string,
  channel: Channel,
  locale = 'en'
): Promise<ResolvedTemplate | null> {
  const own = await runner.query(
    `SELECT subject, body FROM notification_templates
      WHERE tenant_id = $1 AND event_key = $2 AND channel = $3 AND locale = $4
        AND is_active = TRUE`,
    [tenantId, eventKey, channel, locale]
  )

  const fallback = defaultTemplate(eventKey, channel)

  if (own.rowCount && own.rowCount > 0) {
    const row = own.rows[0]
    return {
      subject: row.subject ?? fallback?.subject,
      body: row.body,
      required: fallback?.required ?? variablesIn(row.body),
      category: fallback?.category ?? categoryFor(eventKey),
      source: 'tenant',
    }
  }

  if (!fallback) return null
  return { ...fallback, source: 'default' }
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

/**
 * Whether this person has switched this category off on this channel.
 *
 * Absence means yes: a school that has never touched preferences still
 * reaches its students. The exception is that nobody may switch off the
 * account and system categories, which carry password resets and the
 * administrator's own channel tests — an opt-out there is a way to lock
 * yourself out rather than a preference.
 */
const UNSTOPPABLE = new Set(['account', 'system'])

async function wants(
  runner: Runner,
  tenantId: string,
  userId: string,
  category: string,
  channel: Channel
): Promise<boolean> {
  if (UNSTOPPABLE.has(category)) return true
  const r = await runner.query(
    `SELECT is_enabled FROM notification_preferences
      WHERE tenant_id = $1 AND user_id = $2 AND category = $3 AND channel = $4`,
    [tenantId, userId, category, channel]
  )
  if (r.rowCount === 0) return true
  return r.rows[0].is_enabled === true
}

/** Whether this address is one we have been told to stop writing to. */
export async function isSuppressed(
  runner: Runner,
  tenantId: string,
  channel: Channel,
  destination: string
): Promise<{ suppressed: boolean; reason?: string }> {
  const r = await runner.query(
    `SELECT reason FROM notification_suppressions
      WHERE tenant_id = $1 AND channel = $2 AND LOWER(destination) = LOWER($3)
        AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)`,
    [tenantId, channel, destination]
  )
  if (r.rowCount === 0) return { suppressed: false }
  return { suppressed: true, reason: r.rows[0].reason }
}

export async function suppress(
  runner: Runner,
  tenantId: string,
  channel: Channel,
  destination: string,
  reason: string,
  note?: string | null,
  actorId?: string | null
): Promise<void> {
  await runner.query(
    `INSERT INTO notification_suppressions
       (tenant_id, channel, destination, reason, note, created_by)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (tenant_id, channel, LOWER(destination)) DO UPDATE
       SET reason = EXCLUDED.reason, note = EXCLUDED.note`,
    [tenantId, channel, destination, reason, note ?? null, actorId ?? null]
  )
}

// ---------------------------------------------------------------------------
// Addressing
// ---------------------------------------------------------------------------

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// Deliberately permissive: numbering plans vary enormously and rejecting a
// valid Ghanaian number because it does not look North American would be
// worse than handing a doubtful one to the relay, which knows better.
const PHONE_SHAPE = /^\+?[0-9][0-9\s().-]{5,}$/

function destinationFor(recipient: Recipient, channel: Channel): string | null {
  switch (channel) {
    case 'email':
      return recipient.email && EMAIL_SHAPE.test(recipient.email.trim())
        ? recipient.email.trim() : null
    case 'sms':
    case 'push':
      return recipient.phone && PHONE_SHAPE.test(recipient.phone.trim())
        ? recipient.phone.trim() : null
    case 'in_app':
      // The account itself is the address.
      return recipient.userId ?? null
  }
}

/**
 * Fills in a recipient's contact details from the server's own records.
 *
 * Callers pass user ids; what is on file is read here. Taking an email
 * address from the request body would let a caller redirect somebody else's
 * offer letter to an address of their choosing.
 */
export async function resolveRecipients(
  runner: Runner,
  tenantId: string,
  userIds: string[]
): Promise<Recipient[]> {
  if (userIds.length === 0) return []
  const r = await runner.query(
    `SELECT u.id, u.full_name, u.email, u.phone
       FROM users u
       JOIN user_tenant_memberships m ON m.user_id = u.id
      WHERE u.id = ANY($1::uuid[]) AND m.tenant_id = $2 AND u.is_active = TRUE`,
    [userIds, tenantId]
  )
  return r.rows.map((row: any) => ({
    userId: row.id,
    name: row.full_name,
    email: row.email,
    phone: row.phone,
  }))
}

/** The tenant's display name, for the sign-off every template ends with. */
export async function tenantName(runner: Runner, tenantId: string): Promise<string> {
  const r = await runner.query(`SELECT name FROM tenants WHERE id = $1`, [tenantId])
  return r.rows[0]?.name ?? 'Your institution'
}

// ---------------------------------------------------------------------------
// Enqueue
// ---------------------------------------------------------------------------

/**
 * Renders and queues a notification.
 *
 * Runs on whatever runner it is given, so a caller inside a transaction can
 * pass its client and have the messages appear only if the domain work
 * commits. Nothing is transmitted here.
 *
 * Never throws for an undeliverable recipient. A student with no phone number
 * is not an error in publishing results; it is a fact about that student, and
 * it comes back in `skipped` so the caller can report it if it matters.
 */
export async function notify(
  runner: Runner,
  ctx: NotifyContext,
  input: NotifyInput
): Promise<NotifySummary> {
  const queued: QueuedMessage[] = []
  const skipped: NotifySummary['skipped'] = []

  if (!DEFAULT_TEMPLATES[input.eventKey] && !input.channels?.length) {
    throw new NotificationError(`Unknown event '${input.eventKey}' and no channels given`)
  }

  const channels = input.channels?.length ? input.channels : defaultChannelsFor(input.eventKey)
  if (channels.length === 0) {
    throw new NotificationError(`Event '${input.eventKey}' has no template on any channel`)
  }

  const shared = {
    tenantName: await tenantName(runner, ctx.tenantId),
    ...(input.data ?? {}),
  }

  for (const channel of channels) {
    const config = await channelConfig(runner, ctx.tenantId, channel)
    if (!config.isEnabled) {
      skipped.push({
        channel, destination: null, recipient: null,
        reason: 'This channel is switched off for this tenant',
      })
      continue
    }

    const template = await resolveTemplate(runner, ctx.tenantId, input.eventKey, channel)
    if (!template) {
      // Not every event has something worth saying on every channel — there
      // is no point texting somebody a rejection letter — so a missing
      // template for a channel that was not explicitly asked for is normal.
      if (input.channels?.includes(channel)) {
        skipped.push({
          channel, destination: null, recipient: null,
          reason: `No ${channel} template for '${input.eventKey}'`,
        })
      }
      continue
    }

    const category = input.category ?? template.category

    for (const recipient of input.recipients) {
      const data = { ...shared, ...(recipient.data ?? {}) }
      const label = recipient.name ?? recipient.email ?? recipient.userId ?? null

      const destination = destinationFor(recipient, channel)
      if (!destination) {
        skipped.push({
          channel, destination: null, recipient: label,
          reason: channel === 'in_app'
            ? 'This recipient has no account to deliver to'
            : `This recipient has no usable ${channel === 'email' ? 'email address' : 'phone number'}`,
        })
        continue
      }

      if (recipient.userId
          && !(await wants(runner, ctx.tenantId, recipient.userId, category, channel))) {
        skipped.push({
          channel, destination, recipient: label,
          reason: `This recipient has turned off ${category} messages on ${channel}`,
        })
        continue
      }

      const blocked = await isSuppressed(runner, ctx.tenantId, channel, destination)
      if (blocked.suppressed) {
        skipped.push({
          channel, destination, recipient: label,
          reason: `This address is suppressed (${blocked.reason})`,
        })
        continue
      }

      const body = render(template.body, data)
      const subject = template.subject ? render(template.subject, data) : null

      // A required variable that came through empty would produce "Dear ,"
      // or an invoice reminder with no amount in it. Refusing to queue is the
      // only outcome that does not put that in front of somebody.
      const missing = [...new Set([...body.missing, ...(subject?.missing ?? [])])]
        .filter((name) => template.required.includes(name))
      if (missing.length > 0) {
        skipped.push({
          channel, destination, recipient: label,
          reason: `The message is missing ${missing.join(', ')}`,
        })
        continue
      }

      // One key per recipient per channel: a single caller-supplied key still
      // fans out, and a repeat of the same sweep still collapses.
      const dedupeKey = input.dedupeKey
        ? `${input.dedupeKey}:${channel}:${recipient.userId ?? destination}`
        : null

      const inserted = await runner.query(
        `INSERT INTO notification_messages
           (tenant_id, channel, category, event_key, recipient_user_id, destination,
            recipient_name, subject, body, priority, max_attempts, scheduled_for,
            next_attempt_at, dedupe_key, related_type, related_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
                 COALESCE($12::timestamptz, CURRENT_TIMESTAMP),
                 COALESCE($12::timestamptz, CURRENT_TIMESTAMP),
                 $13,$14,$15,$16)
         ON CONFLICT (tenant_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
         RETURNING id, channel, destination, status`,
        [
          ctx.tenantId, channel, category, input.eventKey, recipient.userId ?? null,
          destination, recipient.name ?? null,
          subject ? tidy(subject.text) : null,
          tidy(body.text),
          input.priority ?? 5, input.maxAttempts ?? 5,
          input.scheduledFor ?? null, dedupeKey,
          input.relatedType ?? null, input.relatedId ?? null,
          ctx.userId ?? null,
        ]
      )

      if (inserted.rowCount === 0) {
        skipped.push({
          channel, destination, recipient: label,
          reason: 'This message has already been queued',
        })
        continue
      }

      queued.push(inserted.rows[0])
    }
  }

  return { queued, skipped }
}

/**
 * Queues a notification without letting it break the caller.
 *
 * Domain code calls this. An enrolment must not fail because the mail
 * template has a typo in it, and a fee sweep must not stop halfway because
 * one tenant's relay configuration is malformed. The failure is logged and
 * the caller carries on.
 */
export async function notifyQuietly(
  runner: Runner,
  ctx: NotifyContext,
  input: NotifyInput
): Promise<NotifySummary | null> {
  try {
    return await notify(runner, ctx, input)
  } catch (error) {
    console.error(`[NOTIFY] could not queue '${input.eventKey}' for tenant ${ctx.tenantId}:`, error)
    return null
  }
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/**
 * How long to wait before attempt n+1.
 *
 * Exponential with a ceiling, plus jitter. Without jitter a relay outage
 * produces a thundering herd on recovery: every message queued during the
 * outage becomes due in the same second.
 */
export function backoffSeconds(attempt: number): number {
  const base = Math.min(30 * 2 ** (attempt - 1), 3600)
  return Math.round(base * (0.75 + Math.random() * 0.5))
}

/**
 * Takes up to `limit` due messages for this worker.
 *
 * FOR UPDATE SKIP LOCKED is what makes more than one dispatcher safe: each
 * claims rows the others have not, without any of them waiting. Marking the
 * rows 'sending' in the same statement means a worker that dies mid-send
 * leaves them visibly stuck rather than silently re-sent.
 */
export async function claimDue(client: PoolClient, limit = 25): Promise<any[]> {
  const claimed = await client.query(
    `WITH due AS (
       SELECT id FROM notification_messages
        WHERE status = 'pending' AND next_attempt_at <= CURRENT_TIMESTAMP
        ORDER BY priority, next_attempt_at
        LIMIT $1
        FOR UPDATE SKIP LOCKED
     )
     UPDATE notification_messages m
        SET status = 'sending', attempts = m.attempts + 1, updated_at = CURRENT_TIMESTAMP
       FROM due
      WHERE m.id = due.id
      RETURNING m.*`,
    [limit]
  )
  return claimed.rows
}

/**
 * Releases messages a dead worker left behind.
 *
 * A row stuck in 'sending' is one whose worker stopped between claiming and
 * recording. Putting it back to pending after a grace period is what keeps
 * the queue from leaking messages; the grace period is long enough that a
 * slow-but-living send is not duplicated.
 */
export async function requeueStalled(olderThanMinutes = 15): Promise<number> {
  const r = await query(
    `UPDATE notification_messages
        SET status = 'pending',
            next_attempt_at = CURRENT_TIMESTAMP,
            last_error = 'The worker handling this message stopped before recording the outcome'
      WHERE status = 'sending'
        AND updated_at < CURRENT_TIMESTAMP - ($1 || ' minutes')::interval
        AND attempts < max_attempts
      RETURNING id`,
    [String(olderThanMinutes)]
  )
  return r.rowCount ?? 0
}

/** Has this tenant already sent as much as it is allowed to this hour? */
async function overRateLimit(tenantId: string, config: ChannelConfig): Promise<boolean> {
  if (!config.hourlyLimit) return false
  const r = await query(
    `SELECT COUNT(*)::int AS n FROM notification_messages
      WHERE tenant_id = $1 AND channel = $2
        AND sent_at > CURRENT_TIMESTAMP - INTERVAL '1 hour'`,
    [tenantId, config.channel]
  )
  return Number(r.rows[0].n) >= config.hourlyLimit
}

async function recordAttempt(
  messageId: string,
  tenantId: string,
  attempt: number,
  provider: ProviderName,
  result: DeliveryResult,
  durationMs: number
): Promise<void> {
  await query(
    `INSERT INTO notification_deliveries
       (tenant_id, message_id, attempt, status, provider, provider_message_id,
        provider_response, error, duration_ms)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      tenantId, messageId, attempt,
      result.status === 'failed' ? 'failed' : result.status,
      provider, result.providerMessageId ?? null,
      result.providerResponse ?? null, result.error ?? null, durationMs,
    ]
  )
}

/**
 * Sends one claimed message and records what happened.
 *
 * Every path through here ends with the message in a settled state — sent,
 * simulated, failed or back to pending with a later next_attempt_at. A
 * message left in 'sending' is a bug, which is why requeueStalled exists to
 * catch the case this code cannot: the process dying mid-call.
 */
export async function deliver(row: any): Promise<DeliveryResult> {
  const message: OutboundMessage = {
    id: row.id,
    tenantId: row.tenant_id,
    channel: row.channel,
    category: row.category,
    eventKey: row.event_key,
    recipientUserId: row.recipient_user_id,
    destination: row.destination,
    recipientName: row.recipient_name,
    subject: row.subject,
    body: row.body,
    attempt: row.attempts,
    relatedType: row.related_type,
    relatedId: row.related_id,
  }

  const config = await channelConfig({ query }, message.tenantId, message.channel)
  const transport = transportFor(config.provider)
  const started = Date.now()

  let result: DeliveryResult

  if (!config.isEnabled) {
    result = {
      status: 'failed',
      error: 'This channel was switched off after the message was queued',
      retryable: false,
    }
  } else if (await overRateLimit(message.tenantId, config)) {
    // Not a failure. The message is fine; there is simply no allowance left
    // this hour, so it waits rather than burning an attempt.
    await query(
      `UPDATE notification_messages
          SET status = 'pending', attempts = GREATEST(attempts - 1, 0),
              next_attempt_at = CURRENT_TIMESTAMP + INTERVAL '10 minutes',
              last_error = 'Waiting: this tenant has reached its hourly limit on this channel'
        WHERE id = $1`,
      [message.id]
    )
    return { status: 'failed', error: 'rate limited', retryable: true }
  } else {
    const unavailable = transport.unavailableReason(config)
    if (unavailable) {
      // A misconfigured transport is a failure of setup, not of this message.
      // It is retryable because setting the missing variable fixes every
      // message waiting behind it.
      result = { status: 'failed', error: unavailable, retryable: true }
    } else {
      try {
        result = await transport.send(message, config)
      } catch (error: any) {
        result = {
          status: 'failed',
          error: `The ${config.provider} transport threw: ${String(error?.message ?? error)}`,
          retryable: true,
        }
      }
    }
  }

  const duration = Date.now() - started
  await recordAttempt(message.id, message.tenantId, message.attempt, config.provider, result, duration)

  if (result.suppress) {
    await suppress(
      { query }, message.tenantId, message.channel, message.destination,
      result.suppress.reason, result.suppress.note ?? null, null
    )
  }

  if (result.status === 'sent' || result.status === 'simulated') {
    await query(
      `UPDATE notification_messages
          SET status = $2, sent_at = CURRENT_TIMESTAMP, provider = $3,
              provider_message_id = $4, last_error = NULL
        WHERE id = $1`,
      [message.id, result.status, config.provider, result.providerMessageId ?? null]
    )
    return result
  }

  const exhausted = row.attempts >= row.max_attempts || result.retryable === false
  if (exhausted) {
    await query(
      `UPDATE notification_messages
          SET status = 'failed', failed_at = CURRENT_TIMESTAMP,
              provider = $3, last_error = $2
        WHERE id = $1`,
      [message.id, result.error ?? 'Delivery failed', config.provider]
    )
  } else {
    await query(
      `UPDATE notification_messages
          SET status = 'pending', provider = $3, last_error = $2,
              next_attempt_at = CURRENT_TIMESTAMP + ($4 || ' seconds')::interval
        WHERE id = $1`,
      [message.id, result.error ?? 'Delivery failed', config.provider,
       String(backoffSeconds(row.attempts))]
    )
  }

  return result
}

export interface SweepResult {
  claimed: number
  sent: number
  simulated: number
  failed: number
  requeued: number
}

/** One pass of the dispatcher. Safe to run concurrently with itself. */
export async function runOnce(limit = 25): Promise<SweepResult> {
  const requeued = await requeueStalled()

  const client = await pool.connect()
  let rows: any[]
  try {
    await client.query('BEGIN')
    rows = await claimDue(client, limit)
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }

  const summary: SweepResult = {
    claimed: rows.length, sent: 0, simulated: 0, failed: 0, requeued,
  }

  // Sequential on purpose. These are network calls to relays that rate-limit,
  // and a burst of parallel connections from one process is how a shared
  // relay starts refusing everything.
  for (const row of rows) {
    const result = await deliver(row)
    if (result.status === 'sent') summary.sent += 1
    else if (result.status === 'simulated') summary.simulated += 1
    else summary.failed += 1
  }

  return summary
}

// ---------------------------------------------------------------------------
// The background dispatcher
// ---------------------------------------------------------------------------

let timer: NodeJS.Timeout | null = null
let running = false

/**
 * Starts the in-process dispatcher.
 *
 * Off unless NOTIFICATION_DISPATCH is 'on', because a test run or a
 * one-off script attaching to a shared database should not start sending
 * real mail as a side effect of importing the server.
 *
 * The `running` guard means a slow sweep does not overlap the next tick; the
 * interval is a floor on the gap between sweeps, not a promise about them.
 */
export function startDispatcher(intervalMs = 15_000): boolean {
  if (process.env.NOTIFICATION_DISPATCH !== 'on') return false
  if (timer) return true

  timer = setInterval(() => {
    if (running) return
    running = true
    runOnce()
      .then((s) => {
        if (s.claimed > 0) {
          console.log(
            `[NOTIFY] ${s.claimed} claimed, ${s.sent} sent, ${s.simulated} simulated, `
            + `${s.failed} failed${s.requeued ? `, ${s.requeued} requeued` : ''}`
          )
        }
      })
      .catch((e) => console.error('[NOTIFY] sweep failed:', e))
      .finally(() => { running = false })
  }, intervalMs)

  // Not a reason to keep the process alive on its own.
  timer.unref?.()
  console.log(`[NOTIFY] dispatcher started, every ${Math.round(intervalMs / 1000)}s`)
  return true
}

export function stopDispatcher(): void {
  if (timer) clearInterval(timer)
  timer = null
}

export { DEFAULT_TEMPLATES, defaultChannelsFor, categoryFor } from './templates.js'
export { render, tidy, variablesIn } from './render.js'
export type { Channel, ChannelConfig, OutboundMessage } from './types.js'
