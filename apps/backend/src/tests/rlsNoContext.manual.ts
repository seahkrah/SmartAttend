/**
 * Row-level security, read side, as the API's runtime role.
 *
 *   - no tenant in context: every tenant table returns no rows;
 *   - tenant A in context: exactly A's rows, and all of them;
 *   - system context: rows of several tenants;
 *   - no view reads around RLS, no SECURITY DEFINER function in public,
 *     every tenant table has forced RLS and a policy;
 *   - a connection released mid-transaction is not reused with stale context.
 *
 * Needs APP_DATABASE_URL (the runtime role) and the e2e seed fixtures. Run by
 * scripts/run-all-e2e.sh as suite "rlsNoContext".
 */
import fs from 'fs'
import path from 'path'
import pg from 'pg'
import pool, { getConnection, query } from '../db/connection.js'
import { runAsSystem, withNoTenant, withTenant } from '../db/dbContext.js'

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    pass++
    console.log(`  ok    ${name}`)
  } else {
    fail++
    console.log(`  FAIL  ${name} ${detail}`)
  }
}

const dir = process.env.E2E_FIXTURE_DIR ?? path.join(process.cwd(), '.e2e-fixtures')
const seed = JSON.parse(fs.readFileSync(path.join(dir, 'seed.json'), 'utf8'))
const A: string = seed.A.tenantId
const B: string = seed.B.tenantId


async function owner(sql: string, params: unknown[] = []) {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await c.connect()
  try {
    return await c.query(sql, params)
  } finally {
    await c.end()
  }
}

async function main() {
  if (!process.env.APP_DATABASE_URL || process.env.APP_DATABASE_URL === process.env.DATABASE_URL) {
    check('APP_DATABASE_URL names a runtime role distinct from DATABASE_URL', false, '(not set: nothing here would be filtered)')
    return
  }

  // Every tenant table that holds any of A's rows: not a sample.
  const tables = (
    await owner(`
      SELECT c.relname AS t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r'
         AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped)
       ORDER BY 1`)
  ).rows.map((r) => r.t as string)
  const withRows: string[] = []
  for (const t of tables) {
    if (Number((await owner(`SELECT count(*) AS n FROM ${t} WHERE tenant_id = $1`, [A])).rows[0].n) > 0) withRows.push(t)
  }
  check(`A has rows in several tenant tables (${withRows.length} of ${tables.length})`, withRows.length >= 10)

  for (const table of withRows) {
    const total = Number((await owner(`SELECT count(*) AS n FROM ${table}`)).rows[0].n)
    const ofA = Number((await owner(`SELECT count(*) AS n FROM ${table} WHERE tenant_id = $1`, [A])).rows[0].n)

    const none = await withNoTenant(() => query(`SELECT count(*) AS n FROM ${table}`))
    check(`${table}: no tenant in context, no rows`, Number(none.rows[0].n) === 0, `(${none.rows[0].n} of ${total})`)

    const asA = await withTenant({ tenantId: A }, () => query(`SELECT tenant_id FROM ${table}`))
    check(`${table}: tenant A sees only A`, asA.rows.every((r: any) => r.tenant_id === A), `(${asA.rowCount} rows)`)
    check(`${table}: and every one of A's rows`, asA.rowCount === ofA, `(${asA.rowCount} vs ${ofA})`)

    // Even a query that names tenant B explicitly gets nothing as A.
    const named = await withTenant({ tenantId: A }, () => query(`SELECT count(*) AS n FROM ${table} WHERE tenant_id = $1`, [B]))
    check(`${table}: asking for B by name, as A, finds nothing`, Number(named.rows[0].n) === 0, `(${named.rows[0].n})`)
  }

  const sys = await runAsSystem('rlsNoContext: prove the system pool sees across tenants', () =>
    query(`SELECT count(DISTINCT tenant_id) AS n FROM students`),
  )
  check('system context sees several tenants', Number(sys.rows[0].n) >= 2, `(${sys.rows[0].n})`)

  // The role itself.
  const role = await query(`SELECT current_user AS u, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`)
  check('the runtime role is not a superuser', role.rows[0].rolsuper === false)
  check('the runtime role cannot bypass RLS', role.rows[0].rolbypassrls === false)
  const member = await query(`SELECT pg_has_role(current_user, 'jjelotech_system', 'MEMBER') AS m`)
  check('the runtime role is not a member of jjelotech_system', member.rows[0].m === false)

  // The catalog: nothing that reads around the policies.
  const unforced = await owner(`
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
       AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped)
       AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity
            OR NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid))`)
  check('every tenant table has forced RLS and a policy', unforced.rowCount === 0, `(${unforced.rows.map((r) => r.relname).join(', ')})`)
  // A policy that exists but admits everything (USING (true)) would pass the
  // check above. Every policy on a tenant table must be the tenant policy.
  const loose = await owner(`
    SELECT p.tablename, p.policyname FROM pg_policies p
     WHERE p.schemaname = 'public'
       AND p.tablename IN (SELECT c.relname FROM pg_class c WHERE EXISTS
             (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped))
       AND NOT (coalesce(p.qual, '') LIKE '%tenant_id = ( SELECT app_current_tenant()%'
                AND coalesce(p.with_check, '') LIKE '%tenant_id = ( SELECT app_current_tenant()%')`)
  check('every policy on a tenant table is the tenant policy', loose.rowCount === 0, `(${loose.rows.map((r) => `${r.tablename}.${r.policyname}`).join(', ')})`)
  // Foreign keys are checked without RLS: every reference between tenant
  // tables needs a same-tenant guard (migration 073 generates them).
  const unguarded = await owner(`
    WITH tt AS (SELECT c.oid FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
                 WHERE ns.nspname = 'public' AND c.relkind = 'r'
                   AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped)),
         fks AS (SELECT con.conrelid AS child, a.attname AS col, con.confrelid AS parent
                   FROM pg_constraint con
                   JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
                   JOIN pg_attribute pa ON pa.attrelid = con.confrelid AND pa.attnum = con.confkey[1]
                  WHERE con.contype = 'f' AND array_length(con.conkey, 1) = 1 AND pa.attname = 'id' AND a.attname <> 'tenant_id'
                    AND con.conrelid IN (SELECT oid FROM tt) AND con.confrelid IN (SELECT oid FROM tt)),
         cov AS (SELECT tg.tgrelid AS child, arr[i] AS col, arr[i + 1] AS parent_name
                   FROM pg_trigger tg JOIN pg_proc p ON p.oid = tg.tgfoid AND p.proname = 'guard_same_tenant'
                   CROSS JOIN LATERAL (SELECT string_to_array(rtrim(encode(tg.tgargs, 'escape'), '\\000'), '\\000') AS arr) x
                   CROSS JOIN LATERAL generate_series(1, coalesce(array_length(arr, 1), 0), 2) AS i
                  WHERE NOT tg.tgisinternal)
    SELECT f.child::regclass::text || '.' || f.col AS ref FROM fks f
     WHERE NOT EXISTS (SELECT 1 FROM cov c WHERE c.child = f.child AND c.col = f.col AND c.parent_name = f.parent::regclass::text)`)
  check('every reference between tenant tables has a same-tenant guard', unguarded.rowCount === 0, `(${unguarded.rows.map((r) => r.ref).slice(0, 8).join(', ')})`)
  // The runtime role reads break-glass grants; only the control plane writes them.
  const grantsWritable = await query(`SELECT has_table_privilege(current_user, 'break_glass_grants', 'INSERT,UPDATE,DELETE') AS w`)
  check('the runtime role cannot write break-glass grants', grantsWritable.rows[0].w === false)
  const logErasable = await query(`SELECT has_table_privilege(current_user, 'break_glass_access_log', 'UPDATE,DELETE') AS w`)
  check('nor edit or erase the break-glass access log', logErasable.rows[0].w === false)
  const views = await owner(`
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'v'
       AND NOT coalesce('security_invoker=true' = ANY (c.reloptions), false)`)
  check('every view runs with the caller’s rights', views.rowCount === 0, `(${views.rows.map((r) => r.relname).join(', ')})`)
  const definer = await owner(`
    SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prosecdef`)
  check('no SECURITY DEFINER function in public', definer.rowCount === 0, `(${definer.rows.map((r) => r.proname).join(', ')})`)

  // A connection handed back mid-transaction must not be trusted: a rollback
  // there would undo its tenant setting.
  // The probe is transaction-local: if the next checkout is still inside the
  // abandoned transaction, it can read it. pg-pool hands out the most
  // recently released idle connection first, so that is the one tested.
  await withTenant({ tenantId: A }, async () => {
    const c = await getConnection()
    await c.query('BEGIN')
    await c.query(`SELECT set_config('jjelo.probe', 'abandoned', true)`)
    c.release()
  })
  const after = await withTenant({ tenantId: B }, () =>
    query(`SELECT current_setting('app.tenant_id') AS t, coalesce(current_setting('jjelo.probe', true), '') AS probe`),
  )
  check('a connection released mid-transaction is not handed out again', after.rows[0].probe !== 'abandoned', `(probe ${after.rows[0].probe})`)
  check('and the next connection carries the right tenant', after.rows[0].t === B, `(${after.rows[0].t})`)
}

main()
  .catch((e) => {
    fail++
    console.error(e)
  })
  .finally(async () => {
    await pool.end().catch(() => {})
    console.log(`\n${pass} passed, ${fail} failed`)
    process.exit(fail === 0 && pass > 0 ? 0 : 1)
  })
