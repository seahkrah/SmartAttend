import { Request, Response, NextFunction } from 'express'
import { query } from '../db/connection.js'
import { logAuditEntry, extractAuditContext } from '../services/auditService.js'

/**
 * IP Allowlist Enforcement Middleware
 * Restricts superadmin operations to pre-approved IP addresses
 */

export interface IpAllowlistEntry {
  id: string
  superadminUserId: string
  ipAddress: string
  ipRange?: string // CIDR notation, e.g., "192.168.1.0/24"
  description?: string
  addedAt: Date
  expiresAt?: Date
  isActive: boolean
}

/**
 * Parse IP address to compare
 */
function parseIp(ipStr: string): number[] {
  return ipStr.split('.').map(x => parseInt(x, 10))
}

/**
 * Check if IP is in CIDR range
 */
function isIpInCidr(ip: string, cidr: string): boolean {
  try {
    const [range, bits] = cidr.split('/')
    const rangeParts = parseIp(range)
    const ipParts = parseIp(ip)
    const maskBits = parseInt(bits || '32', 10)

    for (let i = 0; i < rangeParts.length; i++) {
      const rangeByte = rangeParts[i]
      const ipByte = ipParts[i]

      if (maskBits >= (i + 1) * 8) {
        // Full octet comparison
        if (rangeByte !== ipByte) return false
      } else if (maskBits > i * 8) {
        // Partial octet comparison
        const shift = 8 - (maskBits % 8)
        if ((rangeByte >> shift) !== (ipByte >> shift)) return false
      } else {
        break
      }
    }
    return true
  } catch (error) {
    console.error('[IP_ALLOWLIST] Error checking CIDR:', error)
    return false
  }
}

/**
 * Get allowlisted IPs for a superadmin user
 */
export async function getAllowlistedIps(userId: string): Promise<IpAllowlistEntry[]> {
  try {
    const result = await query(
      `SELECT id, superadmin_user_id, ip_address, ip_range, description, added_at, expires_at, is_active
       FROM superadmin_ip_allowlist
       WHERE superadmin_user_id = $1 AND is_active = TRUE AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY added_at DESC`,
      [userId]
    )

    return result.rows.map(row => ({
      id: row.id,
      superadminUserId: row.superadmin_user_id,
      ipAddress: row.ip_address,
      ipRange: row.ip_range,
      description: row.description,
      addedAt: new Date(row.added_at),
      expiresAt: row.expires_at ? new Date(row.expires_at) : undefined,
      isActive: row.is_active
    }))
  } catch (error) {
    console.error('[IP_ALLOWLIST] Error fetching allowlist:', error)
    return []
  }
}

/**
 * Check if an IP address is allowlisted for a user
 */
export async function isIpAllowlisted(userId: string, ipAddress: string): Promise<boolean> {
  const allowlist = await getAllowlistedIps(userId)

  if (allowlist.length === 0) {
    // If no allowlist entries, allow all IPs (open policy)
    return true
  }

  for (const entry of allowlist) {
    if (entry.ipAddress === ipAddress) {
      return true
    }
    if (entry.ipRange && isIpInCidr(ipAddress, entry.ipRange)) {
      return true
    }
  }

  return false
}

/**
 * Add IP to allowlist
 */
export async function addIpToAllowlist(
  userId: string,
  ipAddress: string,
  options?: {
    description?: string
    expiresAt?: Date
  }
): Promise<string> {
  try {
    const result = await query(
      `INSERT INTO superadmin_ip_allowlist (superadmin_user_id, ip_address, description, expires_at, is_active)
       VALUES ($1, $2, $3, $4, TRUE)
       RETURNING id`,
      [userId, ipAddress, options?.description || null, options?.expiresAt?.toISOString() || null]
    )

    return result.rows[0].id
  } catch (error) {
    console.error('[IP_ALLOWLIST] Error adding IP:', error)
    throw error
  }
}

/**
 * Remove IP from allowlist
 */
export async function removeIpFromAllowlist(userId: string, ipAddress: string): Promise<void> {
  try {
    await query(
      `UPDATE superadmin_ip_allowlist SET is_active = FALSE WHERE superadmin_user_id = $1 AND ip_address = $2`,
      [userId, ipAddress]
    )
  } catch (error) {
    console.error('[IP_ALLOWLIST] Error removing IP:', error)
    throw error
  }
}

/**
 * IP Allowlist Enforcement Middleware
 * Checks if the request IP is allowlisted for the user
 */
export async function ipAllowlistMiddleware(req: Request, res: Response, next: NextFunction) {
  const userId = req.user?.userId
  const requestIp = req.ip || 'unknown'

  if (!userId) {
    return next() // Not authenticated, let auth middleware handle it
  }

  try {
    const isAllowed = await isIpAllowlisted(userId, requestIp)

    if (!isAllowed) {
      // Log attempted access from non-allowlisted IP
      const auditContext = extractAuditContext(req, 'IP_ALLOWLIST_VIOLATION', 'GLOBAL')
      await logAuditEntry(auditContext).catch(err => console.warn('[AUDIT] Non-critical failure:', err))

      return res.status(403).json({
        error: 'Access denied',
        code: 'IP_NOT_ALLOWLISTED',
        message: 'Your IP address is not allowlisted for superadmin operations',
        recoveryHint: 'Contact your system administrator to add your IP to the allowlist',
        requestedIp: requestIp
      })
    }

    next()
  } catch (error: any) {
    console.error('[IP_ALLOWLIST] Error in middleware:', error)
    // Fail open in case of errors
    next()
  }
}

/**
 * Soft warning if IP is about to expire from allowlist
 */
export async function warnIfIpExpiringSoon(expirationWarningDays: number = 7) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.user?.userId
    const requestIp = req.ip

    if (!userId || !requestIp) {
      return next()
    }

    try {
      const allowlist = await getAllowlistedIps(userId)
      const currentEntry = allowlist.find(e => e.ipAddress === requestIp)

      if (currentEntry && currentEntry.expiresAt) {
        const daysUntilExpiry = (currentEntry.expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
        if (daysUntilExpiry < expirationWarningDays && daysUntilExpiry > 0) {
          res.setHeader(
            'X-IP-Allowlist-Warning',
            `Your IP allowlist entry expires in ${Math.ceil(daysUntilExpiry)} days`
          )
        }
      }
    } catch (error) {
      console.warn('[IP_ALLOWLIST] Warning check failed:', error)
    }

    next()
  }
}
