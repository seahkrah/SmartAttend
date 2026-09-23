import { createHmac, timingSafeEqual } from 'node:crypto'
import type { ChannelConfig, DeliveryResult, OutboundMessage, Transport } from '../types.js'

/**
 * A relay the tenant runs, for the channels that need an account somewhere.
 *
 * SMS and push both mean a commercial account — Twilio, Africa's Talking,
 * Firebase — with its own billing, sender registration and regional rules.
 * Hard-coding one of them would pick a vendor for every school in every
 * country the platform is ever deployed in, so this posts the message to a
 * URL the tenant configures and lets them put whatever they already use
 * behind it.
 *
 * The request is signed. Without a signature the relay's URL is an open door:
 * anyone who learns it can send messages that appear to come from the school.
 */

interface RelayResponse {
  messageId?: string
  id?: string
  error?: string
  /** The relay telling us this address is dead. */
  suppress?: boolean
  reason?: 'hard_bounce' | 'invalid' | 'complaint'
}

/** The bytes that are signed: exactly what is sent, with the timestamp. */
function signature(secret: string, timestamp: string, payload: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex')
}

/**
 * Verifies a signature this module would have produced.
 *
 * Exported for the inbound side — a relay reporting a bounce back to us has
 * to prove it is the relay — and compared in constant time, because a
 * byte-by-byte comparison leaks the correct value one character at a time.
 */
export function verifyRelaySignature(
  secret: string,
  timestamp: string,
  payload: string,
  provided: string
): boolean {
  const expected = signature(secret, timestamp, payload)
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(String(provided ?? ''), 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export const webhookTransport: Transport = {
  name: 'webhook',

  unavailableReason(config: ChannelConfig): string | null {
    const c = config.config as Record<string, unknown>
    const url = c.url ? String(c.url) : ''
    if (!url) return 'No relay URL is configured'

    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return 'The relay URL is not a valid URL'
    }
    // Plaintext HTTP would put every message and its signature on the wire.
    if (parsed.protocol !== 'https:') return 'The relay URL must be https'

    if (!config.secretEnvVar) {
      return 'No environment variable is named for the relay signing secret'
    }
    if (!process.env[config.secretEnvVar]) {
      return `The environment variable ${config.secretEnvVar} is not set on this server`
    }
    return null
  },

  async send(message: OutboundMessage, config: ChannelConfig): Promise<DeliveryResult> {
    const c = config.config as Record<string, any>
    const secret = process.env[config.secretEnvVar!]!
    const timestamp = String(Date.now())

    const payload = JSON.stringify({
      id: message.id,
      channel: message.channel,
      event: message.eventKey,
      category: message.category,
      to: message.destination,
      toName: message.recipientName,
      subject: message.subject,
      body: message.body,
      from: config.fromAddress,
      fromName: config.fromName,
      attempt: message.attempt,
    })

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), Number(c.timeoutMs ?? 20_000))

    try {
      const response = await fetch(String(c.url), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Notification-Timestamp': timestamp,
          'X-Notification-Signature': signature(secret, timestamp, payload),
          // The relay needs to know which tenant it is acting for without
          // trusting anything inside the body.
          'X-Tenant-Id': message.tenantId,
        },
        body: payload,
        signal: controller.signal,
      })

      const text = await response.text()
      let parsed: RelayResponse = {}
      try {
        parsed = text ? (JSON.parse(text) as RelayResponse) : {}
      } catch {
        // A relay that answers 200 with a plain string is still a success;
        // the text is kept verbatim for the delivery log.
      }

      if (!response.ok) {
        // 4xx is the relay saying the request was wrong, which retrying will
        // not fix. 5xx and 429 are worth another attempt.
        const retryable = response.status >= 500 || response.status === 429
        return {
          status: 'failed',
          error: `The relay answered ${response.status}`,
          providerResponse: text.slice(0, 2000),
          retryable,
          suppress:
            parsed.suppress || response.status === 422
              ? { reason: parsed.reason ?? 'invalid', note: text.slice(0, 500) }
              : undefined,
        }
      }

      if (parsed.error) {
        return {
          status: 'failed',
          error: parsed.error,
          providerResponse: text.slice(0, 2000),
          retryable: false,
          suppress: parsed.suppress
            ? { reason: parsed.reason ?? 'invalid', note: parsed.error }
            : undefined,
        }
      }

      return {
        status: 'sent',
        providerMessageId: parsed.messageId ?? parsed.id ?? null,
        providerResponse: text.slice(0, 2000),
      }
    } catch (error: any) {
      const aborted = error?.name === 'AbortError'
      return {
        status: 'failed',
        error: aborted ? 'The relay did not answer in time' : String(error?.message ?? error),
        retryable: true,
      }
    } finally {
      clearTimeout(timeout)
    }
  },
}
