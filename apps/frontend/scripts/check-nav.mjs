#!/usr/bin/env node
/**
 * Checks the navigation against the router.
 *
 * The four sidebars this shell replaced each held their own copy of the route
 * table, and the copies had drifted: the HR pages were in no menu at all, two
 * entries pointed at routes that had never existed, and several real pages
 * were reachable only by typing a URL. Nothing caught any of it, because
 * nothing compared the two.
 *
 * This does. It fails when a menu entry marked 'ready' points somewhere the
 * router does not go, when an entry marked 'planned' turns out to have a page
 * after all, and when a route exists that no menu offers and no exemption
 * covers.
 *
 * It reads both files as text rather than importing them, so it needs no
 * bundler and no browser, and runs in CI beside the other gates.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appSrc = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
const navSrc = fs.readFileSync(path.join(root, 'src/navigation/navConfig.ts'), 'utf8');

// --- the routes the router actually serves --------------------------------

/**
 * Route groups are declared as `path="/hr/*"` with nested `<Route path="...">`
 * inside. The nested paths are relative, so each is joined to its group.
 */
function collectRoutes(src) {
  // Each group is `path="/hr/*"` followed by exactly one <Routes> block. The
  // block ends at its own </Routes>, not at the next group — bounding it at
  // the next group instead lets the last one run to end of file and swallow
  // every top-level route after it, which is how this check first reported
  // a /student/dashboard that does not exist.
  const groups = [...src.matchAll(/path="(\/[a-z/]*)\*"/g)].map((m) => {
    const open = src.indexOf('<Routes>', m.index);
    const close = src.indexOf('</Routes>', open);
    return { prefix: m[1].replace(/\/$/, ''), from: open, to: close };
  });

  const inSomeGroup = (i) => groups.some((g) => i > g.from && i < g.to);

  const routes = new Set();

  // Routes declared outside any group: the public pages and the legacy
  // post-sign-in landing.
  for (const m of src.matchAll(/<Route\s+path="([^"]+)"/g)) {
    const p = m[1];
    if (p.includes('*') || inSomeGroup(m.index)) continue;
    routes.add(p);
  }

  for (const g of groups) {
    const block = src.slice(g.from, g.to);
    for (const m of block.matchAll(/<Route\s+path="([^"]+)"/g)) {
      const p = m[1];
      if (p.includes('*')) continue;
      routes.add(p === '/' ? g.prefix : g.prefix + p);
    }
  }
  return routes;
}

// --- what the navigation offers -------------------------------------------

function collectNavItems(src) {
  const items = [];
  for (const m of src.matchAll(
    /\{\s*label:\s*'([^']+)',\s*to:\s*'([^']+)',[\s\S]*?status:\s*'(ready|planned)'/g
  )) {
    items.push({ label: m[1], to: m[2], status: m[3] });
  }
  // `home` on each audience has to be somewhere real too.
  for (const m of src.matchAll(/home:\s*'([^']+)'/g)) {
    items.push({ label: '(home)', to: m[1], status: 'ready' });
  }
  return items;
}

/**
 * Routes that legitimately appear in no menu.
 *
 * Each needs a reason. "It is hard to categorise" is not one — an
 * unreachable page is the defect this gate exists to catch.
 */
const UNLISTED = new Map([
  ['/', 'the public landing page'],
  ['/login', 'reached before there is a menu'],
  ['/login-superadmin', 'reached before there is a menu'],
  ['/register', 'reached before there is a menu'],
  ['/register-superadmin', 'reached before there is a menu'],
  ['/change-password', 'reached from the account menu and from a forced reset'],
  ['/account/security', 'reached from the shield in the sidebar account area, and forced for roles that must use two-factor'],
  ['/forgot-password', 'reached from the sign-in page, before there is a menu'],
  ['/reset-password', 'reached from the link in a password-reset email'],
  ['/activate', 'reached from the link in an account invitation'],
  ['/unauthorized', 'an error destination, not a place to go'],
  ['/dashboard', 'the legacy post-sign-in landing; each audience has its own home'],
  ['/admin', 'legacy tenant panel, superseded by /admin/school and /admin/corporate'],
  ['/admin/dashboard', 'legacy tenant panel'],
  ['/admin/tenants', 'legacy tenant panel'],
  ['/admin/school', 'redirects to /admin/school/dashboard'],
  ['/admin/corporate', 'redirects to /admin/corporate/dashboard'],
  ['/superadmin', 'redirects to /superadmin/dashboard'],
  ['/superadmin/console', 'the same redirect as /superadmin'],
  ['/superadmin/incident/:incidentId', 'a detail page, reached from an incident rather than from a menu'],
  ['/superadmin/entities', 'an alias of /superadmin/management'],
  ['/superadmin/tenants', 'an alias of /superadmin/management'],
  ['/guardian/children/:studentId', 'a detail page, reached from the guardian\'s list of children'],
]);

// --- the comparison --------------------------------------------------------

const routes = collectRoutes(appSrc);
const items = collectNavItems(navSrc);
const problems = [];

for (const item of items) {
  const exists = routes.has(item.to);
  if (item.status === 'ready' && !exists) {
    problems.push(`menu entry "${item.label}" points at ${item.to}, which the router does not serve`);
  }
  if (item.status === 'planned' && exists) {
    problems.push(`menu entry "${item.label}" is marked planned but ${item.to} is a real route now`);
  }
}

const offered = new Set(items.filter((i) => i.status === 'ready').map((i) => i.to));
for (const route of [...routes].sort()) {
  if (offered.has(route) || UNLISTED.has(route)) continue;
  problems.push(`route ${route} is in no menu and has no entry in UNLISTED saying why`);
}

const stale = [...UNLISTED.keys()].filter((r) => !routes.has(r));
for (const r of stale) {
  problems.push(`UNLISTED still excuses ${r}, which is no longer a route`);
}

if (problems.length) {
  console.error('navigation does not match the router:\n');
  for (const p of problems) console.error(`  - ${p}`);
  console.error(`\n${problems.length} problem(s)`);
  process.exit(1);
}

console.log(`checked ${items.length} menu entries against ${routes.size} routes`);
console.log(`${UNLISTED.size} routes deliberately unlisted`);
console.log('0 problems');
