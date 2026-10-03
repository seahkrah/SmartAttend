import { Response, NextFunction, Request } from 'express'
import { query } from '../db/connection.js'
import { runAsSystem, withNoTenant, withTenant } from '../db/dbContext.js'
import { tagged } from './guards.js'

/**
 * Platform and tenant resolution.
 *
 * The invariant: a request's platform and tenant are derived from the
 * authenticated identity and the server's own membership records. A tenant id
 * supplied by the client — in a path, query string, body, header or cookie —
 * is never trusted as an authorisation input. It may only ever be checked
 * against what the server already resolved.
 *
 * Chain: Platform -> Tenant -> User -> Resource -> Permission.
 *
 * This replaces the previous behaviour, where TenantContext.tenantId was set
 * from users.platform_id. That is the platform ('school' | 'corporate' |
 * 'system'), not the tenant, so every institution on a platform shared one
 * context and no tenant was isolated from another.
 */

export type PlatformKind = 'school' | 'corporate' | 'system'

export interface ResolvedTenantContext {
  userId: string
  roleId: string
  roleName: string
  platformId: string
  platformKind: PlatformKind
  /** Null for system/superadmin identities, which are not tenant-scoped. */
  tenantId: string | null
  tenantName: string | null
  /** Every tenant this user may act in on the current platform. */
  memberships: Array<{ tenantId: string; tenantName: string; platformKind: PlatformKind }>
  isSuperadmin: boolean
}

export interface TenantRequest extends Request {
  ctx?: ResolvedTenantContext
}

const SUPERADMIN_ROLES = new Set(['superadmin'])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Resolves platform, role and tenant membership for the authenticated user.
 *
 * Runs after authenticateToken. Does not reject on its own: a request with no
 * tenant is legitimate for superadmin and for the handful of identity routes.
 * Enforcement is the job of requireTenant / requirePlatform below, so that
 * each route states what it needs.
 */
export async function resolveTenantContext(
  req: TenantRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!req.user?.userId) {
    return next()
  }

  try {
    const identity = await query(
      `SELECT u.id AS user_id,
              u.role_id,
              r.name AS role_name,
              p.id AS platform_id,
              p.name AS platform_kind
         FROM users u
         JOIN roles r ON r.id = u.role_id
         JOIN platforms p ON p.id = u.platform_id
        WHERE u.id = $1 AND u.is_active = TRUE`,
      [req.user.userId]
    )

    if (identity.rows.length === 0) {
      res.status(401).json({ error: 'Unauthorized', message: 'Account is inactive or no longer exists' })
      return
    }

    const row = identity.rows[0]
    const platformKind = row.platform_kind as PlatformKind
    const isSuperadmin = SUPERADMIN_ROLES.has(row.role_name) || platformKind === 'system'

    // Memberships come from the server's own association records, scoped to
    // the platform the identity belongs to. A school identity can never
    // resolve a corporate tenant, and vice versa.
    let memberships: ResolvedTenantContext['memberships'] = []
    if (!isSuperadmin && (platformKind === 'school' || platformKind === 'corporate')) {
      // Identity, not tenant data: which tenants this person belongs to is
      // what decides the tenant, so it cannot be filtered by one.
      const m = await runAsSystem("resolve the caller's own tenant memberships", () => query(
        `SELECT tenant_id, tenant_name, platform_kind
           FROM user_tenant_memberships
          WHERE user_id = $1
            AND platform_kind = $2
            AND status = 'active'`,
        [row.user_id, platformKind]
      ))
      memberships = m.rows.map((r: any) => ({
        tenantId: r.tenant_id,
        tenantName: r.tenant_name,
        platformKind: r.platform_kind,
      }))
    }

    // A session started through single sign-on acts only in the tenant whose
    // identity provider vouched for the person; their other memberships are
    // not this session's to use (audit phase 2, F5).
    const bound = req.user.boundTenantId
    if (bound) memberships = memberships.filter((m) => m.tenantId === bound)

    // A user with exactly one membership is bound to it. With several, the
    // active tenant may be selected per request, but only from this list —
    // never from an arbitrary client value.
    let active = memberships.length === 1 ? memberships[0] : null

    if (!active && memberships.length > 1) {
      const requested = req.header('x-tenant-id')
      if (requested) {
        active = memberships.find(m => m.tenantId === requested) ?? null
        if (!active) {
          res.status(403).json({
            error: 'Forbidden',
            message: 'You are not a member of the requested tenant',
          })
          return
        }
      }
    }

    req.ctx = {
      userId: row.user_id,
      roleId: row.role_id,
      roleName: row.role_name,
      platformId: row.platform_id,
      platformKind,
      tenantId: active?.tenantId ?? null,
      tenantName: active?.tenantName ?? null,
      memberships,
      isSuperadmin,
    }

    // Everything downstream runs bound to this tenant (or to none): every
    // database connection it takes carries app.tenant_id for RLS.
    if (req.ctx.tenantId) withTenant({ tenantId: req.ctx.tenantId, userId: row.user_id }, next)
    else withNoTenant(next, row.user_id)
  } catch (error: any) {
    console.error('[TENANT_CTX] resolution failed:', error)
    res.status(500).json({ error: 'Internal error', message: 'Could not resolve tenant context' })
  }
}

/**
 * Requires a resolved tenant. Use on every tenant-owned route.
 *
 * Superadmins are not exempt by default: a superadmin acting on tenant data
 * must select a tenant explicitly, so that privileged access is deliberate and
 * attributable rather than an accidental consequence of a broad role.
 */
export function requireTenant(req: TenantRequest, res: Response, next: NextFunction): void {
  if (!req.ctx) {
    res.status(401).json({ error: 'Unauthorized', message: 'Authentication required' })
    return
  }

  if (req.ctx.isSuperadmin && !req.ctx.tenantId) {
    const requested = req.header('x-tenant-id')
    if (!requested) {
      res.status(400).json({
        error: 'Tenant required',
        message: 'Select a tenant with the X-Tenant-Id header to act on tenant data',
      })
      return
    }
    // A superadmin may act inside a tenant's data only through break-glass:
    // an open, time-boxed grant with a stated reason, recorded in the
    // tenant's audit trail when opened (POST /api/superadmin/break-glass),
    // and every request under it logged where the tenant can see it.
    // Unknown and malformed tenants read the same: 404.
    if (!UUID.test(requested)) {
      res.status(404).json({ error: 'Tenant not found' })
      return
    }
    const ctx = req.ctx
    const tenantId = requested
    ;(async () => {
      const t = await query(`SELECT id, name FROM tenants WHERE id = $1`, [tenantId])
      if (!t.rows.length) {
        res.status(404).json({ error: 'Tenant not found' })
        return
      }
      await withTenant({ tenantId, userId: ctx.userId }, async () => {
        const grant = await query(
          `SELECT id, expires_at FROM break_glass_grants
            WHERE tenant_id = $1 AND superadmin_id = $2
              AND closed_at IS NULL AND expires_at > CURRENT_TIMESTAMP
            ORDER BY expires_at DESC LIMIT 1`,
          [tenantId, ctx.userId]
        )
        if (!grant.rows.length) {
          res.status(403).json({
            error: 'Break-glass required',
            message:
              'Acting inside a tenant needs an open break-glass grant: POST /api/superadmin/break-glass with the tenant and your reason',
          })
          return
        }
        await query(
          `INSERT INTO break_glass_access_log (tenant_id, grant_id, method, path) VALUES ($1, $2, $3, $4)`,
          [tenantId, grant.rows[0].id, req.method.slice(0, 10), (req.originalUrl.split('?')[0] || '/').slice(0, 500)]
        )
        ctx.tenantId = tenantId
        ctx.tenantName = t.rows[0].name
        next()
      })
    })().catch((error) => {
      console.error('[TENANT_CTX] superadmin tenant selection failed:', error)
      res.status(500).json({ error: 'Internal error', message: 'Could not resolve tenant context' })
    })
    return
  }

  if (!req.ctx.tenantId) {
    res.status(403).json({
      error: 'Forbidden',
      message:
        req.ctx.memberships.length > 1
          ? 'Select a tenant with the X-Tenant-Id header'
          : 'Your account is not associated with any tenant',
    })
    return
  }

  next()
}

/** Restricts a route to one platform. SMS access never implies EMS access. */
export function requirePlatform(...allowed: PlatformKind[]) {
  return tagged((req: TenantRequest, res: Response, next: NextFunction): void => {
    if (!req.ctx) {
      res.status(401).json({ error: 'Unauthorized', message: 'Authentication required' })
      return
    }
    if (req.ctx.isSuperadmin) {
      next()
      return
    }
    if (!allowed.includes(req.ctx.platformKind)) {
      res.status(403).json({
        error: 'Forbidden',
        message: 'Your account does not have access to this platform',
      })
      return
    }
    next()
  }, { kind: 'platform', values: [...allowed] })
}

/** Restricts a route to named roles, checked against the resolved context. */
export function requireRoles(...allowed: string[]) {
  return tagged((req: TenantRequest, res: Response, next: NextFunction): void => {
    if (!req.ctx) {
      res.status(401).json({ error: 'Unauthorized', message: 'Authentication required' })
      return
    }
    if (req.ctx.isSuperadmin) {
      next()
      return
    }
    if (!allowed.includes(req.ctx.roleName)) {
      res.status(403).json({ error: 'Forbidden', message: 'Insufficient permissions' })
      return
    }
    next()
  }, { kind: 'roles', values: [...allowed] })
}

tagged(requireTenant, { kind: 'tenant' })

/** Restricts a route to superadmins, from the resolved identity. */
export const requireSuperadmin = tagged((req: TenantRequest, res: Response, next: NextFunction): void => {
  if (!req.ctx) {
    res.status(401).json({ error: 'Unauthorized', message: 'Authentication required' })
    return
  }
  if (!req.ctx.isSuperadmin) {
    res.status(403).json({ error: 'Superadmin access required' })
    return
  }
  next()
}, { kind: 'superadmin' })
