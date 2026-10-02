/**
 * Requests to addresses a tenant chose: its audit collector, its identity
 * provider. They must not become a way into the platform's own network
 * (server-side request forgery), so the address must be HTTPS, carry no
 * credentials, and not resolve to a private, loopback, link-local,
 * carrier-grade NAT or multicast address. Callers also refuse redirects.
 *
 * OUTBOUND_ALLOW_HTTP and OUTBOUND_ALLOW_PRIVATE relax this for local testing,
 * where the collector or the identity provider runs on 127.0.0.1. The check
 * resolves the name once, and the request resolves it again; a name that
 * changes its answer in between (DNS rebinding) is a residual risk, listed in
 * the Phase 2 threat model.
 */
import dns from 'dns/promises'
import net from 'net'

export class OutboundUrlError extends Error {}

/** Whether an address is one a tenant-chosen request must not reach. */
export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number)
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
  }
  const v6 = ip.toLowerCase()
  if (v6.startsWith('::ffff:')) return isPrivateAddress(v6.slice(7))
  return v6 === '::1' || v6 === '::' || v6.startsWith('fe80:') || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('ff')
}

/** Refuses an address that is not HTTPS or that resolves into a private network. */
export async function checkOutboundUrl(raw: unknown, env: NodeJS.ProcessEnv = process.env): Promise<URL> {
  let url: URL
  try {
    url = new URL(String(raw ?? ''))
  } catch {
    throw new OutboundUrlError('Give the full address, starting https://')
  }
  if (url.username || url.password) throw new OutboundUrlError('Do not put credentials in the address')
  const httpOk = env.OUTBOUND_ALLOW_HTTP === 'true'
  if (url.protocol !== 'https:' && !(httpOk && url.protocol === 'http:')) {
    throw new OutboundUrlError('The address must be reached over HTTPS')
  }
  if (env.OUTBOUND_ALLOW_PRIVATE === 'true') return url
  const host = url.hostname.replace(/^\[|\]$/g, '')
  const addrs = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true }).catch(() => [])).map((a) => a.address)
  if (!addrs.length) throw new OutboundUrlError('That address does not resolve')
  if (addrs.some(isPrivateAddress)) throw new OutboundUrlError('That address is on a private network')
  return url
}
