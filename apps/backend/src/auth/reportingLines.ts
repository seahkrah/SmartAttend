/**
 * Whom a caller may act for on the employer platform (finding #41).
 *
 *   - HR, the HR director, an administrator and a superadmin: everyone in
 *     the tenant.
 *   - A manager: the people who report to them, directly or through another
 *     manager (employees.manager_id), never themselves. A manager with no
 *     reports acts for nobody.
 *   - Anyone else: nobody but themselves, and the routes say what that allows.
 *
 * Reporting lines are set by HR (PUT /api/hr/employees/:employeeId/manager),
 * which refuses a line that would make someone their own manager. The walk
 * below uses UNION, so a cycle that got in some other way still ends.
 *
 * Routes treat someone outside the scope as absent (404) rather than
 * forbidden, as they already do for another tenant's records.
 */
import { query } from '../db/connection.js'

export interface ActorContext {
  tenantId: string
  userId: string
  roleName: string
  isSuperadmin?: boolean
}

export interface ReportScope {
  /** The whole tenant. */
  all: boolean
  /** The caller's own employee record here, if any. */
  self: string | null
  /** For a manager, everyone below them; empty otherwise. */
  reports: string[]
}

export function isPeopleAdmin(ctx: ActorContext): boolean {
  return !!ctx.isSuperadmin || ['hr', 'hr_director', 'admin'].includes(ctx.roleName)
}

/** Everyone below an employee in the reporting lines, not including them. */
export async function reportsOf(tenantId: string, managerEmployeeId: string): Promise<string[]> {
  const r = await query(
    `WITH RECURSIVE below AS (
       SELECT id FROM employees WHERE tenant_id = $1 AND manager_id = $2
       UNION
       SELECT e.id FROM employees e JOIN below b ON e.manager_id = b.id WHERE e.tenant_id = $1
     )
     SELECT id FROM below WHERE id <> $2`,
    [tenantId, managerEmployeeId])
  return r.rows.map((x: any) => x.id)
}

export async function reportScope(ctx: ActorContext): Promise<ReportScope> {
  const me = await query(`SELECT id FROM employees WHERE user_id = $1 AND tenant_id = $2 LIMIT 1`, [ctx.userId, ctx.tenantId])
  const self: string | null = me.rows[0]?.id ?? null
  if (isPeopleAdmin(ctx)) return { all: true, self, reports: [] }
  if (ctx.roleName === 'manager' && self) return { all: false, self, reports: await reportsOf(ctx.tenantId, self) }
  return { all: false, self, reports: [] }
}

/** Whether the caller may act for this employee as their manager or HR (not as themselves). */
export function actsFor(scope: ReportScope, employeeId: string | null | undefined): boolean {
  if (!employeeId) return false
  return scope.all || scope.reports.includes(employeeId)
}

/**
 * The employees a list may show for this caller, as a SQL array parameter:
 * null for everyone, otherwise the ids (possibly empty).
 */
export function listFilter(scope: ReportScope, includeSelf = false): string[] | null {
  if (scope.all) return null
  return includeSelf && scope.self ? [...scope.reports, scope.self] : scope.reports
}
