/**
 * What each route requires, readable from the route itself.
 *
 * Every middleware that decides who may reach a route carries a tag. The
 * route inventory (src/scripts/routeInventory.ts --permissions) walks each
 * route's middleware chain, collects the tags and writes
 * docs/api/permission-map.json. scripts/checks/permission-coverage.mjs fails
 * when a route declares nothing, and the privilegeEscalation suite calls each
 * role-guarded route as a role the map leaves out.
 *
 * A route whose rule lives inside its handler (a role that depends on the
 * record, a person reading only their own) says so with `checkedInHandler`,
 * so the rule is written down where a reviewer will see it. A route anyone
 * may call says so with `publicRoute`.
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express'

export type GuardTag =
  | { kind: 'authenticated' }
  | { kind: 'tenant' }
  | { kind: 'platform'; values: string[] }
  | { kind: 'roles'; values: string[] }
  | { kind: 'superadmin' }
  | { kind: 'public'; reason: string }
  | { kind: 'self'; what: string }
  | { kind: 'member'; what: string }
  | { kind: 'inHandler'; rule: string }

const GUARD = Symbol.for('jjelotech.guard')

export function tagged<F extends (...args: any[]) => unknown>(fn: F, tag: GuardTag): F {
  Object.defineProperty(fn, GUARD, { value: tag, enumerable: false })
  return fn
}

export function guardOf(fn: unknown): GuardTag | undefined {
  return typeof fn === 'function' ? ((fn as any)[GUARD] as GuardTag | undefined) : undefined
}

const pass = (_req: Request, _res: Response, next: NextFunction) => next()

/** Marks a route anyone may call, with why. Does nothing at run time. */
export function publicRoute(reason: string): RequestHandler {
  return tagged((req: Request, res: Response, next: NextFunction) => pass(req, res, next), { kind: 'public', reason })
}

/**
 * Marks a route that serves only the caller's own records: nothing the caller
 * sends selects another person. Does nothing at run time.
 */
export function selfService(what: string): RequestHandler {
  return tagged((req: Request, res: Response, next: NextFunction) => pass(req, res, next), { kind: 'self', what })
}

/**
 * Marks a route any member of the tenant may call (reference data such as
 * terms or leave types). Does nothing at run time.
 */
export function anyMember(what: string): RequestHandler {
  return tagged((req: Request, res: Response, next: NextFunction) => pass(req, res, next), { kind: 'member', what })
}

/**
 * Marks a route whose authorisation is decided inside its handler, with the
 * rule in words. Does nothing at run time: the handler must enforce it.
 */
export function checkedInHandler(rule: string): RequestHandler {
  return tagged((req: Request, res: Response, next: NextFunction) => pass(req, res, next), { kind: 'inHandler', rule })
}
