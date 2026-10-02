/**
 * Whose data a database call is for, carried through async code without
 * being passed by hand.
 *
 * Three modes:
 *   tenant  app.tenant_id is set; row-level security shows that tenant only.
 *   none    no tenant is known yet (pre-authentication, identity lookups):
 *           tenant tables return no rows.
 *   system  explicit cross-tenant work (control plane, identity, jobs). Uses
 *           the system pool, which RLS does not filter. Only through
 *           runAsSystem(), and only from the files allow-listed in
 *           scripts/checks/no-raw-query.mjs.
 *
 * src/db/connection.ts reads this on every connection checkout.
 * Decision: docs/decisions/2026-10-02-adopt-rls.md
 */
import { AsyncLocalStorage } from 'async_hooks'

export type DbContext =
  | { mode: 'tenant'; tenantId: string; userId: string | null }
  | { mode: 'none'; userId: string | null }
  | { mode: 'system'; reason: string; userId: string | null }

const storage = new AsyncLocalStorage<DbContext>()

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The context in force; outside any, "none". */
export function currentDbContext(): DbContext {
  return storage.getStore() ?? { mode: 'none', userId: null }
}

/**
 * Runs fn with tenant data visible for tenantId only. A malformed id is
 * refused here rather than turned into a cast error inside every query.
 */
export function withTenant<T>(ctx: { tenantId: string; userId?: string | null }, fn: () => T): T {
  if (!UUID.test(ctx.tenantId)) throw new Error('withTenant: tenantId must be a UUID')
  if (ctx.userId && !UUID.test(ctx.userId)) throw new Error('withTenant: userId must be a UUID')
  return storage.run({ mode: 'tenant', tenantId: ctx.tenantId, userId: ctx.userId ?? null }, fn)
}

/** Runs fn with no tenant: tenant tables return nothing. */
export function withNoTenant<T>(fn: () => T, userId: string | null = null): T {
  return storage.run({ mode: 'none', userId }, fn)
}

/**
 * Runs fn across tenants, on the system pool. The reason is required so a
 * reader of the call site, and the audit pass, can see why the boundary is
 * being stepped over.
 */
export function runAsSystem<T>(reason: string, fn: () => T): T {
  if (!reason || reason.trim().length < 8) throw new Error('runAsSystem: give a reason')
  const userId = currentDbContext().userId ?? null
  return storage.run({ mode: 'system', reason, userId }, fn)
}
