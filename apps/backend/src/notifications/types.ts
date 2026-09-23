/**
 * The contract every transport meets.
 *
 * A transport's job is narrow on purpose: take one already-rendered message
 * and try to hand it to something outside this process. It does not decide
 * who to write to, what to say, whether the recipient wants it, or whether to
 * try again — all of that is settled before a message reaches here, and
 * leaving those decisions to each transport is how two channels end up
 * disagreeing about what an opt-out means.
 */

export type Channel = 'email' | 'sms' | 'push' | 'in_app'
export type ProviderName = 'smtp' | 'webhook' | 'in_app' | 'log'

export interface OutboundMessage {
  id: string
  tenantId: string
  channel: Channel
  category: string
  eventKey: string | null
  recipientUserId: string | null
  destination: string
  recipientName: string | null
  subject: string | null
  body: string
  attempt: number
  relatedType: string | null
  relatedId: string | null
}

export interface ChannelConfig {
  channel: Channel
  provider: ProviderName
  isEnabled: boolean
  config: Record<string, unknown>
  secretEnvVar: string | null
  fromName: string | null
  fromAddress: string | null
  replyTo: string | null
  hourlyLimit: number | null
}

export interface DeliveryResult {
  /**
   * 'sent' means a transport outside this process accepted the message.
   * 'simulated' means it was rendered and recorded and went nowhere — the
   * only honest answer when no real transport is configured.
   */
  status: 'sent' | 'simulated' | 'failed'
  providerMessageId?: string | null
  providerResponse?: string | null
  error?: string | null
  /**
   * Whether trying again could plausibly work. A refused mailbox is
   * permanent; a refused connection is not. Retrying a permanent failure
   * forever is how a queue stops moving.
   */
  retryable?: boolean
  /** An address the transport reports as dead, to be suppressed. */
  suppress?: { reason: 'hard_bounce' | 'invalid' | 'complaint'; note?: string }
}

export interface Transport {
  readonly name: ProviderName
  /** Why this transport cannot run, or null if it can. */
  unavailableReason(config: ChannelConfig): string | null
  send(message: OutboundMessage, config: ChannelConfig): Promise<DeliveryResult>
}
