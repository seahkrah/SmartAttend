#!/usr/bin/env node
/**
 * Every route declares who may call it.
 *
 * docs/api/permission-map.json is generated from the routers themselves
 * (apps/backend/src/scripts/routeInventory.ts --permissions): each route with
 * the guard tags (src/auth/guards.ts) of every middleware that runs before
 * its handler. This check fails when:
 *
 *   1. the committed map is stale (a route or a guard changed without it);
 *   2. the map and docs/api/route-inventory.json list different routes;
 *   3. a route is neither public nor behind authentication;
 *   4. an authenticated route declares no authorisation: no role guard, no
 *      superadmin guard, and no written rule (own records only, any member,
 *      or a rule its handler enforces);
 *   5. a declaration is empty (a role guard with no roles, a rule with no
 *      words);
 *   6. a guard sits after the route's handler, where it never runs first.
 *
 * router.all and RegExp routes are in the map (as ALL, and under their
 * pattern) but not in the inventory, and must be declared like the rest.
 *
 * The privilegeEscalation suite then tests the role guards the map lists.
 *
 *   node scripts/checks/permission-coverage.mjs           check
 *   node scripts/checks/permission-coverage.mjs --no-regen  check the committed map only
 */
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const MAP = path.join(ROOT, 'docs', 'api', 'permission-map.json')
const INVENTORY = path.join(ROOT, 'docs', 'api', 'route-inventory.json')
const AUTHZ = new Set(['roles', 'superadmin', 'self', 'member', 'inHandler'])

const problems = []

if (!process.argv.includes('--no-regen')) {
  try {
    execSync('npx tsx src/scripts/routeInventory.ts --permissions --check', {
      cwd: path.join(ROOT, 'apps', 'backend'),
      stdio: ['ignore', 'ignore', 'pipe'],
      encoding: 'utf8',
      env: { ...process.env, NODE_ENV: process.env.NODE_ENV ?? 'test' },
    })
  } catch (e) {
    const tail = String(e.stderr ?? e.message)
      .trim()
      .split('\n')
      .slice(-3)
      .join(' | ')
    problems.push(`permission map could not be confirmed current: ${tail}`)
  }
}

const map = JSON.parse(fs.readFileSync(MAP, 'utf8'))
const inventory = JSON.parse(fs.readFileSync(INVENTORY, 'utf8'))
const key = r => `${r.method} ${r.path}`
const mapped = new Set(map.filter(r => r.method !== 'ALL' && !r.path.includes('regexp:')).map(key))
const listed = new Set(inventory.map(key))
for (const k of listed) if (!mapped.has(k)) problems.push(`${k}: in the route inventory but not the permission map`)
for (const k of mapped) if (!listed.has(k)) problems.push(`${k}: in the permission map but not the route inventory`)

const text = v => typeof v === 'string' && v.trim().length >= 3
for (const r of map) {
  const kinds = new Set(r.guards.map(g => g.kind))
  if (r.guardAfterHandler) problems.push(`${key(r)}: a guard after the handler, where it cannot run first`)
  for (const g of r.guards) {
    if ((g.kind === 'roles' || g.kind === 'platform') && !(Array.isArray(g.values) && g.values.length)) {
      problems.push(`${key(r)}: a ${g.kind} guard with nothing in it`)
    }
    if (g.kind === 'public' && !text(g.reason)) problems.push(`${key(r)}: public with no reason`)
    if (g.kind === 'inHandler' && !text(g.rule)) problems.push(`${key(r)}: a handler rule with no words`)
    if ((g.kind === 'self' || g.kind === 'member') && !text(g.what))
      problems.push(`${key(r)}: ${g.kind} with no description`)
  }
  if (kinds.has('public')) {
    if (kinds.has('authenticated')) problems.push(`${key(r)}: declared public but behind authentication`)
    continue
  }
  if (!kinds.has('authenticated')) {
    problems.push(`${key(r)}: neither public nor behind authentication`)
    continue
  }
  if (![...kinds].some(k => AUTHZ.has(k)))
    problems.push(`${key(r)}: authenticated, but says nothing about who may call it`)
}

const count = kind => map.filter(r => r.guards.some(g => g.kind === kind)).length
if (problems.length) {
  console.error(`permission-coverage: ${problems.length} problem(s)`)
  for (const p of problems.slice(0, 50)) console.error(`  ${p}`)
  if (problems.length > 50) console.error(`  ... and ${problems.length - 50} more`)
  process.exit(1)
}
console.log(
  `permission-coverage: ok (${map.length} routes: ${count('roles')} role-guarded, ${count('superadmin')} superadmin, ` +
    `${count('self')} own records, ${count('member')} any member, ${count('inHandler')} handler rules, ${count('public')} public)`,
)
