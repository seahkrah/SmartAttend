import nodemailer, { type Transporter } from 'nodemailer'
import type { ChannelConfig, DeliveryResult, OutboundMessage, Transport } from '../types.js'

/**
 * Email over SMTP.
 *
 * The password is never in the database. The channel names an environment
 * variable, this reads it at send time, and a channel whose variable is unset
 * reports that as its reason for being unavailable rather than failing
 * halfway through a send.
 *
 * Connections are pooled per tenant channel, because a term-end fee sweep is
 * several hundred messages and opening a TLS session for each one is both
 * slow and a good way to be rate-limited by the relay.
 */

interface PoolEntry {
  transporter: Transporter
  signature: string
}

const pools = new Map<string, PoolEntry>()

/** What the pool key is built from, so a reconfigured channel gets a new one. */
function signatureOf(config: ChannelConfig, password: string | undefined): string {
  const c = config.config as Record<string, unknown>
  return JSON.stringify([
    c.host, c.port, c.secure, c.username, config.fromAddress,
    // The password itself is never logged or stored; its length is enough to
    // notice a rotation and rebuild the pool.
    password ? password.length : 0,
  ])
}

function transporterFor(key: string, config: ChannelConfig, password?: string): Transporter {
  const signature = signatureOf(config, password)
  const existing = pools.get(key)
  if (existing && existing.signature === signature) return existing.transporter
  if (existing) existing.transporter.close()

  const c = config.config as Record<string, any>
  const port = Number(c.port ?? 587)

  const transporter = nodemailer.createTransport({
    host: String(c.host),
    port,
    // Port 465 is implicit TLS; everything else starts plain and upgrades.
    secure: c.secure !== undefined ? !!c.secure : port === 465,
    requireTLS: c.requireTLS !== undefined ? !!c.requireTLS : port !== 465,
    auth: c.username && password ? { user: String(c.username), pass: password } : undefined,
    pool: true,
    maxConnections: Number(c.maxConnections ?? 3),
    maxMessages: Number(c.maxMessages ?? 100),
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
  })

  pools.set(key, { transporter, signature })
  return transporter
}

/** Closes every pooled connection. Called when the process is shutting down. */
export function closeSmtpPools(): void {
  for (const entry of pools.values()) entry.transporter.close()
  pools.clear()
}

/**
 * SMTP reply codes that mean "this address will never work".
 *
 * 5xx is permanent by definition, but the two that matter for suppression are
 * the ones naming the mailbox rather than the message: writing to them again
 * damages the sender's reputation with no possibility of success.
 */
function classify(error: any): { retryable: boolean; hardBounce: boolean } {
  const code = Number(error?.responseCode ?? error?.code)
  const text = String(error?.response ?? error?.message ?? '')

  // A connection that never opened says nothing about the address.
  if (['ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', 'EHOSTUNREACH', 'ENOTFOUND', 'ESOCKET']
        .includes(String(error?.code))) {
    return { retryable: true, hardBounce: false }
  }

  if (Number.isFinite(code) && code >= 500 && code < 600) {
    const hard = /no such user|user unknown|mailbox unavailable|does not exist|invalid recipient|recipient rejected/i
      .test(text)
    return { retryable: false, hardBounce: hard || code === 550 }
  }

  // 4xx is a temporary refusal: greylisting, a full mailbox, a busy relay.
  if (Number.isFinite(code) && code >= 400 && code < 500) {
    return { retryable: true, hardBounce: false }
  }

  return { retryable: true, hardBounce: false }
}

/** A display name and address, with the name quoted if it needs it. */
function addressOf(name: string | null, address: string): string {
  if (!name) return address
  return `${JSON.stringify(name)} <${address}>`
}

/**
 * The plain-text body as minimal HTML.
 *
 * Templates are authored as text, because a school administrator editing an
 * offer letter should not have to write markup. Escaping is not optional: an
 * applicant called "Ben & Co <test>" must not break the message or inject
 * anything into it.
 */
function asHtml(body: string): string {
  const escaped = body
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#1f2937">`
    + escaped.split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('')
    + `</div>`
}

export const smtpTransport: Transport = {
  name: 'smtp',

  unavailableReason(config: ChannelConfig): string | null {
    const c = config.config as Record<string, unknown>
    if (!c.host) return 'No SMTP host is configured'
    if (!config.fromAddress) return 'No from address is configured'
    if (c.username && !config.secretEnvVar) {
      return 'A username is configured but no environment variable is named for the password'
    }
    if (config.secretEnvVar && !process.env[config.secretEnvVar]) {
      return `The environment variable ${config.secretEnvVar} is not set on this server`
    }
    return null
  },

  async send(message: OutboundMessage, config: ChannelConfig): Promise<DeliveryResult> {
    const password = config.secretEnvVar ? process.env[config.secretEnvVar] : undefined
    const transporter = transporterFor(`${config.channel}:${message.tenantId}`, config, password)

    try {
      const info = await transporter.sendMail({
        from: addressOf(config.fromName, config.fromAddress!),
        to: addressOf(message.recipientName, message.destination),
        replyTo: config.replyTo || undefined,
        subject: message.subject ?? '(no subject)',
        text: message.body,
        html: asHtml(message.body),
        headers: {
          // Ties a bounce arriving days later back to the outbox row.
          'X-Notification-Id': message.id,
          'X-Tenant-Id': message.tenantId,
        },
      })

      // A relay can accept a message for some recipients and refuse others.
      // With one recipient per message, a rejection means this one failed.
      if (Array.isArray(info.rejected) && info.rejected.length > 0) {
        return {
          status: 'failed',
          error: `The relay refused ${message.destination}`,
          providerResponse: String(info.response ?? ''),
          retryable: false,
          suppress: { reason: 'invalid', note: String(info.response ?? '') },
        }
      }

      return {
        status: 'sent',
        providerMessageId: info.messageId ?? null,
        providerResponse: String(info.response ?? ''),
      }
    } catch (error: any) {
      const { retryable, hardBounce } = classify(error)
      return {
        status: 'failed',
        error: String(error?.message ?? error),
        providerResponse: String(error?.response ?? ''),
        retryable,
        suppress: hardBounce
          ? { reason: 'hard_bounce', note: String(error?.response ?? error?.message ?? '') }
          : undefined,
      }
    }
  },
}
