import type { ChannelConfig, DeliveryResult, OutboundMessage, Transport } from '../types.js'

/**
 * The transport that does not transport.
 *
 * Every deployment has one channel that works without credentials, and this
 * is it. It renders the message, records exactly what would have gone where,
 * and reports 'simulated' — a status of its own, never 'sent'.
 *
 * That distinction is the whole point. The platform's previous notification
 * code inserted rows with status 'sent' already set and nothing behind them,
 * so a school could believe for a term that its applicants were being written
 * to. A simulated message is visible as simulated in the outbox, in the
 * delivery log and in the admin UI.
 */
export const logTransport: Transport = {
  name: 'log',

  unavailableReason(): string | null {
    return null
  },

  async send(message: OutboundMessage, config: ChannelConfig): Promise<DeliveryResult> {
    const line = [
      `[notify:simulated] tenant=${message.tenantId}`,
      `channel=${message.channel}`,
      `event=${message.eventKey ?? '-'}`,
      `to=${message.destination}`,
      message.subject ? `subject=${JSON.stringify(message.subject)}` : null,
    ]
      .filter(Boolean)
      .join(' ')

    console.log(line)

    return {
      status: 'simulated',
      providerMessageId: null,
      providerResponse:
        `No transport is configured for ${message.channel} on this tenant, so the message ` +
        `was rendered and recorded but not sent.` +
        (config.secretEnvVar ? ` Set ${config.secretEnvVar} and configure a provider to send it.` : ''),
      retryable: false,
    }
  },
}
