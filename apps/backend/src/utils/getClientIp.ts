import { Request } from 'express'

/**
 * The address of the client that made the request.
 *
 * This used to take the first X-Forwarded-For entry from any request, so any
 * client could name whatever address it liked: the IP allowlist, the audit
 * trail and sign-in throttling all believed it. It now uses Express's req.ip,
 * which honours forwarding headers only from proxies the deployment says it
 * has (TRUST_PROXY, set in server.ts).
 */
export function getClientIp(req: Request): string {
  let ip = req.ip || req.socket?.remoteAddress || 'unknown'
  // Normalize IPv6 loopback and IPv4-mapped IPv6
  if (ip === '::1' || ip === '::ffff:127.0.0.1') ip = '127.0.0.1'
  if (ip.startsWith('::ffff:')) ip = ip.slice(7)
  return ip
}
