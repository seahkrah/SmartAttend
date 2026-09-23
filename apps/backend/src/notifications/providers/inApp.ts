import { query } from '../../db/connection.js'
import type { ChannelConfig, DeliveryResult, OutboundMessage, Transport } from '../types.js'

/**
 * In-app delivery: a row in the recipient's inbox.
 *
 * This is the one channel whose destination is inside the system, so it
 * cannot bounce and never needs credentials — which is why it is the sensible
 * default for a tenant that has not configured anything else.
 *
 * It writes into the existing notifications table rather than a new one. That
 * table was already the inbox the UI reads; what changes is that rows now
 * arrive through the outbox, carrying message_id, so an in-app notice and the
 * email about the same event are visibly one message that went two ways.
 */
export const inAppTransport: Transport = {
  name: 'in_app',

  unavailableReason(): string | null {
    return null
  },

  async send(message: OutboundMessage, _config: ChannelConfig): Promise<DeliveryResult> {
    // An in-app message needs somewhere to land. A recipient with no account
    // — an applicant, a parent — can only be reached off-platform, and the
    // dispatcher should never have routed this here.
    if (!message.recipientUserId) {
      return {
        status: 'failed',
        error: 'An in-app notification needs a recipient with an account',
        retryable: false,
      }
    }

    const inserted = await query(
      `INSERT INTO notifications
         (tenant_id, recipient_user_id, category, subject, body, channel, status,
          message_id, sent_at)
       VALUES ($1, $2, $3, $4, $5, 'in_app', 'sent', $6, CURRENT_TIMESTAMP)
       RETURNING id`,
      [
        message.tenantId,
        message.recipientUserId,
        message.category,
        message.subject ?? message.body.slice(0, 120),
        message.body,
        message.id,
      ]
    )

    return {
      status: 'sent',
      providerMessageId: inserted.rows[0].id,
      providerResponse: 'Delivered to the in-app inbox',
    }
  },
}
