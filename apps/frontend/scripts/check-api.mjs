#!/usr/bin/env node
/**
 * Every API call the frontend makes must name a route the backend serves.
 *
 * Found by hand once already: a dashboard called /attendance/stats/:id, which
 * never existed, and covered the 404 with invented numbers. This gate reads
 * the backend's mounts (server.ts) and route files, reads every call in the
 * frontend source, and fails the build on a call with no matching route.
 *
 * Calls are matched on method and path shape: `${id}` in a template becomes a
 * parameter, and a backend `:param` matches any single segment. Calls whose
 * path cannot be read statically are listed as skipped, not passed.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const FRONT = path.resolve(here, '..', 'src');
const BACK = path.resolve(here, '..', '..', 'backend', 'src');

// ---------------------------------------------------------------- backend
const server = fs.readFileSync(path.join(BACK, 'server.ts'), 'utf8');
const imports = new Map();
for (const m of server.matchAll(/import\s+(\w+)\s+from\s+'\.\/routes\/([\w.]+)\.js'/g)) imports.set(m[1], m[2]);
const mounts = [];
for (const m of server.matchAll(/app\.use\(\s*'([^']+)'\s*,\s*(\w+)\s*\)/g)) {
  if (imports.has(m[2])) mounts.push({ prefix: m[1], file: imports.get(m[2]) });
}

const routes = [];
for (const { prefix, file } of mounts) {
  const src = fs.readFileSync(path.join(BACK, 'routes', `${file}.ts`), 'utf8');
  for (const m of src.matchAll(/router\.(get|post|put|patch|delete)\(\s*['`]([^'`]+)['`]/g)) {
    routes.push({ method: m[1].toUpperCase(), path: (prefix + (m[2] === '/' ? '' : m[2])).replace(/\/$/, '') || '/', file });
  }
}

function matches(route, call) {
  if (route.method !== call.method) return false;
  const r = route.path.split('/').filter(Boolean);
  const c = call.path.split('/').filter(Boolean);
  if (r.length !== c.length) return false;
  return r.every((seg, i) => seg.startsWith(':') || c[i] === ':param' || seg === c[i]);
}

// ---------------------------------------------------------------- frontend
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'dev' ? [] : walk(p);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name) ? [p] : [];
  });
}

const calls = [];
const skipped = [];
// axiosClient / this.client / apiClient / axios / api  .get('...') etc.
const CALL = /\b(axiosClient|client|apiClient|axios|api|http)\.(get|post|put|patch|delete)(?:<[^>]*>)?\(\s*(['`])((?:(?!\3).)*)\3/g;
for (const file of walk(FRONT)) {
  const src = fs.readFileSync(file, 'utf8');
  for (const m of src.matchAll(CALL)) {
    let raw = m[4];
    const line = src.slice(0, m.index).split('\n').length;
    const where = `${path.relative(FRONT, file)}:${line}`;
    if (/^https?:/.test(raw)) continue;
    // A template expression glued to the end of a segment adds a query
    // string (`/download${inline ? '?inline=true' : ''}`), not a segment.
    raw = raw.replace(/([^/])\$\{[^}]*\}$/, '$1');
    raw = raw.replace(/\$\{[^}]*\}/g, (m) => m.replace(/\?/g, ''));
    raw = raw.split('?')[0];
    if (raw.includes('${') && /^\$\{[^}]+\}$/.test(raw.split('/')[0])) { skipped.push(where); continue; }
    let p = raw.replace(/\$\{[^}]+\}/g, ':param');
    // axios with an absolute /api path; the instances prefix /api themselves.
    if (!p.startsWith('/api')) p = '/api' + (p.startsWith('/') ? p : '/' + p);
    p = p.replace(/\/$/, '');
    calls.push({ method: m[2].toUpperCase(), path: p, where });
  }
}

const missing = calls.filter((c) => !routes.some((r) => matches(r, c)));
const seen = new Set();
const unique = missing.filter((c) => { const k = `${c.method} ${c.path}`; if (seen.has(k)) return false; seen.add(k); return true; });

console.log(`checked ${calls.length} API calls against ${routes.length} backend routes`);
if (skipped.length) console.log(`${skipped.length} calls with a dynamic base path were not checked`);
if (unique.length) {
  console.log(`\n${unique.length} call(s) with no backend route:`);
  for (const c of unique) {
    const at = missing.filter((m) => m.method === c.method && m.path === c.path).map((m) => m.where);
    console.log(`  ${c.method} ${c.path}   <- ${at.join(', ')}`);
  }
  process.exit(1);
}
console.log('0 problems');
