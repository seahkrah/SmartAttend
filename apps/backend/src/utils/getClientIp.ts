import { Request } from 'express'

/**
 * Extract real client IP address from request.
 * Handles X-Forwarded-For, X-Real-IP headers, and normalizes
 * IPv6 loopback (::1) and IPv4-mapped IPv6 (::ffff:127.0.0.1) to readable IPv4.
 */
export function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for']
  const realIp = req.headers['x-real-ip']
  let ip = typeof forwarded === 'string'
    ? forwarded.split(',')[0].trim()
    : typeof realIp === 'string'
      ? realIp.trim()
      : req.ip || req.socket?.remoteAddress || 'unknown'
  // Normalize IPv6 loopback and IPv4-mapped IPv6
  if (ip === '::1' || ip === '::ffff:127.0.0.1') ip = '127.0.0.1'
  if (ip.startsWith('::ffff:')) ip = ip.slice(7)
  return ip
}
