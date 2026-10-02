/**
 * Every route the API serves, read from the Express routers themselves, so
 * a route added anywhere is in the inventory without anyone listing it.
 *
 *   npx tsx src/scripts/routeInventory.ts            print JSON to stdout
 *   npx tsx src/scripts/routeInventory.ts --write    update docs/api/route-inventory.json
 *   npx tsx src/scripts/routeInventory.ts --check    fail if that file is stale
 *
 * Read by the cross-tenant fuzzer (src/tests/crossTenantFuzz.manual.ts).
 * Express 4 keeps a router's mount path only inside a regular expression,
 * so the mounts are recorded as they happen: app.use and router.use are
 * wrapped before the server module is imported.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import express from 'express'

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

export async function inventory(): Promise<RouteEntry[]> {
  const { app } = (await import('../server.js')) as { app: any }
  // Routes declared on the app itself live on its internal router.
  const appRouter = app._router
  const prefixes = (owner: Owner, seen = new Set<Owner>()): string[] => {
    if (owner === app || owner === appRouter) return ['']
    if (seen.has(owner)) return []
    seen.add(owner)
    const out: string[] = []
    for (const m of mounts.get(owner) ?? []) for (const p of prefixes(m.parent, seen)) out.push(p + m.path)
    return out
  }

  const routes = new Map<string, RouteEntry>()
  for (const owner of [appRouter, ...mounts.keys()]) {
    for (const layer of (owner as any).stack ?? []) {
      if (!layer.route) continue
      const routePaths: unknown[] = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path]
      for (const rp of routePaths) {
        if (typeof rp !== 'string') continue
        for (const prefix of prefixes(owner)) {
          const full = (prefix + rp).replace(/\/+/g, '/').replace(/(.)\/$/, '$1')
          for (const method of Object.keys(layer.route.methods).filter((m) => m !== '_all')) {
            const key = `${method.toUpperCase()} ${full}`
            routes.set(key, { method: method.toUpperCase(), path: full, params: [...full.matchAll(/:(\w+)/g)].map((m) => m[1]) })
          }
        }
      }
    }
  }
  return [...routes.values()].sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method))
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'docs', 'api', 'route-inventory.json')
  inventory()
    .then((routes) => {
      const json = JSON.stringify(routes, null, 2) + '\n'
      if (process.argv.includes('--write')) {
        fs.mkdirSync(path.dirname(out), { recursive: true })
        fs.writeFileSync(out, json)
        console.error(`${routes.length} routes written to docs/api/route-inventory.json`)
      } else if (process.argv.includes('--check')) {
        const current = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : ''
        if (current !== json) {
          console.error('docs/api/route-inventory.json is stale: run `npx tsx src/scripts/routeInventory.ts --write`')
          process.exit(1)
        }
        console.error(`route inventory current (${routes.length} routes)`)
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
