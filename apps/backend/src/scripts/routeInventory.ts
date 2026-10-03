/**
 * Every route the API serves, read from the Express routers themselves, so
 * a route added anywhere is in the inventory without anyone listing it.
 *
 *   npx tsx src/scripts/routeInventory.ts            print JSON to stdout
 *   npx tsx src/scripts/routeInventory.ts --write    update docs/api/route-inventory.json
 *   npx tsx src/scripts/routeInventory.ts --check    fail if that file is stale
 *
 * With --permissions the same three do the same for docs/api/permission-map.json:
 * each route with the guard tags (src/auth/guards.ts) of every middleware
 * that runs before its handler, app-level, router-level and its own.
 *
 * Read by the cross-tenant fuzzer (src/tests/crossTenantFuzz.manual.ts), the
 * permission-coverage gate and the privilegeEscalation suite. Express 4 keeps
 * a router's mount path only inside a regular expression, so the mounts are
 * recorded as they happen: app.use and router.use are wrapped before the
 * server module is imported.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import express from 'express'
import { guardOf, type GuardTag } from '../auth/guards.js'

process.env.JJELO_ROUTE_INVENTORY = '1'

type Owner = object
const mounts = new Map<Owner, Array<{ parent: Owner; path: string }>>()

function isRouter(h: unknown): h is { stack: any[] } {
  return typeof h === 'function' && Array.isArray((h as any).stack)
}

function record(parent: Owner, args: unknown[]) {
  const first = args[0]
  const paths = typeof first === 'string' ? [first] : Array.isArray(first) && first.every((p) => typeof p === 'string') ? first : null
  const handlers = (paths ? args.slice(1) : args).flat()
  for (const h of handlers) {
    if (!isRouter(h)) continue
    for (const p of paths ?? ['']) {
      const list = mounts.get(h) ?? []
      list.push({ parent, path: p === '/' ? '' : p })
      mounts.set(h, list)
    }
  }
}

const appUse = (express as any).application.use
;(express as any).application.use = function (this: Owner, ...args: unknown[]) {
  record(this, args)
  return appUse.apply(this, args)
}
const routerUse = (express.Router as any).use
;(express.Router as any).use = function (this: Owner, ...args: unknown[]) {
  record(this, args)
  return routerUse.apply(this, args)
}

export interface RouteEntry {
  method: string
  path: string
  params: string[]
}

export interface PermissionEntry {
  method: string
  path: string
  guards: GuardTag[]
  /** A guard placed after the route's handler: it never runs before the handler answers. */
  guardAfterHandler?: true
}

/** Whether a middleware layer (app.use / router.use) runs for a path below its router. */
function layerApplies(layer: any, rel: string): boolean {
  return !!layer.regexp?.fast_slash || (layer.regexp instanceof RegExp && layer.regexp.test(rel || '/'))
}

/** Tags of the middleware layers of a router that run, for this path, before a given layer. */
function tagsBefore(owner: any, upto: unknown, rel: string): GuardTag[] {
  const out: GuardTag[] = []
  for (const l of owner?.stack ?? []) {
    if (l === upto) break
    if (l.route || isRouter(l.handle) || !layerApplies(l, rel)) continue
    const t = guardOf(l.handle)
    if (t) out.push(t)
  }
  return out
}

export async function inventory(): Promise<RouteEntry[]> {
  return (await walk()).routes
}

export async function permissionMap(): Promise<PermissionEntry[]> {
  return (await walk()).permissions
}

async function walk(): Promise<{ routes: RouteEntry[]; permissions: PermissionEntry[] }> {
  const { app } = (await import('../server.js')) as { app: any }
  // Routes declared on the app itself live on its internal router.
  const appRouter = app._router
  const isTop = (o: Owner) => o === app || o === appRouter

  // Each way a router is reached: the full path prefix, and the guards of
  // every middleware layer that runs before it on the way down.
  type Way = { prefix: string; tags: GuardTag[] }
  const reach = (owner: Owner, rel: string, seen: Set<Owner> = new Set()): Way[] => {
    if (isTop(owner)) return [{ prefix: '', tags: [] }]
    if (seen.has(owner)) return []
    const out: Way[] = []
    for (const m of mounts.get(owner) ?? []) {
      const parent: any = isTop(m.parent) ? appRouter : m.parent
      const mountLayer = (parent.stack ?? []).find((l: any) => l.handle === owner)
      const relInParent = m.path + rel
      for (const up of reach(m.parent, relInParent, new Set([...seen, owner]))) {
        out.push({ prefix: up.prefix + m.path, tags: [...up.tags, ...tagsBefore(parent, mountLayer, relInParent)] })
      }
    }
    return out
  }

  const routes = new Map<string, RouteEntry>()
  const permissions = new Map<string, PermissionEntry>()
  for (const owner of [appRouter, ...mounts.keys()]) {
    for (const layer of (owner as any).stack ?? []) {
      if (!layer.route) continue
      const routePaths: unknown[] = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path]
      // The handler is the last function on the route. A guard after it never
      // runs before the handler answers, so it does not count, and is flagged.
      const stack: any[] = layer.route.stack ?? []
      const own = stack.slice(0, -1).map((l: any) => guardOf(l.handle)).filter(Boolean) as GuardTag[]
      const guardAfterHandler = stack.length > 0 && !!guardOf(stack[stack.length - 1].handle)
      for (const rp of routePaths) {
        // A RegExp route is in the permission map under its pattern, not in
        // the inventory, whose paths the fuzzer fills in.
        const regex = typeof rp !== 'string'
        if (regex && !(rp instanceof RegExp)) continue
        const rel = regex ? '' : (rp as string)
        const ways = isTop(owner) ? [{ prefix: '', tags: [] as GuardTag[] }] : reach(owner, rel)
        for (const way of ways) {
          const full = regex ? `${way.prefix || ''}regexp:${String(rp)}` : (way.prefix + rel).replace(/\/+/g, '/').replace(/(.)\/$/, '$1')
          const guards = [...way.tags, ...tagsBefore(isTop(owner) ? appRouter : owner, layer, rel), ...own]
          for (const m of Object.keys(layer.route.methods)) {
            // router.all serves every method: in the map as ALL, not in the
            // inventory (there is no one method to call it with).
            const method = m === '_all' ? 'ALL' : m.toUpperCase()
            const key = `${method} ${full}`
            if (!regex && m !== '_all') {
              routes.set(key, { method, path: full, params: [...full.matchAll(/:(\w+)/g)].map((x) => x[1]) })
            }
            // Express answers with the first route that matches, so the first
            // registration of a method and path is the one that serves it.
            if (!permissions.has(key)) {
              permissions.set(key, { method, path: full, guards, ...(guardAfterHandler ? { guardAfterHandler: true as const } : {}) })
            }
          }
        }
      }
    }
  }
  const order = (a: { path: string; method: string }, b: { path: string; method: string }) =>
    a.path.localeCompare(b.path) || a.method.localeCompare(b.method)
  return { routes: [...routes.values()].sort(order), permissions: [...permissions.values()].sort(order) }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const perms = process.argv.includes('--permissions')
  const file = perms ? 'permission-map.json' : 'route-inventory.json'
  const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'docs', 'api', file)
  ;(perms ? permissionMap() : inventory())
    .then((routes: unknown[]) => {
      const json = JSON.stringify(routes, null, 2) + '\n'
      if (process.argv.includes('--write')) {
        fs.mkdirSync(path.dirname(out), { recursive: true })
        fs.writeFileSync(out, json)
        console.error(`${routes.length} routes written to docs/api/${file}`)
      } else if (process.argv.includes('--check')) {
        const current = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : ''
        if (current !== json) {
          console.error(`docs/api/${file} is stale: run \`npx tsx src/scripts/routeInventory.ts${perms ? ' --permissions' : ''} --write\``)
          process.exit(1)
        }
        console.error(`${perms ? 'permission map' : 'route inventory'} current (${routes.length} routes)`)
      } else {
        process.stdout.write(json)
      }
      process.exit(0)
    })
    .catch((e) => {
      console.error(e)
      process.exit(1)
    })
}
