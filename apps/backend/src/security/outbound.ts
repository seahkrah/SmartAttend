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

function privateV4(b: number[]): boolean {
  const [a, c] = b
  return a === 10 || a === 127 || a === 0 || (a === 169 && c === 254) || (a === 172 && c >= 16 && c <= 31)
    || (a === 192 && c === 168) || (a === 100 && c >= 64 && c <= 127) || a >= 224
    || (a === 192 && c === 0 && b[2] === 0) || (a === 198 && (c === 18 || c === 19))
}

/** An IPv6 address as its 16 bytes, whatever way it was written; null if it is not one. */
export function ipv6Bytes(ip: string): number[] | null {
  let s = ip.toLowerCase().replace(/^\[|\]$/g, '').split('%')[0]
  if (!net.isIPv6(s)) return null
  // A dotted IPv4 tail (::ffff:127.0.0.1) becomes two hex groups.
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(s)
  if (dotted) {
    const q = dotted[1].split('.').map(Number)
    s = s.slice(0, -dotted[1].length) + ((q[0] << 8) | q[1]).toString(16) + ':' + ((q[2] << 8) | q[3]).toString(16)
  }
  const [head, tail] = s.includes('::') ? s.split('::') : [s, null]
  const h = head ? head.split(':') : []
  const t = tail ? tail.split(':') : []
  const groups = tail === null ? h : [...h, ...Array(8 - h.length - t.length).fill('0'), ...t]
  if (groups.length !== 8) return null
  return groups.flatMap((g) => { const n = parseInt(g || '0', 16); return [n >> 8, n & 255] })
}

/**
 * Whether an address is one a tenant-chosen request must not reach. IPv6
 * forms that carry an IPv4 address (mapped ::ffff:a.b.c.d, also written
 * ::ffff:7f00:1; compatible ::a.b.c.d; NAT64 64:ff9b::/96; 6to4 2002::/16)
 * are judged by that IPv4 address; Teredo (2001::/32), whose client address
 * is hidden, is refused outright.
 */
export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) return privateV4(ip.split('.').map(Number))
  const b = ipv6Bytes(ip)
  if (!b) return true
  const zero = (from: number, to: number) => b.slice(from, to).every((x) => x === 0)
  if (zero(0, 10) && b[10] === 0xff && b[11] === 0xff) return privateV4(b.slice(12))
  if (zero(0, 12)) return zero(12, 15) ? true : privateV4(b.slice(12)) // ::, ::1, ::a.b.c.d
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b) {
    return zero(4, 12) ? privateV4(b.slice(12)) : true // 64:ff9b::/96; 64:ff9b:1::/48 is local
  }
  if (b[0] === 0x20 && b[1] === 0x02) return privateV4(b.slice(2, 6))
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x00 && b[3] === 0x00) return true
  return (b[0] & 0xfe) === 0xfc || (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) || b[0] === 0xff
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
