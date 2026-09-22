import type { ResolvedTenantContext, TenantRequest } from './tenantContextMiddleware.js'
import type { Request } from 'express'

/**
 * Who may see which incidents.
 *
 * incidents.affected_tenant_id records the tenant an incident arose in, and
 * nothing consulted it: the list and statistics queries filtered on
 * platform_id — one value shared by every school — and the by-id reads
 * filtered on nothing at all. An incident carries a title, a description, the
 * error that produced it and the affected users, so a school's incidents are
 * a school's business.
 *
 * The three levels:
 *
 *   superadmin     every incident, including the platform-level ones that
 *                  belong to no tenant
 *   administrator  their own tenant's incidents
 *   anyone else    none — an incident report is operational detail, not
 *                  something a student or lecturer is entitled to
 */

const TENANT_ADMIN_ROLES = new Set(['admin', 'hr_director', 'manager', 'it', 'security_officer'])

export interface IncidentVisibility {
  /** SQL predicate over the incidents table, numbered from $1. */
  sql: string
  params: any[]
  /** False when the caller may see no incidents at all. */
  any: boolean
}

export class IncidentAccessError extends Error {
  constructor(message: string, readonly status = 403) {
    super(message)
    this.name = 'IncidentAccessError'
  }
}

export function contextOf(req: Request): ResolvedTenantContext {
  const ctx = (req as TenantRequest).ctx
  if (!ctx) throw new IncidentAccessError('No resolved identity for this request', 401)
  return ctx
}

export function incidentVisibility(ctx: ResolvedTenantContext): IncidentVisibility {
  if (ctx.isSuperadmin) {
    return { sql: 'TRUE', params: [], any: true }
  }

  if (TENANT_ADMIN_ROLES.has(ctx.roleName) && ctx.tenantId) {
    // NULL never matches, so a platform-level incident stays invisible to a
    // tenant administrator without needing a second condition.
    return { sql: 'affected_tenant_id = $1', params: [ctx.tenantId], any: true }
  }

  return { sql: 'FALSE', params: [], any: false }
}

/**
 * Renumbers the predicate's placeholders so it composes with a query that has
 * already bound parameters, and returns the params to append in order.
 */
export function shiftVisibility(
  visibility: IncidentVisibility,
  startAt: number
): { sql: string; params: any[] } {
  if (visibility.params.length === 0) return { sql: visibility.sql, params: [] }
  return {
    sql: visibility.sql.replace(/\$(\d+)/g, (_m, n) => `$${Number(n) + startAt - 1}`),
    params: visibility.params,
  }
}
