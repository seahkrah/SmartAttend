import type { ProviderName, Transport } from '../types.js'
import { logTransport } from './log.js'
import { smtpTransport } from './smtp.js'
import { webhookTransport } from './webhook.js'
import { inAppTransport } from './inApp.js'

const TRANSPORTS: Record<ProviderName, Transport> = {
  log: logTransport,
  smtp: smtpTransport,
  webhook: webhookTransport,
  in_app: inAppTransport,
}

export function transportFor(provider: ProviderName): Transport {
  return TRANSPORTS[provider] ?? logTransport
}

export { logTransport, smtpTransport, webhookTransport, inAppTransport }
export { closeSmtpPools } from './smtp.js'
export { verifyRelaySignature } from './webhook.js'
